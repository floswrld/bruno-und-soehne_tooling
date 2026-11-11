package de.brunosoehne.live;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.context.CommandContext;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientChunkEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.ClientAsset;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Bruno Live: zeigt im Intranet live, wer auf dem Server ist, wo er steht und welche Blöcke des Bauplans stehen.
 *
 * <p>Eine WebSocket-Leitung zum Live-Raum des Intranets. Positionen gehen bis zu zehnmal pro Sekunde raus, gesetzte
 * Blöcke im selben Tick, in dem das Spiel sie anzeigt. Meldet nur auf dem Server, der im Intranet eingestellt ist.
 * Das Netz läuft in eigenen Threads, das Spiel wartet nie auf eine Antwort.
 */
public final class BrunoLive implements ClientModInitializer {
	static final Logger LOG = LoggerFactory.getLogger("bruno-live");
	private static final int TICKS_POS = 2; // 100 ms, wenn sich etwas bewegt hat
	private static final int TICKS_POS_HERZ = 40; // sonst alle 2 Sekunden
	private static final int TICKS_TAB = 20;
	private static final int TICKS_TAB_HERZ = 200;
	private static final int MAX_JE_NACHRICHT = 5000;
	private static final double REICHWEITE = 8.0; // So weit weg kann ein Spieler einen Block setzen oder abbauen.

	private static volatile BrunoLive instanz;

	private final ExecutorService netz = Executors.newSingleThreadExecutor((r) -> {
		Thread t = new Thread(r, "bruno-live-netz");
		t.setDaemon(true);
		return t;
	});
	private final Queue<JsonObject> eingang = new ConcurrentLinkedQueue<>();

	// Ab hier nur im Spiel-Thread anfassen
	private Intranet intranet;
	private Intranet.Leitung leitung;
	private boolean verbindet;
	private boolean beendet; // kein neuer Versuch: anderer Server, Schlüssel ungültig, keine Datei
	private int bisNeuversuch;
	private int fehlversuche;
	private int sitzung; // alte Antworten nach einem Serverwechsel verwerfen
	private int startNummer;
	private boolean aktiv;
	private boolean begruesst;
	private Abgleich abgleich;
	private Abgleich.Plan planCache;
	private String status = "Noch nicht verbunden.";
	private int ticks;
	private String letztePos = "";
	private int letztePosGesendet = -1000;
	private String letzterTab = "";
	private int letzterTabGesendet = -1000;
	private final Set<String> haeuteGeschickt = new HashSet<>();

	@Override
	public void onInitializeClient() {
		instanz = this;
		ClientPlayConnectionEvents.JOIN.register((handler, sender, mc) -> sitzungStarten(mc));
		ClientPlayConnectionEvents.DISCONNECT.register((handler, mc) -> sitzungBeenden());
		ClientTickEvents.END_CLIENT_TICK.register(this::tick);
		ClientChunkEvents.CHUNK_LOAD.register((welt, chunk) -> {
			if (abgleich != null && welt.dimension() == Level.OVERWORLD) abgleich.chunkGeladen(chunk.getPos().x(), chunk.getPos().z());
		});
		ClientChunkEvents.CHUNK_UNLOAD.register((welt, chunk) -> {
			if (abgleich != null && welt.dimension() == Level.OVERWORLD) abgleich.chunkEntladen(chunk.getPos().x(), chunk.getPos().z());
		});
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, kontext) -> dispatcher.register(
			ClientCommands.literal("bruno")
				.executes((c) -> {
					c.getSource().sendFeedback(Component.literal("Bruno Live: " + statusText()));
					return 1;
				})
				.then(ClientCommands.literal("ecke")
					.executes((c) -> ecke(c, false))
					.then(ClientCommands.literal("ja").executes((c) -> ecke(c, true))))));
	}

	/** Aus dem Mixin: Ein Block im Client hat sich geändert. */
	public static void blockGeaendert(BlockPos pos) {
		BrunoLive b = instanz;
		if (b == null || b.abgleich == null || !Minecraft.getInstance().isSameThread()) return;
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null || mc.level.dimension() != Level.OVERWORLD) return;
		b.abgleich.blockGeaendert(pos.getX(), pos.getZ());
	}

	private static Path konfigDatei() {
		return FabricLoader.getInstance().getConfigDir().resolve("bruno-live.json");
	}

	// ---------- Sitzung und Leitung ----------

	private void sitzungStarten(Minecraft mc) {
		sitzungBeenden();
		Path datei = konfigDatei();
		if (!Files.exists(datei)) {
			status = "Keine Zugangsdatei. Im Intranet unter Profil erzeugen und nach config/bruno-live.json legen.";
			beendet = true;
			return;
		}
		try {
			intranet = new Intranet(Intranet.Konfig.laden(datei));
		} catch (Exception ex) {
			status = "Fehler in config/bruno-live.json: " + ex.getMessage();
			beendet = true;
			return;
		}
		beendet = false;
		fehlversuche = 0;
		verbinden(mc);
	}

	private void sitzungBeenden() {
		sitzung++;
		if (leitung != null) leitung.schliessen();
		leitung = null;
		intranet = null;
		verbindet = false;
		aktiv = false;
		abgleich = null;
		begruesst = false;
		eingang.clear();
		status = "Nicht verbunden.";
	}

	private void verbinden(Minecraft mc) {
		verbindet = true;
		int diese = sitzung;
		status = "Verbinde mit dem Intranet …";
		intranet.verbinden(eingang).whenComplete((l, fehler) -> mc.execute(() -> {
			if (diese != sitzung) {
				if (l != null) l.schliessen();
				return;
			}
			verbindet = false;
			if (fehler == null) {
				leitung = l; // Jetzt kommt der Start vom Live-Raum.
				return;
			}
			Throwable f = fehler instanceof CompletionException && fehler.getCause() != null ? fehler.getCause() : fehler;
			if (f instanceof Intranet.Abgelehnt a && (a.status == 401 || a.status == 403)) {
				beendet = true;
				status = "Fehler: Der Schlüssel gilt nicht mehr. Im Profil einen neuen erzeugen.";
				return;
			}
			LOG.warn("Verbindung zum Intranet fehlgeschlagen: {}", f.toString());
			neuVersuchen("Fehler: " + f.getMessage());
		}));
	}

	private void neuVersuchen(String grund) {
		fehlversuche++;
		int sekunden = Math.min(30, 1 << Math.min(fehlversuche, 5));
		bisNeuversuch = sekunden * 20;
		status = grund + " Neuer Versuch in " + sekunden + " s.";
	}

	private void tick(Minecraft mc) {
		ticks++;
		// Der Start kann schneller da sein als die Meldung, dass die Leitung steht. Dann wartet er hier einen Tick.
		for (JsonObject m; leitung != null && (m = eingang.poll()) != null; ) {
			try {
				behandeln(mc, m);
			} catch (RuntimeException ex) {
				LOG.warn("Nachricht vom Intranet nicht verstanden: {}", ex.toString());
			}
		}
		if (intranet == null || beendet) return;
		if (leitung != null && !leitung.offen()) {
			String grund = leitung.grund();
			leitung = null;
			aktiv = false;
			abgleich = null;
			eingang.clear();
			neuVersuchen(grund + ".");
		}
		if (leitung == null) {
			if (!verbindet && --bisNeuversuch <= 0) verbinden(mc);
			return;
		}
		if (!aktiv || mc.level == null || mc.player == null) return;
		if (ticks % TICKS_POS == 0) positionSenden(mc);
		if (ticks % TICKS_TAB == 0) tabSenden(mc);
		if (abgleich != null && mc.level.dimension() == Level.OVERWORLD) bloeckeAbgleichen(mc);
	}

	private void behandeln(Minecraft mc, JsonObject m) {
		switch (m.get("t").getAsString()) {
			case "start" -> start(mc, m);
			case "bloecke" -> {
				if (abgleich != null) abgleich.bekanntAendern(m.getAsJsonArray("liste"));
			}
			case "meldung" -> chat(mc, m.get("text").getAsString());
			default -> {}
		}
	}

	/** Der Live-Raum schickt Standort, Server und den bekannten Stand. Kommt beim Verbinden und nach jeder Änderung. */
	private void start(Minecraft mc, JsonObject m) {
		if (leitung == null) return;
		ServerData server = mc.getCurrentServer();
		String adresse = server == null ? null : server.ip;
		String eingestellt = m.get("server").getAsString();
		boolean admin = m.get("admin").getAsBoolean();
		boolean passt = mc.hasSingleplayerServer() ? intranet.konfig.einzelspieler() : gleicherServer(adresse, eingestellt);
		fehlversuche = 0;
		aktiv = false;
		abgleich = null;
		startNummer++;
		if (!passt) {
			if (eingestellt.isBlank() && !mc.hasSingleplayerServer()) {
				// Noch nichts eingestellt: Leitung bleibt offen, meldet aber nichts. Sobald die Geschäftsführung den
				// Server festlegt (im Intranet oder mit /bruno ecke), kommt ein neuer Start und es geht los.
				if (admin) {
					status = "Einrichtung: Im Intranet ist noch kein Server eingestellt. Schau auf den Eckblock und tippe /bruno ecke.";
					chat(mc, "Noch nicht eingerichtet. Schau mit dem Fadenkreuz auf die untere Nordwest-Ecke des Gebäudes und tippe §e/bruno ecke§r.");
				} else {
					status = "Wartet: Im Intranet ist noch kein Server eingestellt. Es wird nichts gemeldet.";
				}
				return;
			}
			LOG.info("Anderer Server, es wird nichts gemeldet.");
			status = "Anderer Server, es wird nichts gemeldet.";
			beendet = true;
			leitung.schliessen();
			leitung = null;
			return;
		}
		aktiv = true;
		JsonObject hallo = new JsonObject();
		hallo.addProperty("t", "hallo");
		hallo.addProperty("name", mc.getUser().getName());
		leitung.senden(hallo, true);
		letztePos = "";
		letzterTab = "";
		haeuteGeschickt.clear();
		if (!begruesst) chat(mc, "verbunden als " + m.get("name").getAsString() + ". Das Intranet sieht dich jetzt live.");
		begruesst = true;

		if (m.get("anker").isJsonNull()) {
			status = "Aktiv, aber im Intranet ist noch kein Standort festgelegt: nur Spieler und Positionen.";
			return;
		}
		JsonObject a = m.getAsJsonObject("anker");
		int ax = a.get("x").getAsInt();
		int ay = a.get("y").getAsInt();
		int az = a.get("z").getAsInt();
		String hash = m.get("hash").getAsString();
		String gebaut = m.get("gebaut").getAsString();
		JsonArray falsch = m.getAsJsonArray("falsch");
		if (planCache != null && planCache.hash.equals(hash)) {
			abgleichStarten(planCache, ax, ay, az, gebaut, falsch);
			return;
		}
		status = "Lade den Bauplan …";
		int diese = sitzung;
		int dieserStart = startNummer;
		Intranet zugang = intranet;
		netz.execute(() -> {
			try {
				Abgleich.Plan p = Abgleich.Plan.aus(zugang.plan());
				mc.execute(() -> {
					if (diese != sitzung || dieserStart != startNummer) return;
					if (!p.hash.equals(hash)) {
						status = "Fehler: Plan und Live-Raum passen gerade nicht zusammen. Bitte neu verbinden.";
						return;
					}
					planCache = p;
					abgleichStarten(p, ax, ay, az, gebaut, falsch);
				});
			} catch (Exception ex) {
				LOG.warn("Bauplan nicht geladen", ex);
				mc.execute(() -> {
					if (diese == sitzung) status = "Fehler beim Laden des Bauplans: " + ex.getMessage();
				});
			}
		});
	}

	private void abgleichStarten(Abgleich.Plan p, int ax, int ay, int az, String gebaut, JsonArray falsch) {
		abgleich = new Abgleich(p, ax, ay, az);
		abgleich.bekanntSetzen(gebaut, falsch);
		status = "Aktiv.";
		LOG.info("Live-Abgleich aktiv, Ecke bei {} / {} / {}.", ax, ay, az);
	}

	// ---------- Melden ----------

	private static double r2(double v) {
		return Math.round(v * 100) / 100.0;
	}

	private static double r1(double v) {
		return Math.round(v * 10) / 10.0;
	}

	private static JsonArray spieler(AbstractClientPlayer p) {
		JsonArray a = new JsonArray();
		a.add(p.getName().getString());
		a.add(r2(p.getX()));
		a.add(r2(p.getY()));
		a.add(r2(p.getZ()));
		a.add(r1(p.yBodyRot));
		a.add(r1(p.getYHeadRot()));
		a.add(r1(p.getXRot()));
		int merker = (p.isCrouching() ? 1 : 0) | (p.isSprinting() ? 2 : 0) | (p.isSwinging() ? 4 : 0) | (p.isFallFlying() ? 8 : 0) | (p.isPassenger() ? 16 : 0);
		a.add(merker);
		return a;
	}

	private void positionSenden(Minecraft mc) {
		JsonArray eigen = spieler(mc.player);
		eigen.add(mc.level.dimension().identifier().toString());
		JsonArray andere = new JsonArray();
		for (AbstractClientPlayer p : mc.level.players()) {
			if (p != mc.player) andere.add(spieler(p));
		}
		String text = eigen.toString() + andere;
		if (text.equals(letztePos) && ticks - letztePosGesendet < TICKS_POS_HERZ) return;
		letztePos = text;
		letztePosGesendet = ticks;
		JsonObject m = new JsonObject();
		m.addProperty("t", "pos");
		m.add("s", eigen);
		m.add("a", andere);
		leitung.senden(m, false);
	}

	private void tabSenden(Minecraft mc) {
		if (mc.getConnection() == null) return;
		JsonArray liste = new JsonArray();
		for (PlayerInfo p : mc.getConnection().getOnlinePlayers()) {
			JsonObject e = new JsonObject();
			e.addProperty("n", p.getProfile().name());
			PlayerSkin haut = p.getSkin();
			e.addProperty("m", haut.model() == PlayerModelType.SLIM ? "slim" : "wide");
			ClientAsset.Texture t = haut.body();
			if (t instanceof ClientAsset.DownloadedTexture d) {
				String hash = d.url().substring(d.url().lastIndexOf('/') + 1);
				if (hash.matches("[0-9a-f]{32,64}")) e.addProperty("h", hash);
			} else if (t instanceof ClientAsset.ResourceTexture r) {
				String res = r.texturePath().toString();
				e.addProperty("r", res);
				hautSchicken(mc, r.texturePath());
			}
			liste.add(e);
		}
		String text = liste.toString();
		if (text.equals(letzterTab) && ticks - letzterTabGesendet < TICKS_TAB_HERZ) return;
		letzterTab = text;
		letzterTabGesendet = ticks;
		JsonObject m = new JsonObject();
		m.addProperty("t", "tab");
		m.add("liste", liste);
		leitung.senden(m, true);
	}

	/** Standard-Skins (Steve, Alex, …) gibt es nur im Spiel. Die Website bekommt sie einmal mitgeschickt. */
	private void hautSchicken(Minecraft mc, Identifier pfad) {
		String res = pfad.toString();
		if (!res.endsWith(".png") || !haeuteGeschickt.add(res)) return;
		Optional<Resource> datei = mc.getResourceManager().getResource(pfad);
		if (datei.isEmpty()) return;
		try (InputStream in = datei.get().open()) {
			byte[] png = in.readAllBytes();
			if (png.length > 16_000) return;
			JsonObject m = new JsonObject();
			m.addProperty("t", "haut");
			m.addProperty("res", res);
			m.addProperty("png", Base64.getEncoder().encodeToString(png));
			leitung.senden(m, false);
		} catch (Exception ex) {
			LOG.debug("Skin {} nicht gelesen", res, ex);
		}
	}

	private void bloeckeAbgleichen(Minecraft mc) {
		List<Abgleich.Aenderung> live = new ArrayList<>();
		List<Abgleich.Aenderung> ersterBlick = new ArrayList<>();
		abgleich.tick(mc.level, live, ersterBlick);
		if (!ersterBlick.isEmpty()) bloeckeSenden(ersterBlick, true, List.of());
		if (!live.isEmpty()) bloeckeSenden(live, false, mc.level.players());
	}

	private void bloeckeSenden(List<Abgleich.Aenderung> liste, boolean sync, List<AbstractClientPlayer> spieler) {
		for (int von = 0; von < liste.size(); von += MAX_JE_NACHRICHT) {
			JsonObject m = new JsonObject();
			m.addProperty("t", "bloecke");
			m.addProperty("hash", abgleich.plan.hash);
			JsonObject a = new JsonObject();
			a.addProperty("x", abgleich.ankerX);
			a.addProperty("y", abgleich.ankerY);
			a.addProperty("z", abgleich.ankerZ);
			m.add("anker", a);
			m.addProperty("sync", sync);
			JsonArray eintraege = new JsonArray();
			JsonArray wer = new JsonArray();
			Map<String, Integer> werNr = new HashMap<>();
			for (Abgleich.Aenderung e : liste.subList(von, Math.min(liste.size(), von + MAX_JE_NACHRICHT))) {
				JsonArray q = new JsonArray();
				q.add(e.nummer());
				if (e.zustand() instanceof String s) q.add(s);
				else q.add((Integer) e.zustand());
				String name = sync ? null : naechster(spieler, e);
				if (name != null) {
					q.add(werNr.computeIfAbsent(name, (k) -> {
						wer.add(k);
						return wer.size() - 1;
					}));
				}
				eintraege.add(q);
			}
			m.add("liste", eintraege);
			if (!wer.isEmpty()) m.add("wer", wer);
			leitung.senden(m, true);
		}
	}

	/** Wer hat's gebaut? Der Spieler, der am nächsten dran ist, wenn er in Reichweite war. */
	private static String naechster(List<AbstractClientPlayer> spieler, Abgleich.Aenderung e) {
		String name = null;
		double best = REICHWEITE * REICHWEITE;
		for (AbstractClientPlayer p : spieler) {
			double dx = p.getX() - (e.x() + 0.5);
			double dy = p.getEyeY() - (e.y() + 0.5);
			double dz = p.getZ() - (e.z() + 0.5);
			double d = dx * dx + dy * dy + dz * dz;
			if (d <= best) {
				best = d;
				name = p.getName().getString();
			}
		}
		return name;
	}

	// ---------- Befehle ----------

	/** /bruno ecke: Standort festlegen. Fadenkreuz auf die untere Nordwest-Ecke des Gebäudes. */
	private int ecke(CommandContext<FabricClientCommandSource> c, boolean ja) {
		Minecraft mc = Minecraft.getInstance();
		if (leitung == null || !leitung.offen()) {
			c.getSource().sendError(Component.literal("Bruno Live ist nicht mit dem Intranet verbunden. " + status));
			return 0;
		}
		if (!(mc.hitResult instanceof BlockHitResult treffer) || treffer.getType() != HitResult.Type.BLOCK) {
			c.getSource().sendError(Component.literal("Schau mit dem Fadenkreuz auf den Eckblock und versuch es nochmal."));
			return 0;
		}
		BlockPos p = treffer.getBlockPos();
		JsonObject m = new JsonObject();
		m.addProperty("t", "ecke");
		m.addProperty("x", p.getX());
		m.addProperty("y", p.getY());
		m.addProperty("z", p.getZ());
		ServerData server = mc.getCurrentServer();
		m.addProperty("server", server == null ? "" : host(server.ip));
		m.addProperty("ja", ja);
		leitung.senden(m, true);
		c.getSource().sendFeedback(Component.literal("Bruno Live: Ecke " + p.getX() + " / " + p.getY() + " / " + p.getZ() + " gemeldet …"));
		return 1;
	}

	private static void chat(Minecraft mc, String text) {
		if (mc.player != null) mc.player.sendSystemMessage(Component.literal("§6Bruno Live§r: " + text));
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

	private String statusText() {
		if (abgleich == null) return status;
		int[] s = abgleich.stand();
		String text = status + " Chunks gesehen: " + s[0] + " von " + s[1] + ". Gebaut: " + s[2] + " von " + s[3] + " Blöcken.";
		if (abgleich.unbekannteBloecke > 0) text += " " + abgleich.unbekannteBloecke + " Blockarten im Plan gibt es in dieser Version nicht, siehe Log.";
		return text;
	}
}
