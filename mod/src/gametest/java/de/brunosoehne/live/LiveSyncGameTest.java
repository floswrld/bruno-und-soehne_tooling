package de.brunosoehne.live;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestDedicatedServerConnection;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestDedicatedServerContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.loader.api.FabricLoader;

/**
 * Echter Durchlauf mit dem Spiel. Erst Einzelspieler: Dort darf die Mod nichts melden. Dann ein echter Server:
 * Blöcke setzen und wieder abbauen. Das Gegenstück prüft scripts/mod-test.mjs am lokalen Intranet.
 */
public class LiveSyncGameTest implements FabricClientGameTest {
	private static final int SEKUNDE = 20;

	@Override
	public void runTest(ClientGameTestContext kontext) {
		// Der Testlauf leert sein Verzeichnis beim Start, darum liegt die Zugangsdatei daneben.
		try {
			Files.copy(Path.of("../../bruno-live-test.json"), FabricLoader.getInstance().getConfigDir().resolve("bruno-live.json"), StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
		try (TestSingleplayerContext welt = kontext.worldBuilder().create()) {
			welt.getConnection().waitForChunksRender();
			welt.getServer().runCommand("gamemode creative @a");
			welt.getServer().runCommand("tp @a -40 110 -50");
			welt.getServer().runCommand("fill -60 114 -60 -60 116 -55 minecraft:white_concrete");
			kontext.waitTicks(15 * SEKUNDE);
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
			kontext.waitTicks(15 * SEKUNDE); // Erster Stand wird gemeldet.
			// Jetzt wird gebaut: Weißer Beton passt zur Fassade, die Fugen sind damit falsch.
			server.runCommand("fill -60 114 -60 -60 120 -30 minecraft:white_concrete");
			kontext.waitTicks(25 * SEKUNDE);
			// Ein Teil wird wieder abgebaut.
			server.runCommand("fill -60 114 -60 -60 120 -50 minecraft:air");
			kontext.waitTicks(25 * SEKUNDE);
		}
	}
}
