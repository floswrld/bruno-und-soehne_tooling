// Raster, Baustoffe und Formen. Alle Koordinaten sind Gebäude-Koordinaten:
// (0,0,0) ist die untere Nord-West-Ecke, x = Osten, y = oben, z = Süden.

export const BAU = { x: 120, y: 40, z: 200 };
// Kein Gelände mehr: Das Raster ist genau das Gebäude. Der Rand bleibt als Stellschraube.
export const RAND = { west: 0, ost: 0, nord: 0, sued: 0 };
export const HOEHE = 41;

export const GX = RAND.west + BAU.x + RAND.ost;
export const GZ = RAND.nord + BAU.z + RAND.sued;

export const LUFT = 0;
const zellen = new Uint16Array(GX * GZ * HOEHE);
const palette = [{ block: null }];
const stoffe = new Map();

// Baustoff anlegen: stoff('dach')('Lüfter', 'iron_bars'). Mit Zone, damit der Plan weiß, wozu der Block gehört.
export function stoff(abschnitt, zone = null) {
  return (teil, block, zustand = null) => {
    const b = block.startsWith('minecraft:') ? block : `minecraft:${block}`;
    const key = [abschnitt, zone, teil, b, zustand].join('|');
    if (!stoffe.has(key)) {
      const e = { block: b, abschnitt, teil };
      if (zone) e.zone = zone;
      if (zustand) e.zustand = zustand;
      stoffe.set(key, palette.length);
      palette.push(e);
    }
    return stoffe.get(key);
  };
}

const idx = (x, y, z) => x + RAND.west + (z + RAND.nord) * GX + y * GX * GZ;

export function set(x, y, z, c) {
  const gx = x + RAND.west;
  const gz = z + RAND.nord;
  if (gx < 0 || gx >= GX || gz < 0 || gz >= GZ || y < 0 || y >= HOEHE) throw new Error(`Außerhalb des Rasters: ${x},${y},${z}`);
  zellen[gx + gz * GX + y * GX * GZ] = c;
}
export const get = (x, y, z) => zellen[idx(x, y, z)];
export const frei = (x, y, z) => zellen[idx(x, y, z)] === LUFT;
export const setFrei = (x, y, z, c) => { if (frei(x, y, z)) set(x, y, z, c); };

export function box(x0, y0, z0, x1, y1, z1, c) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
}
export function boxFrei(x0, y0, z0, x1, y1, z1, c) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (frei(x, y, z)) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
}
export const leeren = (x0, y0, z0, x1, y1, z1) => box(x0, y0, z0, x1, y1, z1, LUFT);

// Wiederholbarer Zufall je Position: gleicher Plan bei jedem Lauf.
export function rnd(x, y, z, salz = 0) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(salz, 40503)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 7), 668265263);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
// Auswahl nach Gewichten: wahl(x,y,z, [[stein, 8], [kies, 2]])
export function wahl(x, y, z, liste, salz = 0) {
  const summe = liste.reduce((s, e) => s + e[1], 0);
  let r = rnd(x, y, z, salz) * summe;
  for (const [c, w] of liste) {
    r -= w;
    if (r < 0) return c;
  }
  return liste[0][0];
}

// Zylinder mit Wand-Stoff, optional gefüllt.
export function zylinder(cx, cz, r, y0, y1, wand, fuell = null) {
  const R = Math.ceil(r);
  for (let y = y0; y <= y1; y++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.hypot(dx, dz);
    if (d > r + 0.3) continue;
    const c = d > r - 0.7 ? wand : fuell;
    if (c != null) set(cx + dx, y, cz + dz, typeof c === 'function' ? c(cx + dx, y, cz + dz) : c);
  }
}

// Auswertung für die Prüfungen am Ende.
export function allesDurchlaufen(fn) {
  for (let y = 0; y < HOEHE; y++) for (let gz = 0; gz < GZ; gz++) for (let gx = 0; gx < GX; gx++) {
    const p = zellen[gx + gz * GX + y * GX * GZ];
    if (p) fn(gx - RAND.west, y, gz - RAND.nord, palette[p], p);
  }
}
export const eintrag = (x, y, z) => palette[get(x, y, z)];

// Lauflängen je Ebene, z. B. "12a3.5b". Zeilenweise: z, dann x. Häufige Baustoffe bekommen die kurzen Zeichen.
export function kodieren() {
  const zaehl = new Uint32Array(palette.length);
  let oben = 0;
  for (let i = 0; i < zellen.length; i++) {
    if (!zellen[i]) continue;
    zaehl[zellen[i]]++;
    oben = Math.max(oben, Math.floor(i / (GX * GZ)));
  }
  const benutzt = [...zaehl.keys()].filter((i) => i && zaehl[i]).sort((a, b) => zaehl[b] - zaehl[a]);
  const ZEICHEN = [];
  for (const c of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') ZEICHEN.push(c);
  for (let c = 0xc0; ZEICHEN.length < benutzt.length; c++) ZEICHEN.push(String.fromCharCode(c));
  const zeichen = new Map(benutzt.map((p, i) => [p, ZEICHEN[i]]));
  zeichen.set(0, '.');
  const hoehe = oben + 1;
  const layers = [];
  for (let y = 0; y < hoehe; y++) {
    let s = '';
    const ebene = y * GX * GZ;
    let akt = zellen[ebene];
    let lauf = 0;
    for (let i = ebene; i < ebene + GX * GZ; i++) {
      if (zellen[i] === akt) { lauf++; continue; }
      s += lauf + zeichen.get(akt);
      akt = zellen[i];
      lauf = 1;
    }
    layers.push(s + lauf + zeichen.get(akt));
  }
  const pal = {};
  benutzt.forEach((p) => (pal[zeichen.get(p)] = palette[p]));
  let gesamt = 0;
  for (const p of benutzt) gesamt += zaehl[p];
  return { layers, palette: pal, gesamt, groesse: { x: GX, y: hoehe, z: GZ }, zaehl: new Map(benutzt.map((p) => [palette[p], zaehl[p]])) };
}
