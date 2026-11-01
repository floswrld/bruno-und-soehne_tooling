// Erzeugt den Bauplan des Rechenzentrums.
//
//   npm run bauplan:plan
//
// Gebäude: 120 x 200 x 40 (x = Osten, y = oben, z = Süden), innen hohl. Dachtechnik ragt über die Attika hinaus.
// Der Plan besteht aus drei Abschnitten: Gebäudehülle, Dach mit Kühlung, Gelände.
//
// Schreibt zwei Dateien:
//   public/rechenzentrum.plan.json   der ganze Plan, wird angemeldet ausgeliefert (siehe src/index.ts)
//   src/rechenzentrum.meta.json      nur Prüfsumme und Blockzahl, das genügt dem Worker
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { BLOECKE } from '../public/bloecke.js';
import { BAU, GX, GZ, HOEHE, RAND, allesDurchlaufen, eintrag, kodieren, set, stoff } from './rechenzentrum/raster.mjs';
import { gebaeudeBauen } from './rechenzentrum/gebaeude.mjs';
import { dachBauen } from './rechenzentrum/dach.mjs';
import { gelaendeBauen } from './rechenzentrum/gelaende.mjs';

// Welt-Koordinate der unteren Nord-West-Ecke des Gebäudes. Null = noch nicht festgelegt.
const ANKER = null;

const ABSCHNITTE = {
  gebaeude: { name: 'Gebäudehülle' },
  dach: { name: 'Dach und Kühlung' },
  gelaende: { name: 'Gelände' },
};

gelaendeBauen();
gebaeudeBauen();
dachBauen();

// ---------- Prüfen ----------

const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
const fehlend = new Set();
allesDurchlaufen((x, y, z, p) => {
  if (!BLOECKE[p.block]) fehlend.add(p.block);
  if (p.abschnitt === 'gebaeude') {
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
    box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
    box.z0 = Math.min(box.z0, z); box.z1 = Math.max(box.z1, z);
  }
  if (y >= 36 && p.teil === 'Logo') throw new Error(`Logo auf dem Dach: ${x},${y},${z}`);
  // Modern heißt hier auch: nichts Kupfernes, das rostig wirkt.
  if (/copper|lightning_rod|terracotta/.test(p.block)) throw new Error(`Rostfarben: ${p.block} (${p.teil}) bei ${x},${y},${z}`);
  // Innen bleibt frei: Gebäudehülle nur in den Wänden, Dachtechnik nur auf dem Dach.
  if (x >= 3 && x < BAU.x - 3 && z >= 3 && z < BAU.z - 3 && y < 36) throw new Error(`Block im Innenraum: ${p.block} (${p.teil}) bei ${x},${y},${z}`);
});
if (fehlend.size) throw new Error(`Unbekannte Blöcke, bitte in public/bloecke.js ergänzen: ${[...fehlend].join(', ')}`);
const masse = [box.x1 - box.x0 + 1, box.z1 - box.z0 + 1, box.y1 - box.y0 + 1];
if (masse.join() !== `${BAU.x},${BAU.z},${BAU.y}`) throw new Error(`Gebäudemaße stimmen nicht: ${masse}`);

// Dachlicht: Monster spawnen im Dunkeln und fressen später das Monster-Limit der Farmen. Die Prüfung rechnet
// das Licht wie das Spiel aus, was auf dem Dach dunkel bleibt, bekommt eine schlanke Leuchte.
const LICHT = { 'minecraft:sea_lantern': 15, 'minecraft:end_rod': 14 };
const DURCHLAESSIG = /(_slab|_wall|_fence|_trapdoor|_door|_pane|_glass|^minecraft:glass$|_bars|iron_chain|end_rod|water|lever|hopper)/;
const NICHT_SPAWNBAR = /(_slab|_trapdoor|_wall|_fence|_bars|_glass|^minecraft:glass$|water|hopper|iron_chain)/;
const DACH_AB = 37;

function dachLichtRechnen() {
  const W = BAU.x; const D = BAU.z; const H = 54;
  const licht = new Int8Array(W * D * H);
  const offen = new Uint8Array(W * D * H);
  const I = (x, y, z) => x + z * W + y * W * D;
  const warteschlange = [];
  for (let y = DACH_AB - 1; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const e = eintrag(x, y, z);
    offen[I(x, y, z)] = !e.block || DURCHLAESSIG.test(e.block) ? 1 : 0;
    const l = LICHT[e.block];
    if (l) { licht[I(x, y, z)] = l; warteschlange.push(I(x, y, z)); }
  }
  for (let k = 0; k < warteschlange.length; k++) {
    const i = warteschlange[k];
    const l = licht[i] - 1;
    if (l <= 0) continue;
    const y = Math.floor(i / (W * D));
    const r = i - y * W * D;
    const z = Math.floor(r / W);
    const x = r - z * W;
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + a; const Y = y + b; const Z = z + c;
      if (X < 0 || X >= W || Y < DACH_AB - 1 || Y >= H || Z < 0 || Z >= D) continue;
      const j = I(X, Y, Z);
      if (offen[j] && licht[j] < l) { licht[j] = l; warteschlange.push(j); }
    }
  }
  const dunkel = [];
  for (let y = DACH_AB; y < H - 2; y++) for (let z = 3; z < D - 3; z++) for (let x = 3; x < W - 3; x++) {
    const unten = eintrag(x, y - 1, z);
    if (!unten.block || NICHT_SPAWNBAR.test(unten.block) || DURCHLAESSIG.test(unten.block)) continue;
    if (eintrag(x, y, z).block || eintrag(x, y + 1, z).block) continue;
    if (licht[I(x, y, z)] > 0) continue;
    dunkel.push({ x, y, z });
  }
  return dunkel;
}

const dachleuchte = stoff('dach')('Dachleuchte', 'end_rod', 'facing=up');
let dunkel = dachLichtRechnen();
let leuchten = 0;
for (let runde = 0; runde < 40 && dunkel.length; runde++) {
  const gesetzt = [];
  for (const q of dunkel) {
    if (gesetzt.some((s) => Math.abs(s.x - q.x) + Math.abs(s.z - q.z) + 4 * Math.abs(s.y - q.y) < 12)) continue;
    set(q.x, q.y, q.z, dachleuchte);
    gesetzt.push(q);
    leuchten++;
  }
  dunkel = dachLichtRechnen();
}
if (dunkel.length) throw new Error(`Noch ${dunkel.length} dunkle Flächen auf dem Dach, z. B. ${JSON.stringify(dunkel[0])}`);

// ---------- Schreiben ----------

const { layers, palette, gesamt, groesse, zaehl } = kodieren();
const inhalt = {
  name: 'Rechenzentrum',
  gesamt,
  groesse,
  gebaeude: { x: RAND.west, y: 0, z: RAND.nord, breite: BAU.x, hoehe: BAU.y, tiefe: BAU.z },
  anker: ANKER,
  abschnitte: ABSCHNITTE,
  palette,
  layers,
};
const hash = createHash('sha256').update(JSON.stringify(inhalt)).digest('hex').slice(0, 16);
const text = JSON.stringify({ hash, ...inhalt });
writeFileSync(new URL('../public/rechenzentrum.plan.json', import.meta.url), `${text}\n`);
writeFileSync(new URL('../src/rechenzentrum.meta.json', import.meta.url), `${JSON.stringify({ hash, gesamt })}\n`);

// ---------- Bericht ----------

const proAbschnitt = {};
for (const [p, n] of zaehl) proAbschnitt[p.abschnitt] = (proAbschnitt[p.abschnitt] ?? 0) + n;
console.log(`Plan ${hash}: Raster ${GX} x ${groesse.y} x ${GZ} (Höchstmaß ${HOEHE}), Gebäude ${masse.join(' x ')}`);
console.log(`Blöcke: ${gesamt.toLocaleString('de-DE')}, Paletteneinträge: ${Object.keys(palette).length}, Dateigröße: ${(text.length / 1024 / 1024).toFixed(2)} MB`);
console.log('Je Abschnitt:', proAbschnitt);
console.log(`Dach: keine dunklen Flächen mehr, ${leuchten} Dachleuchten ergänzt.`);
