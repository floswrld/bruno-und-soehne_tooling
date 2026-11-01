package de.brunosoehne.live;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/** Zugang zum Intranet: Adresse und Schlüssel aus config/bruno-live.json, dazu die drei Anfragen der Mod. */
final class Intranet {
	/** Inhalt von config/bruno-live.json. Die Datei kommt fertig aus dem Profil im Intranet. */
	record Konfig(String url, String schluessel, boolean einzelspieler) {
		static Konfig laden(Path datei) throws IOException {
			JsonObject o = JsonParser.parseString(Files.readString(datei, StandardCharsets.UTF_8)).getAsJsonObject();
			String url = o.get("url").getAsString().replaceAll("/+$", "");
			if (!url.startsWith("https://") && !url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
				throw new IOException("Die Adresse muss mit https:// beginnen.");
			}
			boolean einzelspieler = o.has("einzelspieler") && o.get("einzelspieler").getAsBoolean();
			return new Konfig(url, o.get("schluessel").getAsString(), einzelspieler);
		}
	}

	/** Antwort mit einem Status, der nicht 2xx ist. 401 = Schlüssel ungültig, 409 = Plan oder Standort geändert. */
	static final class Abgelehnt extends IOException {
		final int status;

		Abgelehnt(int status, String text) {
			super("HTTP " + status + ": " + text);
			this.status = status;
		}
	}

	private static final Gson GSON = new Gson();
	private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
	private final Konfig konfig;

	Intranet(Konfig konfig) {
		this.konfig = konfig;
	}

	private HttpRequest.Builder anfrage(String pfad) {
		return HttpRequest.newBuilder(URI.create(konfig.url() + pfad))
			.timeout(Duration.ofSeconds(30))
			.header("Authorization", "Bearer " + konfig.schluessel());
	}

	private String senden(HttpRequest anfrage) throws IOException, InterruptedException {
		HttpResponse<String> antwort = client.send(anfrage, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		if (antwort.statusCode() / 100 != 2) {
			String text = antwort.body();
			throw new Abgelehnt(antwort.statusCode(), text.length() > 200 ? text.substring(0, 200) : text);
		}
		return antwort.body();
	}

	JsonObject einstellungen() throws IOException, InterruptedException {
		return JsonParser.parseString(senden(anfrage("/api/mc/config").GET().build())).getAsJsonObject();
	}

	JsonObject plan() throws IOException, InterruptedException {
		return JsonParser.parseString(senden(anfrage("/api/mc/plan").GET().build())).getAsJsonObject();
	}

	void melden(JsonObject meldung) throws IOException, InterruptedException {
		senden(anfrage("/api/mc/melden")
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(meldung), StandardCharsets.UTF_8))
			.build());
	}
}
