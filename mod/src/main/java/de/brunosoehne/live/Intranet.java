package de.brunosoehne.live;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Queue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.atomic.AtomicInteger;

/** Zugang zum Intranet: Adresse und Schlüssel aus config/bruno-live.json, der Plan und die Live-Leitung. */
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

	/** Antwort mit einem Status, der nicht 2xx ist. 401 = Schlüssel ungültig. */
	static final class Abgelehnt extends IOException {
		final int status;

		Abgelehnt(int status, String text) {
			super("HTTP " + status + ": " + text);
			this.status = status;
		}
	}

	private static final Gson GSON = new Gson();
	private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
	final Konfig konfig;

	Intranet(Konfig konfig) {
		this.konfig = konfig;
	}

	JsonObject plan() throws IOException, InterruptedException {
		HttpRequest anfrage = HttpRequest.newBuilder(URI.create(konfig.url() + "/api/mc/plan"))
			.timeout(Duration.ofSeconds(30))
			.header("Authorization", "Bearer " + konfig.schluessel())
			.GET()
			.build();
		HttpResponse<String> antwort = client.send(anfrage, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		if (antwort.statusCode() / 100 != 2) throw new Abgelehnt(antwort.statusCode(), kurz(antwort.body()));
		return JsonParser.parseString(antwort.body()).getAsJsonObject();
	}

	/** Baut die Live-Leitung auf. Eingehende Nachrichten landen in der Warteschlange, die das Spiel jeden Tick leert. */
	CompletableFuture<Leitung> verbinden(Queue<JsonObject> eingang) {
		String ziel = konfig.url().replaceFirst("^http", "ws") + "/api/mc/live";
		Leitung leitung = new Leitung(eingang);
		return client.newWebSocketBuilder()
			.header("Authorization", "Bearer " + konfig.schluessel())
			.connectTimeout(Duration.ofSeconds(10))
			.buildAsync(URI.create(ziel), leitung)
			.handle((ws, fehler) -> {
				if (fehler == null) return leitung;
				Throwable f = fehler.getCause() != null ? fehler.getCause() : fehler;
				if (f instanceof WebSocketHandshakeException h) {
					int status = h.getResponse().statusCode();
					Object body = h.getResponse().body();
					throw new java.util.concurrent.CompletionException(new Abgelehnt(status, body instanceof String s ? kurz(s) : ""));
				}
				throw new java.util.concurrent.CompletionException(f);
			});
	}

	private static String kurz(String text) {
		return text == null ? "" : text.length() > 200 ? text.substring(0, 200) : text;
	}

	/** Eine offene WebSocket-Verbindung zum Live-Raum. Senden geht der Reihe nach, das Spiel wartet nie darauf. */
	static final class Leitung implements WebSocket.Listener {
		private static final int MAX_UNTERWEGS = 64;
		private final Queue<JsonObject> eingang;
		private final StringBuilder teil = new StringBuilder();
		private final AtomicInteger unterwegs = new AtomicInteger();
		private volatile WebSocket ws;
		private volatile boolean offen;
		private volatile String grund = "";
		private CompletableFuture<WebSocket> kette = CompletableFuture.completedFuture(null);

		Leitung(Queue<JsonObject> eingang) {
			this.eingang = eingang;
		}

		boolean offen() {
			return offen;
		}

		String grund() {
			return grund;
		}

		@Override
		public void onOpen(WebSocket ws) {
			this.ws = ws;
			offen = true;
			ws.request(1);
		}

		@Override
		public CompletionStage<?> onText(WebSocket ws, CharSequence daten, boolean letztes) {
			teil.append(daten);
			if (letztes) {
				try {
					eingang.add(JsonParser.parseString(teil.toString()).getAsJsonObject());
				} catch (RuntimeException ex) {
					BrunoLive.LOG.debug("Unlesbare Nachricht", ex);
				}
				teil.setLength(0);
			}
			ws.request(1);
			return null;
		}

		@Override
		public CompletionStage<?> onClose(WebSocket ws, int code, String text) {
			offen = false;
			grund = "Verbindung beendet (" + code + (text == null || text.isEmpty() ? "" : ": " + text) + ")";
			return null;
		}

		@Override
		public void onError(WebSocket ws, Throwable fehler) {
			offen = false;
			grund = "Verbindung unterbrochen: " + fehler;
		}

		/** Wichtiges (Blöcke) wird immer gesendet. Positionen fallen weg, wenn die Leitung gerade hinterherhinkt. */
		synchronized void senden(JsonObject nachricht, boolean wichtig) {
			if (!offen) return;
			if (!wichtig && unterwegs.get() > MAX_UNTERWEGS) return;
			String text = GSON.toJson(nachricht);
			unterwegs.incrementAndGet();
			kette = kette.thenCompose((x) -> ws.sendText(text, true)).handle((x, fehler) -> {
				unterwegs.decrementAndGet();
				if (fehler != null) {
					offen = false;
					grund = "Senden fehlgeschlagen: " + fehler;
				}
				return ws;
			});
		}

		void schliessen() {
			offen = false;
			WebSocket w = ws;
			if (w != null) w.sendClose(WebSocket.NORMAL_CLOSURE, "").exceptionally((x) -> null);
		}
	}
}
