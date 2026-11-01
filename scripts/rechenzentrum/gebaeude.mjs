// Gebäudehülle: 120 x 200 x 40, innen hohl. Der Innenausbau ist Sache des Teams.
// Modern und klar: Sockel aus Graphit mit Lüftungsband, darüber ein weißer Baukörper mit schmalen
// Fensterschlitzen, abgesetzt durch Schattenfugen. Ecken und Mittelteil aus dunklem Glas. Kein Kupfer.
import { BAU, box, leeren, rnd, set, stoff } from './raster.mjs';
import { kleinesLogo } from './logo.mjs';

const m = stoff('gebaeude');
const S = {
  schattenfuge: m('Schattenfuge', 'black_concrete'),
  graphit: m('Sockelband', 'gray_concrete'),
  graphitFuge: m('Sockelband', 'black_concrete'),
  weiss: m('Fassadenfläche', 'white_concrete'),
  weissFuge: m('Fassadenfuge', 'iron_block'),
  licht: m('Lichtlinie', 'sea_lantern'),
  gitter: m('Lüftungsband', 'iron_bars'),
  gitterDunkel: m('Lüftungsband', 'black_concrete'),
  schlitz: m('Fensterschlitz', 'tinted_glass'),
  hinterwand: m('Hinterwand', 'gray_concrete'),
  attika: m('Attika', 'gray_concrete'),
  deckel: m('Attikadeckel', 'iron_block'),
  eckGlas: m('Eckverglasung', 'tinted_glass'),
  eckProfil: m('Eckverglasung', 'black_concrete'),
  glas: m('Glasfront', 'gray_stained_glass'),
  glasDunkel: m('Glasfront', 'tinted_glass'),
  profil: m('Glasfront-Profil', 'black_concrete'),
  logoGrund: m('Logofläche', 'white_concrete'),
  logo: m('Logo', 'black_concrete'),
  torRahmen: m('Torrahmen', 'gray_concrete'),
  tor: m('Sektionaltor', 'iron_block'),
  torFuge: m('Sektionaltor', 'white_concrete'),
  puffer: m('Rampenpuffer', 'black_wool'),
  tuerGlas: m('Eingang', 'glass_pane'),
  tuerRahmen: m('Eingang', 'black_concrete'),
};

const ECKE = 8; // Breite der Eckverglasung entlang der Wand
const FELD = 12;

// Jede Wand mit eigener Zählrichtung: u wächst von außen gesehen immer nach rechts.
// d ist die Tiefe: 0 = äußerste Schicht, 2 = Innenseite.
const WAENDE = {
  west: { L: BAU.z, put: (u, y, d, c) => set(d, y, u, c) },
  ost: { L: BAU.z, put: (u, y, d, c) => set(BAU.x - 1 - d, y, BAU.z - 1 - u, c) },
  nord: { L: BAU.x, put: (u, y, d, c) => set(BAU.x - 1 - u, y, d, c) },
  sued: { L: BAU.x, put: (u, y, d, c) => set(u, y, BAU.z - 1 - d, c) },
};

function fassade(name, seite) {
  const { L, put } = WAENDE[name];
  // Das Mittelteil der Längsseiten ist eine durchgehende Glasfront
  const langseite = name === 'west' || name === 'ost';
  const glasVon = langseite ? 86 : -1;
  const glasBis = langseite ? 113 : -1;
  for (let u = 0; u < L; u++) {
    const ecke = u < ECKE || u >= L - ECKE;
    const imGlas = u >= glasVon && u <= glasBis;
    const feld = Math.floor((u - ECKE) / FELD);
    const i = (u - ECKE) % FELD;
    // Fensterschlitze: je Feld einer, unregelmäßig gesetzt, abwechselnd schmal und breit
    const schlitzAb = 2 + Math.floor(rnd(feld, 0, seite, 3) * 7);
    const schlitzBreit = rnd(feld, 1, seite, 3) < 0.35 ? 2 : 1;
    const schlitz = i >= schlitzAb && i < schlitzAb + schlitzBreit;

    for (let y = 0; y <= 39; y++) {
      // Attika mit hellem Deckel, oben durchgehend
      if (y === 39) { for (const d of [0, 1, 2]) put(u, y, d, S.deckel); continue; }
      if (y >= 36) { for (const d of [0, 1, 2]) put(u, y, d, S.attika); continue; }
      // Schattenfuge unter der Attika: Das Dach scheint zu schweben
      if (y === 35) { put(u, y, 0, 0); put(u, y, 1, S.schattenfuge); put(u, y, 2, S.hinterwand); continue; }

      if (ecke) {
        const k = u < ECKE ? u : L - 1 - u;
        const senkrecht = k % 4 === 0;
        // Außen nur die senkrechten Profile: Waagerechte würden an der Ecke wie Zinnen aussehen.
        put(u, y, 0, senkrecht ? S.eckProfil : 0);
        put(u, y, 1, senkrecht || (y - 1) % 6 === 0 || y === 0 ? S.eckProfil : S.eckGlas);
        put(u, y, 2, S.eckProfil);
        continue;
      }
      if (imGlas) {
        const k = u - glasVon;
        const profil = k % 4 === 0 || (y - 1) % 6 === 0 || y === 0;
        put(u, y, 0, k % 4 === 0 && y > 0 ? S.profil : 0);
        put(u, y, 1, profil ? S.profil : rnd(u, y, seite, 5) < 0.3 ? S.glasDunkel : S.glas);
        put(u, y, 2, 0);
        continue;
      }
      if (y === 0) { for (const d of [0, 1, 2]) put(u, y, d, S.schattenfuge); continue; }
      // Sockelband aus Graphit, darin ein Lüftungsband
      if (y <= 11) {
        const lueftung = y >= 4 && y <= 8 && i >= 2;
        if (lueftung) { put(u, y, 0, 0); put(u, y, 1, S.gitter); put(u, y, 2, S.gitterDunkel); continue; }
        put(u, y, 0, i === 0 ? S.graphitFuge : S.graphit);
        put(u, y, 1, S.graphit);
        put(u, y, 2, S.hinterwand);
        continue;
      }
      // Lichtlinie in der Schattenfuge zwischen Sockel und weißem Baukörper
      if (y === 12) { put(u, y, 0, 0); put(u, y, 1, S.licht); put(u, y, 2, S.hinterwand); continue; }
      // Weißer Baukörper
      if (schlitz && y >= 15 && y <= 33) { put(u, y, 0, 0); put(u, y, 1, S.schlitz); put(u, y, 2, S.hinterwand); continue; }
      const fuge = i === 0 || (y - 13) % 8 === 7;
      put(u, y, 0, fuge ? S.weissFuge : S.weiss);
      put(u, y, 1, S.weiss);
      put(u, y, 2, S.hinterwand);
    }
  }
}

// Logo: oben links auf der Wand, von außen gelesen. Schwarz direkt auf Weiß, ohne Tafel.
function logo(name) {
  const { put } = WAENDE[name];
  const F = kleinesLogo();
  const u0 = ECKE + 3;
  const obenY = 33;
  for (let r = -1; r <= F.length; r++) {
    for (let k = -2; k <= F[0].length + 1; k++) {
      const y = obenY - r;
      const an = r >= 0 && r < F.length && k >= 0 && k < F[0].length && F[r][k];
      put(u0 + k, y, 0, an ? S.logo : S.logoGrund);
      put(u0 + k, y, 1, S.logoGrund);
    }
  }
}

// Ladetore im Nordteil der Westwand
function ladetore() {
  for (let i = 0; i < 4; i++) {
    const z0 = 11 + i * 6;
    box(0, 0, z0 - 1, 2, 7, z0 + 4, S.torRahmen);
    leeren(0, 1, z0, 2, 5, z0 + 3);
    // Sektionaltor mit waagerechten Fugen, das zweite steht offen
    if (i !== 1) box(1, 1, z0, 1, 5, z0 + 3, (x, y) => (y % 2 ? S.tor : S.torFuge));
    box(0, 0, z0 - 1, 0, 2, z0 - 1, S.puffer);
    box(0, 0, z0 + 4, 0, 2, z0 + 4, S.puffer);
  }
}

// Eingang West in der Glasfront, großes Tor im Süden
function eingaenge() {
  leeren(0, 1, 98, 2, 4, 103);
  box(1, 5, 97, 1, 5, 104, S.tuerRahmen);
  for (const z of [97, 104]) box(1, 1, z, 1, 4, z, S.tuerRahmen);
  for (const z of [98, 103]) box(1, 1, z, 1, 4, z, S.tuerGlas);

  const y1 = 8;
  box(52, 1, BAU.z - 3, 67, y1 + 1, BAU.z - 1, S.torRahmen);
  leeren(54, 0, BAU.z - 3, 65, y1, BAU.z - 1);
  box(54, 5, BAU.z - 2, 65, y1, BAU.z - 2, (x, y) => (x % 3 === 0 || y === y1 ? S.tuerRahmen : S.glas));
  for (const x of [54, 55, 64, 65]) box(x, 1, BAU.z - 2, x, 4, BAU.z - 2, S.tuerGlas);
}

export function gebaeudeBauen() {
  Object.keys(WAENDE).forEach((name, i) => fassade(name, i + 1));
  logo('west');
  logo('ost');
  ladetore();
  eingaenge();
}
