// Erzeugt den Bauplan des Rechenzentrums.
//
//   npm run bauplan:plan
//
// Nur die äußerste Schicht des Gebäudes: 120 x 200 x 40 (x = Osten, y = oben, z = Süden), innen hohl.
// Kein Gelände, keine Dachtechnik. Die Fassade wird zuerst wie gewohnt entworfen (drei Blöcke tief, mit
// zurückgesetzten Fenstern und Fugen), danach bleibt nur, was man von außen sieht. Alles dahinter fällt weg.
//
// Schreibt zwei Dateien:
//   public/rechenzentrum.plan.json   der ganze Plan, wird angemeldet ausgeliefert (siehe src/index.ts)
//   src/rechenzentrum.meta.json      nur Prüfsumme, Blockzahl und Maße, das genügt dem Worker
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { BLOECKE } from '../public/bloecke.js';
import { BAU, GX, GZ, HOEHE, LUFT, RAND, allesDurchlaufen, eintrag, get, kodieren, set, stoff } from './rechenzentrum/raster.mjs';
import { gebaeudeBauen } from './rechenzentrum/gebaeude.mjs';
import { DACH, DACHLEUCHTE, DACHPLATTE, dachBauen } from './rechenzentrum/dach.mjs';

// Welt-Koordinate der unteren Nord-West-Ecke des Gebäudes. Null = noch nicht festgelegt.
const ANKER = null;

const ABSCHNITTE = {
  gebaeude: { name: 'Fassade' },
  dach: { name: 'Dachfläche' },
};

gebaeudeBauen();
dachBauen();

// ---------- Nur die äußerste Schicht ----------
// Außenluft: alles, was von außen erreichbar ist, ohne durchs Gebäude zu gehen. Glas und Gitter zählen als Wand.
// Der Innenraum (ab der dritten Wandschicht, unter dem Dach) ist keine Außenluft, auch hinter offenen Toren nicht.
// Ein Block bleibt, wenn er an Außenluft grenzt. Unten liegt der Boden der Welt, der zählt nicht als außen.

const W = BAU.x;
const D = BAU.z;
const H = HOEHE;
const innen = (x, y, z) => x >= 2 && x <= W - 3 && z >= 2 && z <= D - 3 && y <= DACHPLATTE - 1;
const I = (x, y, z) => x + z * W + y * W * D;

function aussenluftRechnen() {
  const aussen = new Uint8Array(W * D * H);
  const schlange = [];
  const rein = (x, y, z) => {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return;
    const i = I(x, y, z);
    if (aussen[i] || get(x, y, z) !== LUFT || innen(x, y, z)) return;
    aussen[i] = 1;
    schlange.push(i);
  };
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (x === 0 || x === W - 1 || z === 0 || z === D - 1 || y === H - 1) rein(x, y, z);
  }
  for (let k = 0; k < schlange.length; k++) {
    const i = schlange[k];
    const y = Math.floor(i / (W * D));
    const r = i - y * W * D;
    const z = Math.floor(r / W);
    const x = r - z * W;
    rein(x + 1, y, z); rein(x - 1, y, z); rein(x, y + 1, z); rein(x, y - 1, z); rein(x, y, z + 1); rein(x, y, z - 1);
  }
  return aussen;
}

function nurAussenhaut() {
  const aussen = aussenluftRechnen();
  const istAussen = (x, y, z) => {
    if (y < 0) return false; // Boden
    if (x < 0 || x >= W || z < 0 || z >= D || y >= H) return true;
    return aussen[I(x, y, z)] === 1;
  };
  const weg = [];
  allesDurchlaufen((x, y, z) => {
    const sichtbar = istAussen(x + 1, y, z) || istAussen(x - 1, y, z) || istAussen(x, y + 1, z) || istAussen(x, y - 1, z) || istAussen(x, y, z + 1) || istAussen(x, y, z - 1);
    if (!sichtbar) weg.push([x, y, z]);
  });
  for (const [x, y, z] of weg) set(x, y, z, LUFT);
  return weg.length;
}

const verdeckt = nurAussenhaut();

// ---------- Licht auf dem Dach ----------
// Monster spawnen im Dunkeln und fressen später das Monster-Limit der Farmen. Die Prüfung rechnet das Licht wie das
// Spiel aus. Leuchten sitzen bündig in der Dachfläche und mittig im Attikadeckel, nichts steht über die Haut hinaus.

const LICHT = { 'minecraft:sea_lantern': 15 };
const DURCHLAESSIG = /(_slab|_wall|_fence|_trapdoor|_door|_pane|_glass|^minecraft:glass$|_bars|iron_chain|end_rod|water|lever|hopper)/;
const NICHT_SPAWNBAR = /(_slab|_trapdoor|_wall|_fence|_bars|_glass|^minecraft:glass$|water|hopper|iron_chain|sea_lantern)/;
const OBEN_AB = DACHPLATTE + 1;
const ATTIKA_OBEN = BAU.y - 1;
const attikaleuchte = stoff('gebaeude')('Attikaleuchte', 'sea_lantern');

function dunkleStellen() {
  const licht = new Int8Array(W * D * H);
  const schlange = [];
  allesDurchlaufen((x, y, z, p) => {
    const l = LICHT[p.block];
    if (l) { licht[I(x, y, z)] = l; schlange.push(I(x, y, z)); }
  });
  const offen = (x, y, z) => { const e = eintrag(x, y, z); return !e.block || DURCHLAESSIG.test(e.block); };
  for (let k = 0; k < schlange.length; k++) {
    const i = schlange[k];
    const l = licht[i] - 1;
    if (l <= 0) continue;
    const y = Math.floor(i / (W * D));
    const r = i - y * W * D;
    const z = Math.floor(r / W);
    const x = r - z * W;
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + a; const Y = y + b; const Z = z + c;
      if (X < 0 || X >= W || Y < 0 || Y >= H || Z < 0 || Z >= D) continue;
      const j = I(X, Y, Z);
      if (licht[j] < l && offen(X, Y, Z)) { licht[j] = l; schlange.push(j); }
    }
  }
  const frei = (x, y, z) => y >= H || !eintrag(x, y, z).block;
  const dunkel = [];
  for (let y = OBEN_AB; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const unten = eintrag(x, y - 1, z);
    if (!unten.block || NICHT_SPAWNBAR.test(unten.block) || DURCHLAESSIG.test(unten.block)) continue;
    if (!frei(x, y, z) || !frei(x, y + 1, z)) continue;
    if (licht[I(x, y, z)] > 0) continue;
    dunkel.push({ x, y, z });
  }
  return dunkel;
}

// Grundraster: an jeder zweiten Kreuzung der Dachfugen, im Attikadeckel alle 12 Blöcke.
const istOberlicht = (x, z) => eintrag(x, DACHPLATTE, z).block === 'minecraft:glass';
for (let z = 12; z <= DACH.z1; z += 24) for (let x = 12; x <= DACH.x1; x += 24) if (!istOberlicht(x, z)) set(x, DACHPLATTE, z, DACHLEUCHTE);
for (let z = 24; z <= DACH.z1; z += 24) for (let x = 24; x <= DACH.x1; x += 24) if (!istOberlicht(x, z)) set(x, DACHPLATTE, z, DACHLEUCHTE);
for (let u = 6; u < D - 3; u += 12) { set(1, ATTIKA_OBEN, u, attikaleuchte); set(W - 2, ATTIKA_OBEN, D - 1 - u, attikaleuchte); }
for (let u = 6; u < W - 3; u += 12) { set(W - 1 - u, ATTIKA_OBEN, 1, attikaleuchte); set(u, ATTIKA_OBEN, D - 2, attikaleuchte); }

// Was danach noch dunkel ist, bekommt eine Leuchte direkt darunter.
let dunkel = dunkleStellen();
let leuchten = 0;
for (let runde = 0; runde < 40 && dunkel.length; runde++) {
  const gesetzt = [];
  for (const q of dunkel) {
    if (gesetzt.some((s) => Math.abs(s.x - q.x) + Math.abs(s.z - q.z) + 4 * Math.abs(s.y - q.y) < 12)) continue;
    const unten = q.y - 1;
    if (unten === DACHPLATTE && !istOberlicht(q.x, q.z)) set(q.x, unten, q.z, DACHLEUCHTE);
    else if (unten === ATTIKA_OBEN) set(q.x, unten, q.z, attikaleuchte);
    else continue;
    gesetzt.push(q);
    leuchten++;
  }
  dunkel = dunkleStellen();
}
if (dunkel.length) throw new Error(`Noch ${dunkel.length} dunkle Flächen auf dem Dach, z. B. ${JSON.stringify(dunkel[0])}`);

// ---------- Prüfen ----------

const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
const fehlend = new Set();
allesDurchlaufen((x, y, z, p) => {
  if (!BLOECKE[p.block]) fehlend.add(p.block);
  box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
  box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
  box.z0 = Math.min(box.z0, z); box.z1 = Math.max(box.z1, z);
  if (y >= 36 && p.teil === 'Logo') throw new Error(`Logo auf dem Dach: ${x},${y},${z}`);
  // Modern heißt hier auch: nichts Kupfernes, das rostig wirkt.
  if (/copper|lightning_rod|terracotta/.test(p.block)) throw new Error(`Rostfarben: ${p.block} (${p.teil}) bei ${x},${y},${z}`);
  // Innen bleibt frei: Fassade nur in den Wänden, darüber nur die Dachfläche.
  if (x >= 3 && x < BAU.x - 3 && z >= 3 && z < BAU.z - 3 && y < DACHPLATTE) throw new Error(`Block im Innenraum: ${p.block} (${p.teil}) bei ${x},${y},${z}`);
  if (y > BAU.y - 1) throw new Error(`Über der Attika: ${p.block} (${p.teil}) bei ${x},${y},${z}`);
});
if (fehlend.size) throw new Error(`Unbekannte Blöcke, bitte in public/bloecke.js ergänzen: ${[...fehlend].join(', ')}`);
const masse = [box.x1 - box.x0 + 1, box.z1 - box.z0 + 1, box.y1 - box.y0 + 1];
if (masse.join() !== `${BAU.x},${BAU.z},${BAU.y}`) throw new Error(`Gebäudemaße stimmen nicht: ${masse}`);
// Der Ankerblock muss stehen: Er ist der Block, den man in der Welt einmisst.
if (!eintrag(0, 0, 0).block) throw new Error('Die Nordwest-Ecke (0, 0, 0) ist leer. Daran wird der Standort eingemessen.');

// ---------- Schreiben ----------

const { layers, palette, gesamt, groesse, zaehl } = kodieren();
const ecke = eintrag(0, 0, 0);
const inhalt = {
  name: 'Rechenzentrum',
  gesamt,
  groesse,
  gebaeude: { x: RAND.west, y: 0, z: RAND.nord, breite: BAU.x, hoehe: BAU.y, tiefe: BAU.z },
  // Hier misst man ein: der unterste Block an der Nordwest-Ecke.
  ankerblock: { x: 0, y: 0, z: 0, block: ecke.block, teil: ecke.teil },
  anker: ANKER,
  abschnitte: ABSCHNITTE,
  palette,
  layers,
};
const hash = createHash('sha256').update(JSON.stringify(inhalt)).digest('hex').slice(0, 16);
const text = JSON.stringify({ hash, ...inhalt });
writeFileSync(new URL('../public/rechenzentrum.plan.json', import.meta.url), `${text}\n`);
writeFileSync(new URL('../src/rechenzentrum.meta.json', import.meta.url), `${JSON.stringify({ hash, gesamt, groesse, gebaeude: inhalt.gebaeude, ankerblock: inhalt.ankerblock })}\n`);

// ---------- Bericht ----------

const proAbschnitt = {};
for (const [p, n] of zaehl) proAbschnitt[p.abschnitt] = (proAbschnitt[p.abschnitt] ?? 0) + n;
console.log(`Plan ${hash}: Raster ${GX} x ${groesse.y} x ${GZ}, Gebäude ${masse.join(' x ')}`);
console.log(`Blöcke: ${gesamt.toLocaleString('de-DE')} (${verdeckt.toLocaleString('de-DE')} verdeckte weggelassen), Paletteneinträge: ${Object.keys(palette).length}, Dateigröße: ${(text.length / 1024).toFixed(0)} KB`);
console.log('Je Abschnitt:', proAbschnitt);
console.log(`Licht: keine dunklen Flächen auf Dach und Attika, ${leuchten} Leuchten zusätzlich gesetzt.`);
console.log(`Ankerblock: ${ecke.block} (${ecke.teil}) bei x 0 · y 0 · z 0`);
