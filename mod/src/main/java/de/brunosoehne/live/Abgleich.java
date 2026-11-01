package de.brunosoehne.live;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.chunk.LevelChunk;

/**
 * Vergleicht die geladenen Chunks mit dem Bauplan.
 *
 * <p>Der Client kennt alle Blöcke in seiner Sichtweite. Darum läuft der Abgleich reihum über die Chunks des Plans,
 * mit festem Budget je Tick, und braucht keine Eingriffe ins Spiel. Abgebaute Blöcke fallen so genauso auf wie
 * gesetzte, und was ein anderer gebaut hat, zählt auch.
 *
 * <p>Die Reihenfolge der Blöcke je Chunk ist die Reihenfolge der Plannummern. Website und Mod rechnen sie gleich aus.
 */
final class Abgleich {
	/** Was natürlich in der Welt vorkommt, gilt nicht als „falsch gesetzt“. Gleiche Liste wie scripts/bauplan-sync.mjs. */
	private static final Pattern NATUR = Pattern.compile("^minecraft:(stone|andesite|tuff|deepslate|gravel|sand|grass_block|moss_block|podzol|coarse_dirt|dirt|water|lava|short_grass|fern|poppy|oxeye_daisy|dandelion|cornflower|allium|oak_log|oak_leaves|birch_log|birch_leaves|spruce_log|spruce_leaves|dark_oak_log|dark_oak_leaves|azalea_leaves|flowering_azalea_leaves|sugar_cane|lily_pad|bamboo)$");

	private static final int BLOECKE_JE_TICK = 3000;
	private static final int CHUNKS_JE_MELDUNG = 16;

	private static final class Stueck {
		final int cx;
		final int cz;
		final int[] stellen; // Welt-Position, x und z je 4 Bit, y darüber
		final short[] soll; // Index in BLOCK_SOLL
		byte[] bits; // zuletzt gesehen, null = noch nie
		Map<String, List<Integer>> falsch = Map.of();
		boolean offen; // muss noch gemeldet werden

		Stueck(int cx, int cz, int[] stellen, short[] soll) {
			this.cx = cx;
			this.cz = cz;
			this.stellen = stellen;
			this.soll = soll;
		}
	}

	/** Änderungen seit der letzten Meldung, für die Live-Anzeige. */
	static final class Ereignis {
		int plus;
		int minus;
		int falsch;
		final Map<String, Integer> bloecke = new HashMap<>();

		boolean leer() {
			return plus == 0 && minus == 0 && falsch == 0;
		}
	}

	final String planHash;
	final int ankerX;
	final int ankerY;
	final int ankerZ;
	final int unbekannteBloecke;
	private final Stueck[] stuecke;
	private final Block[] blockSoll;
	private final String[] blockName;
	private final Map<Block, String> baustoffe = new HashMap<>();
	private final ArrayDeque<Stueck> warteschlange = new ArrayDeque<>();
	private final BlockPos.MutableBlockPos stelle = new BlockPos.MutableBlockPos();
	private Ereignis ereignis = new Ereignis();
	private int reihum;

	/** Vorbereitung ohne Spielzustand, läuft im Netz-Thread. */
	record Vorlage(String hash, int ankerX, int ankerY, int ankerZ, String[] namen, List<int[]> kopf, List<int[]> stellen, List<short[]> soll) {
		static Vorlage aus(JsonObject plan, int ankerX, int ankerY, int ankerZ) {
			JsonObject groesse = plan.getAsJsonObject("groesse");
			JsonObject gebaeude = plan.getAsJsonObject("gebaeude");
			int gx = groesse.get("x").getAsInt();
			int gz = groesse.get("z").getAsInt();
			int vonX = ankerX - gebaeude.get("x").getAsInt();
			int vonY = ankerY - gebaeude.get("y").getAsInt();
			int vonZ = ankerZ - gebaeude.get("z").getAsInt();

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

			// Chunk -> Blöcke, aufsteigend nach Plannummer: Ebene für Ebene, dann z, dann x.
			Map<Long, List<long[]>> sammlung = new TreeMap<>();
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
						short soll = index.get(c);
						for (int n = 0; n < zahl; n++) {
							int q = zelle + n;
							int wx = vonX + q % gx;
							int wz = vonZ + q / gx;
							long key = (((long) (wx >> 4)) << 32) ^ ((wz >> 4) & 0xffffffffL);
							sammlung.computeIfAbsent(key, s -> new ArrayList<>()).add(new long[] {(wx & 15) | ((wz & 15) << 4) | ((long) (vonY + y + 2048) << 8), soll});
						}
					}
					zelle += zahl;
					zahl = 0;
				}
				if (zelle != gx * gz) throw new IllegalStateException("Ebene " + y + " hat die falsche Länge.");
			}

			List<int[]> kopf = new ArrayList<>();
			List<int[]> stellen = new ArrayList<>();
			List<short[]> soll = new ArrayList<>();
			for (Map.Entry<Long, List<long[]>> e : sammlung.entrySet()) {
				List<long[]> liste = e.getValue();
				int[] s = new int[liste.size()];
				short[] b = new short[liste.size()];
				for (int i = 0; i < s.length; i++) {
					s[i] = (int) liste.get(i)[0];
					b[i] = (short) liste.get(i)[1];
				}
				kopf.add(new int[] {(int) (e.getKey() >> 32), (int) (long) e.getKey()});
				stellen.add(s);
				soll.add(b);
			}
			return new Vorlage(plan.get("hash").getAsString(), ankerX, ankerY, ankerZ, namen.toArray(new String[0]), kopf, stellen, soll);
		}
	}

	/** Blöcke auflösen und fertig machen. Muss im Spiel-Thread laufen. */
	Abgleich(Vorlage v) {
		planHash = v.hash();
		ankerX = v.ankerX();
		ankerY = v.ankerY();
		ankerZ = v.ankerZ();
		blockName = v.namen();
		blockSoll = new Block[blockName.length];
		int unbekannt = 0;
		for (int i = 0; i < blockName.length; i++) {
			Identifier id = Identifier.parse(blockName[i]);
			if (BuiltInRegistries.BLOCK.containsKey(id)) {
				blockSoll[i] = BuiltInRegistries.BLOCK.getValue(id);
				if (!NATUR.matcher(blockName[i]).matches()) baustoffe.put(blockSoll[i], blockName[i]);
			} else {
				unbekannt++;
				BrunoLive.LOG.warn("Block aus dem Plan gibt es in dieser Version nicht: {}", blockName[i]);
			}
		}
		unbekannteBloecke = unbekannt;
		stuecke = new Stueck[v.kopf().size()];
		for (int i = 0; i < stuecke.length; i++) {
			int[] k = v.kopf().get(i);
			stuecke[i] = new Stueck(k[0], k[1], v.stellen().get(i), v.soll().get(i));
		}
	}

	/** Ein Happen Abgleich. Wird jeden Tick aufgerufen und kostet höchstens ein paar tausend Blockabfragen. */
	void tick(ClientLevel welt) {
		int budget = BLOECKE_JE_TICK;
		for (int i = 0; i < stuecke.length && budget > 0; i++) {
			Stueck s = stuecke[reihum];
			reihum = (reihum + 1) % stuecke.length;
			LevelChunk chunk = welt.getChunkSource().getChunkNow(s.cx, s.cz);
			if (chunk == null) continue; // nicht in Sichtweite
			pruefen(s, chunk, welt);
			budget -= s.stellen.length;
		}
	}

	private void pruefen(Stueck s, LevelChunk chunk, ClientLevel welt) {
		int n = s.stellen.length;
		byte[] bits = new byte[(n + 7) / 8];
		Map<String, List<Integer>> falsch = new TreeMap<>();
		for (int i = 0; i < n; i++) {
			int p = s.stellen[i];
			int y = (p >> 8) - 2048;
			if (y < welt.getMinY() || y > welt.getMaxY()) continue;
			stelle.set((s.cx << 4) | (p & 15), y, (s.cz << 4) | ((p >> 4) & 15));
			Block ist = chunk.getBlockState(stelle).getBlock();
			if (ist == blockSoll[s.soll[i]]) {
				bits[i >> 3] |= (byte) (1 << (i & 7));
			} else {
				String name = baustoffe.get(ist);
				if (name != null) falsch.computeIfAbsent(name, k -> new ArrayList<>()).add(i);
			}
		}
		if (s.bits != null && Arrays.equals(bits, s.bits) && falsch.equals(s.falsch)) return;
		boolean aenderung = s.bits != null;
		if (aenderung) unterschiedZaehlen(s, bits, falsch);
		s.bits = bits;
		s.falsch = falsch;
		// Was sich gerade geändert hat, geht vor: Beim Betreten warten sonst alle Chunks der Umgebung davor.
		if (aenderung) {
			if (s.offen) warteschlange.remove(s);
			warteschlange.addFirst(s);
		} else if (!s.offen) {
			warteschlange.addLast(s);
		}
		s.offen = true;
	}

	/** Noch mehr offen, als in eine Meldung passt: Beim Betreten darf schneller gemeldet werden. */
	boolean rueckstand() {
		return warteschlange.size() > CHUNKS_JE_MELDUNG;
	}

	private void unterschiedZaehlen(Stueck s, byte[] neu, Map<String, List<Integer>> falsch) {
		for (int i = 0; i < s.stellen.length; i++) {
			boolean vorher = (s.bits[i >> 3] & (1 << (i & 7))) != 0;
			boolean jetzt = (neu[i >> 3] & (1 << (i & 7))) != 0;
			if (jetzt && !vorher) {
				ereignis.plus++;
				ereignis.bloecke.merge(blockName[s.soll[i]], 1, Integer::sum);
			} else if (vorher && !jetzt) {
				ereignis.minus++;
			}
		}
		int alt = s.falsch.values().stream().mapToInt(List::size).sum();
		int jetzt = falsch.values().stream().mapToInt(List::size).sum();
		if (jetzt > alt) ereignis.falsch += jetzt - alt;
	}

	/** Nimmt geänderte Chunks und Ereignis in die Meldung auf. Klappt das Senden nicht, kommt alles mit {@link #zurueck} wieder rein. */
	Abgabe abgeben(JsonObject meldung) {
		List<Stueck> dabei = new ArrayList<>();
		while (dabei.size() < CHUNKS_JE_MELDUNG && !warteschlange.isEmpty()) {
			Stueck s = warteschlange.poll();
			s.offen = false;
			dabei.add(s);
		}
		Ereignis e = ereignis;
		ereignis = new Ereignis();
		if (dabei.isEmpty() && e.leer()) return new Abgabe(dabei, e);

		meldung.addProperty("plan_hash", planHash);
		JsonObject anker = new JsonObject();
		anker.addProperty("x", ankerX);
		anker.addProperty("y", ankerY);
		anker.addProperty("z", ankerZ);
		meldung.add("anker", anker);

		JsonArray liste = new JsonArray();
		for (Stueck s : dabei) {
			JsonObject c = new JsonObject();
			c.addProperty("cx", s.cx);
			c.addProperty("cz", s.cz);
			c.addProperty("n", s.stellen.length);
			c.addProperty("gebaut", Base64.getEncoder().encodeToString(s.bits));
			JsonObject falsch = new JsonObject();
			s.falsch.forEach((block, stellen) -> {
				JsonArray a = new JsonArray();
				stellen.forEach(a::add);
				falsch.add(block, a);
			});
			c.add("falsch", falsch);
			liste.add(c);
		}
		meldung.add("chunks", liste);

		if (!e.leer()) {
			JsonObject o = new JsonObject();
			o.addProperty("plus", e.plus);
			o.addProperty("minus", e.minus);
			o.addProperty("falsch", e.falsch);
			JsonObject bloecke = new JsonObject();
			e.bloecke.entrySet().stream()
				.sorted((a, b) -> b.getValue() - a.getValue())
				.limit(12)
				.forEach((x) -> bloecke.addProperty(x.getKey(), x.getValue()));
			o.add("bloecke", bloecke);
			meldung.add("ereignis", o);
		}
		return new Abgabe(dabei, e);
	}

	record Abgabe(List<Stueck> stuecke, Ereignis ereignis) {}

	void zurueck(Abgabe a) {
		for (Stueck s : a.stuecke()) {
			if (!s.offen) {
				s.offen = true;
				warteschlange.addFirst(s);
			}
		}
		ereignis.plus += a.ereignis().plus;
		ereignis.minus += a.ereignis().minus;
		ereignis.falsch += a.ereignis().falsch;
		a.ereignis().bloecke.forEach((k, v) -> ereignis.bloecke.merge(k, v, Integer::sum));
	}

	/** Zahlen für /bruno status */
	int[] stand() {
		int gesehen = 0;
		int bloecke = 0;
		int gebaut = 0;
		for (Stueck s : stuecke) {
			if (s.bits == null) continue;
			gesehen++;
			bloecke += s.stellen.length;
			for (byte b : s.bits) gebaut += Integer.bitCount(b & 0xff);
		}
		return new int[] {gesehen, stuecke.length, gebaut, bloecke, warteschlange.size()};
	}
}
