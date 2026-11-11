// Skins der Spieler: laden, Kopf als Listenbild, Ersatz, wenn es keinen gibt.
// Echte Skins holt der Worker bei Mojang (/api/live/haut/<hash>), Standard-Skins schickt die Mod mit.

const bilder = new Map(); // Adresse -> Promise<HTMLImageElement | null>
const koepfe = new Map(); // Adresse -> Promise<string>

export function hautUrl(haut) {
  if (haut?.hash) return `/api/live/haut/${haut.hash}`;
  if (haut?.res) return `/api/live/haut?res=${encodeURIComponent(haut.res)}`;
  return null;
}

// Neu laden, z. B. wenn die Mod einen Standard-Skin gerade erst geschickt hat.
export function hautVergessen(res) {
  for (const key of [...bilder.keys()]) if (key.includes(encodeURIComponent(res))) bilder.delete(key);
  for (const key of [...koepfe.keys()]) if (key.includes(encodeURIComponent(res))) koepfe.delete(key);
}

export function hautLaden(haut) {
  const url = hautUrl(haut);
  if (!url) return Promise.resolve(null);
  if (!bilder.has(url)) {
    bilder.set(url, new Promise((fertig) => {
      const img = new Image();
      img.onload = () => fertig(img.naturalWidth === 64 && (img.naturalHeight === 64 || img.naturalHeight === 32) ? img : null);
      img.onerror = () => {
        bilder.delete(url);
        fertig(null);
      };
      img.src = url;
    }));
  }
  return bilder.get(url);
}

// Schlichte Figur, falls es keinen Skin gibt: Haut, dunkles Haar, Hemd in Messing, graue Hose.
let ersatz = null;
export function ersatzHaut() {
  if (ersatz) return ersatz;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const f = (farbe, x, y, b, h) => {
    g.fillStyle = farbe;
    g.fillRect(x, y, b, h);
  };
  const haut = '#d9a77e';
  const haar = '#3b2a20';
  const hemd = '#b8893c';
  const hose = '#4a5160';
  const schuh = '#2a2d33';
  f(haut, 0, 0, 32, 16); // Kopf
  f(haar, 8, 0, 8, 8); // Scheitel
  for (const x of [0, 8, 16, 24]) f(haar, x, 8, 8, 2); // Haaransatz rundum
  f(haar, 24, 8, 8, 8); // Hinterkopf
  f('#ffffff', 9, 12, 2, 1);
  f('#ffffff', 13, 12, 2, 1);
  f('#2b3a55', 10, 12, 1, 1);
  f('#2b3a55', 13, 12, 1, 1);
  f('#a8735a', 11, 14, 2, 1);
  f(hemd, 16, 16, 24, 16); // Rumpf
  f(hemd, 40, 16, 16, 16); // rechter Arm
  f(hemd, 32, 48, 16, 16); // linker Arm
  f(haut, 40, 26, 16, 6);
  f(haut, 32, 58, 16, 6);
  f(hose, 0, 16, 16, 16); // rechtes Bein
  f(hose, 16, 48, 16, 16); // linkes Bein
  f(schuh, 0, 29, 16, 3);
  f(schuh, 16, 61, 16, 3);
  ersatz = c;
  return c;
}

// Gesicht mit Hut-Ebene, als Bild-Adresse fürs <img>.
export function kopfBild(haut) {
  const url = hautUrl(haut) ?? 'ersatz';
  if (!koepfe.has(url)) {
    koepfe.set(url, (async () => {
      const bild = (await hautLaden(haut)) ?? ersatzHaut();
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const g = c.getContext('2d');
      g.drawImage(bild, 8, 8, 8, 8, 0, 0, 8, 8);
      g.drawImage(bild, 40, 8, 8, 8, 0, 0, 8, 8);
      return c.toDataURL();
    })());
  }
  return koepfe.get(url);
}

// Füllt alle <img data-kopf="…"> in el, sobald die Bilder da sind.
export function koepfeFuellen(el, spieler) {
  const nachName = new Map(spieler.map((s) => [s.name, s]));
  el.querySelectorAll('img[data-kopf]').forEach(async (img) => {
    const s = nachName.get(img.dataset.kopf);
    img.src = await kopfBild(s?.haut);
  });
}
