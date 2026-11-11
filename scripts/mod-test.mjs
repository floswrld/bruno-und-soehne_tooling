// Echter Test der Mod gegen das lokale Intranet: Das Spiel startet (kurz ein Fenster), legt eine Welt an, läuft
// herum, setzt und entfernt Blöcke. Dieses Skript hängt dabei als Browser am Live-Raum und misst, wie schnell alles
// ankommt. Danach prüft es den Stand.
//
//   Terminal 1:  npm run lokal
//   Terminal 2:  npm run mod:test      (braucht JDK 25 in JAVA_HOME)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const A = 'http://localhost:8787';
const ANKER = { x: -60, y: 100, z: -100 }; // wie in LiveSyncGameTest.java
const plan = JSON.parse(readFileSync(new URL('../public/rechenzentrum.plan.json', import.meta.url), 'utf8'));

const login = await fetch(`${A}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test', password: 'testtest1234' }) });
if (!login.ok) throw new Error(`Anmeldung fehlgeschlagen (${login.status}). Läuft npm run lokal?`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const json = async (methode, pfad, body) => {
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

// Als Browser am Live-Raum: jede Nachricht mit Empfangszeit.
const empfangen = [];
const ws = new WebSocket(`ws://localhost:8787/api/live/ws`, { headers: { cookie, origin: A } });
await new Promise((ok, fehler) => {
  ws.onopen = ok;
  ws.onerror = () => fehler(new Error('WebSocket zum Live-Raum ging nicht auf.'));
});
ws.onmessage = (e) => {
  if (e.data !== 'pong') empfangen.push({ am: Date.now(), m: JSON.parse(e.data) });
};
ws.send(JSON.stringify({ t: 'abo', an: true }));

const mod = fileURLToPath(new URL('../mod/', import.meta.url));
const programm = `"${mod}${process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'}" --console=plain runClientGameTest`;
const ende = await new Promise((fertig) => spawn(programm, { cwd: mod, stdio: 'inherit', shell: true }).on('exit', fertig));
await new Promise((r) => setTimeout(r, 1500));
ws.close();
if (ende !== 0) throw new Error(`Der Spieltest ist fehlgeschlagen (${ende}).`);

// ---------- Prüfen ----------

const melde = (titel, ok, wert) => {
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${titel}${wert !== undefined ? `: ${wert}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const zeitenDatei = `${ablage}bruno-live-test-zeiten.txt`;
const zeiten = existsSync(zeitenDatei) ? Object.fromEntries(readFileSync(zeitenDatei, 'utf8').trim().split('\n').map((z) => z.split(' ')).map(([k, v]) => [k, Number(v)])) : {};
const nach = (t, typ, bedingung = () => true) => empfangen.find((e) => e.am >= t && e.m.t === typ && bedingung(e.m));

// Die letzte Meldung: Die Skins kommen mit der Tab-Liste, kurz nach dem Anmelden.
const online = empfangen.filter((e) => e.m.t === 'online').map((e) => e.m.spieler.find((s) => s.mit_mod)).filter(Boolean).at(-1);
melde('Spieler mit Mod war online zu sehen', !!online, online?.name);
melde('Skin des Spielers kam mit', !!online?.haut, online?.haut && (online.haut.hash ?? online.haut.res));
if (online?.haut?.res) {
  const r = await fetch(`${A}/api/live/haut?res=${encodeURIComponent(online.haut.res)}`, { headers: { cookie } });
  melde('Standard-Skin ist als Bild abrufbar', r.ok && r.headers.get('content-type') === 'image/png', `${r.status}, ${(await r.arrayBuffer()).byteLength} Bytes`);
}

const lauf = empfangen.filter((e) => e.m.t === 'pos' && e.am >= zeiten.laufen && e.am <= zeiten.gelaufen + 300 && e.m.liste.length);
const dauer = (zeiten.gelaufen - zeiten.laufen) / 1000;
melde('Positionen beim Laufen mehrmals pro Sekunde', lauf.length / dauer >= 4, `${lauf.length} in ${dauer.toFixed(1)} s (${(lauf.length / dauer).toFixed(1)} pro Sekunde)`);
const p = lauf.at(-1)?.m.liste[0];
melde('Position mit Kommastellen und Blickrichtung', !!p && !Number.isInteger(p[1]) && typeof p[4] === 'number', p && JSON.stringify(p.slice(0, 8)));

const bau = nach(zeiten.bauen, 'bloecke', (m) => !m.sync);
melde('Gesetzte Blöcke kommen sofort an', !!bau && bau.am - zeiten.bauen < 1500, bau ? `${bau.am - zeiten.bauen} ms nach dem Befehl` : 'gar nicht');
const abbau = nach(zeiten.abbauen, 'bloecke', (m) => !m.sync && m.liste.some(([, s]) => s === 0));
melde('Abbau kommt sofort an', !!abbau && abbau.am - zeiten.abbauen < 1500, abbau ? `${abbau.am - zeiten.abbauen} ms nach dem Befehl` : 'gar nicht');

const feed = new Map();
for (const e of empfangen) if (e.m.t === 'feed') feed.set(e.m.eintrag.id, e.m.eintrag);
const summe = (k) => [...feed.values()].reduce((s, e) => s + e[k], 0);
melde('Feed: gebaut', summe('plus') > 0, summe('plus'));
melde('Feed: abgebaut', summe('minus') > 0, summe('minus'));
melde('Feed: falsch gesetzt', summe('falsch') > 0, summe('falsch'));

// Stichprobe am Ende: Was gebaut ist, muss im Plan wirklich weißer Beton an der gefüllten Stelle sein.
const stand = await json('GET', '/api/live');
melde('Nach dem Verlassen wieder offline', stand.spieler.length === 0);
const bits = Buffer.from(stand.fortschritt?.gebaut ?? '', 'base64');
const falsch = new Map(Object.entries(stand.fortschritt?.falsch ?? {}).flatMap(([b, l]) => l.map((n) => [n, b])));
const { x: X, z: Z } = plan.groesse;
let nummer = 0;
let richtig = 0;
let faelschlich = 0;
let falschRichtig = 0;
plan.layers.forEach((schicht, y) => {
  let i = 0;
  for (const [, n, c] of schicht.matchAll(/(\d+)(\D)/g)) {
    if (c !== '.') {
      for (let k = 0; k < Number(n); k++, nummer++) {
        const q = i + k;
        const wx = ANKER.x - plan.gebaeude.x + (q % X);
        const wz = ANKER.z - plan.gebaeude.z + Math.floor(q / X);
        const wy = ANKER.y - plan.gebaeude.y + y;
        const gebaut = (bits[nummer >> 3] & (1 << (nummer & 7))) !== 0;
        // Stehen geblieben ist weißer Beton in x = -60, y 114..120, z -49..-30.
        const imBereich = wx === -60 && wy >= 114 && wy <= 120 && wz >= -49 && wz <= -30;
        const soll = plan.palette[c].block;
        if (gebaut && imBereich && soll === 'minecraft:white_concrete') richtig++;
        else if (gebaut) faelschlich++;
        if (imBereich && soll !== 'minecraft:white_concrete' && falsch.get(nummer) === 'minecraft:white_concrete') falschRichtig++;
      }
    }
    i += Number(n);
  }
});
melde('Gebaut steht an den richtigen Stellen', richtig > 0, `${richtig} Blöcke`);
melde('Nichts steht fälschlich als gebaut da', faelschlich === 0, faelschlich);
melde('Falsch gesetzte Blöcke erkannt', falschRichtig > 0, falschRichtig);
console.log(process.exitCode ? '\nTest fehlgeschlagen.' : '\nTest bestanden.');
