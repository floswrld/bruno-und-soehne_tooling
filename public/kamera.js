// Kameraführung für den Bauplan: Maus, Touch und Tastatur, weiche Flüge, Folgen und Auto-Kamera.
//
//   Frei     Ziehen dreht, rechte Maustaste (oder Shift) verschiebt über den Boden, Rad zoomt zur Maus hin.
//            WASD/Pfeile fahren, Q/E drehen, R/F zoomen, Shift macht schneller. Alles gleitet weich aus.
//   Folgen   Die Ansicht wandert mit einem Spieler mit, drehen und zoomen geht weiter.
//   Auto     Die Kamera hängt hinter einem Spieler und schaut mit ihm. Wer gerade baut, kommt ins Bild.
//            Steht er still, kreist sie langsam um ihn. Ziehen schaut sich um, das Rad ändert den Abstand.
import * as THREE from '/vendor/three/three.module.min.js';
import { OrbitControls } from '/vendor/three/OrbitControls.js';

const RAD = Math.PI / 180;
const glatt = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const winkelDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
const imEingabefeld = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export class Kamerafuehrung {
  constructor(kamera, element, { mitte, beiAenderung, beiModus }) {
    this.kamera = kamera;
    this.element = element;
    this.mitte = mitte;
    this.beiModus = beiModus;
    const o = new OrbitControls(kamera, element);
    o.enableDamping = true;
    o.dampingFactor = 0.085;
    o.zoomToCursor = true;
    o.screenSpacePanning = false; // verschieben über den Boden, nicht in die Höhe
    o.rotateSpeed = 0.75;
    o.zoomSpeed = 1.15;
    o.maxPolarAngle = Math.PI / 2 - 0.02;
    o.minDistance = 3;
    o.maxDistance = 1800;
    o.target.copy(mitte);
    o.addEventListener('change', beiAenderung);
    o.addEventListener('start', () => {
      this.flug = null;
      this.greift = true;
    });
    o.addEventListener('end', () => (this.greift = false));
    this.o = o;

    this.modus = 'frei'; // frei | folgen | auto
    this.flug = null;
    this.greift = false;
    this.tasten = new Set();
    this.folgeZiel = null; // Bewegung des Spielers, dem gefolgt wird
    this.folgeLetzte = new THREE.Vector3();
    this.auto = { ziel: null, yaw: 0, dreh: 0, neigung: 0, abstand: 16, handAm: 0, stillSeit: 0, rund: 0 };
    this.hilf = new THREE.Vector3();
    this.hilf2 = new THREE.Vector3();

    // Tastatur: nur wenn die Seite sichtbar ist und niemand in ein Feld tippt.
    this.taste = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || imEingabefeld(e.target) || !this.element.isConnected) return;
      const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
      if (e.type === 'keydown') {
        if (/^(w|a|s|d|arrow)/.test(k) && this.modus !== 'frei') this.modusSetzen('frei');
        this.tasten.add(k);
        this.flug = null;
        beiAenderung();
      } else {
        this.tasten.delete(k);
      }
      e.preventDefault();
    };
    this.shift = false;
    this.shiftTaste = (e) => (this.shift = e.shiftKey);
    this.losgelassen = () => this.tasten.clear();
    window.addEventListener('keydown', this.taste);
    window.addEventListener('keyup', this.taste);
    window.addEventListener('keydown', this.shiftTaste);
    window.addEventListener('keyup', this.shiftTaste);
    window.addEventListener('blur', this.losgelassen);

    // Auto-Kamera: eigene Maus- und Radsteuerung, die OrbitControls ruhen solange.
    this.ziehen = null;
    this.runter = (e) => {
      if (this.modus !== 'auto') return;
      this.ziehen = [e.clientX, e.clientY];
      element.setPointerCapture?.(e.pointerId);
    };
    this.bewegt = (e) => {
      if (this.modus !== 'auto' || !this.ziehen) return;
      const dx = e.clientX - this.ziehen[0];
      const dy = e.clientY - this.ziehen[1];
      this.ziehen = [e.clientX, e.clientY];
      this.auto.dreh -= dx * 0.008;
      this.auto.neigung = Math.min(1.6, Math.max(-0.25, this.auto.neigung + dy * 0.004));
      this.auto.handAm = performance.now();
      beiAenderung();
    };
    this.hoch = () => {
      this.ziehen = null;
      this.auto.handAm = performance.now();
    };
    this.rad = (e) => {
      if (this.modus !== 'auto') return;
      e.preventDefault();
      this.auto.abstand = Math.min(120, Math.max(4, this.auto.abstand * Math.exp(Math.sign(e.deltaY) * 0.12)));
      this.auto.handAm = performance.now();
      beiAenderung();
    };
    element.addEventListener('pointerdown', this.runter);
    element.addEventListener('pointermove', this.bewegt);
    element.addEventListener('pointerup', this.hoch);
    element.addEventListener('pointercancel', this.hoch);
    element.addEventListener('wheel', this.rad, { passive: false });
  }

  get ziel() {
    return this.o.target;
  }

  modusSetzen(modus) {
    if (this.modus === modus) return;
    this.modus = modus;
    this.o.enabled = modus !== 'auto';
    if (modus !== 'folgen') this.folgeZiel = null;
    if (modus === 'auto') {
      // Von der jetzigen Blickrichtung aus weich in die Verfolgung gleiten.
      this.flug = null;
      this.auto.ziel = null;
      this.auto.dreh = 0;
      this.auto.neigung = 0;
      this.auto.stillSeit = performance.now();
      this.auto.rund = Math.atan2(this.kamera.position.x - this.mitte.x, -(this.kamera.position.z - this.mitte.z));
    }
    this.beiModus?.(modus);
  }

  // Weich von hier nach dort: Blickpunkt und Kameraposition.
  fliegeZu(ziel, pos, dauer = 0.9) {
    if (this.modus === 'auto') this.modusSetzen('frei');
    this.flug = { a: { ziel: this.o.target.clone(), pos: this.kamera.position.clone() }, b: { ziel: ziel.clone(), pos: pos.clone() }, t: 0, dauer };
  }

  sofort(ziel, pos) {
    this.flug = null;
    this.o.target.copy(ziel);
    this.kamera.position.copy(pos);
    this.o.update();
  }

  // Hinfliegen und den Blickwinkel behalten, nur näher ran.
  fokus(punkt, maxAbstand = 60) {
    const richtung = this.hilf.copy(this.kamera.position).sub(this.o.target);
    richtung.setLength(Math.min(richtung.length(), maxAbstand));
    this.modusSetzen('frei');
    this.fliegeZu(punkt, punkt.clone().add(richtung));
  }

  folgen(bewegung) {
    this.modusSetzen('folgen');
    this.folgeZiel = bewegung;
    this.folgeLetzte.copy(bewegung.pos);
    const p = bewegung.pos;
    this.fliegeZu(new THREE.Vector3(p.x, p.y + 1, p.z), new THREE.Vector3(p.x - 22, p.y + 16, p.z + 22));
  }

  // Ein Bild weiter. Gibt zurück, ob noch etwas in Bewegung ist.
  update(dt) {
    let weiter = false;
    const o = this.o;
    const kam = this.kamera;

    if (this.modus === 'folgen' && this.folgeZiel) {
      const delta = this.hilf.copy(this.folgeZiel.pos).sub(this.folgeLetzte);
      this.folgeLetzte.copy(this.folgeZiel.pos);
      if (delta.lengthSq() > 0) {
        o.target.add(delta);
        kam.position.add(delta);
        if (this.flug) for (const p of [this.flug.a.ziel, this.flug.a.pos, this.flug.b.ziel, this.flug.b.pos]) p.add(delta);
        weiter = true;
      }
    }

    if (this.flug) {
      const f = this.flug;
      f.t = Math.min(1, f.t + dt / f.dauer);
      const k = glatt(f.t);
      o.target.lerpVectors(f.a.ziel, f.b.ziel, k);
      kam.position.lerpVectors(f.a.pos, f.b.pos, k);
      if (f.t >= 1) this.flug = null;
      weiter = true;
    }

    if (this.tasten.size) {
      this.tastenFahren(dt);
      weiter = true;
    }

    if (this.modus === 'auto') {
      this.autoFahren(dt);
      return true;
    }
    return o.update() || weiter || this.greift;
  }

  tastenFahren(dt) {
    const t = this.tasten;
    const o = this.o;
    const kam = this.kamera;
    const schnell = this.shift ? 3 : 1;
    if (this.modus === 'auto') {
      if (t.has('q')) this.auto.dreh += dt * 1.4;
      if (t.has('e')) this.auto.dreh -= dt * 1.4;
      if (t.has('r')) this.auto.abstand = Math.max(4, this.auto.abstand * Math.exp(-dt * 1.5));
      if (t.has('f')) this.auto.abstand = Math.min(120, this.auto.abstand * Math.exp(dt * 1.5));
      this.auto.handAm = performance.now();
      return;
    }
    const abstand = kam.position.distanceTo(o.target);
    const vor = this.hilf.copy(o.target).sub(kam.position).setY(0);
    if (vor.lengthSq() < 1e-6) vor.set(0, 0, -1);
    vor.normalize();
    const rechts = this.hilf2.set(-vor.z, 0, vor.x);
    const tempo = Math.max(10, abstand * 0.5) * schnell * dt;
    let dx = 0;
    let dz = 0;
    if (t.has('w') || t.has('arrowup')) dz += 1;
    if (t.has('s') || t.has('arrowdown')) dz -= 1;
    if (t.has('d') || t.has('arrowright')) dx += 1;
    if (t.has('a') || t.has('arrowleft')) dx -= 1;
    if (dx || dz) {
      const weg = vor.multiplyScalar(dz * tempo).add(rechts.multiplyScalar(dx * tempo));
      o.target.add(weg);
      kam.position.add(weg);
    }
    const dreh = (t.has('q') ? 1 : 0) - (t.has('e') ? 1 : 0);
    if (dreh) {
      const rel = kam.position.clone().sub(o.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, dreh * dt * 1.3 * schnell);
      kam.position.copy(o.target).add(rel);
    }
    const zoom = (t.has('f') ? 1 : 0) - (t.has('r') ? 1 : 0);
    if (zoom) {
      const rel = kam.position.clone().sub(o.target);
      rel.setLength(Math.min(o.maxDistance, Math.max(o.minDistance, rel.length() * Math.exp(zoom * dt * 1.6 * schnell))));
      kam.position.copy(o.target).add(rel);
    }
  }

  // Hinter dem Spieler, mit seiner Blickrichtung. Ohne Spieler kreist sie langsam ums Gebäude.
  autoFahren(dt) {
    const a = this.auto;
    const kam = this.kamera;
    const o = this.o;
    const jetzt = performance.now();
    const b = a.ziel;
    let soll;
    let blick;
    if (!b) {
      a.rund += dt * 0.06;
      const r = 300;
      soll = this.hilf.set(this.mitte.x + Math.sin(a.rund) * r, this.mitte.y + 150, this.mitte.z - Math.cos(a.rund) * r);
      blick = this.hilf2.copy(this.mitte);
    } else {
      if (b.schwung > 0.1) a.stillSeit = jetzt;
      const still = jetzt - a.stillSeit > 3000;
      const hand = jetzt - a.handAm < 2500;
      a.yaw += winkelDiff(a.yaw, b.koerper) * (1 - Math.exp(-dt * 1.6));
      // Steht er still, kreist die Kamera langsam um ihn. Läuft er los, schwenkt sie zurück hinter ihn.
      if (still && !hand) a.dreh += dt * 0.12;
      else if (!still && !hand) a.dreh *= Math.exp(-dt * 1.1);
      const w = a.yaw * RAD + a.dreh;
      const hoehe = a.abstand * (0.38 + a.neigung);
      soll = this.hilf.set(b.pos.x + Math.sin(w) * a.abstand, b.pos.y + 1.6 + hoehe, b.pos.z - Math.cos(w) * a.abstand);
      blick = this.hilf2.set(b.pos.x, b.pos.y + 1.5, b.pos.z);
    }
    const k = 1 - Math.exp(-dt * (a.wechsel ? 2.2 : 4.5));
    if (a.wechsel && kam.position.distanceTo(soll) < 2) a.wechsel = false;
    kam.position.lerp(soll, k);
    o.target.lerp(blick, Math.min(1, k * 1.5));
    kam.lookAt(o.target);
  }

  autoZiel(name, bewegung) {
    const a = this.auto;
    if (a.ziel === bewegung) return;
    if (bewegung && !a.ziel) a.yaw = bewegung.koerper;
    if (bewegung && a.ziel) a.wechsel = true; // anderer Spieler: etwas gemächlicher rüber
    a.ziel = bewegung;
    a.name = name;
    a.stillSeit = performance.now();
  }

  dispose() {
    window.removeEventListener('keydown', this.taste);
    window.removeEventListener('keyup', this.taste);
    window.removeEventListener('keydown', this.shiftTaste);
    window.removeEventListener('keyup', this.shiftTaste);
    window.removeEventListener('blur', this.losgelassen);
    this.element.removeEventListener('pointerdown', this.runter);
    this.element.removeEventListener('pointermove', this.bewegt);
    this.element.removeEventListener('pointerup', this.hoch);
    this.element.removeEventListener('pointercancel', this.hoch);
    this.element.removeEventListener('wheel', this.rad);
    this.o.dispose();
  }
}
