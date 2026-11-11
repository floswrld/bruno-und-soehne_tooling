// Spielerfigur wie im Spiel: Kopf, Rumpf, Arme, Beine, dazu die zweite Skin-Ebene (Hut, Jacke, Ärmel, Hose).
// Maße in Skin-Pixeln, ein Pixel ist 1/16 Block, die ganze Figur 1,875 Blöcke hoch wie im Spiel.
import * as THREE from '/vendor/three/three.module.min.js';

const PX = 0.9375 / 16;

// Quader mit Skin-Koordinaten wie im Spiel. (u, v) ist die linke obere Ecke des Netzes.
// BoxGeometry hat die Flächen in der Folge +x, −x, +y, −y, +z, −z. Die Figur schaut nach +z.
function quader(w, h, d, u, v, mehr, hoehe, spiegeln) {
  const geo = new THREE.BoxGeometry((w + 2 * mehr) * PX, (h + 2 * mehr) * PX, (d + 2 * mehr) * PX);
  const rechts = [u, v + d, d, h]; // rechte Seite der Figur (−x)
  const links = [u + d + w, v + d, d, h]; // +x
  const oben = [u + d, v, w, d];
  const unten = [u + d + w, v, w, d];
  const vorn = [u + d, v + d, w, h];
  const hinten = [u + 2 * d + w, v + d, w, h];
  const flaechen = spiegeln ? [rechts, links, oben, unten, vorn, hinten] : [links, rechts, oben, unten, vorn, hinten];
  const uv = geo.attributes.uv;
  flaechen.forEach(([x, y, b, hh], f) => {
    let x0 = x / 64;
    let x1 = (x + b) / 64;
    if (spiegeln) [x0, x1] = [x1, x0];
    const y0 = 1 - y / hoehe;
    const y1 = 1 - (y + hh) / hoehe;
    uv.setXY(f * 4, x0, y0);
    uv.setXY(f * 4 + 1, x1, y0);
    uv.setXY(f * 4 + 2, x0, y1);
    uv.setXY(f * 4 + 3, x1, y1);
  });
  return geo;
}

export function figurBauen(bild, slim) {
  const tex = new THREE.Texture(bild);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const hoehe = bild.height;
  const neu = hoehe === 64; // alte Skins (64 x 32) haben keine eigenen linken Gliedmaßen und keine zweite Ebene
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
  const geos = [];

  const gelenk = (eltern, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x * PX, y * PX, z * PX);
    eltern.add(g);
    return g;
  };
  const stueck = (eltern, w, h, d, u, v, dy, mehr = 0, spiegeln = false) => {
    const geo = quader(w, h, d, u, v, mehr, hoehe, spiegeln);
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = dy * PX;
    eltern.add(m);
    return m;
  };

  const wurzel = new THREE.Group(); // an den Füßen, dreht mit dem Körper
  const beinR = gelenk(wurzel, -2, 12, 0);
  const beinL = gelenk(wurzel, 2, 12, 0);
  stueck(beinR, 4, 12, 4, 0, 16, -6);
  if (neu) {
    stueck(beinR, 4, 12, 4, 0, 32, -6, 0.25);
    stueck(beinL, 4, 12, 4, 16, 48, -6);
    stueck(beinL, 4, 12, 4, 0, 48, -6, 0.25);
  } else {
    stueck(beinL, 4, 12, 4, 0, 16, -6, 0, true);
  }

  const oben = gelenk(wurzel, 0, 12, 0); // Oberkörper, kippt beim Schleichen an der Hüfte
  stueck(oben, 8, 12, 4, 16, 16, 6);
  if (neu) stueck(oben, 8, 12, 4, 16, 32, 6, 0.25);
  const aw = slim ? 3 : 4;
  const armR = gelenk(oben, -(4 + aw / 2), 10, 0);
  const armL = gelenk(oben, 4 + aw / 2, 10, 0);
  stueck(armR, aw, 12, 4, 40, 16, -4);
  if (neu) {
    stueck(armR, aw, 12, 4, 40, 32, -4, 0.25);
    stueck(armL, aw, 12, 4, 32, 48, -4);
    stueck(armL, aw, 12, 4, 48, 48, -4, 0.25);
  } else {
    stueck(armL, aw, 12, 4, 40, 16, -4, 0, true);
  }
  const kopf = gelenk(oben, 0, 12, 0);
  stueck(kopf, 8, 8, 8, 0, 0, 4);
  stueck(kopf, 8, 8, 8, 32, 0, 4, 0.5);

  return {
    wurzel,
    teile: { oben, kopf, armR, armL, beinR, beinL },
    dispose() {
      geos.forEach((g) => g.dispose());
      mat.dispose();
      tex.dispose();
    },
  };
}

const RAD = Math.PI / 180;
// Kürzester Weg zwischen zwei Winkeln (Grad)
const winkelDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

// Bewegung und Haltung. ziel kommt aus den Meldungen, gezeigt wird weich nachgeführt.
export class Bewegung {
  constructor(w) {
    this.pos = new THREE.Vector3(w.x, w.y, w.z);
    this.ziel = { ...w };
    this.koerper = w.koerper;
    this.kopf = w.kopf;
    this.nicken = w.nicken;
    this.phase = 0;
    this.schwung = 0; // wie stark die Beine schwingen
    this.schlag = 0; // Armschwung beim Bauen
  }

  setzen(w) {
    // Sprung (Teleport): nicht durch die Gegend gleiten
    if (Math.hypot(w.x - this.pos.x, w.y - this.pos.y, w.z - this.pos.z) > 24) this.pos.set(w.x, w.y, w.z);
    if (w.merker & 4 && !(this.ziel.merker & 4)) this.schlag = 1;
    this.ziel = { ...w };
  }

  // dt in Sekunden. Gibt zurück, ob sich noch etwas bewegt.
  schritt(dt, f) {
    const k = 1 - Math.exp(-dt * 14);
    const vorher = this.pos.clone();
    this.pos.x += (this.ziel.x - this.pos.x) * k;
    this.pos.y += (this.ziel.y - this.pos.y) * k;
    this.pos.z += (this.ziel.z - this.pos.z) * k;
    this.koerper += winkelDiff(this.koerper, this.ziel.koerper) * k;
    this.kopf += winkelDiff(this.kopf, this.ziel.kopf) * k;
    this.nicken += (this.ziel.nicken - this.nicken) * k;
    const weg = Math.hypot(this.pos.x - vorher.x, this.pos.z - vorher.z);
    const tempo = dt > 0 ? weg / dt : 0;
    this.schwung += (Math.min(1, tempo / 4.3) - this.schwung) * Math.min(1, dt * 10);
    this.phase += weg * 2.66;
    if (this.schlag > 0) this.schlag = Math.max(0, this.schlag - dt * 3.3);
    else if (this.ziel.merker & 4) this.schlag = 1;

    const m = this.ziel.merker;
    const t = f.teile;
    f.wurzel.position.copy(this.pos);
    f.wurzel.rotation.set(m & 8 ? 1.2 : 0, -this.koerper * RAD, 0, 'YXZ'); // Elytra: liegend, Kopf voraus
    const schleicht = !!(m & 1);
    f.wurzel.position.y -= schleicht ? 0.12 : 0;
    t.oben.rotation.x = schleicht ? 0.45 : 0;
    t.kopf.rotation.set((this.nicken * RAD) - (schleicht ? 0.45 : 0), -winkelDiff(this.koerper, this.kopf) * RAD, 0, 'YXZ');
    const bein = Math.cos(this.phase) * 1.4 * this.schwung * 0.6;
    const arm = Math.cos(this.phase + Math.PI) * this.schwung * 0.8;
    if (m & 16) {
      // sitzt (Boot, Lore, Pferd)
      t.beinR.rotation.set(-1.4, 0.3, 0);
      t.beinL.rotation.set(-1.4, -0.3, 0);
      t.armR.rotation.x = -0.6;
      t.armL.rotation.x = -0.6;
    } else {
      t.beinR.rotation.set(bein, 0, 0);
      t.beinL.rotation.set(-bein, 0, 0);
      t.armR.rotation.x = arm - Math.sin(this.schlag * Math.PI) * 1.3;
      t.armL.rotation.x = -arm;
    }
    t.armR.rotation.z = 0.06;
    t.armL.rotation.z = -0.06;
    const rest = Math.hypot(this.ziel.x - this.pos.x, this.ziel.y - this.pos.y, this.ziel.z - this.pos.z);
    return rest > 0.002 || this.schwung > 0.01 || this.schlag > 0 || Math.abs(winkelDiff(this.koerper, this.ziel.koerper)) > 0.2 || Math.abs(winkelDiff(this.kopf, this.ziel.kopf)) > 0.2;
  }
}
