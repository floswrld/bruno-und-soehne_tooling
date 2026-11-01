// Gelände rund um das Haus: Straßen, Parkplatz, Ladehof, Notstrom, Umspannwerk, Zaun, Teich und viel Grün.
import { BAU, RAND, box, boxFrei, get, rnd, set, setFrei, stoff, wahl, zylinder } from './raster.mjs';

const g = stoff('gelaende');
const S = {
  asphalt: g('Straße', 'black_concrete'),
  asphaltAlt: g('Straße', 'gray_concrete'),
  asphaltFlick: g('Straße', 'blackstone'),
  asphaltRiss: g('Straße', 'deepslate'),
  markierung: g('Fahrbahnmarkierung', 'white_concrete'),
  gelb: g('Fahrbahnmarkierung', 'yellow_concrete'),
  bordstein: g('Bordstein', 'smooth_stone'),
  gehweg: g('Gehweg', 'white_concrete'),
  gehwegPlatte: g('Gehweg', 'smooth_stone'),
  gehwegRiss: g('Gehweg', 'smooth_stone'),
  ablauf: g('Straßenablauf', 'iron_trapdoor'),

  gras: g('Rasen', 'grass_block'),
  moos: g('Rasen', 'moss_block'),
  erde: g('Rasen', 'coarse_dirt'),
  podsol: g('Rasen', 'podzol'),
  halm: g('Bewuchs', 'short_grass'),
  farn: g('Bewuchs', 'fern'),
  mohn: g('Blumen', 'poppy'),
  gaensebluemchen: g('Blumen', 'oxeye_daisy'),
  loewenzahn: g('Blumen', 'dandelion'),
  kornblume: g('Blumen', 'cornflower'),
  allium: g('Blumen', 'allium'),

  kies: g('Traufstreifen', 'gravel'),
  kiesGrob: g('Traufstreifen', 'andesite'),
  rinne: g('Traufstreifen', 'gray_concrete'),
  rost: g('Entwässerung', 'iron_bars'),

  stamm: g('Baum', 'oak_log'),
  krone: g('Baum', 'oak_leaves'),
  birke: g('Baum', 'birch_log'),
  birkeKrone: g('Baum', 'birch_leaves'),
  fichte: g('Baum', 'spruce_log'),
  fichteKrone: g('Baum', 'spruce_leaves'),
  hecke: g('Hecke', 'dark_oak_leaves'),
  busch: g('Hecke', 'azalea_leaves'),

  zaun: g('Sicherheitszaun', 'iron_bars'),
  zaunPfosten: g('Sicherheitszaun', 'andesite_wall'),
  zaunSockel: g('Sicherheitszaun', 'polished_andesite'),
  stachel: g('Sicherheitszaun', 'iron_chain'),

  mast: g('Lichtmast', 'andesite_wall'),
  mastKopf: g('Lichtmast', 'iron_block'),
  lampe: g('Lichtmast', 'sea_lantern'),
  kamera: g('Kamera', 'polished_blackstone'),
  poller: g('Poller', 'white_concrete'),
  pollerKopf: g('Poller', 'black_concrete'),
  pollerBeton: g('Poller', 'andesite_wall'),

  auto: { blau: g('Auto', 'blue_concrete'), rot: g('Auto', 'red_concrete'), weiss: g('Auto', 'white_concrete'), grau: g('Auto', 'gray_concrete'), schwarz: g('Auto', 'black_concrete'), silber: g('Auto', 'light_gray_concrete') },
  scheibe: g('Autoscheibe', 'gray_stained_glass'),
  reifen: g('Reifen', 'black_wool'),

  lkw: g('Auflieger', 'white_concrete'),
  lkwRahmen: g('Auflieger', 'iron_block'),
  lkwKabine: g('Zugmaschine', 'gray_concrete'),
  lkwFenster: g('Zugmaschine', 'gray_stained_glass'),
  rampe: g('Ladehof', 'gray_concrete'),
  rampeFlick: g('Ladehof', 'polished_andesite'),
  rampeGelb: g('Ladehof', 'white_concrete'),
  rampeSchwarz: g('Ladehof', 'black_concrete'),
  dach: g('Vordach', 'iron_block'),
  dachStuetze: g('Vordach', 'gray_concrete'),
  dachLicht: g('Vordach', 'sea_lantern'),

  // Notstrom
  gen: g('Notstromaggregat', 'white_concrete'),
  genBand: g('Notstromaggregat', 'gray_concrete'),
  genGitter: g('Aggregat-Lüftung', 'iron_bars'),
  genDunkel: g('Aggregat-Lüftung', 'black_concrete'),
  genDach: g('Notstromaggregat', 'smooth_stone'),
  auspuff: g('Abgaskamin', 'iron_block'),
  auspuffOben: g('Abgaskamin', 'polished_blackstone'),
  tank: g('Tagestank', 'white_concrete'),
  tankBand: g('Tagestank', 'polished_andesite'),
  fundament: g('Fundament', 'smooth_stone'),
  yardKies: g('Aggregatehof', 'gravel'),
  yardDunkel: g('Aggregatehof', 'andesite'),
  kabelkanal: g('Kabelkanal', 'iron_trapdoor'),
  kabelRand: g('Kabelkanal', 'polished_andesite'),
  trasse: g('Kabelbrücke', 'iron_block'),
  trasseG: g('Kabelbrücke', 'iron_bars'),
  rohr: g('Kraftstoffleitung', 'gray_concrete'),

  // Umspannwerk
  trafoKoerper: g('Transformator', 'polished_deepslate'),
  trafoRippe: g('Trafo-Kühlrippen', 'iron_bars'),
  trafoKessel: g('Transformator', 'polished_andesite'),
  isolator: g('Isolator', 'end_rod'),
  sammelschiene: g('Sammelschiene', 'iron_block'),
  portal: g('Schaltfeld-Portal', 'iron_block'),
  portalG: g('Schaltfeld-Portal', 'iron_bars'),
  schaltHaus: g('Schalthaus', 'white_concrete'),
  schaltDach: g('Schalthaus', 'smooth_stone'),
  mastStahl: g('Freileitungsmast', 'iron_bars'),
  mastEcke: g('Freileitungsmast', 'iron_block'),
  seil: g('Freileitung', 'iron_chain'),
  warn: g('Warnschild', 'yellow_concrete'),
  warnS: g('Warnschild', 'black_concrete'),

  // Teich, Löschwasser, Pförtner
  wasser: g('Teich', 'water'),
  sand: g('Teich', 'sand'),
  kiesufer: g('Teich', 'gravel'),
  rohrkolben: g('Teich', 'sugar_cane'),
  seerose: g('Teich', 'lily_pad'),
  loeschTank: g('Löschwassertank', 'white_concrete'),
  loeschBand: g('Löschwassertank', 'gray_concrete'),
  loeschDach: g('Löschwassertank', 'smooth_stone'),
  haus: g('Pförtnerhaus', 'white_concrete'),
  hausDach: g('Pförtnerhaus', 'gray_concrete'),
  hausGlas: g('Pförtnerhaus', 'glass_pane'),
  schranke: g('Schranke', 'red_concrete'),
  schrankeW: g('Schranke', 'white_concrete'),
  fahne: g('Fahnenmast', 'iron_bars'),
  fahneTuch: g('Fahnenmast', 'white_wool'),
  fahneTuch2: g('Fahnenmast', 'black_wool'),
};

const XW = -RAND.west;
const XO = BAU.x + RAND.ost - 1;
const ZN = -RAND.nord;
const ZS = BAU.z + RAND.sued - 1;

function grundflaeche() {
  for (let z = ZN; z <= ZS; z++) for (let x = XW; x <= XO; x++) {
    if (x >= 0 && x < BAU.x && z >= 0 && z < BAU.z) continue;
    const n = Math.sin(x * 0.13 + z * 0.07) + Math.sin(z * 0.11 - x * 0.05);
    const c = wahl(x, 0, z, [[S.gras, 80], [S.moos, n > 0.9 ? 16 : 2]]);
    set(x, 0, z, c);
  }
}

function strassenbelag(x0, z0, x1, z1) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const r = rnd(x, 0, z, 21);
    const riss = Math.sin(x * 0.4 + z * 0.15) > 0.97;
    set(x, 0, z, riss ? S.asphaltRiss : r < 0.03 ? S.asphaltAlt : r < 0.07 ? S.asphaltFlick : S.asphalt);
  }
}

function bordstein(x0, z0, x1, z1) {
  for (let x = x0; x <= x1; x++) { set(x, 0, z0, S.bordstein); set(x, 0, z1, S.bordstein); }
  for (let z = z0; z <= z1; z++) { set(x0, 0, z, S.bordstein); set(x1, 0, z, S.bordstein); }
}

// Ringstraße um das Haus, acht breit, dazu Traufstreifen an der Wand
function strassen() {
  const R = { x0: -16, x1: BAU.x + 15, z0: -16, z1: BAU.z + 15 };
  const breite = 8;
  bordstein(R.x0 - 1, R.z0 - 1, R.x1 + 1, R.z1 + 1);
  bordstein(R.x0 + breite, R.z0 + breite, R.x1 - breite, R.z1 - breite);
  strassenbelag(R.x0, R.z0, R.x1, R.z0 + breite - 1);
  strassenbelag(R.x0, R.z1 - breite + 1, R.x1, R.z1);
  strassenbelag(R.x0, R.z0 + breite, R.x0 + breite - 1, R.z1 - breite);
  strassenbelag(R.x1 - breite + 1, R.z0 + breite, R.x1, R.z1 - breite);
  // Mittelstriche und Haltelinien
  for (let x = R.x0 + 12; x <= R.x1 - 12; x++) if (x % 6 < 3) { set(x, 0, R.z0 + 3, S.markierung); set(x, 0, R.z1 - 4, S.markierung); }
  for (let z = R.z0 + 12; z <= R.z1 - 12; z++) if (z % 6 < 3) { set(R.x0 + 3, 0, z, S.markierung); set(R.x1 - 4, 0, z, S.markierung); }
  // Straßenabläufe am Rand
  for (let z = R.z0 + 8; z <= R.z1 - 8; z += 14) { set(R.x0 + breite - 1, 0, z, S.ablauf); set(R.x1 - breite + 1, 0, z, S.ablauf); }
  // Traufstreifen und Gehweg an der Wand
  const X0 = -1;
  const X1 = BAU.x;
  const Z0 = -1;
  const Z1 = BAU.z;
  for (let z = Z0 - 7; z <= Z1 + 7; z++) for (let x = X0 - 7; x <= X1 + 7; x++) {
    if (x >= 0 && x < BAU.x && z >= 0 && z < BAU.z) continue;
    const abstand = Math.max(x < 0 ? -x : x >= BAU.x ? x - BAU.x + 1 : 0, z < 0 ? -z : z >= BAU.z ? z - BAU.z + 1 : 0);
    if (abstand > 8) continue;
    if (abstand === 1) set(x, 0, z, S.rinne);
    else if (abstand <= 3) {
      const r = rnd(x, 0, z, 33);
      set(x, 0, z, r < 0.15 ? S.kiesGrob : S.kies);
      if (abstand === 2 && (x + z) % 16 === 0) set(x, 0, z, S.rost);
    } else if (abstand <= 7) {
      // Gehweg, in Platten
      set(x, 0, z, x % 6 === 0 || z % 6 === 0 ? S.gehwegPlatte : S.gehweg);
    } else set(x, 0, z, S.bordstein);
  }
}

function zufahrt() {
  // Von der Grundstücksgrenze im Süden zur Ringstraße
  const x0 = 50;
  const x1 = 61;
  strassenbelag(x0, BAU.z + 16, x1, ZS);
  for (let z = BAU.z + 16; z <= ZS; z++) { set(x0 - 1, 0, z, S.bordstein); set(x1 + 1, 0, z, S.bordstein); }
  for (let z = BAU.z + 18; z <= ZS - 2; z++) if (z % 6 < 3) set(55, 0, z, S.markierung);
  // Gehweg seitlich
  for (let z = BAU.z + 16; z <= ZS; z++) for (let x = x1 + 2; x <= x1 + 4; x++) set(x, 0, z, z % 6 === 0 ? S.gehwegPlatte : S.gehweg);
  // Plaza vor dem Südtor
  for (let z = BAU.z + 1; z <= BAU.z + 7; z++) for (let x = 44; x <= 75; x++) {
    set(x, 0, z, x % 6 === 0 || z % 6 === 0 ? S.gehwegPlatte : S.gehweg);
  }
}

// ---------- Parkplatz und Eingang im Westen ----------

function auto(x, z, nachWesten, farbe) {
  // Ein Auto ist 2 breit und 5 lang
  const c = S.auto[farbe] ?? S.auto.grau;
  const X = (k) => (nachWesten ? x - k : x + k);
  for (const dz of [0, 1]) {
    set(X(0), 1, z + dz, S.reifen);
    set(X(4), 1, z + dz, S.reifen);
    for (let k = 0; k <= 4; k++) set(X(k), 1, z + dz, k === 0 || k === 4 ? S.reifen : c);
    set(X(0), 2, z + dz, c);
    set(X(1), 2, z + dz, S.scheibe);
    set(X(2), 2, z + dz, c);
    set(X(3), 2, z + dz, S.scheibe);
    set(X(4), 2, z + dz, c);
    set(X(1), 3, z + dz, c);
    set(X(2), 3, z + dz, c);
    set(X(3), 3, z + dz, c);
  }
}

function parkplatz() {
  const x0 = -44;
  const x1 = -18;
  const z0 = 44;
  const z1 = 166;
  strassenbelag(x0, z0, x1, z1);
  bordstein(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
  // Einfahrten zur Ringstraße
  for (const z of [46, 158]) {
    strassenbelag(x1, z, -17, z + 7);
    set(x1 + 1, 0, z - 1, S.bordstein);
    set(x1 + 1, 0, z + 8, S.bordstein);
  }
  // Stellplätze, zwei Reihen mit Grünstreifen dazwischen
  const FARBEN = ['blau', 'rot', 'weiss', 'grau', 'schwarz', 'silber', 'weiss', 'grau'];
  for (let z = z0 + 2; z <= z1 - 3; z += 4) {
    if (z >= 95 && z <= 102) continue;
    for (const [xa, xb] of [[x0, x0 + 7], [x1 - 7, x1]]) {
      for (let x = xa; x <= xb; x++) set(x, 0, z - 1, S.markierung);
    }
    if (rnd(z, 0, 0, 5) < 0.72) auto(x0 + 1, z, false, FARBEN[Math.floor(rnd(z, 1, 0, 5) * FARBEN.length)]);
    if (rnd(z, 0, 1, 5) < 0.65) auto(x1 - 1, z, true, FARBEN[Math.floor(rnd(z, 1, 1, 5) * FARBEN.length)]);
  }
  // Mittelinsel mit Bäumen und Hecke, Abstand 8
  for (let z = z0 + 2; z <= z1 - 2; z++) {
    for (let x = x0 + 12; x <= x0 + 14; x++) {
      if (z >= 95 && z <= 102) break;
      set(x, 0, z, x === x0 + 13 ? S.gras : S.bordstein);
    }
    if (z >= 95 && z <= 102) continue;
    set(x0 + 13, 1, z, S.hecke);
  }
  for (let z = z0 + 6; z <= z1 - 6; z += 14) {
    if (z >= 90 && z <= 106) continue;
    set(x0 + 13, 1, z, 0);
    baum(x0 + 13, z, 'birke');
  }
  // Zugang zum Eingang: von der Insel bis zur Lobby
  for (let z = 98; z <= 103; z++) for (let x = -17; x <= -9; x++) set(x, 0, z, S.gehwegPlatte);
  for (let z = 98; z <= 103; z++) for (let x = -8; x <= -1; x++) set(x, 0, z, x % 6 === 0 ? S.gehwegPlatte : S.gehweg);
  // Zebrastreifen auf der Ringstraße
  for (let z = 97; z <= 104; z += 2) for (let x = -16; x <= -9; x++) set(x, 0, z, S.markierung);
}

function eingangWest() {
  // Vordach über dem Eingang
  for (let z = 96; z <= 105; z++) {
    for (let x = -8; x <= -1; x++) set(x, 7, z, z === 96 || z === 105 || x === -8 ? S.dachStuetze : (x + z) % 4 === 0 ? S.dachLicht : S.dach);
  }
  for (const [x, z] of [[-8, 96], [-8, 105]]) box(x, 1, z, x, 6, z, S.dachStuetze);
  // Poller vor dem Eingang
  for (let z = 95; z <= 106; z += 2) { set(-9, 1, z, S.pollerBeton); }
  // Fahnen
  for (const [z, c] of [[87, S.fahneTuch], [91, S.fahneTuch2], [108, S.fahneTuch], [112, S.fahneTuch2]]) {
    box(-5, 1, z, -5, 14, z, S.fahne);
    box(-5, 12, z + 1, -5, 14, z + 2, c);
  }
}

// ---------- Ladehof im Nordwesten ----------

function ladehof() {
  const x0 = -40;
  const x1 = -1;
  const z0 = -4;
  const z1 = 42;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const r = rnd(x, 0, z, 41);
    set(x, 0, z, r < 0.14 ? S.rampeFlick : S.rampe);
  }
  bordstein(x0 - 1, z0 - 1, -17, z1 + 1);
  for (let z = z0; z <= z1; z++) for (let x = -17; x <= -16; x++) set(x, 0, z, S.asphalt);
  // Einweisungslinien und Rammschutz an den vier Toren
  for (let i = 0; i < 4; i++) {
    const z = 11 + i * 6;
    for (let x = -30; x <= -1; x++) {
      if (x > -28) { set(x, 0, z - 1, S.rampeGelb); set(x, 0, z + 4, S.rampeGelb); }
    }
    for (let k = -2; k <= 5; k += 1) set(-1, 0, z + k - 0, (k + 40) % 2 === 0 ? S.rampeGelb : S.rampeSchwarz);
    box(-1, 1, z - 1, -1, 2, z - 1, S.poller);
    box(-1, 1, z + 4, -1, 2, z + 4, S.poller);
    set(-1, 3, z - 1, S.pollerKopf);
    set(-1, 3, z + 4, S.pollerKopf);
  }
  // Vordach über alle Tore
  for (let z = 8; z <= 36; z++) for (let x = -6; x <= -1; x++) {
    set(x, 8, z, x === -6 || z === 8 || z === 36 ? S.dachStuetze : (z + x) % 6 === 0 ? S.dachLicht : S.dach);
  }
  for (let z = 8; z <= 36; z += 7) box(-6, 1, z, -6, 7, z, S.dachStuetze);
  // Zwei Lkw an der Rampe, einer im Hof
  lkw(-20, 11, S.lkwKabine);
  lkw(-20, 23, S.auto.schwarz);
  lkw(-34, 35, S.auto.silber);
  // Container-Stapel
  for (const [x, z, h] of [[-38, 3, 2], [-38, 9, 1], [-38, 15, 2]]) {
    for (let k = 0; k < h; k++) {
      const y = 1 + k * 3;
      const c = k % 2 ? S.auto.weiss : S.auto.grau;
      box(x, y, z, x + 3, y + 2, z + 4, (X, Y) => ((X + Y) % 2 ? c : c));
    }
  }
}

function lkw(x, z, kabine) {
  // Auflieger Richtung Rampe (Osten), Kabine im Westen, 3 breit
  for (let dz = 0; dz <= 2; dz++) {
    for (let k = 0; k <= 13; k++) {
      set(x + k, 1, z + dz, S.lkwRahmen);
      if (k % 5 === 1 && (dz === 0 || dz === 2)) set(x + k, 1, z + dz, S.reifen);
      for (let y = 2; y <= 5; y++) set(x + k, y, z + dz, S.lkw);
    }
    for (let k = -4; k <= -1; k++) {
      set(x + k, 1, z + dz, (k === -4 || k === -2) && dz !== 1 ? S.reifen : kabine);
      set(x + k, 2, z + dz, kabine);
      set(x + k, 3, z + dz, k >= -2 ? kabine : S.lkwFenster);
      set(x + k, 4, z + dz, kabine);
    }
  }
  box(x + 1, 6, z + 1, x + 13, 6, z + 1, S.lkw);
}

// ---------- Notstrom im Osten ----------

function aggregat(x0, z0) {
  const x1 = x0 + 7;
  const z1 = z0 + 13;
  box(x0 - 1, 0, z0 - 1, x1 + 1, 0, z1 + 1, S.fundament);
  // Container-Körper mit Lüftungsfeldern an den Längsseiten
  for (let y = 1; y <= 5; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const rand = x === x0 || x === x1 || z === z0 || z === z1;
    if (!rand) continue;
    const feld = (z - z0) % 3 !== 0 && y >= 2 && y <= 4 && (x === x0 || x === x1);
    set(x, y, z, y === 3 && !feld ? S.genBand : feld ? S.genGitter : S.gen);
    if (feld) set(x === x0 ? x0 + 1 : x1 - 1, y, z, S.genDunkel);
  }
  box(x0, 6, z0, x1, 6, z1, S.genDach);
  // Abgaskamine auf dem Dach
  for (const z of [z0 + 3, z0 + 10]) {
    box(x0 + 2, 7, z, x0 + 2, 11, z, S.auspuff);
    set(x0 + 2, 12, z, S.auspuffOben);
    box(x0 + 5, 7, z, x0 + 5, 9, z, S.auspuff);
  }
  // Tagestank neben dem Container
  zylinder(x1 + 4, z0 + 5, 2.4, 1, 4, (x, y) => (y === 3 ? S.tankBand : S.tank), S.tank);
  // Warnschild, Kraftstoffleitung und Anschluss an den Kabelkanal
  set(x0 - 1, 1, z0, S.warn);
  for (let x = x1 + 1; x <= x1 + 2; x++) set(x, 1, z0 + 5, S.rohr);
  for (let x = x0 - 2; x >= x0 - 8; x--) set(x, 0, z0 + 6, S.kabelkanal);
}

function notstrom() {
  const x0 = 136;
  const x1 = 165;
  const z0 = 4;
  const z1 = 195;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    set(x, 0, z, wahl(x, 0, z, [[S.yardKies, 80], [S.yardDunkel, 14], [S.kabelRand, 2]]));
  }
  bordstein(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
  // Kabelkanal an der Straßenseite
  for (let z = z0; z <= z1; z++) { set(x0 + 1, 0, z, S.kabelkanal); set(x0, 0, z, S.kabelRand); set(x0 + 2, 0, z, S.kabelRand); }
  // Zwei Reihen Aggregate
  for (let i = 0; i < 11; i++) aggregat(x0 + 6, z0 + 4 + i * 17);
  // Kabelbrücken über die Ringstraße in die Ostwand
  for (const z of [32, 68, 100, 132, 168]) {
    for (let x = BAU.x; x <= x0 + 1; x++) {
      set(x, 9, z, S.trasse);
      set(x, 9, z + 1, S.trasseG);
      set(x, 10, z, S.trasseG);
      if ((x - BAU.x) % 6 === 2) {
        box(x, 1, z, x, 8, z, S.portal);
        box(x, 1, z + 1, x, 8, z + 1, S.portal);
      }
    }
  }
}

// ---------- Umspannwerk im Norden ----------

function trafo(x0, z0) {
  box(x0 - 1, 0, z0 - 1, x0 + 11, 0, z0 + 11, S.fundament);
  // Kessel
  box(x0 + 2, 1, z0 + 2, x0 + 8, 6, z0 + 8, S.trafoKoerper);
  box(x0 + 2, 7, z0 + 2, x0 + 8, 7, z0 + 8, S.trafoKessel);
  // Kühlrippen ringsum
  for (let y = 1; y <= 6; y++) {
    for (let k = 2; k <= 8; k += 1) {
      if (k % 2) continue;
      set(x0 + k, y, z0 + 1, S.trafoRippe);
      set(x0 + k, y, z0 + 9, S.trafoRippe);
      set(x0 + 1, y, z0 + k, S.trafoRippe);
      set(x0 + 9, y, z0 + k, S.trafoRippe);
    }
  }
  // Ausdehnungsgefäß
  box(x0 + 3, 8, z0 + 4, x0 + 7, 9, z0 + 6, S.trafoKessel);
  // Durchführungen und Isolatoren auf dem Dach
  for (const k of [3, 5, 7]) {
    set(x0 + k, 8, z0 + 2, S.isolator);
    set(x0 + k, 9, z0 + 2, S.isolator);
    set(x0 + k, 10, z0 + 2, S.sammelschiene);
  }
  // Warnschild
  set(x0 + 5, 1, z0 + 10, S.warn);
  set(x0 + 5, 2, z0 + 10, S.warnS);
}

function umspannwerk() {
  const x0 = -16;
  const x1 = BAU.x + 15;
  const z0 = -60;
  const z1 = -19;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    set(x, 0, z, wahl(x, 0, z, [[S.yardKies, 82], [S.yardDunkel, 16], [S.kabelRand, 2]]));
  }
  bordstein(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
  // Reihe Trafos
  for (let i = 0; i < 6; i++) trafo(0 + i * 20, -38);
  // Sammelschienen und Portale
  for (let x = 0; x <= 120; x += 12) {
    box(x, 1, -46, x, 12, -46, S.portal);
    box(x, 1, -50, x, 12, -50, S.portal);
    box(x, 13, -50, x, 13, -46, S.portal);
    set(x, 14, -48, S.isolator);
  }
  for (let x = -2; x <= 122; x++) { set(x, 13, -48, S.sammelschiene); set(x, 11, -46, S.seil); set(x, 11, -50, S.seil); }
  // Zuleitungen von Trafos zu den Sammelschienen
  for (let i = 0; i < 6; i++) {
    const X = 5 + i * 20;
    for (let z = -44; z <= -37; z++) set(X, 12, z, S.sammelschiene);
    box(X, 10, -37, X, 12, -37, S.sammelschiene);
  }
  // Kabelbrücke ins Haus über die Ringstraße
  for (let i = 0; i < 6; i++) {
    const X = 5 + i * 20;
    for (let z = -26; z <= -1; z++) {
      set(X, 9, z, S.trasse);
      set(X + 1, 9, z, S.trasseG);
      if ((z + 40) % 7 === 0) box(X, 1, z, X, 8, z, S.portal);
    }
  }
  // Schalthaus
  box(-14, 1, -58, -2, 5, -48, (x, y, z) => (x === -14 || x === -2 || z === -58 || z === -48 ? (y % 3 === 0 ? S.trafoKessel : S.schaltHaus) : 0));
  box(-15, 6, -59, -1, 6, -47, S.schaltDach);
  for (let x = -12; x <= -4; x += 2) set(x, 3, -48, S.portalG);
  // Freileitungsmasten
  for (const [X, Z] of [[-8, -30], [132, -30]]) freileitungsmast(X, Z);
}

function freileitungsmast(x, z) {
  for (let y = 1; y <= 28; y++) {
    const r = y < 10 ? 3 : y < 18 ? 2 : 1;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) set(x + dx, y, z + dz, S.mastEcke);
    if (y % 3 === 0) for (let k = -r; k <= r; k++) {
      set(x + k, y, z - r, S.mastStahl);
      set(x + k, y, z + r, S.mastStahl);
      set(x - r, y, z + k, S.mastStahl);
      set(x + r, y, z + k, S.mastStahl);
    }
  }
  // Traversen
  for (const y of [20, 25]) {
    for (let k = -7; k <= 7; k++) set(x + k, y, z, S.mastEcke);
    for (const k of [-7, 7]) { set(x + k, y - 1, z, S.isolator); set(x + k, y - 2, z, S.isolator); }
  }
}

// ---------- Teich, Tanks, Pförtner, Zaun ----------

function teich() {
  const cx = 130;
  const cz = 225;
  for (let dz = -14; dz <= 14; dz++) for (let dx = -24; dx <= 24; dx++) {
    const d = Math.hypot(dx / 24, dz / 13) + 0.1 * Math.sin(dx * 0.5) * Math.cos(dz * 0.6);
    const X = cx + dx;
    const Z = cz + dz;
    if (X > XO - 1 || Z > ZS - 1) continue;
    if (d < 0.78) {
      set(X, 0, Z, S.wasser);
      if (rnd(X, 0, Z, 51) < 0.03 && d < 0.6) set(X, 1, Z, S.seerose);
    } else if (d < 0.92) {
      set(X, 0, Z, rnd(X, 0, Z, 52) < 0.5 ? S.sand : S.kiesufer);
      if (rnd(X, 0, Z, 53) < 0.28) { const h = 1 + Math.floor(rnd(X, 1, Z, 53) * 2); box(X, 1, Z, X, h, Z, S.rohrkolben); }
    }
  }
}

function loeschtank(cx, cz) {
  zylinder(cx, cz, 7, 0, 0, S.fundament, S.fundament);
  for (let y = 1; y <= 9; y++) zylinder(cx, cz, 6, y, y, y === 4 || y === 8 ? S.loeschBand : S.loeschTank);
  zylinder(cx, cz, 6, 10, 10, S.loeschDach, S.loeschDach);
  zylinder(cx, cz, 3, 11, 11, S.loeschDach, S.loeschDach);
  for (let y = 1; y <= 10; y++) set(cx - 7, y, cz, S.zaun);
}

function pfoertner() {
  const x0 = 64;
  const z0 = ZS - 12;
  box(x0, 1, z0, x0 + 8, 4, z0 + 6, S.haus);
  box(x0 + 1, 1, z0 + 1, x0 + 7, 4, z0 + 5, 0);
  box(x0 - 1, 5, z0 - 1, x0 + 9, 5, z0 + 7, S.hausDach);
  for (const z of [z0 + 1, z0 + 2, z0 + 4, z0 + 5]) set(x0, 3, z, S.hausGlas);
  for (const x of [x0 + 2, x0 + 3, x0 + 5, x0 + 6]) set(x, 3, z0, S.hausGlas);
  box(x0 + 4, 1, z0 + 6, x0 + 4, 2, z0 + 6, 0);
  // Schranke über die Zufahrt
  set(62, 1, ZS - 4, S.pollerKopf);
  set(62, 2, ZS - 4, S.schrankeW);
  for (let x = 50; x <= 61; x++) set(x, 2, ZS - 4, x % 3 === 0 ? S.schrankeW : S.schranke);
  // Zufahrtsmarke „STOP“
  for (let x = 50; x <= 61; x++) set(x, 0, ZS - 3, S.gelb);
}

function zaun() {
  for (let x = XW; x <= XO; x++) for (let z = ZN; z <= ZS; z++) {
    if (x !== XW && x !== XO && z !== ZN && z !== ZS) continue;
    // Tor im Süden
    if (z === ZS && x >= 49 && x <= 62) continue;
    set(x, 0, z, S.zaunSockel);
    const eck = (x === XW || x === XO) && (z === ZN || z === ZS);
    if (eck || (x + z) % 6 === 0) {
      box(x, 1, z, x, 4, z, S.zaunPfosten);
      set(x, 5, z, S.stachel);
    } else {
      box(x, 1, z, x, 4, z, S.zaun);
    }
  }
}

// ---------- Bäume und Grün ----------

function baum(x, z, art = 'eiche') {
  const stamm = art === 'birke' ? S.birke : art === 'fichte' ? S.fichte : S.stamm;
  const blatt = art === 'birke' ? S.birkeKrone : art === 'fichte' ? S.fichteKrone : S.krone;
  const h = 5 + Math.floor(rnd(x, 0, z, 61) * 3) + (art === 'fichte' ? 3 : 0);
  // Krone zuerst, damit der Stamm durchkommt
  if (art === 'fichte') {
    for (let y = 3; y <= h + 1; y++) {
      const r = Math.max(0, Math.round((h + 1 - y) * 0.5));
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dz) <= r + 1 && rnd(x + dx, y, z + dz, 62) > 0.08) setFrei(x + dx, y, z + dz, blatt);
      }
    }
  } else {
    const c = h;
    for (let dy = -2; dy <= 2; dy++) {
      const r = dy >= 2 ? 1 : dy === 1 ? 2 : 3;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && rnd(x + dx, c + dy, z + dz, 63) < 0.7) continue;
        if (rnd(x + dx, c + dy, z + dz, 64) > 0.07) setFrei(x + dx, c + dy, z + dz, blatt);
      }
    }
  }
  box(x, 1, z, x, h, z, stamm);
  set(x, 0, z, S.podsol);
}

function gruen() {
  // Bewuchs und Blumen auf freiem Rasen
  for (let z = ZN + 1; z < ZS; z++) for (let x = XW + 1; x < XO; x++) {
    const g0 = get(x, 0, z);
    if (g0 !== S.gras && g0 !== S.moos) continue;
    if (get(x, 1, z) !== 0) continue;
    const r = rnd(x, 1, z, 71);
    const beet = Math.sin(x * 0.09) * Math.cos(z * 0.08) > 0.55;
    if (beet && r < 0.1) set(x, 1, z, [S.mohn, S.gaensebluemchen, S.loewenzahn, S.kornblume, S.allium][Math.floor(rnd(x, 2, z, 71) * 5)]);
    else if (r < 0.14) set(x, 1, z, r < 0.02 ? S.farn : S.halm);
  }
  // Baumgruppen an den Rändern
  const stellen = [];
  for (let z = ZN + 4; z <= ZS - 4; z += 9) {
    stellen.push([XW + 6, z], [XW + 15, z + 4]);
    stellen.push([XO - 5, z + 2]);
  }
  for (let x = XW + 4; x <= XO - 4; x += 9) {
    stellen.push([x, ZN + 3]);
    stellen.push([x + 3, ZS - 6]);
    stellen.push([x, ZS - 16]);
  }
  for (const [x, z] of stellen) {
    if (get(x, 0, z) !== S.gras && get(x, 0, z) !== S.moos && get(x, 0, z) !== S.podsol) continue;
    let frei = true;
    for (let dz = -3; dz <= 3 && frei; dz++) for (let dx = -3; dx <= 3; dx++) {
      const g0 = get(x + dx, 0, z + dz);
      if (g0 !== S.gras && g0 !== S.moos && g0 !== S.podsol && g0 !== S.erde) { frei = false; break; }
      if (get(x + dx, 2, z + dz) !== 0) { frei = false; break; }
    }
    if (!frei) continue;
    const r = rnd(x, 0, z, 72);
    if (r < 0.2) continue;
    baum(x, z, r < 0.45 ? 'fichte' : r < 0.6 ? 'birke' : 'eiche');
  }
  // Hecken entlang der Innenkante der Ringstraße im Süden
  for (let x = -14; x < BAU.x + 14; x++) {
    if (x >= 44 && x <= 75) continue;
    if (get(x, 0, BAU.z + 17) === S.gras || get(x, 0, BAU.z + 17) === S.moos) box(x, 1, BAU.z + 17, x, 2, BAU.z + 17, (X, Y) => (Y === 2 && rnd(X, Y, 0, 73) < 0.2 ? 0 : S.hecke));
  }
}

function lichtmast(x, z, arm = 1) {
  box(x, 1, z, x, 8, z, S.mast);
  set(x, 9, z, S.mastKopf);
  set(x + arm, 9, z, S.mastKopf);
  set(x + arm, 8, z, S.lampe);
  if ((x + z) % 3 === 0) set(x, 10, z, S.kamera);
}

function masten() {
  for (let z = -8; z <= BAU.z + 8; z += 24) { lichtmast(-18, z, 1); lichtmast(BAU.x + 17, z, -1); }
  for (let x = 2; x <= BAU.x - 2; x += 24) { lichtmast(x, -18, 0); lichtmast(x, BAU.z + 17, 0); }
  // Parkplatz
  for (let z = 50; z <= 160; z += 24) if (z < 90 || z > 110) lichtmast(-31, z, 1);
  // Aggregatehof und Umspannwerk
  for (let z = 10; z <= 195; z += 34) lichtmast(166, z, -1);
  for (let x = -10; x <= 130; x += 28) lichtmast(x, -61, 0);
}

export function gelaendeBauen() {
  grundflaeche();
  strassen();
  zufahrt();
  parkplatz();
  eingangWest();
  ladehof();
  notstrom();
  umspannwerk();
  teich();
  loeschtank(14, 226);
  loeschtank(32, 226);
  pfoertner();
  zaun();
  masten();
  gruen();
  void boxFrei;
  void setFrei;
}
