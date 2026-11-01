// Bildmarke und Schriftzug als Pixelfläche. Die Bildmarke entspricht public/index.html (viewBox 200):
// Ringe und Tropfen, die Racks sind ausgestanzt.

function tropfenUmriss() {
  const kubisch = (a, b, c, d, t) => {
    const s = 1 - t;
    return [0, 1].map((i) => s * s * s * a[i] + 3 * s * s * t * b[i] + 3 * s * t * t * c[i] + t * t * t * d[i]);
  };
  const p = [];
  for (let t = 0; t <= 1; t += 0.01) p.push(kubisch([100, 18], [100, 18], [38, 96], [38, 136], t));
  for (let w = Math.PI; w >= 0; w -= 0.02) p.push([100 + 62 * Math.cos(w), 136 + 62 * Math.sin(w)]);
  for (let t = 0; t <= 1; t += 0.01) p.push(kubisch([162, 136], [162, 96], [100, 18], [100, 18], t));
  return p;
}
const TROPFEN = tropfenUmriss();
function imTropfen(u, v) {
  let drin = false;
  for (let i = 0, j = TROPFEN.length - 1; i < TROPFEN.length; j = i++) {
    const [ax, ay] = TROPFEN[i];
    const [bx, by] = TROPFEN[j];
    if (ay > v !== by > v && u < ((bx - ax) * (v - ay)) / (by - ay) + ax) drin = !drin;
  }
  return drin;
}
const RACKS = [98, 122, 146, 170];

// Pixel der Bildmarke bei Durchmesser d, abgetastet in der Pixelmitte.
function bildmarke(d) {
  const s = d / 200;
  const halb = 0.5 / s;
  const zeilen = [];
  for (let py = 0; py < d; py++) {
    const zeile = [];
    for (let px = 0; px < d; px++) {
      const u = (px + 0.5) / s;
      const v = (py + 0.5) / s;
      const r = Math.hypot(u - 100, v - 100);
      let an = Math.abs(r - 96) <= Math.max(1.5, halb);
      if (imTropfen(u, v)) an = !RACKS.some((y) => v >= y && v < y + 18);
      zeile.push(an);
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

const SCHRIFT = {
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  S: ['###', '#..', '###', '..#', '###'],
  Ö: ['#.#', '...', '###', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
  ' ': ['..', '..', '..', '..', '..'],
};

function schriftzug(text) {
  const zeilen = Array.from({ length: 5 }, () => []);
  [...text].forEach((ch, i) => {
    if (i > 0) for (const z of zeilen) z.push(false);
    SCHRIFT[ch].forEach((reihe, r) => {
      for (const c of reihe) zeilen[r].push(c === '#');
    });
  });
  return zeilen;
}

// Kleines Logo: Bildmarke links, rechts daneben zwei Textzeilen übereinander. Höhe 11, Breite 40.
export function kleinesLogo() {
  const d = 11;
  const marke = bildmarke(d);
  const z1 = schriftzug('BRUNO');
  const z2 = schriftzug('& SÖHNE');
  const links = d + 2;
  const breite = links + Math.max(z1[0].length, z2[0].length);
  const flaeche = Array.from({ length: d }, () => Array(breite).fill(false));
  marke.forEach((zeile, y) => zeile.forEach((an, x) => (flaeche[y][x] = an)));
  z1.forEach((zeile, y) => zeile.forEach((an, x) => (flaeche[y][links + x] = an)));
  z2.forEach((zeile, y) => zeile.forEach((an, x) => (flaeche[6 + y][links + x] = an)));
  return flaeche;
}
