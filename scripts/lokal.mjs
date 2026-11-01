// Startet das Intranet lokal zum Testen: npm run lokal
//
// Bringt die lokale Datenbank auf den neuesten Stand, legt beim ersten Start einen Test-Zugang an und
// füllt den Baufortschritt mit Beispieldaten, solange es keinen echten Abgleich gibt.
// Alles bleibt in .wrangler/state auf diesem Rechner, die echte Website wird nicht berührt.
import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = 8787;
const ADRESSE = `http://localhost:${PORT}`;
const BENUTZER = 'test';
const PASSWORT = 'testtest1234';
const SCHLUESSEL = 'lokal';

const json = (pfad, body, kopf = {}) =>
  fetch(ADRESSE + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(body) });

// Beispiel: Gebäude bis Ebene 12 und die Straße stehen, ein Stück Nordfassade ist in der falschen Farbe.
function beispielFortschritt(plan) {
  const bits = Buffer.alloc(Math.ceil(plan.gesamt / 8));
  const falsch = [];
  let nummer = 0;
  let anzahl = 0;
  plan.layers.forEach((schicht, y) => {
    for (const [, n, c] of schicht.matchAll(/(\d+)(\D)/g)) {
      if (c === '.') continue;
      const { abschnitt, teil } = plan.palette[c];
      for (let k = 0; k < Number(n); k++, nummer++) {
        if (teil === 'Fassadenfläche' && y === 5 && falsch.length < 150) {
          falsch.push(nummer);
        } else if ((abschnitt === 'gebaeude' && y <= 12) || teil === 'Straße' || teil === 'Fahrbahnmarkierung') {
          bits[nummer >> 3] |= 1 << (nummer & 7);
          anzahl++;
        }
      }
    }
  });
  return { plan_hash: plan.hash, gebaut: bits.toString('base64'), gebaut_anzahl: anzahl, falsch: { 'minecraft:gray_concrete': falsch } };
}

async function einrichten() {
  for (let i = 0; ; i++) {
    try {
      await fetch(`${ADRESSE}/api/setup`);
      break;
    } catch {
      if (i > 60) throw new Error('Der lokale Server antwortet nicht.');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const { needed } = await (await fetch(`${ADRESSE}/api/setup`)).json();
  const antwort = needed
    ? await json('/api/setup', { token: SCHLUESSEL, username: BENUTZER, display_name: 'Test', password: PASSWORT })
    : await json('/api/auth/login', { username: BENUTZER, password: PASSWORT });

  if (antwort.ok) {
    const cookie = antwort.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const { fortschritt } = await (await fetch(`${ADRESSE}/api/bauplan`, { headers: { cookie } })).json();
    if (!fortschritt) {
      const plan = JSON.parse(readFileSync(new URL('../public/rechenzentrum.plan.json', import.meta.url), 'utf8'));
      await json('/api/bauplan/fortschritt', beispielFortschritt(plan), { authorization: `Bearer ${SCHLUESSEL}` });
    }
  }
  console.log(`
  Intranet läuft:  ${ADRESSE}/#/bauplan
  Anmelden:        ${antwort.ok ? `${BENUTZER} / ${PASSWORT}` : 'mit deinem bestehenden lokalen Zugang'}
  Beenden:         Strg+C
`);
}

execSync('npx wrangler d1 migrations apply bruno-intranet --local', { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
const server = spawn(`npx wrangler dev --port ${PORT} --var SETUP_TOKEN:${SCHLUESSEL} --var BAUPLAN_SYNC_KEY:${SCHLUESSEL}`, { stdio: 'inherit', shell: true });
server.on('exit', (code) => process.exit(code ?? 0));
einrichten().catch((err) => console.error(err.message));
