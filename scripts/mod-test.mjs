// Echter Test der Mod gegen das lokale Intranet: Das Spiel startet (kurz ein Fenster), legt eine Welt an,
// setzt und entfernt Blöcke. Danach prüft dieses Skript, ob alles im Intranet angekommen ist.
//
//   Terminal 1:  npm run lokal
//   Terminal 2:  npm run mod:test      (braucht JDK 25 in JAVA_HOME)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const A = 'http://localhost:8787';
const ANKER = { x: -60, y: 100, z: -100 }; // wie in LiveSyncGameTest.java
const plan = JSON.parse(readFileSync(new URL('../public/rechenzentrum.plan.json', import.meta.url), 'utf8'));

const login = await fetch(`${A}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test', password: 'testtest1234' }) });
if (!login.ok) throw new Error(`Anmeldung fehlgeschlagen (${login.status}). Läuft npm run lokal?`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const json = async (methode, pfad, body) => {
  // Während das Spiel läuft, verfällt eine offene Verbindung. Darum einmal neu versuchen.
  const anfrage = () => fetch(A + pfad, { method: methode, headers: { cookie, connection: 'close', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const r = await anfrage().catch(anfrage);
  const d = await r.json();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${JSON.stringify(d)}`);
  return d;
};

await json('PUT', '/api/bauplan/einstellung', { anker: null, server: '' }); // leert den alten Live-Stand
await json('PUT', '/api/bauplan/einstellung', { anker: ANKER, server: 'localhost' });
const { konfig } = await json('POST', '/api/me/mc-key', {});

// Die Zugangsdatei holt sich der Test selbst: Sein Laufverzeichnis wird beim Start geleert.
const ablage = fileURLToPath(new URL('../mod/build/', import.meta.url));
mkdirSync(ablage, { recursive: true });
writeFileSync(`${ablage}bruno-live-test.json`, JSON.stringify(konfig));

const mod = fileURLToPath(new URL('../mod/', import.meta.url));
// Während das Spiel läuft, muss der Spieler im Intranet als online zu sehen sein.
let gesehen = null;
const beobachter = setInterval(async () => {
  const d = await json('GET', '/api/live?nur=spieler').catch(() => null);
  const s = d?.spieler.find((q) => q.mit_mod);
  if (s) gesehen = s;
}, 4000);
const programm = `"${mod}${process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'}" --console=plain runClientGameTest`;
const ende = await new Promise((fertig) => spawn(programm, { cwd: mod, stdio: 'inherit', shell: true }).on('exit', fertig));
clearInterval(beobachter);
if (ende !== 0) throw new Error(`Der Spieltest ist fehlgeschlagen (${ende}).`);

// ---------- Prüfen ----------

const live = await json('GET', '/api/live?seit=0');
const melde = (titel, ok, wert) => {
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${titel}${wert !== undefined ? `: ${wert}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const summe = (k) => live.ereignisse.reduce((s, e) => s + e[k], 0);
melde('Spieler war online zu sehen', !!gesehen, gesehen && `${gesehen.name} bei ${gesehen.x} / ${gesehen.y} / ${gesehen.z}`);
melde('Nach dem Verlassen wieder offline', live.spieler.length === 0);
melde('Chunks gemeldet', live.chunks.length > 0, live.chunks.length);
melde('Blöcke als gebaut gemeldet', summe('plus') > 0, summe('plus'));
melde('Abbau gemeldet', summe('minus') > 0, summe('minus'));
melde('Falsche Blöcke gemeldet', summe('falsch') > 0, summe('falsch'));

// Stichprobe: Was die Mod als gebaut meldet, muss im Plan wirklich dieser Block sein.
const { x: X, z: Z } = plan.groesse;
const vonX = ANKER.x - plan.gebaeude.x;
const vonZ = ANKER.z - plan.gebaeude.z;
const chunkListen = new Map();
plan.layers.forEach((schicht, y) => {
  let i = 0;
  for (const [, n, c] of schicht.matchAll(/(\d+)(\D)/g)) {
    if (c !== '.') for (let k = 0; k < Number(n); k++) {
      const q = i + k;
      const wx = vonX + (q % X);
      const wz = vonZ + Math.floor(q / X);
      const key = `${wx >> 4},${wz >> 4}`;
      if (!chunkListen.has(key)) chunkListen.set(key, []);
      chunkListen.get(key).push({ wx, wy: ANKER.y + y, wz, block: plan.palette[c].block });
    }
    i += Number(n);
  }
});
let gebautRichtig = 0;
let gebautFalschesFeld = 0;
let laengePasst = true;
for (const c of live.chunks) {
  const liste = chunkListen.get(`${c.cx},${c.cz}`);
  if (!liste || liste.length !== c.n) { laengePasst = false; continue; }
  const bits = Buffer.from(c.gebaut, 'base64');
  liste.forEach((b, i) => {
    if (!(bits[i >> 3] & (1 << (i & 7)))) return;
    // Gesetzt wurde weißer Beton in x = -60, y 114..120, z -49..-30 (der Rest wurde wieder abgebaut).
    const imBereich = b.wx === -60 && b.wy >= 114 && b.wy <= 120 && b.wz >= -49 && b.wz <= -30;
    if (imBereich && b.block === 'minecraft:white_concrete') gebautRichtig++;
    else if (b.block === 'minecraft:white_concrete') gebautFalschesFeld++; // Abgebautes darf nicht mehr als gebaut gelten
  });
}
melde('Blockzahl je Chunk passt zum Plan', laengePasst);
melde('Gebaut steht an den richtigen Stellen', gebautRichtig > 0, `${gebautRichtig} Blöcke`);
melde('Nichts steht fälschlich als gebaut da', gebautFalschesFeld === 0, gebautFalschesFeld);
console.log(process.exitCode ? '\nTest fehlgeschlagen.' : '\nTest bestanden.');
