// Dach: Trockenkühler, Kühltürme, Rohrbrücken, Kältemaschinen, Technikhäuser und Antennen.
// Die Attika läuft bis y = 39. Die Technik darüber ragt sichtbar heraus, genau wie bei echten Rechenzentren.
import { BAU, box, boxFrei, get, rnd, set, setFrei, stoff, zylinder } from './raster.mjs';

const d = stoff('dach');
const S = {
  dach: d('Dachfläche', 'smooth_stone'),
  dachHell: d('Dachfläche', 'smooth_stone'),
  kies: d('Dachfläche', 'smooth_stone'),
  kiesHell: d('Dachfuge', 'polished_andesite'),
  platte: d('Laufweg', 'gray_concrete'),
  platte2: d('Laufplatte', 'smooth_stone'),
  rost: d('Gitterrost', 'iron_trapdoor'),
  gelaender: d('Geländer', 'iron_bars'),
  gelaenderPfosten: d('Geländer', 'stone_brick_wall'),
  strebe: d('Unterkonstruktion', 'iron_block'),
  stuetze: d('Rohrstütze', 'iron_bars'),
  schwelle: d('Unterkonstruktion', 'polished_blackstone'),

  gehaeuse: d('Kühler-Gehäuse', 'white_concrete'),
  gehaeuseDunkel: d('Kühler-Gehäuse', 'gray_concrete'),
  lamelle: d('Kühlregister', 'iron_bars'),
  lamelleAlt: d('Kühlregister', 'iron_bars'),
  rahmen: d('Kühler-Rahmen', 'iron_block'),
  deck: d('Lüfterdeck', 'white_concrete'),
  ring: d('Lüfterring', 'iron_block'),
  nabe: d('Lüfternabe', 'polished_blackstone'),
  schacht: d('Lüfterschacht', 'black_concrete'),
  gitterFan: d('Lüftergitter', 'iron_bars'),
  fluegel: d('Lüfterflügel', 'polished_blackstone_slab', 'type=top'),

  vor: d('Vorlauf', 'light_blue_concrete'),
  rueck: d('Rücklauf', 'white_concrete'),
  kupfer: d('Sammelleitung', 'iron_block'),
  kupfer2: d('Sammelleitung', 'iron_block'),
  flansch: d('Flansch', 'gray_concrete'),
  ventil: d('Ventil', 'lever'),
  ventilGehaeuse: d('Ventil', 'iron_block'),
  pumpe: d('Pumpe', 'light_blue_concrete'),
  pumpeSockel: d('Pumpe', 'polished_blackstone'),

  turm: d('Kühlturm', 'white_concrete'),
  turmBand: d('Kühlturm', 'white_concrete'),
  turmLamelle: d('Kühlturm-Einlass', 'iron_bars'),
  turmWasser: d('Kühlturm-Becken', 'water'),
  turmBecken: d('Kühlturm-Becken', 'polished_andesite'),
  turmStein: d('Kühlturm-Becken', 'stone'),

  chiller: d('Kältemaschine', 'white_concrete'),
  chillerKante: d('Kältemaschine', 'gray_concrete'),
  chillerGitter: d('Kältemaschine', 'iron_bars'),
  chillerSchatten: d('Kältemaschine', 'black_concrete'),

  haus: d('Technikhaus', 'white_concrete'),
  hausKante: d('Technikhaus', 'gray_concrete'),
  hausDach: d('Technikhaus', 'iron_block'),
  tuer: d('Dachtür', 'gray_concrete'),
  hausLicht: d('Technikhaus', 'end_rod', 'facing=up'),
  gitterHaus: d('Technikhaus-Lüftung', 'iron_bars'),

  tank: d('Wassertank', 'white_concrete'),
  tankBand: d('Wassertank', 'white_concrete'),
  tankKappe: d('Wassertank', 'smooth_stone'),

  mast: d('Antennenmast', 'iron_bars'),
  mastPfeiler: d('Antennenmast', 'iron_block'),
  spitze: d('Antennenmast', 'iron_chain'),
  warnrot: d('Flugwarnlicht', 'red_concrete'),
  schuessel: d('Richtfunk', 'white_concrete'),
  schuesselKante: d('Richtfunk', 'white_concrete'),

  ablauf: d('Dachablauf', 'hopper'),
  lueft: d('Dachlüfter', 'iron_block'),
  lueftKappe: d('Dachlüfter', 'iron_trapdoor'),
  licht: d('Dachlicht', 'end_rod', 'facing=up'),
  licht2: d('Dachlicht', 'end_rod', 'facing=up'),
  kabel: d('Kabeltrasse', 'iron_bars'),
  kabel2: d('Kabeltrasse', 'iron_trapdoor'),
  oberlicht: d('Oberlicht', 'glass'),
  oberlichtR: d('Oberlicht', 'iron_block'),

};

const Y = 37; // erste Ebene über der Dachplatte
const DACHPLATTE = 36;

function flaeche() {
  for (let z = 3; z < BAU.z - 3; z++) for (let x = 3; x < BAU.x - 3; x++) {
    // Helle Dachbahn mit feinen Stößen
    set(x, DACHPLATTE, z, x % 12 === 0 || z % 12 === 0 ? S.kiesHell : S.dach);
  }
}

// Laufwege aus Platten und Geländer. Quer und längs.
function wege() {
  const quer = [52, 94, 107, 150];
  for (let z = 3; z < BAU.z - 3; z++) {
    for (let x = 3; x <= 5; x++) set(x, DACHPLATTE, z, S.platte);
    for (let x = BAU.x - 6; x < BAU.x - 3; x++) set(x, DACHPLATTE, z, S.platte);
    for (let x = 42; x <= 44; x++) set(x, DACHPLATTE, z, S.platte);
    for (let x = 75; x <= 77; x++) set(x, DACHPLATTE, z, S.platte);
  }
  for (let x = 3; x < BAU.x - 3; x++) for (const z0 of quer) {
    for (let z = z0; z <= z0 + 1; z++) set(x, DACHPLATTE, z, S.platte);
  }
}

// Handlauf entlang der Attika: nicht auf der Attika selbst
function innengelaender() {
  for (let z = 4; z < BAU.z - 4; z++) {
    if (z % 8 === 0) { set(6, Y, z, S.gelaenderPfosten); set(BAU.x - 7, Y, z, S.gelaenderPfosten); }
    for (const x of [6, BAU.x - 7]) if (frei0(x, Y, z)) set(x, Y + 1, z, S.gelaender);
  }
}
const frei0 = (x, y, z) => get(x, y, z) === 0;

// Ein Trockenkühler: Rahmen, V-förmige Register aus Kupfergitter, oben Lüfter.
function trockenkuehler(x0, z0, l = 22, b = 8) {
  const x1 = x0 + b - 1;
  const z1 = z0 + l - 1;
  // Unterkonstruktion mit Schwellen
  for (let z = z0; z <= z1; z += 4) box(x0 - 1, Y, z, x1 + 1, Y, z, S.schwelle);
  for (let x = x0; x <= x1; x += b - 1) for (let z = z0; z <= z1; z += 3) set(x, Y + 1, z, S.strebe);
  const y0 = Y + 2;
  const yTop = y0 + 3;
  // Wanne
  box(x0, y0, z0, x1, y0, z1, S.gehaeuseDunkel);
  // Register: Seiten aus Kupfergitter, Enden Gehäuse
  for (let y = y0 + 1; y < yTop; y++) {
    for (let z = z0; z <= z1; z++) {
      const pfosten = (z - z0) % 5 === 0;
      const reg = rnd(x0, y, z, 2) < 0.15 ? S.lamelleAlt : S.lamelle;
      set(x0, y, z, pfosten ? S.rahmen : reg);
      set(x1, y, z, pfosten ? S.rahmen : reg);
    }
    for (let x = x0; x <= x1; x++) { set(x, y, z0, S.gehaeuse); set(x, y, z1, S.gehaeuse); }
    // V-Form im Inneren: sichtbar, wenn man den Schnitt ansieht
    const v = y - y0;
    for (let z = z0 + 1; z < z1; z++) { set(x0 + v, y, z, S.lamelle); set(x1 - v, y, z, S.lamelle); }
  }
  // Lüfterdeck
  box(x0, yTop, z0, x1, yTop, z1, (x) => (x === x0 || x === x1 ? S.rahmen : S.deck));
  const fans = Math.floor((l - 1) / 5);
  for (let n = 0; n < fans; n++) {
    const cz = z0 + 2 + n * 5 + Math.floor((l - fans * 5) / 2);
    const cx = x0 + Math.floor(b / 2) - 1;
    luefter(cx, cz, yTop);
    // Antrieb neben dem Lüfter
    set(cx + 3 > x1 ? x1 : cx + 3, yTop + 1, cz, S.nabe);
  }
  return { x0, x1, z0, z1, yTop };
}

function luefter(cx, cz, yTop) {
  // Ring 4 x 4 auf dem Deck, innen schwarz mit Nabe und Gitter darüber
  for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
    const eck = (dx === -1 || dx === 2) && (dz === -1 || dz === 2);
    if (eck) continue;
    const rand = dx === -1 || dx === 2 || dz === -1 || dz === 2;
    set(cx + dx, yTop + 1, cz + dz, rand ? S.ring : S.gitterFan);
    if (!rand) set(cx + dx, yTop, cz + dz, S.schacht);
  }
  set(cx, yTop, cz, S.nabe);
  set(cx + 1, yTop, cz + 1, S.nabe);
}

// Rohre: je ein Vorlauf und ein Rücklauf auf Stützen.
function rohrZ(x, y, z0, z1, c, flanschAlle = 8) {
  for (let z = z0; z <= z1; z++) {
    set(x, y, z, z % flanschAlle === 0 ? S.flansch : c);
    if (z % flanschAlle === 4) for (let h = Y; h < y; h++) setFrei(x, h, z, S.stuetze);
  }
}
function rohrX(x0, x1, y, z, c, flanschAlle = 8) {
  for (let x = x0; x <= x1; x++) {
    set(x, y, z, x % flanschAlle === 0 ? S.flansch : c);
    if (x % flanschAlle === 4) for (let h = Y; h < y; h++) setFrei(x, h, z, S.stuetze);
  }
}
function ventil(x, y, z) {
  set(x, y, z, S.ventilGehaeuse);
  setFrei(x, y + 1, z, S.ventil);
}

// Hauptrohrbrücke entlang der Mitte
function rohrbruecke() {
  const y = Y + 5;
  for (const z of [10, 30, 50, 70, 90, 110, 130, 150, 170, 190]) {
    for (const x of [54, 64]) box(x, Y, z, x, y, z, S.stuetze);
    box(54, y + 1, z, 64, y + 1, z, S.strebe);
  }
  for (const z0 of [6]) {
    const z1 = 193;
    rohrZ(56, y + 2, z0, z1, S.kupfer);
    rohrZ(58, y + 2, z0, z1, S.vor);
    rohrZ(60, y + 2, z0, z1, S.rueck);
    rohrZ(62, y + 2, z0, z1, S.kupfer);
    // Kabeltrassen auf der gleichen Brücke, eine Ebene höher
    for (let z = z0; z <= z1; z++) { set(55, y + 3, z, S.kabel); set(63, y + 3, z, S.kabel); }
  }
}

// Reihen von Trockenkühlern, angeschlossen an die Brücke
function kuehlerfeld(xStart, zStart, anzahl, richtung) {
  for (let i = 0; i < anzahl; i++) {
    const z0 = zStart + i * 24;
    const k = trockenkuehler(xStart, z0);
    const zm = z0 + 11;
    // Stichleitung: oben auf den Rand des Kühlers, hinüber zur Brücke
    const xEnde = richtung > 0 ? 56 : 62;
    const y = Y + 2;
    if (richtung > 0) {
      rohrX(k.x1 + 1, xEnde - 1, y, zm, S.vor);
      rohrX(k.x1 + 1, xEnde - 1, y, zm + 2, S.rueck);
    } else {
      rohrX(xEnde + 1, k.x0 - 1, y, zm, S.vor);
      rohrX(xEnde + 1, k.x0 - 1, y, zm + 2, S.rueck);
    }
    ventil(richtung > 0 ? k.x1 + 2 : k.x0 - 2, y, zm);
    ventil(richtung > 0 ? k.x1 + 2 : k.x0 - 2, y, zm + 2);
  }
}

// Runder Kühlturm mit Lamellen unten, Haube und Lüfter.
function kuehlturm(cx, cz, r = 6) {
  zylinder(cx, cz, r + 1, Y, Y, S.turmBecken, S.turmStein);
  zylinder(cx, cz, r, Y + 1, Y + 1, S.turmBecken, S.turmWasser);
  // Stelzen und Lamellen
  for (let y = Y + 2; y <= Y + 4; y++) {
    zylinder(cx, cz, r, y, y, (x, _, z) => ((x + z) % 3 === 0 ? S.strebe : S.turmLamelle));
  }
  const hoehe = 8;
  for (let i = 0; i < hoehe; i++) {
    const y = Y + 5 + i;
    // Leicht taillierte Form wie ein Naturzugturm
    const t = i / (hoehe - 1);
    const rr = r - 1.2 * Math.sin(t * Math.PI) + (t > 0.8 ? 0.4 : 0);
    zylinder(cx, cz, rr, y, y, i % 3 === 2 ? S.turmBand : S.turm);
  }
  const yOben = Y + 5 + hoehe;
  // Kragen und Lüfter
  zylinder(cx, cz, r - 0.2, yOben, yOben, S.ring);
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const dist = Math.hypot(dx, dz);
    if (dist < r - 1) setFrei(cx + dx, yOben, cz + dz, S.gitterFan);
  }
  box(cx, yOben, cz, cx, yOben, cz, S.nabe);
  for (let k = 1; k <= r - 2; k++) {
    set(cx + k, yOben - 1, cz, S.fluegel);
    set(cx - k, yOben - 1, cz, S.fluegel);
    set(cx, yOben - 1, cz + k, S.fluegel);
    set(cx, yOben - 1, cz - k, S.fluegel);
  }
  // Steigleiter
  for (let y = Y + 1; y <= yOben; y++) set(cx + r + 1, y, cz, S.gelaender);
}

// Kältemaschine: geschlossene Einheit mit Gitterwänden.
function kaeltemaschine(x0, z0, l = 16) {
  const x1 = x0 + 7;
  const z1 = z0 + l - 1;
  box(x0, Y, z0, x1, Y, z1, S.schwelle);
  box(x0, Y + 1, z0, x1, Y + 4, z1, S.chiller);
  for (let y = Y + 1; y <= Y + 4; y++) {
    for (let z = z0; z <= z1; z++) {
      const k = (z - z0) % 4;
      set(x0, y, z, k === 0 ? S.chillerKante : y >= Y + 2 && y <= Y + 3 ? S.chillerGitter : S.chiller);
      set(x1, y, z, k === 0 ? S.chillerKante : y >= Y + 2 && y <= Y + 3 ? S.chillerGitter : S.chiller);
      if (y >= Y + 2 && y <= Y + 3 && k !== 0) { set(x0 + 1, y, z, S.chillerSchatten); set(x1 - 1, y, z, S.chillerSchatten); }
    }
  }
  box(x0, Y + 5, z0, x1, Y + 5, z1, S.chillerKante);
  for (let z = z0 + 2; z <= z1 - 2; z += 5) luefter(x0 + 3, z, Y + 5);
  // Pumpen vorne
  for (const x of [x0 + 2, x0 + 5]) {
    set(x, Y, z1 + 2, S.pumpeSockel);
    set(x, Y + 1, z1 + 2, S.pumpe);
    set(x, Y + 2, z1 + 2, S.ventilGehaeuse);
    set(x, Y + 2, z1 + 1, x === x0 + 2 ? S.vor : S.rueck);
  }
}

function technikhaus(x0, z0, x1, z1, h, mitTuer = true) {
  box(x0, Y, z0, x1, Y + h - 1, z1, (x, y, z) => {
    const kante = (x === x0 || x === x1) && (z === z0 || z === z1);
    if (kante) return S.hausKante;
    const aussen = x === x0 || x === x1 || z === z0 || z === z1;
    if (!aussen) return 0;
    if (y >= Y + 1 && y <= Y + 2 && (x + z) % 4 < 2) return S.gitterHaus;
    return S.haus;
  });
  box(x0 - 1, Y + h, z0 - 1, x1 + 1, Y + h, z1 + 1, S.hausDach);
  if (mitTuer) {
    const zm = Math.floor((z0 + z1) / 2);
    box(x0, Y, zm, x0, Y + 1, zm, S.tuer);
    set(x0 - 1, Y + 2, zm, S.licht2);
  }
  // Lüfterdosen und Kabeldurchführung auf dem Dach
  for (let x = x0 + 1; x <= x1 - 1; x += 4) {
    set(x, Y + h + 1, z0 + 1, S.lueft);
    set(x, Y + h + 2, z0 + 1, S.lueftKappe);
  }
}

function wassertank(cx, cz, r, h) {
  zylinder(cx, cz, r + 1, Y, Y, S.schwelle, S.schwelle);
  for (let i = 0; i < h; i++) zylinder(cx, cz, r, Y + 1 + i, Y + 1 + i, i % 3 === 0 ? S.tankBand : S.tank);
  zylinder(cx, cz, r, Y + h + 1, Y + h + 1, S.tankKappe, S.tankKappe);
  zylinder(cx, cz, r - 2, Y + h + 2, Y + h + 2, S.tankKappe, S.tankKappe);
  for (let y = Y + 1; y <= Y + h; y++) set(cx - r - 1, y, cz, S.gelaender);
}

function antennenmast(x, z, h) {
  // Gittermast mit Plattform, nach oben schmaler
  for (let i = 0; i < h; i++) {
    const y = Y + i;
    const r = i < h / 2 ? 2 : 1;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) set(x + dx, y, z + dz, S.mastPfeiler);
    if (i % 3 === 0) {
      for (let k = -r; k <= r; k++) {
        set(x + k, y, z - r, S.mast);
        set(x + k, y, z + r, S.mast);
        set(x - r, y, z + k, S.mast);
        set(x + r, y, z + k, S.mast);
      }
    }
  }
  const top = Y + h;
  box(x, top, z, x, top + 3, z, S.spitze);
  set(x, top + 4, z, S.warnrot);
  // Richtfunkschüsseln
  for (const [dx, dz, y] of [[-3, 0, Y + h - 6], [3, 0, Y + h - 9]]) {
    const X = x + dx;
    const Z = z + dz;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (Math.abs(a) + Math.abs(b) === 2) { set(X, y + a, Z + b, S.schuesselKante); continue; }
      set(X, y + a, Z + b, S.schuessel);
    }
  }
}

function kleinzeug() {
  // Dachabläufe und Pilzlüfter
  for (let z = 10; z < BAU.z - 10; z += 13) for (let x = 8; x < BAU.x - 8; x += 19) {
    if (get(x, Y, z) === 0 && rnd(x, 0, z, 8) < 0.7) {
      set(x, Y, z, rnd(x, 1, z, 8) < 0.5 ? S.ablauf : S.lueft);
      if (rnd(x, 2, z, 8) < 0.6 && get(x, Y, z) === S.lueft) set(x, Y + 1, z, S.lueftKappe);
    }
  }
  // Dachlicht entlang der Wege: gegen Monster und für die Nacht
  for (let z = 6; z < BAU.z - 4; z += 8) {
    for (const x of [4, 43, 76, BAU.x - 5]) setFrei(x, Y, z, S.licht);
  }
  for (const z of [52, 94, 107, 150]) for (let x = 8; x < BAU.x - 4; x += 8) setFrei(x, Y, z, S.licht);
  // Oberlichter über den Hauptgängen im Norden
  for (let z = 56; z <= 90; z += 8) {
    box(38, DACHPLATTE, z, 41, DACHPLATTE, z + 1, S.oberlicht);
  }
  // Kabeltrassen quer übers Dach
  for (let x = 6; x <= 54; x++) if (get(x, Y, 53) === 0) set(x, Y, 53, S.kabel2);
  for (let x = 66; x <= 113; x++) if (get(x, Y, 53) === 0) set(x, Y, 53, S.kabel2);
}

export function dachBauen() {
  flaeche();
  wege();
  rohrbruecke();
  // Nord: Trockenkühler, auf beiden Seiten der Brücke
  kuehlerfeld(10, 6, 2, 1);
  kuehlerfeld(26, 6, 2, 1);
  kuehlerfeld(80, 6, 2, -1);
  kuehlerfeld(96, 6, 2, -1);
  // Mitte Nord: Kältemaschinen und Wassertanks
  kaeltemaschine(10, 56, 16);
  kaeltemaschine(24, 56, 16);
  kaeltemaschine(84, 56, 16);
  kaeltemaschine(98, 56, 16);
  wassertank(16, 84, 5, 7);
  wassertank(30, 84, 5, 7);
  wassertank(90, 84, 5, 7);
  wassertank(104, 84, 5, 7);
  // Mittelband: Dachausgänge, Technikhäuser und Beacon
  technikhaus(10, 96, 30, 105, 5);
  technikhaus(90, 96, 110, 105, 5);
  antennenmast(22, 112, 22);
  // Süd: Kühltürme und zweite Kühlerreihe
  for (const z of [122, 138]) {
    kuehlturm(18, z, 6);
    kuehlturm(33, z, 6);
    kuehlturm(88, z, 6);
    kuehlturm(103, z, 6);
  }
  kuehlerfeld(10, 154, 1, 1);
  kuehlerfeld(26, 154, 1, 1);
  kuehlerfeld(80, 154, 1, -1);
  kuehlerfeld(96, 154, 1, -1);
  kaeltemaschine(10, 180, 14);
  kaeltemaschine(26, 180, 14);
  kaeltemaschine(84, 180, 14);
  kaeltemaschine(98, 180, 14);
  innengelaender();
  kleinzeug();
  void boxFrei;
}
