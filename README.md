# Bruno & Söhne Intranet

Das interne Tooling der Bruno & Söhne GmbH: Login, Personalverwaltung, Zeiterfassung, Scrum-Board und (bald) der Bauplan.

Läuft komplett auf Cloudflare: ein **Worker** liefert App und API aus, die Daten liegen in **D1** (SQLite). Für eine kleine Gruppe ist das im kostenlosen Tarif dauerhaft gratis.

## Funktionen

- **Keine Selbstregistrierung.** Nur die Geschäftsführung (Admins) legt Zugänge an. Jeder neue Zugang bekommt ein Einmal-Passwort wie `Pumpe-8723-Kupfer-Basalt`, das bei der ersten Anmeldung ersetzt werden muss.
- **Rollen:** Geschäftsführung (Admin) und Belegschaft. Admins können Titel vergeben, Rechte ändern, Zugänge deaktivieren und Passwörter zurücksetzen. Die letzte aktive Geschäftsführung kann sich nicht selbst entmachten.
- **Zeiterfassung:** Ein- und Ausstempeln, Zeit nachtragen und korrigieren, Wochenansicht. Admins sehen die Zeiten aller Mitarbeiter. Die Fleißrangliste auf der Übersicht sehen alle.
- **Scrum-Board:** Sprints mit Ziel und Zeitraum, fünf Spalten, Zuständige, Filter nach Mitarbeiter. Die Spalte einer Karte ändert sich nur per Drag & Drop, nicht im Bearbeiten-Dialog. Auf dem Handy: Karte lange drücken, dann ziehen.
- **Teilaufgaben:** Aufgaben lassen sich in Teilaufgaben zerlegen (eine Ebene). Sie stehen als eigene Karten auf dem Board, laufen im Sprint der übergeordneten Aufgabe mit, und deren Karte zeigt den Fortschritt. Nach „Erledigt“ darf eine Aufgabe erst, wenn alle Teilaufgaben erledigt sind. Wird danach eine Teilaufgabe wieder geöffnet oder neu angelegt, geht die Aufgabe zurück in Arbeit.
- **Bauplan:** Platzhalter, wird als Nächstes ausgebaut.

**Sicherheit:** Passwörter als PBKDF2-SHA256 (100.000 Runden, Salt). Sitzungen als HttpOnly-Cookie, in der Datenbank nur als SHA-256-Hash gespeichert. Login-Sperre nach 8 Fehlversuchen in 15 Minuten. Schreibende Anfragen müssen JSON vom eigenen Origin sein (Schutz gegen CSRF). Schriften liegen lokal, es gehen keine Anfragen an Google.

## KI-Agenten (MCP)

KI-Agenten (Claude Code, Cursor, …) können über `/mcp` das Scrum-Board bearbeiten. Nur das Board, kein Löschen.

1. Geschäftsführung: **Personal → Mitarbeiter bearbeiten → KI-Agenten (MCP) → Schlüssel**.
2. Den angezeigten Befehl ausführen (der Schlüssel erscheint nur einmal):

   ```bash
   claude mcp add --transport http bruno-board https://<deine-adresse>/mcp --header "Authorization: Bearer bsmcp_…"
   ```

Andere Programme: gleiche Adresse, Kopfzeile `Authorization: Bearer …`. Widerrufen im selben Dialog.

### Einrichten je Programm

| Programm | Geht mit dem Schlüssel? |
| --- | --- |
| Claude Code | Ja |
| Claude App (Web, Desktop, Handy) | Ja, wenn „Request headers“ angeboten wird (Beta). Sonst Claude Desktop über `mcp-remote` |
| ChatGPT (Web, App) | Nein, ChatGPT kann nur OAuth. Stattdessen Codex CLI |
| Gemini (Web, App) | Nein, nur OAuth und nur in den USA. Stattdessen Gemini CLI |

In allen Beispielen `<adresse>` und `bsmcp_…` ersetzen.

**Claude Code:** der Befehl oben.

**Claude App:** auf claude.ai **Customize → Connectors → Add custom connector**. URL `https://<adresse>/mcp`, Anmeldung **No sign-in**, unter **Request headers** den Namen `authorization` und als Wert `Bearer bsmcp_…` (mit „Bearer “). Gilt danach auch in der Desktop- und Handy-App. Bei Team/Enterprise legt das die Organisation an, dann teilen sich alle einen Schlüssel.

**Claude Desktop ohne „Request headers“:** braucht [Node.js](https://nodejs.org). **Settings → Developer → Edit Config**, eintragen und Claude neu starten:

```json
{
  "mcpServers": {
    "bruno-board": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<adresse>/mcp", "--header", "Authorization:${AUTH}"],
      "env": { "AUTH": "Bearer bsmcp_…" }
    }
  }
}
```

**Codex CLI (OpenAI):** in `~/.codex/config.toml` eintragen und den Schlüssel als Umgebungsvariable `BRUNO_MCP_KEY` setzen (nur `bsmcp_…`, ohne „Bearer“):

```toml
[mcp_servers.bruno-board]
url = "https://<adresse>/mcp"
bearer_token_env_var = "BRUNO_MCP_KEY"
```

**Gemini CLI:** in `~/.gemini/settings.json` eintragen:

```json
{
  "mcpServers": {
    "bruno-board": {
      "httpUrl": "https://<adresse>/mcp",
      "headers": { "Authorization": "Bearer bsmcp_…" }
    }
  }
}
```

## Online stellen (ca. 10 Minuten)

Voraussetzungen: [Node.js](https://nodejs.org) ab Version 20 und dein Cloudflare-Account (der, in dem vasica.de liegt).

```bash
npm install
npx wrangler login                        # öffnet den Browser, einmal bestätigen

npx wrangler d1 create bruno-intranet     # gibt eine database_id aus
```

Die ausgegebene `database_id` in `wrangler.jsonc` eintragen (statt der Nullen). Dann:

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
echo "SETUP_TOKEN=lokal" > .dev.vars
npm run db:local
npm run dev                               # http://localhost:8787
```

## Aufbau

```
src/index.ts          API (Hono): Auth, Personal, Zeiten, Sprints, Aufgaben
src/crypto.ts         Passwort-Hashing, Tokens, Einmal-Passwörter
migrations/           Datenbankschema (D1/SQLite)
public/               Die App: index.html, app.js, styles.css, Schriften, Logo
```

Das Frontend kommt ohne Build-Schritt aus: einfaches JavaScript, direkt im Browser. Neue Datenbank-Änderungen kommen als weitere Datei in `migrations/` (z. B. `0002_bauplan.sql`) und werden mit `npm run db:remote` eingespielt.

## Schriften

Bodoni Moda, Hanken Grotesk und Cinzel stehen unter der SIL Open Font License (Lizenztexte in `public/fonts/`).
