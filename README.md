# Bruno & Söhne Intranet

Das interne Tooling der Bruno & Söhne GmbH: Login, Personalverwaltung, Zeiterfassung, Scrum-Board und der Bauplan.

Läuft komplett auf Cloudflare: ein **Worker** liefert App und API aus, die Daten liegen in **D1** (SQLite). Für eine kleine Gruppe ist das im kostenlosen Tarif dauerhaft gratis.

## Funktionen

- **Keine Selbstregistrierung.** Nur die Geschäftsführung (Admins) legt Zugänge an. Jeder neue Zugang bekommt ein Einmal-Passwort wie `Pumpe-8723-Kupfer-Basalt`, das bei der ersten Anmeldung ersetzt werden muss.
- **Rollen:** Geschäftsführung (Admin) und Belegschaft. Admins können Titel vergeben, Rechte ändern, Zugänge deaktivieren und Passwörter zurücksetzen. Die letzte aktive Geschäftsführung kann sich nicht selbst entmachten.
- **Zeiterfassung:** Ein- und Ausstempeln, Zeit nachtragen und korrigieren, Wochenansicht. Admins sehen die Zeiten aller Mitarbeiter. Die Fleißrangliste auf der Übersicht sehen alle.
- **Scrum-Board:** Sprints mit Ziel und Zeitraum, fünf Spalten, Zuständige, Filter nach Mitarbeiter. Die Spalte einer Karte ändert sich nur per Drag & Drop, nicht im Bearbeiten-Dialog. Auf dem Handy: Karte lange drücken, dann ziehen.
- **Teilaufgaben:** Aufgaben lassen sich in Teilaufgaben zerlegen (eine Ebene). Sie stehen als eigene Karten auf dem Board, laufen im Sprint der übergeordneten Aufgabe mit, und deren Karte zeigt den Fortschritt. Nach „Erledigt“ darf eine Aufgabe erst, wenn alle Teilaufgaben erledigt sind. Wird danach eine Teilaufgabe wieder geöffnet oder neu angelegt, geht die Aufgabe zurück in Arbeit.
- **Bauplan:** Das Rechenzentrum in 3D (120 × 200 × 40), nur die äußerste Schicht: Fassade und Dachfläche, ohne Gelände und Dachtechnik. Innen ist es hohl, den Ausbau macht das Team selbst. Kamera: Ziehen dreht, rechte Maustaste verschiebt, das Rad zoomt zur Maus hin, WASD fährt, Doppelklick fliegt hin. Die Auto-Kamera hängt sich hinter den Spieler, der gerade baut. Ebene für Ebene ansehen, Block anklicken für Baustoff und Koordinate, Materialliste mit Stacks und Shulkern. Umschalten zwischen Gesamtbau, schon gebaut und noch offen. Der Plan steht im Code, hochladen kann niemand etwas.
- **Live vom Minecraft-Server:** Mit der Mod „Bruno Live“ zeigt das Intranet in Echtzeit, wer online ist und wo jeder gerade steht, als Figur mit seinem Skin. Der Bauplan baut sich beim Bauen sofort mit: frische Blöcke leuchten auf, der Fortschritt zählt mit, die Kamera kann einem Spieler folgen. Siehe unten.
- **Hell und Dunkel:** Standard ist die Einstellung des Geräts, umschalten per Sonne/Mond-Knopf oder im Profil. Die Wahl liegt nur im Browser. Im Dunkeln ist im Bauplan Nacht, und die Lampen leuchten.

**Sicherheit:** Passwörter als PBKDF2-SHA256 (100.000 Runden, Salt). Sitzungen als HttpOnly-Cookie, in der Datenbank nur als SHA-256-Hash gespeichert. Login-Sperre nach 8 Fehlversuchen in 15 Minuten. Schreibende Anfragen müssen JSON vom eigenen Origin sein (Schutz gegen CSRF). Schriften liegen lokal, es gehen keine Anfragen an Google.

## KI-Agenten (MCP)

KI-Apps können über `https://<adresse>/mcp` das Scrum-Board bearbeiten. Nur das Board, kein Löschen.

### Mit Anmeldung (jeder selbst)

In der KI-App einen eigenen Connector (MCP) mit der Adresse anlegen. Es öffnet sich die Anmeldung des Intranets, dann **Erlauben**. Die App arbeitet danach in deinem Namen. Verbundene Apps stehen unter **Profil → KI-Apps** und lassen sich dort trennen.

| Programm | So geht's |
| --- | --- |
| Claude App (Web, Desktop, Handy) | claude.ai → **Customize → Connectors → Add custom connector**, Adresse eintragen, **Connect** |
| ChatGPT | Developer Mode einschalten, dann unter Apps eine eigene App mit der Adresse anlegen, Anmeldung **OAuth** |
| Claude Code | `claude mcp add --transport http bruno-board https://<adresse>/mcp`, dann in Claude Code `/mcp` → anmelden |
| Cursor, VS Code, Codex, Gemini CLI | Adresse als MCP-Server eintragen, beim ersten Zugriff fragt das Programm nach der Anmeldung |
| Gemini App | Geht nicht: eigene Connectoren gibt es dort nur in den USA |

### Mit Schlüssel (nur Geschäftsführung)

Für Skripte oder Programme ohne Anmeldung: **Personal → Mitarbeiter bearbeiten → KI-Agenten (MCP) → Schlüssel**. Der Schlüssel erscheint nur einmal und kommt als Kopfzeile `Authorization: Bearer bsmcp_…` mit, z. B.:

```bash
claude mcp add --transport http bruno-board https://<adresse>/mcp --header "Authorization: Bearer bsmcp_…"
```

Widerrufen im selben Dialog. Dort sieht die Geschäftsführung auch die selbst verbundenen Apps und kann sie trennen.

## Online stellen (ca. 10 Minuten)

Voraussetzungen: [Node.js](https://nodejs.org) ab Version 20 und dein Cloudflare-Account (der, in dem vasica.de liegt).

```bash
npm install
npx wrangler login                        # öffnet den Browser, einmal bestätigen

npx wrangler d1 create bruno-intranet     # gibt eine database_id aus
npx wrangler kv namespace create OAUTH_KV # gibt eine id aus (für die Anmeldung von KI-Apps)
```

Die ausgegebene `database_id` und die KV-`id` in `wrangler.jsonc` eintragen. Dann:

```bash
npm run db:remote                         # Tabellen anlegen
npx wrangler secret put SETUP_TOKEN       # Gründungsschlüssel festlegen, z. B. ein langes Zufallswort
npm run deploy
```

Die App läuft jetzt unter `https://bruno-intranet.<dein-account>.workers.dev`.

### Eigene Adresse, z. B. bruno.vasica.de

Im Cloudflare-Dashboard: **Workers & Pages → bruno-intranet → Settings → Domains & Routes → Add → Custom Domain** und `bruno.vasica.de` eintragen. Da vasica.de schon bei Cloudflare liegt, ist das Zertifikat nach ein bis zwei Minuten aktiv.

### Firma gründen

1. Die Adresse öffnen. Solange es noch keinen Zugang gibt, erscheint „Firma gründen“.
2. Gründungsschlüssel, Name, Benutzername und Passwort eingeben. Dieser erste Zugang wird Geschäftsführung mit dem Titel „CEO & Patriarch“.
3. Unter **Personal** die anderen anlegen und ihnen das Einmal-Passwort schicken.

Danach wird der Gründungsschlüssel nicht mehr gebraucht. Du kannst ihn mit `npx wrangler secret delete SETUP_TOKEN` entfernen.

### Optional: automatisch deployen über GitHub

Projekt in ein GitHub-Repo legen, dann im Dashboard unter **bruno-intranet → Settings → Build → Connect** das Repo verbinden. Jeder Push auf `main` geht dann automatisch online.

### Optional: zusätzlicher Türsteher

Mit **Cloudflare Zero Trust → Access** (bis 50 Nutzer kostenlos) lässt sich vor die ganze Seite noch eine E-Mail-Bestätigung schalten. Für eine Minecraft-Firma ist das nicht nötig, aber es geht.

## Lokal entwickeln

```bash
npm install
npm run lokal                             # http://localhost:8787, Anmeldung: test / testtest1234
```

Das bringt die lokale Datenbank auf den neuesten Stand, legt beim ersten Start den Test-Zugang an und füllt den Baufortschritt mit Beispieldaten. Änderungen an `public/` und `src/` sind nach dem Neuladen der Seite da. Alles liegt in `.wrangler/state` auf diesem Rechner, die echte Website bleibt unberührt. Neu anfangen: Server beenden und den Ordner `.wrangler/state` löschen.

Den Abgleich testen, ohne etwas bei Aternos herunterzuladen: in einer Einzelspieler-Welt bauen, die Welt verlassen und im zweiten Terminal diese Welt melden. `--anker` ist die Stelle, an der die Nordwest-Ecke des Gebäudes stehen soll.

```powershell
$env:BAUPLAN_SYNC_KEY = "lokal"
npm run bauplan:sync -- "$env:APPDATA\.minecraft\saves\New World (1)" --anker 0,-60,0 --url http://localhost:8787
```

## Aufbau

```
src/index.ts          API (Hono): Auth, Personal, Zeiten, Sprints, Aufgaben, Routen
src/tasks.ts          Aufgaben und Board-Regeln, gemeinsam für App und MCP
src/mcp.ts            MCP-Server für KI-Apps (nur Scrum-Board)
src/oauth.ts          Anmeldung von KI-Apps (OAuth), Zustimmungsseite, Verbindungen
src/crypto.ts         Passwort-Hashing, Tokens, Einmal-Passwörter
migrations/           Datenbankschema (D1/SQLite)
public/               Die App: index.html, app.js, thema.js, bauplan.js (3D), bloecke.js (Baustoffe), styles.css, Schriften, Logo
public/vendor/three/  three.js (MIT), liegt lokal und wird nur auf der Bauplan-Seite geladen
public/rechenzentrum.plan.json   Der Bauplan, nur angemeldet abrufbar (eigene Route in src/index.ts)
src/rechenzentrum.meta.json      Prüfsumme und Blockzahl des Plans für den Worker
scripts/rechenzentrum/   Der Plan im Code: Raster, Logo, Fassade, Dachfläche
scripts/              Plan erzeugen (npm run bauplan:plan), mit der Welt abgleichen (npm run bauplan:sync), Mod bauen und testen
mod/                  Die Fabric-Mod „Bruno Live“ (Java, Gradle). Fertig gebaut in public/downloads/
src/live.ts           Anmeldung für Mod und Live-Anzeige, Skins, Standort
src/liveraum.ts       Live-Raum (Durable Object): WebSockets von Mods und Browsern, Stand des Baus
public/figur.js       Spielerfigur mit Skin für die 3D-Ansicht
public/haut.js        Skins laden, Köpfe für die Listen
```

### Live-Abgleich mit der Mod „Bruno Live“

Aternos erlaubt keine eigenen Server-Mods, darum läuft der Abgleich im Client: eine kleine Fabric-Mod im CurseForge-Profil (Ordner `mod/`, Minecraft 26.3). Mod und Website hängen per WebSocket am **Live-Raum**, einem Durable Object (`src/liveraum.ts`). Nichts wird abgefragt:

- Positionen gehen bis zu zehnmal pro Sekunde raus, mit Blickrichtung und Haltung (schleicht, sprintet, schlägt). Jede Mod meldet auch die Mitspieler in ihrer Sichtweite, auch solche ohne Mod.
- Ein geänderter Block wird per Mixin im selben Tick erkannt und sofort gemeldet. Wer am nächsten dran stand, bekommt ihn im Feed gutgeschrieben. Betonpulver zählt als Beton derselben Farbe (auch im Datei-Abgleich).
- Skins: echte Skins holt der Worker bei Mojang (`/api/live/haut/<hash>`), Standard-Skins schickt die Mod einmal mit.

Einmalig einrichten:

1. Deployen. Der Live-Raum wird dabei angelegt (Migration in `wrangler.jsonc`), Standort und Server von früher übernimmt er einmal aus D1.
2. Standort einmessen: Es zählt genau ein Block, der unterste an der Nordwest-Ecke (Plan x 0 · y 0 · z 0, schwarzer Beton). Den Block in der Welt setzen und als Geschäftsführung im Spiel draufschauen und `/bruno ecke` tippen. Das setzt Standort und Server auf einmal. Alternativ im Bauplan unter **Live → Standort und Server** eintragen, dort zeigt „Ecke im Modell zeigen“ den Block.
3. Jeder Mitspieler folgt der Anleitung im Profil: Mod herunterladen (Version 2, die alte vorher löschen), Zugangsdatei erzeugen, beides in den Profilordner legen.

So bleibt es harmlos: Die Mod meldet nur auf dem eingestellten Server und nur in der Oberwelt Blöcke. Jeder hat einen eigenen Schlüssel, der nur `/api/mc/*` darf und sich im Profil widerrufen lässt. Sie sieht nur, was der Client ohnehin kennt: Was gerade niemand mit Mod in Sichtweite hat, bleibt auf dem letzten Stand. Beim ersten Blick auf einen Chunk meldet sie nur, was vom bekannten Stand abweicht.

Gratis-Tarif: Der Live-Raum speichert den Stand gesammelt alle zwei Sekunden (eine Zeile), Positionen gar nicht. Eingehende WebSocket-Nachrichten zählen nur zu einem Zwanzigstel als Anfrage. Eine Mod schickt höchstens zehn Positionen pro Sekunde und nur, solange sich etwas bewegt: Fünf Spieler, die drei Stunden am Stück herumlaufen, ergeben rund 27.000 Anfragen, das Limit liegt bei 100.000 am Tag. Ein Browser mit offenem Bauplan kostet nichts extra.

Die Mod bauen (JDK 25 in `JAVA_HOME`): `npm run mod:bauen` legt sie nach `public/downloads/bruno-live.jar`. Echter Test mit dem Spiel gegen das lokale Intranet: `npm run lokal`, dann in einem zweiten Terminal `npm run mod:test`. Dabei öffnet sich kurz ein Spielfenster, in dem ein Testserver läuft. Fenster offen lassen, es schließt sich selbst. Zum Ausprobieren im Einzelspieler `"einzelspieler": true` in `config/bruno-live.json` ergänzen.

### Den Bauplan ändern

Plan neu erzeugen: `npm run bauplan:plan`. Die Fassade wird erst drei Blöcke tief entworfen (zurückgesetzte Fenster, Fugen), danach bleibt nur, was von außen zu sehen ist. Beim Erzeugen prüft das Skript: Gebäudemaße, unbekannte Block-IDs, kein Logo auf dem Dach, kein Kupfer, Innenraum frei, der Ankerblock steht und keine dunklen Flächen auf Dach und Attika (es rechnet das Licht wie das Spiel und setzt fehlende Leuchten bündig in die Fläche).

### Bauplan mit der Welt abgleichen

Der Abgleich liest eine Kopie der Minecraft-Welt und meldet, welche Blöcke des Plans schon stehen. Ein Durchlauf zählt jeden Block neu, abgebaute Blöcke werden also wieder offen.

Einmalig einrichten:

1. Einen langen Zufallswert als Schlüssel setzen: `npx wrangler secret put BAUPLAN_SYNC_KEY`.
2. Beim Melden mit `--anker x,y,z` den eingemessenen Ankerblock angeben (oder in `scripts/gen-rechenzentrum.mjs` bei `ANKER` eintragen, `npm run bauplan:plan` ausführen und deployen).

Danach bei jedem Abgleich die Welt bei Aternos herunterladen (Server vorher stoppen, damit alles gespeichert ist) und melden:

```bash
BAUPLAN_SYNC_KEY=... npm run bauplan:sync -- pfad/zur/world.zip --url https://deine-adresse
```

Das Ergebnis ersetzt den Stand im Live-Raum und erscheint sofort auf allen offenen Bauplan-Seiten. Mit `--nur-pruefen` statt `--url` wird nur das Ergebnis angezeigt und nichts gemeldet. Wird der Plan geändert, zählt der alte Abgleich nicht mehr und muss neu laufen.

Das Frontend kommt ohne Build-Schritt aus: einfaches JavaScript, direkt im Browser. Neue Datenbank-Änderungen kommen als weitere Datei in `migrations/` (z. B. `0002_bauplan.sql`) und werden mit `npm run db:remote` eingespielt.

## Schriften

Bodoni Moda, Hanken Grotesk und Cinzel stehen unter der SIL Open Font License (Lizenztexte in `public/fonts/`).
