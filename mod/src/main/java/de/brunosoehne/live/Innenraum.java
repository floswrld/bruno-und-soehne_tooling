package de.brunosoehne.live;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;

/**
 * Der Innenraum: alles, was in der Welt innerhalb des Gebäudes steht, vom Dach bis {@code tiefe} Blöcke unter den
 * Boden. Nur zum Anschauen im Bauplan. Er zählt nicht zum Baufortschritt, richtig oder falsch gibt es hier nicht, und
 * die Planblöcke selbst gehören dem {@link Abgleich}.
 *
 * <p>Der Raum ist in Stücke geteilt, eines je Chunk-Säule. Ein Stück geht immer ganz raus: die Blockarten als Liste
 * und die Zellen als Lauflängen. Der Live-Raum kennt zu jedem Stück eine Prüfsumme und schickt sie beim Start mit.
 * Gemeldet wird nur, was davon abweicht. Geänderte Blöcke kommen über den Mixin sofort an die Reihe, zur Sicherheit
 * läuft außerdem ein Stück nach dem anderen durch.
 */
final class Innenraum {
	private static final int ZELLEN_JE_TICK = 48_000;
	private static final int PAUSE_TICKS = 4; // Ein Stück geht höchstens fünfmal pro Sekunde raus.
	private static final int REIHUM_TICKS = 2; // alle Stücke des Rechenzentrums in rund zehn Sekunden
	/** Unsichtbar im Spiel: Die Website soll dort nichts zeichnen. */
	private static final Set<String> UNSICHTBAR = Set.of("minecraft:light", "minecraft:barrier", "minecraft:structure_void", "minecraft:moving_piston");

	private static final class Stueck {
		final int x0; // Rechteck in Plan-Koordinaten
		final int z0;
		final int b;
		final int t;
		final int cx; // Chunk in der Welt
		final int cz;
		final String key;
		boolean markiert;
		boolean gesehen;
		int zuletzt = Integer.MIN_VALUE / 2;

		Stueck(int x0, int z0, int b, int t, int cx, int cz) {
			this.x0 = x0;
			this.z0 = z0;
			this.b = b;
			this.t = t;
			this.cx = cx;
			this.cz = cz;
			this.key = x0 + "," + z0;
		}
	}

	final int tiefe;
	private final int gx;
	private final int gy;
	private final int gz;
	private final int hoehe;
	private final int vonX; // Welt-Koordinate der Plan-Zelle 0 / 0 / 0
	private final int vonY;
	private final int vonZ;
	private final BitSet planzelle;
	private final Stueck[] stuecke;
	private final Map<Long, Stueck> nachChunk = new HashMap<>();
	private final Map<String, String> bekannt = new HashMap<>(); // Stück -> Prüfsumme im Live-Raum
	private final ArrayDeque<Stueck> markierte = new ArrayDeque<>();
	private final Map<Block, String> namen = new HashMap<>();
	private final BlockPos.MutableBlockPos stelle = new BlockPos.MutableBlockPos();
	private int reihum;
	private int ticks;

	/** Muss im Spiel-Thread laufen (Blockregister). */
	Innenraum(Abgleich.Plan plan, int ankerX, int ankerY, int ankerZ, int tiefe, JsonObject pruefsummen) {
		this.tiefe = tiefe;
		gx = plan.gx;
		gy = plan.gy;
		gz = plan.gz;
		hoehe = gy + tiefe;
		vonX = ankerX - plan.gebX;
		vonY = ankerY - plan.gebY;
		vonZ = ankerZ - plan.gebZ;
		planzelle = new BitSet(gx * gy * gz);
		for (int s : plan.stelle) planzelle.set((s & 1023) + ((s >> 10) & 1023) * gx + (s >> 20) * gx * gz);
		List<Stueck> liste = new ArrayList<>();
		for (int cx = Math.floorDiv(vonX, 16); cx <= Math.floorDiv(vonX + gx - 1, 16); cx++) {
			for (int cz = Math.floorDiv(vonZ, 16); cz <= Math.floorDiv(vonZ + gz - 1, 16); cz++) {
				int x0 = Math.max(cx * 16, vonX) - vonX;
				int z0 = Math.max(cz * 16, vonZ) - vonZ;
				int x1 = Math.min(cx * 16 + 16, vonX + gx) - vonX;
				int z1 = Math.min(cz * 16 + 16, vonZ + gz) - vonZ;
				Stueck s = new Stueck(x0, z0, x1 - x0, z1 - z0, cx, cz);
				liste.add(s);
				nachChunk.put(schluessel(cx, cz), s);
			}
		}
		stuecke = liste.toArray(new Stueck[0]);
		if (pruefsummen != null) {
			for (Map.Entry<String, JsonElement> e : pruefsummen.entrySet()) bekannt.put(e.getKey(), e.getValue().getAsString());
		}
		for (Stueck s : stuecke) markieren(s);
	}

	private static long schluessel(int cx, int cz) {
		return (((long) cx) << 32) ^ (cz & 0xffffffffL);
	}

	/** Was andere Mods gemeldet haben: [Stück, Prüfsumme]. */
	void bekanntAendern(JsonArray liste) {
		for (JsonElement e : liste) {
			JsonArray p = e.getAsJsonArray();
			bekannt.put(p.get(0).getAsString(), p.get(1).getAsString());
		}
	}

	/** Aus dem Mixin: Hier hat sich ein Block geändert. */
	void blockGeaendert(int x, int y, int z) {
		int ly = y - vonY + tiefe;
		int px = x - vonX;
		int pz = z - vonZ;
		if (ly < 0 || ly >= hoehe || px < 0 || px >= gx || pz < 0 || pz >= gz) return;
		Stueck s = nachChunk.get(schluessel(x >> 4, z >> 4));
		if (s != null) markieren(s);
	}

	void chunkGeladen(int cx, int cz) {
		Stueck s = nachChunk.get(schluessel(cx, cz));
		if (s != null) markieren(s);
	}

	private void markieren(Stueck s) {
		if (s.markiert) return;
		s.markiert = true;
		markierte.add(s);
	}

	/** Ein Tick. Jedes Stück, das anders aussieht, als der Live-Raum es kennt, landet fertig zum Senden in raus. */
	void tick(ClientLevel welt, List<JsonObject> raus) {
		ticks++;
		int budget = ZELLEN_JE_TICK;
		for (int i = markierte.size(); i > 0 && budget > 0; i--) {
			Stueck s = markierte.poll();
			if (ticks - s.zuletzt < PAUSE_TICKS) {
				markierte.add(s); // gerade erst gemeldet: kurz warten, dann alles auf einmal
				continue;
			}
			s.markiert = false;
			budget -= pruefen(s, welt, raus);
		}
		if (ticks % REIHUM_TICKS == 0 && budget > 0 && stuecke.length > 0) {
			Stueck s = stuecke[reihum];
			reihum = (reihum + 1) % stuecke.length;
			if (ticks - s.zuletzt >= PAUSE_TICKS) pruefen(s, welt, raus);
		}
	}

	/** Liest das Stück aus der Welt. Gibt zurück, wie viele Zellen dafür gelesen wurden. */
	private int pruefen(Stueck s, ClientLevel welt, List<JsonObject> raus) {
		LevelChunk chunk = welt.getChunkSource().getChunkNow(s.cx, s.cz);
		if (chunk == null) return 0; // nicht zu sehen: Im Live-Raum bleibt der letzte Stand
		s.zuletzt = ticks;
		s.gesehen = true;
		Map<Block, Integer> index = new HashMap<>();
		List<String> arten = new ArrayList<>();
		int[] laeufe = new int[256];
		int n = 0;
		int art = -1;
		int laenge = 0;
		int minY = welt.getMinY();
		int maxY = welt.getMaxY();
		for (int ly = 0; ly < hoehe; ly++) {
			int py = ly - tiefe;
			int wy = vonY + py;
			boolean inWelt = wy >= minY && wy <= maxY;
			for (int z = s.z0; z < s.z0 + s.t; z++) {
				for (int x = s.x0; x < s.x0 + s.b; x++) {
					int wert = 0;
					if (inWelt && !(py >= 0 && planzelle.get(x + z * gx + py * gx * gz))) {
						stelle.set(vonX + x, wy, vonZ + z);
						BlockState zustand = chunk.getBlockState(stelle);
						if (!zustand.isAir()) {
							Block block = zustand.getBlock();
							String name = name(block);
							if (name != null) {
								Integer i = index.get(block);
								if (i == null) {
									arten.add(name);
									i = arten.size();
									index.put(block, i);
								}
								wert = i;
							}
						}
					}
					if (wert == art) {
						laenge++;
						continue;
					}
					if (laenge > 0) {
						if (n + 2 > laeufe.length) laeufe = Arrays.copyOf(laeufe, laeufe.length * 2);
						laeufe[n++] = laenge;
						laeufe[n++] = art;
					}
					art = wert;
					laenge = 1;
				}
			}
		}
		if (n + 2 > laeufe.length) laeufe = Arrays.copyOf(laeufe, laeufe.length + 2);
		laeufe[n++] = laenge;
		laeufe[n++] = art;

		String summe = pruefsumme(arten, laeufe, n);
		if (!summe.equals(bekannt.get(s.key))) {
			bekannt.put(s.key, summe);
			JsonObject o = new JsonObject();
			JsonArray k = new JsonArray();
			k.add(s.x0);
			k.add(s.z0);
			k.add(s.b);
			k.add(s.t);
			o.add("k", k);
			JsonArray p = new JsonArray();
			for (String a : arten) p.add(a);
			o.add("p", p);
			JsonArray r = new JsonArray();
			for (int i = 0; i < n; i++) r.add(laeufe[i]);
			o.add("r", r);
			raus.add(o);
		}
		return s.b * s.t * hoehe;
	}

	private String name(Block block) {
		if (namen.containsKey(block)) return namen.get(block);
		String n = BuiltInRegistries.BLOCK.getKey(block).toString();
		if (UNSICHTBAR.contains(n)) n = null;
		namen.put(block, n);
		return n;
	}

	/** FNV-1a über „Arten mit Komma | Lauflängen mit Komma“, genau wie stueckHash in src/liveraum.ts. */
	static String pruefsumme(List<String> arten, int[] laeufe, int n) {
		StringBuilder text = new StringBuilder(String.join(",", arten)).append('|');
		for (int i = 0; i < n; i++) {
			if (i > 0) text.append(',');
			text.append(laeufe[i]);
		}
		int h = 0x811c9dc5;
		for (int i = 0; i < text.length(); i++) {
			h ^= text.charAt(i);
			h *= 0x01000193;
		}
		return String.format(Locale.ROOT, "%08x", h);
	}

	/** Zahlen für /bruno: gesehene Stücke, alle Stücke. */
	int[] stand() {
		int gesehen = 0;
		for (Stueck s : stuecke) if (s.gesehen) gesehen++;
		return new int[] {gesehen, stuecke.length};
	}
}
