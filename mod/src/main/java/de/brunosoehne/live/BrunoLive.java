package de.brunosoehne.live;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.Level;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Bruno Live: meldet ans Intranet, wer online ist und welche Blöcke des Bauplans stehen.
 *
 * <p>Meldet nur auf dem Server, der im Intranet eingestellt ist. Das Netz läuft in einem eigenen Thread, das Spiel
 * wartet nie auf eine Antwort.
 */
public final class BrunoLive implements ClientModInitializer {
	static final Logger LOG = LoggerFactory.getLogger("bruno-live");
	private static final int TICKS_JE_MELDUNG = 200; // 10 Sekunden
	private static final int TICKS_BEI_RUECKSTAND = 40; // 2 Sekunden, nur solange der erste Stand aufgeholt wird
	private static final int TICKS_NACH_FEHLER = 600; // 30 Sekunden

	private final ExecutorService netz = Executors.newSingleThreadExecutor((r) -> {
		Thread t = new Thread(r, "bruno-live-netz");
		t.setDaemon(true);
		return t;
	});

	// Nur im Spiel-Thread anfassen
	private Intranet intranet;
	private Abgleich abgleich;
	private boolean aktiv;
	private boolean unterwegs;
	private int bisZurMeldung;
	private int sitzung; // alte Antworten nach einem Serverwechsel verwerfen
	private String status = "Noch nicht verbunden.";

	@Override
	public void onInitializeClient() {
		ClientPlayConnectionEvents.JOIN.register((handler, sender, mc) -> sitzungStarten(mc));
		ClientPlayConnectionEvents.DISCONNECT.register((handler, mc) -> sitzungBeenden(mc));
		ClientTickEvents.END_CLIENT_TICK.register(this::tick);
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, kontext) ->
			dispatcher.register(ClientCommands.literal("bruno").executes((c) -> {
				c.getSource().sendFeedback(Component.literal("Bruno Live: " + statusText()));
				return 1;
			})));
	}

	private static Path konfigDatei() {
		return FabricLoader.getInstance().getConfigDir().resolve("bruno-live.json");
	}

	private void sitzungStarten(Minecraft mc) {
		int diese = ++sitzung;
		aktiv = false;
		abgleich = null;
		Path datei = konfigDatei();
		if (!Files.exists(datei)) {
			status = "Keine Konfiguration. Datei im Intranet unter Profil erzeugen und nach config/bruno-live.json legen.";
			return;
		}
		ServerData server = mc.getCurrentServer();
		String adresse = server == null ? null : server.ip;
		boolean einzelspieler = mc.hasSingleplayerServer();
		status = "Verbinde mit dem Intranet …";
		netz.execute(() -> {
			try {
				Intranet.Konfig konfig = Intranet.Konfig.laden(datei);
				Intranet verbindung = new Intranet(konfig);
				JsonObject e = verbindung.einstellungen();
				boolean passt = einzelspieler ? konfig.einzelspieler() : gleicherServer(adresse, e.get("server").getAsString());
				if (!passt) {
					LOG.info("Anderer Server, es wird nichts gemeldet.");
					mc.execute(() -> {
						if (diese == sitzung) status = "Anderer Server, es wird nichts gemeldet.";
					});
					return;
				}
				Abgleich.Vorlage vorlage = null;
				if (!e.get("anker").isJsonNull()) {
					JsonObject a = e.getAsJsonObject("anker");
					vorlage = Abgleich.Vorlage.aus(verbindung.plan(), a.get("x").getAsInt(), a.get("y").getAsInt(), a.get("z").getAsInt());
				}
				Abgleich.Vorlage fertig = vorlage;
				String name = e.get("name").getAsString();
				mc.execute(() -> {
					if (diese != sitzung) return;
					intranet = verbindung;
					abgleich = fertig == null ? null : new Abgleich(fertig);
					aktiv = true;
					bisZurMeldung = 20;
					LOG.info("Live-Abgleich aktiv.");
					status = fertig == null ? "Aktiv, aber im Intranet ist noch kein Standort festgelegt: nur Online-Anzeige." : "Aktiv.";
					if (mc.player != null) mc.player.sendSystemMessage(Component.literal("§6Bruno Live§r: verbunden als " + name + "."));
				});
			} catch (Exception ex) {
				LOG.warn("Verbindung zum Intranet fehlgeschlagen", ex);
				mc.execute(() -> {
					if (diese == sitzung) status = fehlerText(ex);
				});
			}
		});
	}

	private void sitzungBeenden(Minecraft mc) {
		sitzung++;
		if (aktiv && mc.getUser() != null) {
			JsonObject abmeldung = new JsonObject();
			abmeldung.addProperty("mc_name", mc.getUser().getName());
			abmeldung.addProperty("offline", true);
			Intranet verbindung = intranet;
			netz.execute(() -> {
				try {
					verbindung.melden(abmeldung);
				} catch (Exception ex) {
					LOG.debug("Abmelden fehlgeschlagen", ex);
				}
			});
		}
		aktiv = false;
		abgleich = null;
		unterwegs = false;
		status = "Nicht verbunden.";
	}

	private void tick(Minecraft mc) {
		if (!aktiv || mc.level == null || mc.player == null) return;
		boolean oberwelt = mc.level.dimension() == Level.OVERWORLD;
		if (abgleich != null && oberwelt) abgleich.tick(mc.level);
		if (--bisZurMeldung > 0 || unterwegs) return;
		bisZurMeldung = abgleich != null && abgleich.rueckstand() ? TICKS_BEI_RUECKSTAND : TICKS_JE_MELDUNG;
		melden(mc);
	}

	private void melden(Minecraft mc) {
		JsonObject meldung = new JsonObject();
		meldung.addProperty("mc_name", mc.player.getName().getString());
		meldung.addProperty("x", mc.player.getBlockX());
		meldung.addProperty("y", mc.player.getBlockY());
		meldung.addProperty("z", mc.player.getBlockZ());
		meldung.addProperty("dimension", mc.level.dimension().identifier().toString());
		JsonArray online = new JsonArray();
		if (mc.getConnection() != null) {
			for (PlayerInfo p : mc.getConnection().getOnlinePlayers()) online.add(p.getProfile().name());
		}
		meldung.add("online", online);

		Abgleich dieser = abgleich;
		Abgleich.Abgabe abgabe = dieser == null ? null : dieser.abgeben(meldung);
		Intranet verbindung = intranet;
		int diese = sitzung;
		unterwegs = true;
		netz.execute(() -> {
			try {
				verbindung.melden(meldung);
				mc.execute(() -> {
					if (diese != sitzung) return;
					unterwegs = false;
					if (status.startsWith("Fehler")) status = "Aktiv.";
				});
			} catch (Exception ex) {
				boolean neuLaden = ex instanceof Intranet.Abgelehnt a && a.status == 409;
				LOG.warn("Melden fehlgeschlagen: {}", ex.toString());
				mc.execute(() -> {
					if (diese != sitzung) return;
					unterwegs = false;
					if (neuLaden) {
						// Plan oder Standort wurden geändert: frisch anfangen.
						sitzungStarten(mc);
						return;
					}
					if (dieser != null && abgabe != null) dieser.zurueck(abgabe);
					bisZurMeldung = TICKS_NACH_FEHLER;
					status = fehlerText(ex);
				});
			}
		});
	}

	/** Vergleich ohne Port und ohne Groß- und Kleinschreibung. Leer im Intranet heißt: Es wird nirgends gemeldet. */
	static boolean gleicherServer(String adresse, String eingestellt) {
		if (adresse == null || eingestellt == null || eingestellt.isBlank()) return false;
		return host(adresse).equals(host(eingestellt));
	}

	private static String host(String adresse) {
		String a = adresse.trim().toLowerCase(Locale.ROOT);
		int doppelpunkt = a.lastIndexOf(':');
		return doppelpunkt > 0 ? a.substring(0, doppelpunkt) : a;
	}

	private static String fehlerText(Exception ex) {
		if (ex instanceof Intranet.Abgelehnt a && a.status == 401) return "Fehler: Der Schlüssel gilt nicht mehr. Im Profil einen neuen erzeugen.";
		return "Fehler: " + ex.getMessage();
	}

	private String statusText() {
		if (abgleich == null) return status;
		int[] s = abgleich.stand();
		String text = status + " Chunks gesehen: " + s[0] + " von " + s[1] + ", davon " + s[2] + " von " + s[3] + " Blöcken gebaut, offen zum Melden: " + s[4] + ".";
		if (abgleich.unbekannteBloecke > 0) text += " " + abgleich.unbekannteBloecke + " Blockarten im Plan gibt es in dieser Version nicht, siehe Log.";
		return text;
	}
}
