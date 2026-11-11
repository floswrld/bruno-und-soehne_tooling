package de.brunosoehne.live;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.chunk.LevelChunk;

/**
 * Vergleicht die Welt mit dem Bauplan, Block für Block.
 *
 * <p>Jeder Planblock hat eine Nummer (Reihenfolge im Plan, Website und Mod rechnen sie gleich aus). Der Live-Raum
 * kennt den Stand aller Nummern und schickt ihn beim Verbinden mit. Die Mod meldet nur Unterschiede:
 *
 * <ul>
 *   <li>Ändert sich ein Block, den sie schon gesehen hat, ist das eine echte Änderung (mit dem Spieler, der am nächsten
 *       dran war).
 *   <li>Sieht sie einen Chunk zum ersten Mal, meldet sie, was vom bekannten Stand abweicht, ohne Spieler.
 * </ul>
 *
 * <p>Geänderte Blöcke kommen über einen Mixin sofort an die Reihe. Zur Sicherheit läuft der Abgleich außerdem reihum
 * über alle geladenen Chunks des Plans.
 */
final class Abgleich {
	/** Was natürlich in der Welt vorkommt, gilt nicht als „falsch gesetzt“. Gleiche Liste wie scripts/bauplan-sync.mjs. */
	private static final Pattern NATUR = Pattern.compile("^minecraft:(stone|andesite|tuff|deepslate|gravel|sand|grass_block|moss_block|podzol|coarse_dirt|dirt|water|lava|short_grass|fern|poppy|oxeye_daisy|dandelion|cornflower|allium|oak_log|oak_leaves|birch_log|birch_leaves|spruce_log|spruce_leaves|dark_oak_log|dark_oak_leaves|azalea_leaves|flowering_azalea_leaves|sugar_cane|lily_pad|bamboo)$");
	private static final byte UNBEKANNT = -1;
	private static final byte OFFEN = 0;
	private static final byte GEBAUT = 1;
	private static final byte FALSCH = 2;
	private static final int CHUNKS_SOFORT_JE_TICK = 48;
	private static final int BLOECKE_REIHUM_JE_TICK = 2500;

	/** Der Plan, fertig zerlegt. Ohne Spielzustand, wird im Netz-Thread gebaut und zwischen Sitzungen behalten. */
	static final class Plan {
		final String hash;
		final int gebX;
		final int gebY;
		final int gebZ;
		final String[] namen; // Blockarten
		final int[] stelle; // je Nummer: x | z << 10 | y << 20 im Planraster
		final short[] soll; // je Nummer: Index in namen

		private Plan(String hash, int gebX, int gebY, int gebZ, String[] namen, int[] stelle, short[] soll) {
			this.hash = hash;
			this.gebX = gebX;
			this.gebY = gebY;
			this.gebZ = gebZ;
			this.namen = namen;
			this.stelle = stelle;
			this.soll = soll;
		}

		int gesamt() {
			return stelle.length;
		}

		static Plan aus(JsonObject plan) {
			JsonObject groesse = plan.getAsJsonObject("groesse");
			JsonObject gebaeude = plan.getAsJsonObject("gebaeude");
			int gx = groesse.get("x").getAsInt();
			int gz = groesse.get("z").getAsInt();
			if (gx >= 1024 || gz >= 1024 || groesse.get("y").getAsInt() >= 1024) throw new IllegalStateException("Plan zu groß.");
			JsonObject palette = plan.getAsJsonObject("palette");
			Map<Character, Short> index = new HashMap<>();
			List<String> namen = new ArrayList<>();
			Map<String, Short> nachBlock = new HashMap<>();
			for (String zeichen : palette.keySet()) {
				String block = palette.getAsJsonObject(zeichen).get("block").getAsString();
				Short i = nachBlock.get(block);
				if (i == null) {
					i = (short) namen.size();
					namen.add(block);
					nachBlock.put(block, i);
				}
				index.put(zeichen.charAt(0), i);
			}
			int gesamt = plan.get("gesamt").getAsInt();
			int[] stelle = new int[gesamt];
			short[] soll = new short[gesamt];
			int n = 0;
			JsonArray ebenen = plan.getAsJsonArray("layers");
			for (int y = 0; y < ebenen.size(); y++) {
				String text = ebenen.get(y).getAsString();
				int zelle = 0;
				int zahl = 0;
				for (int k = 0; k < text.length(); k++) {
					char c = text.charAt(k);
					if (c >= '0' && c <= '9') {
						zahl = zahl * 10 + (c - '0');
						continue;
					}
					if (c != '.') {
						short s = index.get(c);
						for (int q = zelle; q < zelle + zahl; q++) {
							stelle[n] = (q % gx) | ((q / gx) << 10) | (y << 20);
							soll[n] = s;
							n++;
						}
					}
					zelle += zahl;
					zahl = 0;
				}
				if (zelle != gx * gz) throw new IllegalStateException("Ebene " + y + " hat die falsche Länge.");
			}
			if (n != gesamt) throw new IllegalStateException("Blockzahl passt nicht: " + n + " statt " + gesamt);
			return new Plan(plan.get("hash").getAsString(), gebaeude.get("x").getAsInt(), gebaeude.get("y").getAsInt(), gebaeude.get("z").getAsInt(), namen.toArray(new String[0]), stelle, soll);
		}
	}

	private static final class Stueck {
		final int cx;
		final int cz;
		final int[] stellen; // Welt-Position im Chunk: x und z je 4 Bit, y + 2048 darüber
		final int[] nummern;
		byte[] gesehen; // null = Chunk gerade nicht geladen oder noch nie gesehen
		final Map<Integer, String> falschGesehen = new HashMap<>();
		boolean markiert;

		Stueck(int cx, int cz, int[] stellen, int[] nummern) {
			this.cx = cx;
			this.cz = cz;
			this.stellen = stellen;
			this.nummern = nummern;
		}
	}

	/** Eine Änderung zum Melden. zustand ist 0 (offen), 1 (gebaut) oder der Name des falschen Blocks. */
	record Aenderung(int nummer, Object zustand, int x, int y, int z) {}

	final Plan plan;
	final int ankerX;
	final int ankerY;
	final int ankerZ;
	final int unbekannteBloecke;
	private final Block[] blockSoll;
	private final Map<Block, String> baustoffe = new HashMap<>();
	/** Gleichwertige Blöcke: Betonpulver zählt als der Beton derselben Farbe. */
	private final Map<Block, Block> gleichwertig = new HashMap<>();
	private final Map<Long, Stueck> nachChunk = new HashMap<>();
	private final Stueck[] stuecke;
	private final ArrayDeque<Stueck> markierte = new ArrayDeque<>();
	private final byte[] bekannt;
	private final Map<Integer, String> bekanntFalsch = new HashMap<>();
	private final BlockPos.MutableBlockPos stelle = new BlockPos.MutableBlockPos();
	private int reihum;

	/** Muss im Spiel-Thread laufen (Blockregister). */
	Abgleich(Plan plan, int ankerX, int ankerY, int ankerZ) {
		this.plan = plan;
		this.ankerX = ankerX;
		this.ankerY = ankerY;
		this.ankerZ = ankerZ;
		blockSoll = new Block[plan.namen.length];
		int unbekannt = 0;
		for (int i = 0; i < plan.namen.length; i++) {
			Identifier id = Identifier.parse(plan.namen[i]);
			if (BuiltInRegistries.BLOCK.containsKey(id)) {
				blockSoll[i] = BuiltInRegistries.BLOCK.getValue(id);
				if (!NATUR.matcher(plan.namen[i]).matches()) baustoffe.put(blockSoll[i], plan.namen[i]);
				// Beton wird oft als Pulver gesetzt und erst später gehärtet: Pulver zählt schon als Beton.
				Identifier pulver = Identifier.parse(plan.namen[i] + "_powder");
				if (plan.namen[i].endsWith("_concrete") && BuiltInRegistries.BLOCK.containsKey(pulver)) {
					gleichwertig.put(BuiltInRegistries.BLOCK.getValue(pulver), blockSoll[i]);
				}
			} else {
				unbekannt++;
				BrunoLive.LOG.warn("Block aus dem Plan gibt es in dieser Version nicht: {}", plan.namen[i]);
			}
		}
		unbekannteBloecke = unbekannt;
		bekannt = new byte[plan.gesamt()];

		int vonX = ankerX - plan.gebX;
		int vonY = ankerY - plan.gebY;
		int vonZ = ankerZ - plan.gebZ;
		Map<Long, List<Integer>> sammlung = new HashMap<>();
		for (int n = 0; n < plan.gesamt(); n++) {
			int s = plan.stelle[n];
			int wx = vonX + (s & 1023);
			int wz = vonZ + ((s >> 10) & 1023);
			sammlung.computeIfAbsent(schluessel(wx >> 4, wz >> 4), (k) -> new ArrayList<>()).add(n);
		}
		stuecke = new Stueck[sammlung.size()];
		int k = 0;
		for (Map.Entry<Long, List<Integer>> e : sammlung.entrySet()) {
			List<Integer> liste = e.getValue();
			int[] stellen = new int[liste.size()];
			int[] nummern = new int[liste.size()];
			for (int i = 0; i < stellen.length; i++) {
				int n = liste.get(i);
				int s = plan.stelle[n];
				int wx = vonX + (s & 1023);
				int wz = vonZ + ((s >> 10) & 1023);
				int wy = vonY + (s >> 20);
				stellen[i] = (wx & 15) | ((wz & 15) << 4) | ((wy + 2048) << 8);
				nummern[i] = n;
			}
			Stueck st = new Stueck((int) (e.getKey() >> 32), (int) (long) e.getKey(), stellen, nummern);
			stuecke[k++] = st;
			nachChunk.put(e.getKey(), st);
		}
	}

	private static long schluessel(int cx, int cz) {
		return (((long) cx) << 32) ^ (cz & 0xffffffffL);
	}

	/** Stand des Live-Raums übernehmen. Danach wird jeder Chunk wie zum ersten Mal verglichen. */
	void bekanntSetzen(String gebautBase64, JsonArray falsch) {
		byte[] bits = Base64.getDecoder().decode(gebautBase64);
		for (int n = 0; n < bekannt.length; n++) bekannt[n] = (n >> 3) < bits.length && (bits[n >> 3] & (1 << (n & 7))) != 0 ? GEBAUT : OFFEN;
		bekanntFalsch.clear();
		for (JsonElement e : falsch) {
			JsonArray p = e.getAsJsonArray();
			int n = p.get(0).getAsInt();
			if (n < 0 || n >= bekannt.length) continue;
			bekannt[n] = FALSCH;
			bekanntFalsch.put(n, p.get(1).getAsString());
		}
		for (Stueck s : stuecke) {
			s.gesehen = null;
			s.falschGesehen.clear();
			markieren(s);
		}
	}

	/** Was andere gemeldet haben. */
	void bekanntAendern(JsonArray liste) {
		for (JsonElement e : liste) {
			JsonArray p = e.getAsJsonArray();
			int n = p.get(0).getAsInt();
			if (n < 0 || n >= bekannt.length) continue;
			JsonElement s = p.get(1);
			if (s.getAsJsonPrimitive().isString()) {
				bekannt[n] = FALSCH;
				bekanntFalsch.put(n, s.getAsString());
			} else {
				bekannt[n] = s.getAsInt() == 1 ? GEBAUT : OFFEN;
				bekanntFalsch.remove(n);
			}
		}
	}

	/** Aus dem Mixin: In diesem Chunk hat sich ein Block geändert. */
	void blockGeaendert(int x, int z) {
		Stueck s = nachChunk.get(schluessel(x >> 4, z >> 4));
		if (s != null) markieren(s);
	}

	void chunkGeladen(int cx, int cz) {
		Stueck s = nachChunk.get(schluessel(cx, cz));
		if (s != null) markieren(s);
	}

	void chunkEntladen(int cx, int cz) {
		Stueck s = nachChunk.get(schluessel(cx, cz));
		if (s == null) return;
		// Was in der Zwischenzeit passiert, war nicht zu sehen: Beim nächsten Laden zählt es als erster Blick.
		s.gesehen = null;
		s.falschGesehen.clear();
	}

	private void markieren(Stueck s) {
		if (s.markiert) return;
		s.markiert = true;
		markierte.add(s);
	}

	/** Ein Tick Abgleich. Was sich geändert hat, landet in live (mit Spieler) oder ersterBlick (ohne). */
	void tick(ClientLevel welt, List<Aenderung> live, List<Aenderung> ersterBlick) {
		for (int i = 0; i < CHUNKS_SOFORT_JE_TICK && !markierte.isEmpty(); i++) {
			Stueck s = markierte.poll();
			s.markiert = false;
			pruefen(s, welt, live, ersterBlick);
		}
		int budget = BLOECKE_REIHUM_JE_TICK;
		for (int i = 0; i < stuecke.length && budget > 0; i++) {
			Stueck s = stuecke[reihum];
			reihum = (reihum + 1) % stuecke.length;
			if (pruefen(s, welt, live, ersterBlick)) budget -= s.stellen.length;
		}
	}

	private boolean pruefen(Stueck s, ClientLevel welt, List<Aenderung> live, List<Aenderung> ersterBlick) {
		LevelChunk chunk = welt.getChunkSource().getChunkNow(s.cx, s.cz);
		if (chunk == null) {
			s.gesehen = null;
			s.falschGesehen.clear();
			return false;
		}
		boolean erstmals = s.gesehen == null;
		if (erstmals) s.gesehen = new byte[s.stellen.length];
		for (int i = 0; i < s.stellen.length; i++) {
			int p = s.stellen[i];
			int y = (p >> 8) - 2048;
			if (y < welt.getMinY() || y > welt.getMaxY()) continue;
			int x = (s.cx << 4) | (p & 15);
			int z = (s.cz << 4) | ((p >> 4) & 15);
			stelle.set(x, y, z);
			Block ist = chunk.getBlockState(stelle).getBlock();
			ist = gleichwertig.getOrDefault(ist, ist);
			int n = s.nummern[i];
			byte neu;
			String falsch = null;
			if (ist == blockSoll[plan.soll[n]]) {
				neu = GEBAUT;
			} else {
				falsch = baustoffe.get(ist);
				neu = falsch != null ? FALSCH : OFFEN;
			}
			if (erstmals) {
				// Erster Blick: nur melden, was vom bekannten Stand abweicht.
				if (neu != bekannt[n] || (neu == FALSCH && !falsch.equals(bekanntFalsch.get(n)))) {
					ersterBlick.add(new Aenderung(n, zustand(neu, falsch), x, y, z));
					merken(n, neu, falsch);
				}
			} else {
				byte alt = s.gesehen[i];
				if (neu != alt || (neu == FALSCH && !falsch.equals(s.falschGesehen.get(i)))) {
					if (neu != bekannt[n] || (neu == FALSCH && !falsch.equals(bekanntFalsch.get(n)))) {
						live.add(new Aenderung(n, zustand(neu, falsch), x, y, z));
						merken(n, neu, falsch);
					}
				}
			}
			s.gesehen[i] = neu;
			if (neu == FALSCH) s.falschGesehen.put(i, falsch);
			else s.falschGesehen.remove(i);
		}
		return true;
	}

	private static Object zustand(byte neu, String falsch) {
		return neu == FALSCH ? falsch : (int) neu;
	}

	private void merken(int n, byte neu, String falsch) {
		bekannt[n] = neu;
		if (neu == FALSCH) bekanntFalsch.put(n, falsch);
		else bekanntFalsch.remove(n);
	}

	/** Zahlen für /bruno: gesehene Chunks, alle Chunks, gebaut, Planblöcke. */
	int[] stand() {
		int gesehen = 0;
		for (Stueck s : stuecke) if (s.gesehen != null) gesehen++;
		int gebaut = 0;
		for (byte b : bekannt) if (b == GEBAUT) gebaut++;
		return new int[] {gesehen, stuecke.length, gebaut, bekannt.length};
	}
}
