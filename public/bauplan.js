// Bauplan des Rechenzentrums: 3D-Ansicht, Ebenen, Baufortschritt, Materialliste, live mitlaufende Spieler.
// Wird erst geladen, wenn jemand die Seite öffnet.
import * as THREE from '/vendor/three/three.module.min.js';
import { BLOECKE } from '/bloecke.js';
import { Kamerafuehrung } from '/kamera.js';
import { Bewegung, figurBauen } from '/figur.js';
import { ersatzHaut, hautLaden, hautVergessen, kopfBild } from '/haut.js';

const FARBE_FALSCH = 0xd8342c;
const STATUS = { fehlt: 1, gebaut: 2, falsch: 3 };
const MODI = [
  ['alles', 'Gesamtbau'],
  ['gebaut', 'Schon gebaut'],
  ['offen', 'Noch offen'],
];
const zahl = new Intl.NumberFormat('de-DE');
const SHULKER = 64 * 27;

// Klassen der Zellen
const OPAK = 1;
const GLAS = 2;
const FORM = 3;
const GEIST = 4;

function ohneNamespace(block) {
  return block.replace('minecraft:', '').replaceAll('_', ' ');
}
const blockName = (block) => BLOECKE[block]?.name ?? ohneNamespace(block);
const blockFarbe = (block) => BLOECKE[block]?.farbe ?? 0x888888;
const hexFarbe = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Form eines Blocks. Alles, was hier nicht steht, ist ein voller Würfel.
function formVon(block, zustand) {
  const id = block.replace('minecraft:', '');
  if (/_stained_glass$|^glass$|^tinted_glass$|^water$/.test(id)) return { art: GLAS };
  if (id === 'nether_portal') return { art: FORM, typ: 'portal' };
  if (id === 'iron_bars' || id === 'glass_pane') return { art: FORM, typ: 'gitter' };
  if (/_fence$/.test(id)) return { art: FORM, typ: 'zaun' };
  if (/_wall$/.test(id)) return { art: FORM, typ: 'mauer' };
  if (/_slab$/.test(id)) return { art: FORM, typ: zustand?.includes('top') ? 'stufeOben' : 'stufe' };
  if (/_carpet$|^rail$|^redstone_wire$|^lily_pad$/.test(id)) return { art: FORM, typ: 'teppich' };
  if (id === 'comparator') return { art: FORM, typ: 'flach' };
  if (/_trapdoor$/.test(id)) return { art: FORM, typ: 'klappe' };
  if (id === 'iron_chain' || id === 'lightning_rod' || id === 'end_rod') return { art: FORM, typ: 'stange' };
  if (id === 'lantern') return { art: FORM, typ: 'laterne' };
  if (/_bed$|^campfire$|^soul_campfire$/.test(id)) return { art: FORM, typ: 'bett' };
  if (/_door$/.test(id)) return { art: FORM, typ: 'tuer' };
  if (id === 'lever' || /_button$/.test(id)) return { art: FORM, typ: 'knopf' };
  if (/^(short_grass|fern|poppy|oxeye_daisy|dandelion|cornflower|allium|sugar_cane|bamboo|carrots)$/.test(id)) return { art: FORM, typ: 'pflanze' };
  if (id === 'hopper' || id === 'cauldron' || id === 'chest' || id === 'waxed_copper_chest' || id === 'brewing_stand' || id === 'anvil') return { art: FORM, typ: 'kiste' };
  return { art: OPAK };
}

function planEntpacken(plan, fortschritt) {
  const { x: X, y: Y, z: Z } = plan.groesse;
  const zeichen = Object.keys(plan.palette);
  const zellen = new Uint16Array(X * Y * Z); // Paletten-Index + 1, 0 = Luft
  const status = new Uint8Array(X * Y * Z);
  const nummern = new Int32Array(plan.gesamt);
  const index = new Map(zeichen.map((c, i) => [c, i + 1]));
  let n = 0;
  plan.layers.forEach((schicht, y) => {
    let i = y * X * Z;
    for (const [, zahlText, c] of schicht.matchAll(/(\d+)(\D)/g)) {
      const anzahl = Number(zahlText);
      if (c !== '.') {
        const p = index.get(c);
        for (let k = 0; k < anzahl; k++) {
          zellen[i + k] = p;
          status[i + k] = STATUS.fehlt;
          nummern[n++] = i + k;
        }
      }
      i += anzahl;
    }
  });
  const ist = new Map();
  if (fortschritt) {
    const bits = Uint8Array.from(atob(fortschritt.gebaut), (ch) => ch.charCodeAt(0));
    for (let k = 0; k < n; k++) {
      if (bits[k >> 3] & (1 << (k & 7))) status[nummern[k]] = STATUS.gebaut;
    }
    for (const [block, liste] of Object.entries(fortschritt.falsch)) {
      for (const k of liste) {
        status[nummern[k]] = STATUS.falsch;
        ist.set(nummern[k], block);
      }
    }
  }
  return { X, Y, Z, zellen, status, ist, nummern, anzahl: n, eintraege: zeichen.map((c) => plan.palette[c]) };
}

// ---------- Texturen ----------
// Je Block ein 16 x 16-Bild, von Hand gerechnet. Alpha < 1 heißt: Der Block leuchtet.

function bildZeichnen(block, eintrag, schicht) {
  const [nr, ng, nb] = [(eintrag.farbe >> 16) & 255, (eintrag.farbe >> 8) & 255, eintrag.farbe & 255];
  const a = 255 - Math.round((eintrag.leuchtet ?? 0) * 255);
  let saat = 0;
  for (const ch of block) saat = (Math.imul(saat, 31) + ch.charCodeAt(0)) | 0;
  const rnd = (x, y, s = 0) => {
    let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(saat + s, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const m = eintrag.muster;
  const helligkeit = (x, y) => {
    switch (m) {
      case 'glatt': return 1 + (rnd(x, y) - 0.5) * 0.04 - (x === 0 || y === 0 ? 0.03 : 0);
      case 'beton': return 1 + (rnd(x, y) - 0.5) * 0.09;
      case 'poliert': return 1 + (rnd(x, y) - 0.5) * 0.06 + (x + y < 6 ? 0.05 : x + y > 24 ? -0.07 : 0) - (x === 0 || y === 0 ? 0.04 : 0);
      case 'stein': return 1 + (rnd(x >> 1, y >> 1) - 0.5) * 0.28 + (rnd(x, y, 1) - 0.5) * 0.12;
      case 'bruch': return (((x + (y >> 2) * 3) % 5 === 0 || y % 4 === 0) ? 0.72 : 1 + (rnd(x >> 2, y >> 2) - 0.5) * 0.3) + (rnd(x, y) - 0.5) * 0.1;
      case 'ziegel': {
        const zeile = y >> 2;
        const fuge = y % 4 === 3 || (x + (zeile % 2) * 4) % 8 === 7;
        return (fuge ? 0.68 : 1 + (rnd((x + zeile * 3) >> 3, zeile) - 0.5) * 0.18) + (rnd(x, y) - 0.5) * 0.08;
      }
      case 'kacheln': {
        const fuge = x % 8 === 7 || y % 8 === 7;
        return (fuge ? 0.72 : 1 + (rnd(x >> 3, y >> 3) - 0.5) * 0.14) + (rnd(x, y) - 0.5) * 0.06;
      }
      case 'kies': return 1 + (rnd(x >> 1, y >> 1) - 0.5) * 0.5;
      case 'erde': return 1 + (rnd(x, y) - 0.5) * 0.4;
      case 'gras': return 1 + (rnd(x, y) - 0.5) * 0.3 + (rnd(x >> 2, y >> 2, 1) - 0.5) * 0.15;
      case 'wolle': return 1 + (rnd(x >> 1, y) - 0.5) * 0.13;
      case 'holz': return ((y % 4 === 3) ? 0.74 : 1) + (rnd(x >> 2, y >> 2) - 0.5) * 0.14 + (rnd(x, y) - 0.5) * 0.06;
      case 'stamm': return 1 + (rnd(x, 0) - 0.5) * 0.34 + (rnd(x, y) - 0.5) * 0.08;
      case 'blatt': return rnd(x, y) < 0.14 ? 0.45 : 1 + (rnd(x, y, 1) - 0.5) * 0.5;
      case 'regal': return y % 8 < 1 || y % 8 === 7 ? 0.8 : 0.7 + rnd(x >> 1, y >> 3) * 0.7;
      case 'metall': return 1 + (rnd(x, y) - 0.5) * 0.05 + (y % 16 < 1 || x % 16 < 1 ? 0.1 : 0) + (x === 15 || y === 15 ? -0.14 : 0);
      case 'kupfer': return 1 + (rnd(x >> 1, y >> 1) - 0.5) * 0.2;
      case 'lochblech': return x % 4 < 2 && y % 4 < 2 ? 0.28 : 1 + (rnd(x, y) - 0.5) * 0.14;
      case 'truhe': return y === 5 ? 0.45 : (x === 7 || x === 8) && y >= 4 && y <= 7 ? 1.5 : 1 + (rnd(x >> 2, y >> 1) - 0.5) * 0.16;
      case 'kasten': return (x === 0 || y === 0 || x === 15 || y === 15 ? 0.7 : 1) + (rnd(x, y) - 0.5) * 0.1 + (x > 4 && x < 11 && y > 4 && y < 11 ? -0.22 : 0);
      case 'lampe': return 1 + (x % 8 === 7 || y % 8 === 7 ? -0.2 : (rnd(x, y) - 0.5) * 0.2);
      case 'pflanze': return 1 + (rnd(x, y) - 0.5) * 0.3;
      case 'glas': return x === 0 || y === 0 || x === 15 || y === 15 ? 1.25 : 1;
      default: return 1;
    }
  };
  const q = (w) => Math.max(0, Math.min(255, Math.round(w)));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const h = helligkeit(x, y);
    const i = (schicht * 256 + y * 16 + x) * 4;
    atlasDaten[i] = q(nr * h);
    atlasDaten[i + 1] = q(ng * h);
    atlasDaten[i + 2] = q(nb * h);
    atlasDaten[i + 3] = a;
  }
}

let atlasDaten = null;
function atlasBauen(bloecke) {
  const schichten = bloecke.length + 1; // letzte Schicht: Rot für „falsch gesetzt“
  atlasDaten = new Uint8Array(256 * 4 * schichten);
  const kachel = new Map();
  bloecke.forEach((block, i) => {
    bildZeichnen(block, BLOECKE[block] ?? { farbe: 0x888888, muster: 'beton' }, i);
    kachel.set(block, i);
  });
  bildZeichnen('falsch', { farbe: FARBE_FALSCH, muster: 'glatt' }, bloecke.length);
  const tex = new THREE.DataArrayTexture(atlasDaten, 16, 16, schichten);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return { tex, kachel, rot: bloecke.length };
}

// Lambert mit Texturschicht je Fläche. Licht und Schatten macht weiter three.js.
function blockMaterial(tex, uniforms, extra) {
  const mat = new THREE.MeshLambertMaterial({ ...extra });
  mat.onBeforeCompile = (s) => {
    s.uniforms.bpAtlas = { value: tex };
    s.uniforms.bpLeuchten = uniforms.leuchten;
    s.vertexShader = `attribute vec3 aBp; varying vec3 vBp;\n${s.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBp = aBp;');
    s.fragmentShader = `precision highp sampler2DArray; uniform sampler2DArray bpAtlas; uniform float bpLeuchten; varying vec3 vBp;\n${s.fragmentShader}`
      .replace('#include <map_fragment>', 'vec4 bpFarbe = texture(bpAtlas, vBp); diffuseColor.rgb *= bpFarbe.rgb;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += bpFarbe.rgb * (1.0 - bpFarbe.a) * bpLeuchten;');
  };
  return mat;
}

// ---------- Würfel zu Flächen ----------
// Je Ebene eigene Meshes, damit der Ebenen-Regler nur ein- und ausblendet.
// Gleiche Blöcke werden zusammengefasst, sonst wären es Millionen Dreiecke.

class Flaechen {
  constructor() {
    this.v = new Float32Array(1 << 16);
    this.vn = 0;
    this.i = new Uint32Array(1 << 15);
    this.in = 0;
  }
  leeren() {
    this.vn = 0;
    this.in = 0;
  }
  viereck(ax, ay, az, ux, uy, uz, wx, wy, wz, nx, ny, nz, lu, lw, t) {
    if (this.vn + 36 > this.v.length) {
      const neu = new Float32Array(this.v.length * 2);
      neu.set(this.v);
      this.v = neu;
    }
    if (this.in + 6 > this.i.length) {
      const neu = new Uint32Array(this.i.length * 2);
      neu.set(this.i);
      this.i = neu;
    }
    const s = this.vn / 9;
    const v = this.v;
    let p = this.vn;
    const ecke = (x, y, z, a, b) => {
      v[p++] = x; v[p++] = y; v[p++] = z;
      v[p++] = nx; v[p++] = ny; v[p++] = nz;
      v[p++] = a; v[p++] = b; v[p++] = t;
    };
    ecke(ax, ay, az, 0, 0);
    ecke(ax + ux, ay + uy, az + uz, lu, 0);
    ecke(ax + ux + wx, ay + uy + wy, az + uz + wz, lu, lw);
    ecke(ax + wx, ay + wy, az + wz, 0, lw);
    this.vn = p;
    const i = this.i;
    let q = this.in;
    i[q++] = s; i[q++] = s + 1; i[q++] = s + 2; i[q++] = s; i[q++] = s + 2; i[q++] = s + 3;
    this.in = q;
  }
  quader(x0, y0, z0, x1, y1, z1, t) {
    const b = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    this.viereck(x0, y1, z0, 0, 0, d, b, 0, 0, 0, 1, 0, d, b, t);
    this.viereck(x0, y0, z0, b, 0, 0, 0, 0, d, 0, -1, 0, b, d, t);
    this.viereck(x1, y0, z0, -b, 0, 0, 0, h, 0, 0, 0, -1, b, h, t);
    this.viereck(x0, y0, z1, b, 0, 0, 0, h, 0, 0, 0, 1, b, h, t);
    this.viereck(x0, y0, z0, 0, 0, d, 0, h, 0, -1, 0, 0, d, h, t);
    this.viereck(x1, y0, z1, 0, 0, -d, 0, h, 0, 1, 0, 0, d, h, t);
  }
  geometrie() {
    if (this.in === 0) return null;
    const g = new THREE.BufferGeometry();
    const puffer = new THREE.InterleavedBuffer(this.v.slice(0, this.vn), 9);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(puffer, 3, 0));
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(puffer, 3, 3));
    g.setAttribute('aBp', new THREE.InterleavedBufferAttribute(puffer, 3, 6));
    g.setIndex(new THREE.BufferAttribute(this.i.slice(0, this.in), 1));
    return g;
  }
}

const eimer = { opak: new Flaechen(), deckel: new Flaechen(), glas: new Flaechen(), form: new Flaechen(), geist: new Flaechen() };

function formZeichnen(f, typ, x, y, z, t, verbunden) {
  const q = (a0, b0, c0, a1, b1, c1) => f.quader(x + a0, y + b0, z + c0, x + a1, y + b1, z + c1, t);
  switch (typ) {
    case 'stufe': return q(0, 0, 0, 1, 0.5, 1);
    case 'stufeOben': return q(0, 0.5, 0, 1, 1, 1);
    case 'teppich': return q(0, 0, 0, 1, 0.07, 1);
    case 'flach': return q(0, 0, 0, 1, 0.14, 1);
    case 'klappe': return q(0, 0, 0, 1, 0.19, 1);
    case 'stange': return q(0.42, 0, 0.42, 0.58, 1, 0.58);
    case 'laterne': return q(0.31, 0, 0.31, 0.69, 0.56, 0.69);
    case 'bett': return q(0, 0, 0, 1, 0.56, 1);
    case 'tuer': return q(0.84, 0, 0, 1, 1, 1);
    case 'knopf': return q(0.34, 0, 0.34, 0.66, 0.2, 0.66);
    case 'kiste': return q(0.06, 0, 0.06, 0.94, 0.88, 0.94);
    case 'portal': return q(0, 0, 0.38, 1, 1, 0.62);
    case 'pflanze':
      q(0.05, 0, 0.44, 0.95, 0.92, 0.56);
      return q(0.44, 0, 0.05, 0.56, 0.92, 0.95);
    case 'gitter':
    case 'zaun':
    case 'mauer': {
      const w = typ === 'gitter' ? 0.06 : typ === 'zaun' ? 0.12 : 0.25;
      const h = typ === 'gitter' ? 1 : typ === 'zaun' ? 1 : 0.81;
      const o = 0.5 - w;
      const p = 0.5 + w;
      const [n, s, wst, ost] = verbunden;
      const ab = typ === 'zaun' ? 0.38 : 0;
      const bis = typ === 'zaun' ? 0.94 : h;
      if (!(n || s || wst || ost) || typ !== 'gitter') q(o, 0, o, p, typ === 'mauer' ? 1 : h, p);
      if (typ === 'gitter' && !(n || s || wst || ost)) {
        q(0, 0, o, 1, 1, p);
        return q(o, 0, 0, p, 1, 1);
      }
      if (n) q(o, ab, 0, p, bis, o);
      if (s) q(o, ab, p, p, bis, 1);
      if (wst) q(0, ab, o, o, bis, p);
      if (ost) q(p, ab, o, 1, bis, p);
      return undefined;
    }
    default: return q(0, 0, 0, 1, 1, 1);
  }
}

function ebeneBauen(y, d) {
  const { X, Y, Z, klasse, kachel, formen, zellen } = d;
  const ebene = y * X * Z;
  for (const f of Object.values(eimer)) f.leeren();

  // Würfel und durchsichtige Würfel je für sich. Grenzt Glas an Glas, entfällt die Fläche dazwischen.
  const zaehlt = (i, art) => klasse[i] === art;
  const verdeckt = (i, art, t) => {
    const k = klasse[i];
    return k === OPAK || (art === GLAS && k === GLAS && kachel[i] === t);
  };

  for (const [art, ziel, deckelZiel] of [[OPAK, eimer.opak, eimer.deckel], [GLAS, eimer.glas, null], [GEIST, eimer.geist, null]]) {
    // Oben und unten: Rechtecke zusammenfassen
    for (const oben of [true, false]) {
      for (const verdecktModus of oben && deckelZiel ? [false, true] : [false]) {
        const fertig = new Uint8Array(X * Z);
        for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
          const i = ebene + x + z * X;
          if (fertig[x + z * X] || !zaehlt(i, art)) continue;
          const t = kachel[i];
          const dran = y === (oben ? Y - 1 : 0) ? false : art === GEIST ? false : verdeckt(i + (oben ? X * Z : -X * Z), art, t);
          // Verdeckte Oberseiten kommen in den Deckel: nur sichtbar, wenn der Regler die Ebene darüber ausblendet.
          if (verdecktModus ? !dran : dran) continue;
          const passt = (q, w) => {
            const n = q + w * X;
            if (fertig[n]) return false;
            const j = ebene + n;
            if (!zaehlt(j, art) || kachel[j] !== t) return false;
            const da = y === (oben ? Y - 1 : 0) ? false : art === GEIST ? false : verdeckt(j + (oben ? X * Z : -X * Z), art, t);
            return verdecktModus ? da : !da;
          };
          let b = 1;
          while (x + b < X && passt(x + b, z)) b++;
          let h = 1;
          hochlauf: while (z + h < Z) {
            for (let q = 0; q < b; q++) if (!passt(x + q, z + h)) break hochlauf;
            h++;
          }
          for (let w = 0; w < h; w++) for (let q = 0; q < b; q++) fertig[x + q + (z + w) * X] = 1;
          const f = verdecktModus ? deckelZiel : ziel;
          if (oben) f.viereck(x, y + 1, z, 0, 0, h, b, 0, 0, 0, 1, 0, h, b, t);
          else f.viereck(x, y, z, b, 0, 0, 0, 0, h, 0, -1, 0, b, h, t);
        }
      }
    }
    // Seiten: Läufe je Zeile
    const seite = (i, di, grenze, t) => grenze || !verdeckt(i + di, art, t);
    for (let z = 0; z < Z; z++) {
      for (const dz of [-1, 1]) {
        for (let x = 0; x < X; x++) {
          const i = ebene + x + z * X;
          if (!zaehlt(i, art)) continue;
          const t = kachel[i];
          const rand = z + dz < 0 || z + dz >= Z;
          if (!seite(i, dz * X, rand, t)) continue;
          let b = 1;
          while (x + b < X) {
            const j = ebene + x + b + z * X;
            if (!zaehlt(j, art) || kachel[j] !== t || !seite(j, dz * X, rand, t)) break;
            b++;
          }
          if (dz < 0) ziel.viereck(x + b, y, z, -b, 0, 0, 0, 1, 0, 0, 0, -1, b, 1, t);
          else ziel.viereck(x, y, z + 1, b, 0, 0, 0, 1, 0, 0, 0, 1, b, 1, t);
          x += b - 1;
        }
      }
    }
    for (let x = 0; x < X; x++) {
      for (const dx of [-1, 1]) {
        for (let z = 0; z < Z; z++) {
          const i = ebene + x + z * X;
          if (!zaehlt(i, art)) continue;
          const t = kachel[i];
          const rand = x + dx < 0 || x + dx >= X;
          if (!seite(i, dx, rand, t)) continue;
          let b = 1;
          while (z + b < Z) {
            const j = ebene + x + (z + b) * X;
            if (!zaehlt(j, art) || kachel[j] !== t || !seite(j, dx, rand, t)) break;
            b++;
          }
          if (dx < 0) ziel.viereck(x, y, z, 0, 0, b, 0, 1, 0, -1, 0, 0, b, 1, t);
          else ziel.viereck(x + 1, y, z + b, 0, 0, -b, 0, 1, 0, 1, 0, 0, b, 1, t);
          z += b - 1;
        }
      }
    }
  }

  // Alles, was kein Würfel ist: einzeln
  const belegt = (i) => klasse[i] === OPAK || klasse[i] === GLAS || klasse[i] === FORM;
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    const i = ebene + x + z * X;
    if (klasse[i] !== FORM) continue;
    const typ = formen[zellen[i] - 1].typ;
    const verbunden = [z > 0 && belegt(i - X), z < Z - 1 && belegt(i + X), x > 0 && belegt(i - 1), x < X - 1 && belegt(i + 1)];
    formZeichnen(eimer.form, typ, x, y, z, kachel[i], verbunden);
  }
  return {
    opak: eimer.opak.geometrie(),
    deckel: eimer.deckel.geometrie(),
    glas: eimer.glas.geometrie(),
    form: eimer.form.geometrie(),
    geist: eimer.geist.geometrie(),
  };
}

// ---------- Seite ----------

const THEMEN = {
  hell: { himmel: 0xc6d7e6, nebel: 0xc6d7e6, boden: 0x6f8a58, hemi: [0xffffff, 0x8a97a5, 1.25], sonne: [0xfff4e0, 2.1], gegen: 0.35, leuchten: 0.22 },
  dunkel: { himmel: 0x0c1219, nebel: 0x0c1219, boden: 0x22301f, hemi: [0xa9bcdc, 0x2a3440, 1.0], sonne: [0xb4c6e6, 0.95], gegen: 0.2, leuchten: 1.6 },
};

export function zeigeBauplan(wurzel, { plan, start, istAdmin, speichern, toast }, esc) {
  const d = planEntpacken(plan, start.fortschritt);
  const anker = start.anker ?? plan.anker;
  const server = start.server;
  const ecke = plan.ankerblock ?? { x: 0, y: 0, z: 0, block: 'minecraft:black_concrete', teil: 'Eckverglasung' };
  // Daten gibt es, sobald ein Abgleich gelaufen ist oder die Mod etwas gemeldet hat.
  let hatDaten = !!start.fortschritt;
  const { X, Y, Z } = d;
  const g = plan.gebaeude;
  const abschnitte = Object.fromEntries(Object.keys(plan.abschnitte).map((a) => [a, true]));
  const sicht = { modus: 'alles', abschnitte, ebene: Y - 1, nurEbene: false, umriss: true };
  wurzel.innerHTML = `
    <div class="bp-layout">
      <section class="bp-buehne" aria-label="3D-Ansicht des Rechenzentrums">
        <canvas></canvas>
        <div class="bp-kompass" aria-hidden="true"></div>
        <div class="bp-spieler-namen" aria-hidden="true"></div>
        <div class="bp-anker-schild" aria-hidden="true" hidden><b>Hier einmessen</b><span>${esc(blockName(ecke.block))}, unterste Nordwest-Ecke</span></div>
        <div class="bp-folgen" hidden><span data-folgen-name></span><button type="button" data-folgen-aus aria-label="Kamera wieder frei">✕</button></div>
        <div class="bp-laden" role="status"></div>
        <div class="bp-oben">
          <div class="bp-seg" role="group" aria-label="Blickrichtung">
            ${[['iso', 'Schräg'], ['plan', 'Grundriss'], ['west', 'West'], ['nord', 'Nord'], ['ost', 'Ost'], ['sued', 'Süd']].map(([k, t]) => `<button type="button" data-blick="${k}">${t}</button>`).join('')}
          </div>
          <div class="bp-seg" role="group" aria-label="Kamera">
            <button type="button" data-auto aria-pressed="false" title="Kamera folgt automatisch dem Spieler, der gerade baut">Auto</button>
          </div>
          <div class="bp-seg" role="group" aria-label="Was gezeigt wird">
            ${MODI.map(([k, t]) => `<button type="button" data-modus="${k}">${t}</button>`).join('')}
          </div>
          <button type="button" class="bp-hilfe-knopf" data-hilfe aria-expanded="false" aria-label="Steuerung anzeigen">?</button>
        </div>
        <div class="bp-hilfe" hidden>
          <b>Steuerung</b>
          <dl>
            <dt>Ziehen</dt><dd>drehen</dd>
            <dt>Rechts ziehen · Shift</dt><dd>verschieben</dd>
            <dt>Mausrad</dt><dd>zoomen, zur Maus hin</dd>
            <dt>Doppelklick</dt><dd>hinfliegen</dd>
            <dt>W A S D · Pfeile</dt><dd>fahren, Shift schneller</dd>
            <dt>Q / E · R / F</dt><dd>drehen · zoomen</dd>
            <dt>Spieler in der Liste</dt><dd>Kamera folgt</dd>
            <dt>Auto</dt><dd>hinter dem Spieler, der gerade baut</dd>
          </dl>
        </div>
        <div class="bp-info" hidden></div>
        <div class="bp-unten">
          <label class="bp-regler">
            <span data-ebene-text></span>
            <input type="range" min="0" max="${Y - 1}" value="${Y - 1}" aria-label="Ebene">
          </label>
          <label class="bp-haken"><input type="checkbox" data-nur> Nur diese Ebene</label>
          <details class="bp-mehr">
            <summary>Anzeigen</summary>
            <div class="bp-mehr-liste">
              ${Object.entries(plan.abschnitte).map(([a, e]) => `<label class="bp-haken"><input type="checkbox" data-abschnitt="${a}" checked> ${esc(e.name)}</label>`).join('')}
            </div>
          </details>
        </div>
      </section>
      <aside class="bp-seite">
        <div class="bp-tabs" role="tablist">
          ${[['live', 'Live'], ['fortschritt', 'Baufortschritt'], ['material', 'Material']].map(([k, t], i) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${i === 0}">${t}</button>`).join('')}
        </div>
        <section class="panel bp-tafel" data-tafel="live">
          <div class="panel-head"><h2>Live</h2><span class="chip off" data-live-chip>keine Daten</span></div>
          <div data-live-spieler></div>
          <h3 class="bp-zwischen">Zuletzt am Bau</h3>
          <ol class="bp-feed" data-live-feed></ol>
          <div data-live-standort></div>
        </section>
        <section class="panel bp-tafel" data-tafel="fortschritt" hidden>
          <div class="panel-head"><h2>Baufortschritt</h2></div>
          <div data-fortschritt></div>
        </section>
        <section class="panel bp-tafel" data-tafel="material" hidden>
          <div class="panel-head"><h2>Material</h2><span class="small" data-material-bereich></span></div>
          <div class="table-wrap"><table class="bp-material">
            <thead><tr><th>Block</th><th>Anzahl</th><th>Offen</th><th>Stacks</th><th>Shulker</th></tr></thead>
            <tbody data-material></tbody>
          </table></div>
        </section>
      </aside>
    </div>`;

  const $ = (s) => wurzel.querySelector(s);
  const $$ = (s) => [...wurzel.querySelectorAll(s)];
  const buehne = $('.bp-buehne');
  const canvas = $('canvas');
  const info = $('.bp-info');
  const ladeAnzeige = $('.bp-laden');

  // ---------- Zählen ----------

  const zaehler = Array.from({ length: Y }, () => d.eintraege.map(() => ({ gesamt: 0, gebaut: 0 })));
  for (let i = 0; i < d.zellen.length; i++) {
    if (!d.zellen[i]) continue;
    const z = zaehler[Math.floor(i / (X * Z))][d.zellen[i] - 1];
    z.gesamt++;
    if (d.status[i] === STATUS.gebaut) z.gebaut++;
  }

  function summeFuer(abschnitt) {
    let gesamt = 0;
    let gebaut = 0;
    zaehler.forEach((ebene) => ebene.forEach((z, p) => {
      if (d.eintraege[p].abschnitt !== abschnitt) return;
      gesamt += z.gesamt;
      gebaut += z.gebaut;
    }));
    return { gesamt, gebaut };
  }

  function fortschrittZeigen() {
    const meter = (titel, s) => {
      const p = s.gesamt ? (100 * s.gebaut) / s.gesamt : 0;
      return `<div class="bp-meter">
        <div class="bp-meter-kopf"><b>${titel}</b><span>${p.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</span></div>
        <div class="bp-balken" role="img" aria-label="${titel}: ${Math.round(p)} Prozent"><i style="width:${p}%"></i></div>
        <div class="small">${zahl.format(s.gebaut)} von ${zahl.format(s.gesamt)} Blöcken</div>
      </div>`;
    };
    const falsch = d.ist.size;
    const stand = hatDaten
      ? 'Stand live aus der Mod: Jeder gesetzte Block kommt sofort an. Was noch keiner mit der Mod gesehen hat, zählt als offen.'
      : 'Noch kein Abgleich mit der Minecraft-Welt. Alles zählt als offen.';
    $('[data-fortschritt]').innerHTML = `
      ${Object.keys(plan.abschnitte).map((a) => meter(esc(plan.abschnitte[a].name), summeFuer(a))).join('')}
      ${falsch ? `<p class="bp-falsch">${zahl.format(falsch)} Blöcke sind falsch gesetzt und rot markiert.</p>` : ''}
      <p class="small bp-stand">${esc(stand)}</p>
      <p class="small bp-stand">${anker ? `Nordwest-Ecke des Gebäudes in der Welt: ${anker.x} / ${anker.y} / ${anker.z}` : 'Standort in der Welt ist noch nicht festgelegt. Koordinaten zählen ab der Nordwest-Ecke des Gebäudes.'}</p>`;
  }

  function materialZeigen() {
    const von = sicht.nurEbene ? sicht.ebene : 0;
    const bis = sicht.ebene;
    const proBlock = new Map();
    for (let y = von; y <= bis; y++) {
      zaehler[y].forEach((z, p) => {
        const e = d.eintraege[p];
        if (!sicht.abschnitte[e.abschnitt] || !z.gesamt) return;
        const s = proBlock.get(e.block) ?? { gesamt: 0, gebaut: 0 };
        s.gesamt += z.gesamt;
        s.gebaut += z.gebaut;
        proBlock.set(e.block, s);
      });
    }
    const zeilen = [...proBlock].sort((a, b) => b[1].gesamt - a[1].gesamt);
    const summe = zeilen.reduce((s, [, z]) => ({ gesamt: s.gesamt + z.gesamt, gebaut: s.gebaut + z.gebaut }), { gesamt: 0, gebaut: 0 });
    const zeile = (titel, z, klasse = '') => {
      const offen = z.gesamt - z.gebaut;
      return `<tr class="${klasse}"><td>${titel}</td><td>${zahl.format(z.gesamt)}</td><td>${zahl.format(offen)}</td><td>${zahl.format(Math.ceil(offen / 64))}</td><td>${(offen / SHULKER).toLocaleString('de-DE', { maximumFractionDigits: 1 })}</td></tr>`;
    };
    $('[data-material]').innerHTML = zeilen.length
      ? zeilen.map(([block, z]) => zeile(`<span class="bp-muster" style="background:${hexFarbe(blockFarbe(block))}"></span>${esc(blockName(block))}`, z)).join('') + zeile('Summe', summe, 'bp-summe')
      : '<tr><td colspan="5">Nichts ausgewählt.</td></tr>';
    $('[data-material-bereich]').textContent = sicht.nurEbene ? `Ebene y = ${sicht.ebene}` : sicht.ebene < Y - 1 ? `bis y = ${sicht.ebene}` : 'alle Ebenen';
  }

  // ---------- Szene ----------

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const szene = new THREE.Scene();
  szene.fog = new THREE.Fog(0xc6d7e6, 600, 2100);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a97a5, 1.2);
  szene.add(hemi);

  const planMitte = new THREE.Vector3(X / 2, 0, Z / 2);
  const sonne = new THREE.DirectionalLight(0xffffff, 2);
  sonne.position.copy(planMitte).add(new THREE.Vector3(-260, 420, 170));
  sonne.target.position.copy(planMitte);
  sonne.castShadow = true;
  sonne.shadow.mapSize.set(4096, 4096);
  const S = Math.max(X, Z) * 0.72;
  Object.assign(sonne.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 50, far: 1100 });
  sonne.shadow.camera.updateProjectionMatrix();
  sonne.shadow.bias = -0.0006;
  sonne.shadow.normalBias = 0.35;
  szene.add(sonne, sonne.target);
  const gegenlicht = new THREE.DirectionalLight(0xffffff, 0.35);
  gegenlicht.position.set(0.7, 0.4, -0.6);
  szene.add(gegenlicht);

  // Wiese rund ums Grundstück: helles Rauschen, das die Farbe des Themas einfärbt.
  const wiesenDaten = new Uint8Array(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i++) {
    const w = 205 + Math.floor(Math.random() * 50);
    wiesenDaten.set([w, w, w, 255], i * 4);
  }
  const wiese = new THREE.DataTexture(wiesenDaten, 128, 128);
  wiese.wrapS = THREE.RepeatWrapping;
  wiese.wrapT = THREE.RepeatWrapping;
  wiese.magFilter = THREE.NearestFilter;
  wiese.minFilter = THREE.LinearMipmapLinearFilter;
  wiese.generateMipmaps = true;
  wiese.repeat.set(70, 70);
  wiese.needsUpdate = true;
  const bodenMaterial = new THREE.MeshLambertMaterial({ color: 0x6f8a58, map: wiese });
  const boden = new THREE.Mesh(new THREE.CircleGeometry(4000, 48), bodenMaterial);
  boden.rotation.x = -Math.PI / 2;
  boden.position.set(X / 2, -0.03, Z / 2);
  boden.receiveShadow = true;
  szene.add(boden);

  const kamera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  const mitte = new THREE.Vector3(g.x + g.breite / 2, 12, g.z + g.tiefe / 2);
  const kf = new Kamerafuehrung(kamera, canvas, { mitte, beiAenderung: () => zeichnen(), beiModus: () => kameraModusZeigen() });

  const BLICKE = {
    iso: [-250, 165, 260],
    west: [-340, 36, 0],
    ost: [340, 36, 0],
    nord: [0, 36, -420],
    sued: [0, 36, 420],
  };
  // Blickrichtungen werden angeflogen, nur beim ersten Bild geht es sofort.
  function blick(name, sofort = false) {
    let pos;
    if (name === 'plan') {
      const quer = kamera.aspect >= 1.05;
      const tan = Math.tan((kamera.fov * Math.PI) / 360);
      const lang = g.tiefe + 44;
      const kurz = g.breite + 44;
      const abstand = Math.max((quer ? lang : kurz) / 2 / (tan * kamera.aspect), (quer ? kurz : lang) / 2 / tan) * 1.12;
      // Der kleine Versatz legt fest, wo oben ist: Quer liegt Osten oben, Norden links.
      pos = new THREE.Vector3(mitte.x + (quer ? -0.6 : 0), mitte.y + abstand, mitte.z + (quer ? 0 : 0.6));
    } else {
      const v = BLICKE[name];
      // Auf schmalen Bildschirmen weiter weg, damit das Gebäude in die Breite passt. Auf breiten näher ran.
      const f = Math.max(0.78, 1.15 / kamera.aspect);
      pos = new THREE.Vector3(mitte.x + v[0] * f, mitte.y + v[1] * f, mitte.z + v[2] * f);
    }
    kf.modusSetzen('frei');
    if (sofort) kf.sofort(mitte, pos);
    else kf.fliegeZu(mitte, pos);
    zeichnen();
  }

  const bloecke = [...new Set(d.eintraege.map((e) => e.block))];
  const atlas = atlasBauen(bloecke);
  const uniforms = { leuchten: { value: 0.5 } };
  const vollMaterial = blockMaterial(atlas.tex, uniforms);
  const glasMaterial = blockMaterial(atlas.tex, uniforms, { transparent: true, opacity: 0.42, depthWrite: false });
  const umrissMaterial = new THREE.MeshBasicMaterial({ color: 0xb8d2ea, transparent: true, opacity: 0.1, depthWrite: false });

  const stufen = Array.from({ length: Y }, () => ({ voll: new THREE.Group(), deckel: new THREE.Group(), glas: new THREE.Group(), geist: new THREE.Group() }));
  stufen.forEach((s) => szene.add(s.voll, s.deckel, s.glas, s.geist));

  const markierung = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
    new THREE.LineBasicMaterial({ color: 0xe8d9b5 })
  );
  markierung.visible = false;
  szene.add(markierung);

  // ---------- Zelltabellen ----------

  d.klasse = new Uint8Array(d.zellen.length);
  d.kachel = new Uint16Array(d.zellen.length);
  const formen = d.eintraege.map((e) => formVon(e.block, e.zustand));
  d.formen = formen;
  const kacheln = d.eintraege.map((e) => atlas.kachel.get(e.block));

  function zelleEinstufen(i) {
    const p = d.zellen[i];
    d.klasse[i] = 0;
    if (!p) return;
    const e = d.eintraege[p - 1];
    if (!sicht.abschnitte[e.abschnitt]) return;
    const st = d.status[i];
    const voll = sicht.modus === 'alles' || st === STATUS.falsch || (sicht.modus === 'gebaut' && st === STATUS.gebaut) || (sicht.modus === 'offen' && st === STATUS.fehlt);
    if (voll) {
      d.klasse[i] = formen[p - 1].art;
      d.kachel[i] = sicht.modus !== 'alles' && st === STATUS.falsch ? atlas.rot : kacheln[p - 1];
    } else if (sicht.umriss && hatDaten && sicht.modus !== 'alles') {
      d.klasse[i] = GEIST;
      d.kachel[i] = 0;
    }
  }

  function stufeFuellen(y, ergebnis) {
    const s = stufen[y];
    for (const gruppe of [s.voll, s.deckel, s.glas, s.geist]) {
      for (const m of gruppe.children) m.geometry.dispose();
      gruppe.clear();
    }
    const dazu = (gruppe, geo, material, schatten) => {
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = schatten;
      mesh.receiveShadow = true;
      gruppe.add(mesh);
    };
    dazu(s.voll, ergebnis.opak, vollMaterial, true);
    dazu(s.voll, ergebnis.form, vollMaterial, true);
    dazu(s.deckel, ergebnis.deckel, vollMaterial, false);
    dazu(s.glas, ergebnis.glas, glasMaterial, false);
    dazu(s.geist, ergebnis.geist, umrissMaterial, false);
  }

  // Baut alles neu. Läuft in Häppchen, damit die Seite nicht einfriert.
  let bauLauf = 0;
  async function geometrieBauen() {
    const lauf = ++bauLauf;
    for (let i = 0; i < d.zellen.length; i++) zelleEinstufen(i);
    ladeAnzeige.hidden = false;
    let letzte = performance.now();
    for (let y = 0; y < Y; y++) {
      const ergebnis = ebeneBauen(y, d);
      if (lauf !== bauLauf || tot) { Object.values(ergebnis).forEach((geo) => geo?.dispose()); return; }
      stufeFuellen(y, ergebnis);
      if (performance.now() - letzte > 40) {
        ladeAnzeige.textContent = `Modell wird gebaut … ${Math.round(((y + 1) / Y) * 100)} %`;
        ebenenZeigen();
        await new Promise((fertig) => requestAnimationFrame(fertig));
        if (lauf !== bauLauf || tot) return;
        letzte = performance.now();
      }
    }
    ladeAnzeige.hidden = true;
    ladeAnzeige.textContent = '';
    ebenenZeigen();
  }

  function ebenenSichtbar(y) {
    return sicht.nurEbene ? y === sicht.ebene : y <= sicht.ebene;
  }
  function ebenenZeigen() {
    stufen.forEach((s, y) => {
      const an = ebenenSichtbar(y);
      s.voll.visible = an;
      s.glas.visible = an;
      s.geist.visible = an;
      s.deckel.visible = y === sicht.ebene;
    });
    const welt = anker ? ` · Welt-Y ${anker.y + sicht.ebene - g.y}` : '';
    $('[data-ebene-text]').textContent = `Ebene y = ${sicht.ebene}${welt}`;
    renderer.shadowMap.needsUpdate = true;
    zeichnen();
  }

  // ---------- Himmelsrichtungen ----------

  const kompass = $('.bp-kompass');
  const RICHTUNGEN = [['N', X / 2, -8], ['S', X / 2, Z + 8], ['W', -8, Z / 2], ['O', X + 8, Z / 2]].map(([t, x, z]) => {
    const el = document.createElement('span');
    el.textContent = t;
    kompass.append(el);
    return { el, p: new THREE.Vector3(x, 8, z) };
  });
  const hilf = new THREE.Vector3();
  function kompassZeigen(b, h) {
    for (const r of RICHTUNGEN) {
      hilf.copy(r.p).project(kamera);
      const sichtbar = hilf.z < 1 && Math.abs(hilf.x) < 1 && Math.abs(hilf.y) < 1;
      r.el.style.display = sichtbar ? '' : 'none';
      const sx = Math.max(24, Math.min(b - 24, ((hilf.x + 1) / 2) * b));
      const sy = Math.max(100, Math.min(h - 110, ((1 - hilf.y) / 2) * h));
      r.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
    }
  }

  // ---------- Zeichnen ----------

  // Gezeichnet wird nur bei Bedarf. Solange sich eine Figur oder die Kamera bewegt, Bild für Bild.
  let geplant = false;
  let tot = false;
  let letztesBild = 0;
  function zeichnen() {
    if (geplant || tot) return;
    geplant = true;
    requestAnimationFrame((t) => {
      geplant = false;
      if (tot) return;
      const dt = letztesBild ? Math.min(0.1, (t - letztesBild) / 1000) : 1 / 60;
      letztesBild = t;
      const figurenLaufen = figurenBewegen(dt);
      const kameraLaeuft = kf.update(dt);
      const weiter = figurenLaufen || kameraLaeuft;
      renderer.render(szene, kamera);
      const b = canvas.clientWidth;
      const h = canvas.clientHeight;
      kompassZeigen(b, h);
      spielerNamenZeigen(b, h);
      eckeSchildZeigen(b, h);
      if (weiter && !document.hidden) zeichnen();
      else letztesBild = 0;
    });
  }
  // Zurück im Tab: weiterzeichnen, falls gerade etwas lief (Auto-Kamera, Figuren).
  const wiederSichtbar = () => {
    if (!document.hidden) zeichnen();
  };
  document.addEventListener('visibilitychange', wiederSichtbar);

  function anpassen() {
    const b = buehne.clientWidth;
    const h = buehne.clientHeight;
    if (!b || !h) return;
    renderer.setSize(b, h, false);
    kamera.aspect = b / h;
    kamera.updateProjectionMatrix();
    zeichnen();
  }
  const groesse = new ResizeObserver(anpassen);
  groesse.observe(buehne);

  // Hell und Dunkel: Bei Dunkel ist es Nacht und die Lampen leuchten.
  function themaAnwenden() {
    const dunkel = document.documentElement.dataset.themaAktiv === 'dunkel';
    const t = dunkel ? THEMEN.dunkel : THEMEN.hell;
    szene.background = new THREE.Color(t.himmel);
    szene.fog.color.setHex(t.nebel);
    bodenMaterial.color.setHex(t.boden);
    hemi.color.setHex(t.hemi[0]);
    hemi.groundColor.setHex(t.hemi[1]);
    hemi.intensity = t.hemi[2];
    sonne.color.setHex(t.sonne[0]);
    sonne.intensity = t.sonne[1];
    gegenlicht.intensity = t.gegen;
    uniforms.leuchten.value = t.leuchten;
    renderer.shadowMap.needsUpdate = true;
    zeichnen();
  }
  document.addEventListener('thema', themaAnwenden);

  // ---------- Block anfassen ----------

  const strahl = new THREE.Raycaster();
  const zeiger = new THREE.Vector2();

  // Läuft Zelle für Zelle durch das Raster bis zum ersten sichtbaren Block.
  function blockTreffen(ereignis) {
    const r = canvas.getBoundingClientRect();
    zeiger.set(((ereignis.clientX - r.left) / r.width) * 2 - 1, -((ereignis.clientY - r.top) / r.height) * 2 + 1);
    strahl.setFromCamera(zeiger, kamera);
    const o = strahl.ray.origin;
    const v = strahl.ray.direction;
    const grenzen = [[0, X], [0, Y], [0, Z]];
    let t0 = 0;
    let t1 = Infinity;
    const start = [o.x, o.y, o.z];
    const rich = [v.x, v.y, v.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(rich[a]) < 1e-9) {
        if (start[a] < grenzen[a][0] || start[a] > grenzen[a][1]) return null;
        continue;
      }
      const t = [(grenzen[a][0] - start[a]) / rich[a], (grenzen[a][1] - start[a]) / rich[a]].sort((m, n) => m - n);
      t0 = Math.max(t0, t[0]);
      t1 = Math.min(t1, t[1]);
    }
    if (t0 > t1) return null;
    const zelle = [0, 1, 2].map((a) => Math.min(grenzen[a][1] - 1, Math.max(0, Math.floor(start[a] + rich[a] * (t0 + 1e-4)))));
    const schritt = rich.map((w) => (w > 0 ? 1 : -1));
    const delta = rich.map((w) => (Math.abs(w) < 1e-9 ? Infinity : Math.abs(1 / w)));
    const naechste = [0, 1, 2].map((a) => {
      if (delta[a] === Infinity) return Infinity;
      const kante = rich[a] > 0 ? zelle[a] + 1 : zelle[a];
      return (kante - start[a]) / rich[a];
    });
    for (let n = 0; n < X + Y + Z + 3; n++) {
      const [x, y, z] = zelle;
      if (x < 0 || x >= X || y < 0 || y >= Y || z < 0 || z >= Z) return null;
      const i = x + z * X + y * X * Z;
      const k = d.klasse[i];
      if (k && k !== GEIST && ebenenSichtbar(y)) return { x, y, z, i };
      const a = naechste[0] < naechste[1] ? (naechste[0] < naechste[2] ? 0 : 2) : naechste[1] < naechste[2] ? 1 : 2;
      zelle[a] += schritt[a];
      naechste[a] += delta[a];
    }
    return null;
  }

  function infoZeigen(t) {
    markierung.visible = !!t;
    info.hidden = !t;
    if (t) {
      markierung.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      const e = d.eintraege[d.zellen[t.i] - 1];
      const st = d.status[t.i];
      const statusText = !hatDaten ? '' : st === STATUS.gebaut ? 'gebaut' : st === STATUS.falsch ? `falsch: dort steht ${blockName(d.ist.get(t.i))}` : 'noch offen';
      const rel = [t.x - g.x, t.y - g.y, t.z - g.z];
      const welt = anker ? `<span>Welt ${anker.x + rel[0]} / ${anker.y + rel[1]} / ${anker.z + rel[2]}</span>` : '';
      info.innerHTML = `<b>${esc(blockName(e.block))}</b><span>${esc(e.teil)} · ${esc(plan.abschnitte[e.abschnitt].name)}</span><span>x ${rel[0]} · y ${rel[1]} · z ${rel[2]}</span>${welt}${statusText ? `<span>${esc(statusText)}</span>` : ''}`;
    }
    zeichnen();
  }

  let druck = null;
  let festgehalten = false;
  canvas.addEventListener('pointerdown', (e) => (druck = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (druck && Math.hypot(e.clientX - druck[0], e.clientY - druck[1]) < 6) {
      const t = blockTreffen(e);
      festgehalten = !!t;
      infoZeigen(t);
    }
    druck = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons || festgehalten) return;
    infoZeigen(blockTreffen(e));
  });
  canvas.addEventListener('pointerleave', () => {
    if (!festgehalten) infoZeigen(null);
  });

  // Doppelklick: dorthin fliegen. Auf einen Block, sonst auf den Boden.
  const bodenEbene = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  canvas.addEventListener('dblclick', (e) => {
    const t = blockTreffen(e);
    let punkt = t ? new THREE.Vector3(t.x + 0.5, t.y + 0.5, t.z + 0.5) : null;
    if (!punkt) punkt = strahl.ray.intersectPlane(bodenEbene, new THREE.Vector3());
    if (!punkt) return;
    kf.fokus(punkt);
    zeichnen();
  });

  // ---------- Bedienung ----------

  function modusZeigen() {
    $$('[data-modus]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modus === sicht.modus)));
  }
  function tabZeigen(name) {
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('[data-tafel]').forEach((t) => (t.hidden = t.dataset.tafel !== name));
  }
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => tabZeigen(b.dataset.tab)));
  $$('[data-modus]').forEach((b) =>
    b.addEventListener('click', () => {
      sicht.modus = b.dataset.modus;
      modusZeigen();
      festgehalten = false;
      infoZeigen(null);
      geometrieBauen();
    })
  );
  $$('[data-blick]').forEach((b) => b.addEventListener('click', () => blick(b.dataset.blick)));
  $('[data-auto]').addEventListener('click', () => {
    if (kf.modus === 'auto') {
      kf.modusSetzen('frei');
    } else {
      autoFest = null;
      kf.modusSetzen('auto');
    }
    zeichnen();
  });
  const hilfeKnopf = $('[data-hilfe]');
  const hilfe = $('.bp-hilfe');
  hilfeKnopf.addEventListener('click', () => {
    hilfe.hidden = !hilfe.hidden;
    hilfeKnopf.setAttribute('aria-expanded', String(!hilfe.hidden));
  });
  $('input[type=range]').addEventListener('input', (e) => {
    sicht.ebene = Number(e.target.value);
    ebenenZeigen();
    materialZeigen();
  });
  $('[data-nur]').addEventListener('change', (e) => {
    sicht.nurEbene = e.target.checked;
    ebenenZeigen();
    materialZeigen();
  });
  $$('[data-abschnitt]').forEach((b) =>
    b.addEventListener('change', () => {
      sicht.abschnitte[b.dataset.abschnitt] = b.checked;
      geometrieBauen();
      materialZeigen();
    })
  );


  // ---------- Live: Blöcke ----------
  // Der Live-Raum schickt Blöcke als Plannummern. Website und Mod zählen sie gleich.

  // Frisch gesetzte Blöcke leuchten kurz auf, auch in der Gesamtansicht.
  const BLINK_MAX = 3000;
  const BLINK_MS = 6000;
  const blinkFarbe = { gebaut: new THREE.Color(0x3fd17a), weg: new THREE.Color(0xf2a33c), falsch: new THREE.Color(0xe5392f) };
  const blinkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.06, 1.06, 1.06), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }), BLINK_MAX);
  blinkMesh.frustumCulled = false;
  blinkMesh.count = 0;
  szene.add(blinkMesh);
  let blinker = [];
  const blinkMatrix = new THREE.Matrix4();
  function blinkZeigen() {
    const jetzt = performance.now();
    blinker = blinker.filter((b) => b.bis > jetzt).slice(-BLINK_MAX);
    blinkMesh.count = blinker.length;
    blinker.forEach((b, i) => {
      const y = Math.floor(b.zelle / (X * Z));
      const q = b.zelle % (X * Z);
      blinkMatrix.makeTranslation((q % X) + 0.5, y + 0.5, Math.floor(q / X) + 0.5);
      blinkMesh.setMatrixAt(i, blinkMatrix);
      blinkMesh.setColorAt(i, b.farbe);
    });
    blinkMesh.instanceMatrix.needsUpdate = true;
    if (blinkMesh.instanceColor) blinkMesh.instanceColor.needsUpdate = true;
    zeichnen();
  }
  const blinkTakt = setInterval(() => {
    if (blinker.length) blinkZeigen();
  }, 500);

  // Viele Meldungen, ein Neubau: Ebenen werden je Bild höchstens einmal neu gebaut, die Tafeln viermal pro Sekunde.
  const schmutzigeEbenen = new Set();
  let nachbauGeplant = false;
  let tafelnGeplant = false;
  function nachbauen() {
    if (!nachbauGeplant) {
      nachbauGeplant = true;
      requestAnimationFrame(() => {
        nachbauGeplant = false;
        if (tot) return;
        if (sicht.modus !== 'alles') {
          for (const y of schmutzigeEbenen) {
            for (let i = y * X * Z; i < (y + 1) * X * Z; i++) zelleEinstufen(i);
            stufeFuellen(y, ebeneBauen(y, d));
          }
          renderer.shadowMap.needsUpdate = true;
        }
        schmutzigeEbenen.clear();
        zeichnen();
      });
    }
    if (!tafelnGeplant) {
      tafelnGeplant = true;
      setTimeout(() => {
        tafelnGeplant = false;
        if (tot) return;
        fortschrittZeigen();
        materialZeigen();
      }, 250);
    }
  }

  // s: 0 offen, 1 gebaut, Text = dort steht ein falscher Block
  function blockSetzen(k, s, blinken, jetzt) {
    const zelle = d.nummern[k];
    if (zelle === undefined) return;
    const neu = typeof s === 'string' ? STATUS.falsch : s === 1 ? STATUS.gebaut : STATUS.fehlt;
    if (neu === STATUS.falsch) d.ist.set(zelle, s);
    else d.ist.delete(zelle);
    const alt = d.status[zelle];
    if (neu === alt) return;
    const y = Math.floor(zelle / (X * Z));
    const z = zaehler[y][d.zellen[zelle] - 1];
    if (alt === STATUS.gebaut) z.gebaut--;
    if (neu === STATUS.gebaut) z.gebaut++;
    d.status[zelle] = neu;
    schmutzigeEbenen.add(y);
    if (blinken) blinker.push({ zelle, farbe: neu === STATUS.gebaut ? blinkFarbe.gebaut : neu === STATUS.falsch ? blinkFarbe.falsch : blinkFarbe.weg, bis: jetzt + BLINK_MS });
  }

  function bloeckeAnwenden(liste, blinken) {
    const jetzt = performance.now();
    const vorher = hatDaten;
    for (const [k, s] of liste) blockSetzen(k, s, blinken, jetzt);
    hatDaten = true;
    if (!vorher && sicht.modus !== 'alles') for (let y = 0; y < Y; y++) schmutzigeEbenen.add(y);
    nachbauen();
    if (blinken) blinkZeigen();
  }

  // Ganzer Stand (beim Verbinden oder nach dem Datei-Abgleich): nur Unterschiede anwenden, ohne Blinken.
  function standAnwenden(f) {
    if (!f) return;
    const bits = Uint8Array.from(atob(f.gebaut), (ch) => ch.charCodeAt(0));
    const falsch = new Map();
    for (const [block, liste] of Object.entries(f.falsch)) for (const k of liste) falsch.set(k, block);
    const liste = [];
    for (let k = 0; k < d.anzahl; k++) liste.push([k, falsch.get(k) ?? (bits[k >> 3] & (1 << (k & 7)) ? 1 : 0)]);
    bloeckeAnwenden(liste, false);
  }

  // ---------- Live: Spieler ----------
  // Figuren mit Skin, weich nachgeführt. Positionen kommen mehrmals pro Sekunde.

  const figuren = new Map(); // Name -> { bew, figur, el, hautKey, groesse }
  const online = new Map(); // Name -> { name, mitarbeiter, mit_mod, haut }
  const positionen = new Map(); // Name -> letzte Meldung [Name, x, y, z, Körper, Kopf, Nicken, Merker, Dimension]
  const namenBox = $('.bp-spieler-namen');
  let beobachtet = false;
  let folgeName = null; // Spieler, dem die Kamera im Modus „folgen“ nachgeht
  let autoFest = null; // in der Liste angeklickt: Auto bleibt bei diesem Spieler
  let autoSeit = 0;
  const aktiv = new Map(); // Name -> { gebaut, bewegt } (performance.now)
  // Wem die Kamera gerade folgt, egal ob von Hand oder automatisch.
  const imBild = () => (kf.modus === 'folgen' ? folgeName : kf.modus === 'auto' ? kf.auto.name ?? null : null);

  const aufsPlan = (w) => ({ x: w[1] - anker.x + g.x, y: w[2] - anker.y + g.y, z: w[3] - anker.z + g.z, koerper: w[4], kopf: w[5], nicken: w[6], merker: w[7] });
  const hautVon = (name) => online.get(name)?.haut ?? null;
  const hautSchluessel = (h) => (h ? `${h.hash ?? h.res}|${h.modell}` : 'ersatz');

  async function figurAnlegen(name) {
    const f = figuren.get(name);
    if (!f) return;
    const haut = hautVon(name);
    const key = hautSchluessel(haut);
    f.hautKey = key;
    const bild = (await hautLaden(haut)) ?? ersatzHaut();
    if (tot || figuren.get(name) !== f || f.hautKey !== key) return;
    if (f.figur) {
      szene.remove(f.figur.wurzel);
      f.figur.dispose();
    }
    f.figur = figurBauen(bild, haut?.modell === 'slim');
    szene.add(f.figur.wurzel);
    f.bew.schritt(0, f.figur);
    zeichnen();
  }

  function positionAnwenden(w) {
    const name = w[0];
    positionen.set(name, w);
    if (!anker || w[8] !== 'minecraft:overworld') return figurWeg(name);
    const p = aufsPlan(w);
    const f = figuren.get(name);
    if (f) {
      f.bew.setzen(p);
      if (f.hautKey !== hautSchluessel(hautVon(name))) figurAnlegen(name);
      return;
    }
    const el = document.createElement('span');
    el.className = 'bp-spieler-name';
    el.textContent = name;
    namenBox.append(el);
    figuren.set(name, { bew: new Bewegung(p), figur: null, el, hautKey: null, groesse: 1 });
    figurAnlegen(name);
    listePlanen();
  }

  function figurWeg(name) {
    const f = figuren.get(name);
    if (!f) return;
    if (f.figur) {
      szene.remove(f.figur.wurzel);
      f.figur.dispose();
    }
    f.el.remove();
    figuren.delete(name);
    if (kf.modus === 'folgen' && folgeName === name) kf.modusSetzen('frei');
    listePlanen();
  }

  // Beim Herauszoomen wachsen die Figuren mit, sonst wären sie im Gesamtbild nur Pünktchen.
  function figurenBewegen(dt) {
    let weiter = false;
    const jetzt = performance.now();
    for (const [name, f] of figuren) {
      if (!f.figur) continue;
      if (f.bew.schritt(dt, f.figur)) weiter = true;
      if (f.bew.schwung > 0.15) aktivMerken(name, 'bewegt', jetzt);
      f.groesse = Math.min(6, Math.max(1, kamera.position.distanceTo(f.bew.pos) / 90));
      f.figur.wurzel.scale.setScalar(f.groesse);
    }
    autoWaehlen(jetzt);
    return weiter;
  }

  // ---------- Kamera: Folgen und Auto ----------

  function aktivMerken(name, art, jetzt = performance.now()) {
    if (!name) return;
    const a = aktiv.get(name) ?? { gebaut: -Infinity, bewegt: -Infinity };
    a[art] = jetzt;
    aktiv.set(name, a);
  }
  // Wer gerade baut, zählt wie eine Minute frischer als wer nur läuft.
  const wertung = (name) => {
    const a = aktiv.get(name);
    return a ? Math.max(a.gebaut + 60_000, a.bewegt) : -Infinity;
  };

  // Auto-Kamera: Wen zeigen? Erst wer baut, dann wer läuft. Gewechselt wird frühestens nach 12 Sekunden,
  // damit das Bild nicht hin und her springt.
  function autoWaehlen(jetzt) {
    if (kf.modus !== 'auto') return;
    let name = autoFest && figuren.has(autoFest) ? autoFest : null;
    if (!name) {
      const aktuell = kf.auto.name && figuren.has(kf.auto.name) ? kf.auto.name : null;
      let best = aktuell;
      for (const n of figuren.keys()) if (best === null || wertung(n) > wertung(best)) best = n;
      const bleiben = aktuell && best !== aktuell && (jetzt - autoSeit < 12_000 || wertung(best) < wertung(aktuell) + 5_000);
      name = bleiben ? aktuell : best;
    }
    const bew = name ? figuren.get(name).bew : null;
    if (name === (kf.auto.name ?? null) && kf.auto.ziel === bew) return;
    kf.autoZiel(name, bew);
    autoSeit = jetzt;
    kameraModusZeigen();
    listePlanen();
  }

  // Anzeige unten links und der Auto-Knopf
  const folgenBox = $('.bp-folgen');
  function kameraModusZeigen() {
    const name = imBild();
    $('[data-auto]').setAttribute('aria-pressed', String(kf.modus === 'auto'));
    folgenBox.hidden = kf.modus === 'frei';
    folgenBox.classList.toggle('bp-folgen-auto', kf.modus === 'auto');
    $('[data-folgen-name]').textContent =
      kf.modus === 'auto'
        ? name
          ? `Auto-Kamera · ${name}${autoFest ? ' (fest)' : ''}`
          : 'Auto-Kamera · niemand im Bild'
        : `Kamera folgt ${name ?? ''}`;
    listePlanen();
  }

  // Spieler in der Liste angeklickt: von Hand folgen, oder in Auto diesen Spieler festhalten.
  function spielerGewaehlt(name) {
    if (kf.modus === 'auto') {
      autoFest = autoFest === name ? null : name;
      autoSeit = 0;
      autoWaehlen(performance.now());
      kameraModusZeigen();
      zeichnen();
      return;
    }
    if (kf.modus === 'folgen' && folgeName === name) {
      kf.modusSetzen('frei');
      return;
    }
    const f = figuren.get(name);
    if (!f) return;
    folgeName = name;
    kf.folgen(f.bew);
    kameraModusZeigen();
    zeichnen();
  }
  $('[data-folgen-aus]').addEventListener('click', () => kf.modusSetzen('frei'));

  function spielerNamenZeigen(b, h) {
    for (const f of figuren.values()) {
      hilf.copy(f.bew.pos);
      hilf.y += 2.25 * f.groesse;
      hilf.project(kamera);
      const sichtbar = hilf.z < 1 && Math.abs(hilf.x) < 0.98 && Math.abs(hilf.y) < 0.98;
      f.el.style.display = sichtbar ? '' : 'none';
      if (sichtbar) f.el.style.transform = `translate(${((hilf.x + 1) / 2) * b}px, ${((1 - hilf.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  // ---------- Live: Liste und Feed ----------

  const uhr = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
  const DIMENSION = { 'minecraft:the_nether': 'im Nether', 'minecraft:the_end': 'im End' };
  function wo(s) {
    const w = positionen.get(s.name);
    if (w) return w[8] === 'minecraft:overworld' ? `x ${Math.round(w[1])} · y ${Math.round(w[2])} · z ${Math.round(w[3])}` : (DIMENSION[w[8]] ?? w[8]);
    return s.mit_mod ? '' : 'nicht in Sichtweite';
  }

  let listeGeplant = false;
  function listePlanen() {
    if (listeGeplant) return;
    listeGeplant = true;
    requestAnimationFrame(() => {
      listeGeplant = false;
      if (!tot) listeBauen();
    });
  }
  function listeBauen() {
    const liste = [...online.values()];
    const chip = $('[data-live-chip]');
    chip.textContent = beobachtet ? `${liste.length} online` : 'keine Daten';
    chip.className = `chip ${beobachtet ? 'ok' : 'off'}`;
    const el = $('[data-live-spieler]');
    el.innerHTML = liste.length
      ? `<ul class="bp-spielerliste">${liste.map((s) => `<li><button type="button" data-spieler="${esc(s.name)}" ${figuren.has(s.name) ? '' : 'disabled'} aria-pressed="${imBild() === s.name}" title="${figuren.has(s.name) ? (kf.modus === 'auto' ? 'Auto-Kamera bei diesem Spieler festhalten' : 'Kamera folgt diesem Spieler') : ''}">
            <img class="bp-kopf" data-kopf="${esc(s.name)}" alt="" width="24" height="24">
            <span class="bp-zone-name">${esc(s.name)}${s.mitarbeiter ? ` <span class="muted">(${esc(s.mitarbeiter)})</span>` : ''}<small data-wo="${esc(s.name)}">${esc(wo(s))}</small></span>
            ${s.mit_mod ? '<span class="chip ok bp-mod-chip">Mod</span>' : ''}
          </button></li>`).join('')}</ul>`
      : `<p class="small muted">${beobachtet ? 'Niemand online.' : 'Gerade ist niemand mit der Mod auf dem Server. Sobald jemand mit Bruno Live spielt, siehst du hier alle live.'}</p>`;
    el.querySelectorAll('img[data-kopf]').forEach(async (img) => {
      img.src = await kopfBild(hautVon(img.dataset.kopf));
    });
    el.querySelectorAll('[data-spieler]').forEach((b) => b.addEventListener('click', () => spielerGewaehlt(b.dataset.spieler)));
  }
  // Koordinaten in der Liste: nur den Text tauschen, viermal pro Sekunde.
  let koordinatenGeplant = false;
  function koordinatenPlanen() {
    if (koordinatenGeplant) return;
    koordinatenGeplant = true;
    setTimeout(() => {
      koordinatenGeplant = false;
      if (tot) return;
      wurzel.querySelectorAll('[data-wo]').forEach((el) => {
        const s = online.get(el.dataset.wo);
        if (s) el.textContent = wo(s);
      });
    }, 250);
  }

  const ereignisse = new Map();
  function feedZeigen(neue, ersetzen = false) {
    if (ersetzen) ereignisse.clear();
    for (const e of neue) {
      ereignisse.set(e.id, e);
      if (!ersetzen && e.mc_name) aktivMerken(e.mc_name, 'gebaut');
    }
    const liste = [...ereignisse.values()].sort((a, b) => b.id - a.id).slice(0, 30);
    $('[data-live-feed]').innerHTML = liste.length
      ? liste.map((e) => {
          const teile = [];
          if (e.plus) teile.push(`<b class="bp-plus">+${zahl.format(e.plus)}</b>`);
          if (e.minus) teile.push(`<b class="bp-minus">−${zahl.format(e.minus)}</b>`);
          if (e.falsch) teile.push(`<b class="bp-rot">${zahl.format(e.falsch)} falsch</b>`);
          const bloecke = Object.entries(e.bloecke).slice(0, 3).map(([b, n]) => `${zahl.format(n)} ${esc(blockName(b))}`).join(', ');
          const wer = e.mc_name ? `<b>${esc(e.mc_name)}</b>` : '<b class="muted">Ohne Spieler</b>';
          return `<li><span class="small muted">${uhr.format(new Date(e.am))}</span><span>${wer} ${teile.join(' ')}${bloecke ? `<small>${bloecke}</small>` : ''}</span></li>`;
        }).join('')
      : '<li class="small muted">Noch nichts gemeldet.</li>';
  }

  // ---------- Einmessen ----------
  // Ein einziger Block legt fest, wo das Gebäude in der Welt steht: der unterste an der Nordwest-Ecke.

  const eckeGruppe = new THREE.Group();
  const eckFarbe = 0xffb020;
  const eckRahmen = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.14, 1.14, 1.14)),
    new THREE.LineBasicMaterial({ color: eckFarbe, depthTest: false, transparent: true })
  );
  eckRahmen.position.set(ecke.x + 0.5, ecke.y + 0.5, ecke.z + 0.5);
  eckRahmen.renderOrder = 20;
  const eckSaeule = new THREE.Mesh(new THREE.BoxGeometry(0.4, 70, 0.4), new THREE.MeshBasicMaterial({ color: eckFarbe, transparent: true, opacity: 0.45, depthWrite: false }));
  eckSaeule.position.set(ecke.x + 0.5, ecke.y + 35.5, ecke.z + 0.5);
  const pfeilX = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(ecke.x, ecke.y + 0.1, ecke.z - 3), 26, 0xd8342c, 4, 2.4);
  const pfeilZ = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(ecke.x - 3, ecke.y + 0.1, ecke.z), 26, 0x2e7dd7, 4, 2.4);
  eckeGruppe.add(eckRahmen, eckSaeule, pfeilX, pfeilZ);
  szene.add(eckeGruppe);
  const eckeSchild = $('.bp-anker-schild');
  const pfeilSchilder = [['+X · Osten', ecke.x + 30, ecke.z - 3, 'x'], ['+Z · Süden', ecke.x - 3, ecke.z + 30, 'z']].map(([t, x, z, k]) => {
    const el = document.createElement('span');
    el.className = `bp-pfeil-schild bp-pfeil-${k}`;
    el.textContent = t;
    el.hidden = true;
    buehne.append(el);
    return { el, p: new THREE.Vector3(x, ecke.y + 1, z) };
  });
  let eckeAngefordert = false;
  const eckeSichtbar = () => !anker || eckeAngefordert;
  const schildPos = new THREE.Vector3(ecke.x + 0.5, ecke.y + 4, ecke.z + 0.5);
  function eckeSchildZeigen(b, h) {
    const an = eckeSichtbar();
    eckeGruppe.visible = an;
    eckeSchild.hidden = !an;
    pfeilSchilder.forEach((s) => (s.el.hidden = !an));
    if (!an) return;
    const setzen = (el, p) => {
      hilf.copy(p).project(kamera);
      const sichtbar = hilf.z < 1 && Math.abs(hilf.x) < 1.1 && Math.abs(hilf.y) < 1.1;
      el.style.display = sichtbar ? '' : 'none';
      el.style.transform = `translate(${((hilf.x + 1) / 2) * b}px, ${((1 - hilf.y) / 2) * h}px) translate(-50%, -100%)`;
    };
    setzen(eckeSchild, schildPos);
    pfeilSchilder.forEach((s) => setzen(s.el, s.p));
  }
  function eckeAnsehen() {
    eckeAngefordert = true;
    kf.modusSetzen('frei');
    kf.fliegeZu(new THREE.Vector3(ecke.x + 0.5, ecke.y + 2, ecke.z + 0.5), new THREE.Vector3(ecke.x - 34, ecke.y + 24, ecke.z - 30));
    zeichnen();
  }

  function standortZeigen() {
    const el = $('[data-live-standort]');
    const welt = anker ? `In der Welt steht er bei <b>${anker.x} / ${anker.y} / ${anker.z}</b>.` : 'In der Welt ist er noch nicht eingemessen.';
    const erklaerung = `
      <div class="bp-einmessen">
        <p><b>Eingemessen wird genau ein Block:</b> der unterste an der Nordwest-Ecke des Gebäudes (Plan x 0 · y 0 · z 0), ${esc(blockName(ecke.block))}. ${welt}</p>
        <p class="small">Von dort geht das Gebäude ${g.breite} Blöcke nach Osten (+X), ${g.tiefe} nach Süden (+Z) und ${g.hoehe} nach oben.</p>
        <ol class="small">
          <li>Den Block in der Welt setzen, wo die Ecke hin soll.</li>
          <li>Mit dem Fadenkreuz draufschauen, <kbd>F3</kbd> drücken: Rechts steht <i>Targeted Block</i> mit X, Y, Z.</li>
          <li>Die drei Zahlen hier eintragen. Schneller mit der Mod: draufschauen und <code>/bruno ecke</code> tippen (nur Geschäftsführung).</li>
        </ol>
        <button type="button" class="btn btn-ghost btn-sm" data-ecke-zeigen>Ecke im Modell zeigen</button>
      </div>`;
    const hinweis = anker ? '' : `<p class="bp-falsch">Standort fehlt: Ohne ihn kann die Mod nur melden, wer online ist, aber keine Blöcke.</p>`;
    const adresse = server ? '' : `<p class="bp-falsch">Server fehlt: Ohne Adresse meldet die Mod nichts.</p>`;
    if (!istAdmin) {
      el.innerHTML = `<details class="bp-standort" ${anker ? '' : 'open'}><summary>Standort in der Welt</summary>${hinweis}${adresse}${erklaerung}<p class="small muted">Einmessen kann nur die Geschäftsführung.</p></details>`;
    } else {
      el.innerHTML = `
      <details class="bp-standort" ${anker && server ? '' : 'open'}>
        <summary>Standort und Server</summary>
        ${hinweis}${adresse}${erklaerung}
        <form class="form" data-standort-form>
          <div class="field"><label>Server-Adresse</label><input class="input" name="server" value="${esc(server ?? '')}" placeholder="z. B. bruno.aternos.me" maxlength="200" autocomplete="off"><span class="hint">Nur auf diesem Server meldet die Mod.</span></div>
          <div class="field"><label>Ankerblock in der Welt (X / Y / Z)</label>
            <div class="bp-koordinaten">
              <input class="input" name="x" inputmode="numeric" aria-label="X" placeholder="X" value="${anker?.x ?? ''}">
              <input class="input" name="y" inputmode="numeric" aria-label="Y" placeholder="Y" value="${anker?.y ?? ''}">
              <input class="input" name="z" inputmode="numeric" aria-label="Z" placeholder="Z" value="${anker?.z ?? ''}">
            </div>
            <span class="hint">Haus nicht versetzen, sobald gebaut wird. Beim Ändern beginnt der Live-Stand neu.</span>
          </div>
          <button class="btn btn-primary btn-sm">Speichern</button>
        </form>
      </details>`;
      $('[data-standort-form]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const leer = ['x', 'y', 'z'].every((k) => !String(f.get(k)).trim());
        const neu = leer ? null : { x: Number(f.get('x')), y: Number(f.get('y')), z: Number(f.get('z')) };
        if (JSON.stringify(neu) !== JSON.stringify(anker ?? null) && anker && !confirm('Standort wirklich ändern? Der Live-Stand beginnt dann neu.')) return;
        try {
          await speichern({ anker: neu, server: String(f.get('server')).trim() });
        } catch (ex) {
          toast(ex.message, true);
        }
      });
    }
    // Wer die Einstellung aufklappt, sieht die Ecke im Modell. Zugeklappt verschwindet sie wieder.
    const details = $('.bp-standort');
    details.addEventListener('toggle', () => {
      eckeAngefordert = details.open && !!anker;
      zeichnen();
    });
    if (details.open && anker) eckeAngefordert = true;
    $('[data-ecke-zeigen]').addEventListener('click', eckeAnsehen);
  }

  // ---------- Nachrichten aus dem Live-Raum ----------

  function onlineSetzen(m) {
    beobachtet = !!m.beobachtet;
    online.clear();
    for (const s of m.spieler) online.set(s.name, s);
    for (const [name, f] of figuren) if (f.hautKey !== hautSchluessel(hautVon(name))) figurAnlegen(name);
    listePlanen();
  }

  function liveEmpfangen(m) {
    if (tot) return;
    switch (m.t) {
      case 'online':
        onlineSetzen(m);
        break;
      case 'start': {
        onlineSetzen(m);
        const da = new Set(m.pos.map((w) => w[0]));
        for (const name of [...figuren.keys()]) if (!da.has(name)) figurWeg(name);
        positionen.clear();
        for (const w of m.pos) positionAnwenden(w);
        standAnwenden(m.fortschritt);
        feedZeigen(m.feed, true);
        zeichnen();
        break;
      }
      case 'pos':
        for (const w of m.liste) positionAnwenden(w);
        for (const name of m.weg ?? []) {
          positionen.delete(name);
          figurWeg(name);
        }
        koordinatenPlanen();
        zeichnen();
        break;
      case 'bloecke':
        bloeckeAnwenden(m.liste, !m.sync);
        break;
      case 'stand':
        standAnwenden(m.fortschritt);
        break;
      case 'feed':
        feedZeigen([m.eintrag]);
        break;
      case 'haut':
        hautVergessen(m.res);
        for (const [name, f] of figuren) {
          if (hautVon(name)?.res !== m.res) continue;
          f.hautKey = null;
          figurAnlegen(name);
        }
        listePlanen();
        break;
    }
  }

  function liveGetrennt() {
    const chip = $('[data-live-chip]');
    chip.textContent = 'Verbindung weg …';
    chip.className = 'chip off';
  }

  modusZeigen();
  fortschrittZeigen();
  materialZeigen();
  standortZeigen();
  themaAnwenden();
  anpassen();
  blick('iso', true);
  geometrieBauen();
  liveEmpfangen({ t: 'start', ...start });

  const ende = () => {
    tot = true;
    bauLauf++;
    clearInterval(blinkTakt);
    blinkMesh.geometry.dispose();
    blinkMesh.dispose();
    for (const f of figuren.values()) f.figur?.dispose();
    eckRahmen.geometry.dispose();
    eckSaeule.geometry.dispose();
    document.removeEventListener('thema', themaAnwenden);
    document.removeEventListener('visibilitychange', wiederSichtbar);
    groesse.disconnect();
    kf.dispose();
    atlas.tex.dispose();
    wiese.dispose();
    stufen.forEach((s) => [s.voll, s.deckel, s.glas, s.geist].forEach((gruppe) => gruppe.children.forEach((m) => m.geometry.dispose())));
    renderer.dispose();
    renderer.forceContextLoss();
  };
  return { ende, liveEmpfangen, liveGetrennt };
}
