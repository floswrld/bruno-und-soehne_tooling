package de.brunosoehne.live;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestDedicatedServerConnection;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestDedicatedServerContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.loader.api.FabricLoader;

/**
 * Echter Durchlauf mit dem Spiel. Erst Einzelspieler: Dort darf die Mod nichts melden. Dann ein echter Server:
 * herumlaufen, Blöcke setzen und wieder abbauen. Das Gegenstück (scripts/mod-test.mjs) hängt als Browser am Live-Raum
 * und misst, wie schnell alles ankommt. Die Zeitpunkte der Befehle stehen dafür in einer Datei neben dem Testlauf.
 */
public class LiveSyncGameTest implements FabricClientGameTest {
	private static final int SEKUNDE = 20;
	private static final Path ZEITEN = Path.of("../../bruno-live-test-zeiten.txt");

	private static void zeit(String was) {
		try {
			Files.writeString(ZEITEN, was + " " + System.currentTimeMillis() + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	@Override
	public void runTest(ClientGameTestContext kontext) {
		// Der Testlauf leert sein Verzeichnis beim Start, darum liegt die Zugangsdatei daneben.
		try {
			Files.copy(Path.of("../../bruno-live-test.json"), FabricLoader.getInstance().getConfigDir().resolve("bruno-live.json"), StandardCopyOption.REPLACE_EXISTING);
			Files.deleteIfExists(ZEITEN);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
		try (TestSingleplayerContext welt = kontext.worldBuilder().create()) {
			welt.getConnection().waitForChunksRender();
			welt.getServer().runCommand("gamemode creative @a");
			welt.getServer().runCommand("tp @a -40 110 -50");
			welt.getServer().runCommand("fill -60 114 -60 -60 116 -55 minecraft:white_concrete");
			kontext.waitTicks(5 * SEKUNDE);
		}
		try (TestDedicatedServerContext server = kontext.worldBuilder().createServer();
				TestDedicatedServerConnection verbindung = server.connect()) {
			verbindung.waitForChunksDownload();
			// Anker im Test: -60 / 100 / -100. Westwand = x -60, Fassade auf Höhe y 114 bis 120.
			server.runCommand("gamemode creative @a");
			server.runCommand("forceload add -64 -64 -48 -16");
			server.runCommand("tp @a -40 110 -50");
			kontext.waitTicks(3 * SEKUNDE);
			verbindung.waitForChunksDownload();
			kontext.waitTicks(5 * SEKUNDE); // Start vom Live-Raum, erster Blick auf die Chunks
			// Herumlaufen: Die Website soll die Figur flüssig sehen.
			zeit("laufen");
			for (int i = 0; i < 40; i++) {
				server.runCommand("tp @a " + (-40 + i * 0.25) + " 110 -50 " + (i * 9) + " 0");
				kontext.waitTicks(2);
			}
			zeit("gelaufen");
			kontext.waitTicks(2 * SEKUNDE);
			// Jetzt wird gebaut: Weißer Beton passt zur Fassade, die Fugen sind damit falsch.
			zeit("bauen");
			server.runCommand("fill -60 114 -60 -60 120 -30 minecraft:white_concrete");
			kontext.waitTicks(4 * SEKUNDE);
			// Ein Teil wird wieder abgebaut.
			zeit("abbauen");
			server.runCommand("fill -60 114 -60 -60 120 -50 minecraft:air");
			kontext.waitTicks(4 * SEKUNDE);
			// Betonpulver zählt als Beton. Darunter Stein, sonst fällt es herunter.
			zeit("pulver");
			server.runCommand("fill -60 113 -70 -60 113 -66 minecraft:stone");
			server.runCommand("fill -60 114 -70 -60 116 -66 minecraft:white_concrete_powder");
			kontext.waitTicks(4 * SEKUNDE);
			zeit("ende");
		}
	}
}
