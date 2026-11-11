// Live-Raum: ein Durable Object für den ganzen Bau. Die Mod „Bruno Live“ (Minecraft) und die offenen Browser
// hängen per WebSocket daran. Was eine Mod meldet, geht ohne Umweg an alle anderen: Positionen mehrmals pro Sekunde,
// gesetzte Blöcke sofort. Es wird nichts abgefragt.
//
// Gespeichert wird im Speicher des Objekts selbst, gesammelt alle zwei Sekunden: ein Bitfeld über alle Planblöcke,
// die falsch gesetzten Blöcke, die letzten Einträge im Feed und der Standort. Positionen und die Tab-Liste sind
// flüchtig, die Mods schicken sie ohnehin laufend.
import { DurableObject } from 'cloudflare:workers';
import plan from './rechenzentrum.meta.json';
import type { Env } from './types';

export type Anker = { x: number; y: number; z: number };
export type Rolle = 'mod' | 'web';
// Wer an der Verbindung hängt. Kommt vom Worker, der vorher angemeldet hat, und überlebt den Ruhezustand.
export type Anhang = { rolle: Rolle; uid: number; name: string; admin: boolean; mc?: string; aktiv?: boolean; abo?: boolean };
type Haut = { hash?: string; res?: string; modell: 'wide' | 'slim' };
type TabEintrag = { name: string; haut?: Haut };
// [Name, x, y, z, Körper-Drehung, Kopf-Drehung, Nicken, Merker, Dimension]
type PosWerte = [string, number, number, number, number, number, number, number, string];
type Position = { werte: PosWerte; am: number; selbst: boolean; quelle: WebSocket };
type Zustand = 0 | 1 | string; // offen, gebaut, falscher Block
type Eintrag = { id: number; mc_name: string; plus: number; minus: number; falsch: number; bloecke: Record<string, number>; von: number; am: number };
type Gespeichert = { hash: string; gebaut: Uint8Array; falsch: [number, string][]; gemeldet: boolean };

const NAME = /^[A-Za-z0-9_.*-]{1,32}$/;
const BLOCK = /^[a-z0-9_.-]+:[a-z0-9_/.-]{1,80}$/;
const DIM = /^[a-z0-9_.-]+:[a-z0-9_/.-]{1,64}$/;
const RES = /^[a-z0-9_.-]+:[a-z0-9_/.-]{1,120}\.png$/;
const HASH = /^[0-9a-f]{32,64}$/;
const SERVER = /^[a-z0-9.-]+(:\d{1,5})?$/;
const BYTES = Math.ceil(plan.gesamt / 8);
const FALSCH_MAX = 5000;
const FEED_MAX = 30;
const FEED_FENSTER = 60_000; // Was jemand innerhalb einer Minute baut, ist ein Eintrag.
const POS_ALT = 5000; // Die Mods melden spätestens alle zwei Sekunden, wen sie sehen.
const SELBST_VORRANG = 1500; // Die eigene Meldung eines Spielers geht vor dem, was andere von ihm sehen.
const SPEICHERN_MS = 2000;

const zahl = (v: unknown, grenze: number): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= grenze ? v : null);
const runden = (v: number, stellen: number) => Math.round(v * stellen) / stellen;
const gleicherAnker = (a: Anker | null | undefined, b: Anker | null | undefined) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function posPruefen(roh: unknown, dimension: string | null): PosWerte | null {
  if (!Array.isArray(roh) || roh.length < 8) return null;
  const [name, x, y, z, koerper, kopf, nicken, merker, dim] = roh;
  if (typeof name !== 'string' || !NAME.test(name)) return null;
  const px = zahl(x, 3e7);
  const py = zahl(y, 4096);
  const pz = zahl(z, 3e7);
  const kb = zahl(koerper, 1e5);
  const kk = zahl(kopf, 1e5);
  const ni = zahl(nicken, 360);
  if (px === null || py === null || pz === null || kb === null || kk === null || ni === null) return null;
  if (!Number.isInteger(merker) || merker < 0 || merker > 255) return null;
  const d = typeof dim === 'string' && DIM.test(dim) ? dim : dimension;
  if (!d) return null;
  return [name, runden(px, 100), runden(py, 100), runden(pz, 100), runden(kb, 10), runden(kk, 10), runden(ni, 10), merker, d];
}

function tabPruefen(roh: unknown): TabEintrag[] {
  if (!Array.isArray(roh)) return [];
  const liste: TabEintrag[] = [];
  for (const e of roh.slice(0, 200)) {
    const q = (e ?? {}) as Record<string, unknown>;
    if (typeof q.n !== 'string' || !NAME.test(q.n)) continue;
    const modell = q.m === 'slim' ? 'slim' : 'wide';
    const haut = typeof q.h === 'string' && HASH.test(q.h) ? { hash: q.h, modell } : typeof q.r === 'string' && RES.test(q.r) ? { res: q.r, modell } : undefined;
    liste.push({ name: q.n, haut } as TabEintrag);
  }
  return liste;
}

export class LiveRaum extends DurableObject<Env> {
  private einstellung: { anker: Anker | null; server: string } = { anker: null, server: '' };
  private gebaut = new Uint8Array(BYTES);
  private falsch = new Map<number, string>();
  private gemeldet = false; // gibt es überhaupt schon Daten?
  private feed: Eintrag[] = [];
  private namen: Record<string, string> = {}; // Minecraft-Name (klein) -> Mitarbeiter
  private tab = new Map<WebSocket, TabEintrag[]>();
  private pos = new Map<string, Position>();
  private haeute = new Map<string, string>();
  private schmutzig = new Set<'stand' | 'feed' | 'namen'>();
  private alarmGesetzt = false;
  private online = '';
  private soll: { bloecke: string[]; index: Uint16Array } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Herzschlag der Browser, ohne das Objekt aufzuwecken.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(() => this.laden());
  }

  private async laden() {
    const s = this.ctx.storage;
    const [einstellung, stand, feed, namen] = await Promise.all([
      s.get<{ anker: Anker | null; server: string }>('einstellung'),
      s.get<Gespeichert>('stand'),
      s.get<Eintrag[]>('feed'),
      s.get<Record<string, string>>('namen'),
    ]);
    if (einstellung) {
      this.einstellung = einstellung;
    } else {
      // Einmalig: Standort und Server aus der Zeit vor dem Live-Raum übernehmen.
      const r = await this.env.DB.prepare('SELECT anker_x, anker_y, anker_z, server FROM bauplan_einstellung WHERE id = 1')
        .first<{ anker_x: number | null; anker_y: number | null; anker_z: number | null; server: string }>()
        .catch(() => null);
      if (r) {
        const da = r.anker_x !== null && r.anker_y !== null && r.anker_z !== null;
        this.einstellung = { anker: da ? { x: r.anker_x!, y: r.anker_y!, z: r.anker_z! } : null, server: r.server ?? '' };
      }
      await s.put('einstellung', this.einstellung);
    }
    // Ein Stand zu einem älteren Plan passt nicht mehr zu den Blocknummern.
    if (stand && stand.hash === plan.hash && stand.gebaut.length === BYTES) {
      this.gebaut = new Uint8Array(stand.gebaut);
      this.falsch = new Map(stand.falsch);
      this.gemeldet = stand.gemeldet;
      this.feed = feed ?? [];
    }
    this.namen = namen ?? {};
  }

  // ---------- Verbindungen ----------

  async fetch(req: Request): Promise<Response> {
    const info = JSON.parse(req.headers.get('x-bruno') ?? 'null') as Anhang | null;
    if (!info || req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Erwartet eine WebSocket-Verbindung.', { status: 426 });
    const paar = new WebSocketPair();
    const [client, server] = [paar[0], paar[1]];
    const anhang: Anhang = { rolle: info.rolle, uid: info.uid, name: info.name, admin: info.admin };
    this.ctx.acceptWebSocket(server, [anhang.rolle]);
    server.serializeAttachment(anhang);
    if (anhang.rolle === 'mod') this.senden(server, this.startFuerMod(anhang));
    else this.senden(server, { t: 'online', ...this.onlineListe() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, roh: string | ArrayBuffer) {
    if (typeof roh !== 'string' || roh.length > 600_000) return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(roh);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    const a = ws.deserializeAttachment() as Anhang;
    try {
      if (a.rolle === 'web') this.vomBrowser(ws, a, m);
      else await this.vonMod(ws, a, m);
    } catch (e) {
      console.error('Live-Raum:', e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, grund: string) {
    this.abmelden(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, grund);
    } catch {
      // schon zu
    }
  }

  async webSocketError(ws: WebSocket) {
    this.abmelden(ws);
  }

  private abmelden(ws: WebSocket) {
    this.tab.delete(ws);
    const weg: string[] = [];
    for (const [key, p] of this.pos) {
      if (p.quelle !== ws) continue;
      this.pos.delete(key);
      weg.push(p.werte[0]);
    }
    if (weg.length) this.anBrowser({ t: 'pos', liste: [], weg });
    this.onlineSenden(ws);
  }

  private senden(ws: WebSocket, nachricht: unknown) {
    try {
      ws.send(typeof nachricht === 'string' ? nachricht : JSON.stringify(nachricht));
    } catch {
      // Verbindung schon zu: räumt webSocketClose auf.
    }
  }

  // An alle Browser, die gerade den Bauplan offen haben (oder alle, wenn nurAbo = false).
  private anBrowser(nachricht: unknown, nurAbo = true) {
    const text = JSON.stringify(nachricht);
    for (const w of this.ctx.getWebSockets('web')) {
      if (!nurAbo || (w.deserializeAttachment() as Anhang).abo) this.senden(w, text);
    }
  }

  // ---------- Browser ----------

  private vomBrowser(ws: WebSocket, a: Anhang, m: Record<string, unknown>) {
    if (m.t !== 'abo') return;
    a.abo = m.an === true;
    ws.serializeAttachment(a);
    if (a.abo) this.senden(ws, { t: 'start', ...this.schnappschussIntern() });
  }

  // ---------- Mod ----------

  private startFuerMod(a: Anhang) {
    return {
      t: 'start',
      hash: plan.hash,
      anker: this.einstellung.anker,
      server: this.einstellung.server,
      name: a.name,
      admin: a.admin,
      gebaut: base64(this.gebaut),
      falsch: [...this.falsch],
    };
  }

  private async vonMod(ws: WebSocket, a: Anhang, m: Record<string, unknown>) {
    switch (m.t) {
      case 'hallo': {
        if (typeof m.name !== 'string' || !NAME.test(m.name)) return;
        a.mc = m.name;
        a.aktiv = true;
        ws.serializeAttachment(a);
        const key = m.name.toLowerCase();
        if (this.namen[key] !== a.name) {
          this.namen[key] = a.name;
          this.merken('namen');
        }
        this.onlineSenden();
        return;
      }
      case 'tab':
        if (!a.aktiv) return;
        this.tab.set(ws, tabPruefen(m.liste));
        this.onlineSenden();
        return;
      case 'pos':
        if (a.aktiv) this.positionen(ws, a, m);
        return;
      case 'bloecke':
        if (a.aktiv) await this.bloecke(ws, a, m);
        return;
      case 'haut':
        if (a.aktiv) await this.hautSpeichern(m);
        return;
      case 'ecke':
        await this.ecke(ws, a, m);
        return;
    }
  }

  private positionen(ws: WebSocket, a: Anhang, m: Record<string, unknown>) {
    const jetzt = Date.now();
    const neu: PosWerte[] = [];
    const eigen = posPruefen(m.s, null);
    const nimm = (w: PosWerte | null, selbst: boolean) => {
      if (!w) return;
      const key = w[0].toLowerCase();
      if (selbst && key !== a.mc?.toLowerCase()) return;
      const alt = this.pos.get(key);
      if (!selbst && alt?.selbst && alt.quelle !== ws && jetzt - alt.am < SELBST_VORRANG) return;
      this.pos.set(key, { werte: w, am: jetzt, selbst, quelle: ws });
      neu.push(w);
    };
    nimm(eigen, true);
    if (Array.isArray(m.a)) for (const roh of m.a.slice(0, 100)) nimm(posPruefen(roh, eigen?.[8] ?? null), false);
    const weg: string[] = [];
    for (const [key, p] of this.pos) {
      if (jetzt - p.am < POS_ALT) continue;
      this.pos.delete(key);
      weg.push(p.werte[0]);
    }
    if (neu.length || weg.length) this.anBrowser({ t: 'pos', liste: neu, weg });
  }

  private zustand(i: number): Zustand {
    return this.falsch.get(i) ?? (this.gebaut[i >> 3] & (1 << (i & 7)) ? 1 : 0);
  }

  private setzen(i: number, s: Zustand) {
    if (s === 1) this.gebaut[i >> 3] |= 1 << (i & 7);
    else this.gebaut[i >> 3] &= ~(1 << (i & 7));
    if (typeof s === 'string') this.falsch.set(i, s);
    else this.falsch.delete(i);
  }

  private async bloecke(ws: WebSocket, a: Anhang, m: Record<string, unknown>) {
    // Meldungen zu einem alten Plan oder Standort passen nicht: Die Mod hat dann schon einen neuen Start bekommen.
    if (m.hash !== plan.hash || !gleicherAnker(m.anker as Anker, this.einstellung.anker)) return;
    const liste = Array.isArray(m.liste) ? m.liste.slice(0, 20_000) : [];
    const wer = Array.isArray(m.wer) ? m.wer.map((n) => (typeof n === 'string' && NAME.test(n) ? n : null)) : [];
    const sync = m.sync === true;
    const geaendert: [number, Zustand][] = [];
    const proWer = new Map<string, { plus: number; minus: number; falsch: number; neu: number[] }>();
    for (const e of liste) {
      if (!Array.isArray(e)) continue;
      const [i, s, w] = e;
      if (!Number.isInteger(i) || i < 0 || i >= plan.gesamt) continue;
      if (!(s === 0 || s === 1 || (typeof s === 'string' && BLOCK.test(s)))) continue;
      if (this.zustand(i) === s) continue;
      if (typeof s === 'string' && !this.falsch.has(i) && this.falsch.size >= FALSCH_MAX) continue;
      const vorher = this.zustand(i);
      this.setzen(i, s);
      geaendert.push([i, s]);
      if (sync) continue;
      const name = (Number.isInteger(w) ? wer[w] : null) ?? '';
      let z = proWer.get(name);
      if (!z) proWer.set(name, (z = { plus: 0, minus: 0, falsch: 0, neu: [] }));
      if (s === 1) {
        z.plus++;
        z.neu.push(i);
      } else if (typeof s === 'string') z.falsch++;
      else if (vorher === 1) z.minus++;
    }
    if (!geaendert.length) return;
    this.gemeldet = true;
    this.merken('stand');
    const text = JSON.stringify({ t: 'bloecke', liste: geaendert, sync });
    for (const w of this.ctx.getWebSockets()) {
      if (w === ws) continue;
      const x = w.deserializeAttachment() as Anhang;
      if (x.rolle === 'web' ? x.abo : x.aktiv) this.senden(w, text);
    }
    if (proWer.size) {
      await this.planLaden();
      for (const [name, z] of proWer) this.feedZaehlen(name, z);
    }
  }

  // Blockart je Plannummer, nur für den Feed („12 weißer Beton“). Der Plan liegt als Datei bei der Website.
  private async planLaden() {
    if (this.soll) return;
    try {
      const r = await this.env.ASSETS.fetch(new Request('https://intern/rechenzentrum.plan.json'));
      const p = (await r.json()) as { hash: string; palette: Record<string, { block: string }>; layers: string[] };
      if (p.hash !== plan.hash) return;
      const zeichen = Object.keys(p.palette);
      const nr = new Map(zeichen.map((c, k) => [c, k]));
      const index = new Uint16Array(plan.gesamt);
      let n = 0;
      for (const ebene of p.layers) {
        for (const [, anzahl, c] of ebene.matchAll(/(\d+)(\D)/g)) {
          if (c === '.') continue;
          index.fill(nr.get(c)!, n, n + Number(anzahl));
          n += Number(anzahl);
        }
      }
      this.soll = { bloecke: zeichen.map((c) => p.palette[c].block), index };
    } catch (e) {
      console.warn('Plan für den Feed nicht geladen:', e);
    }
  }

  private feedZaehlen(name: string, z: { plus: number; minus: number; falsch: number; neu: number[] }) {
    if (!z.plus && !z.minus && !z.falsch) return;
    const jetzt = Date.now();
    let e = this.feed.find((f) => f.mc_name === name && jetzt - f.am < FEED_FENSTER);
    if (!e) {
      e = { id: (this.feed[0]?.id ?? 0) + 1, mc_name: name, plus: 0, minus: 0, falsch: 0, bloecke: {}, von: jetzt, am: jetzt };
      this.feed.unshift(e);
      this.feed.length = Math.min(this.feed.length, FEED_MAX);
    }
    e.plus += z.plus;
    e.minus += z.minus;
    e.falsch += z.falsch;
    e.am = jetzt;
    if (this.soll) {
      for (const i of z.neu) {
        const b = this.soll.bloecke[this.soll.index[i]];
        e.bloecke[b] = (e.bloecke[b] ?? 0) + 1;
      }
      e.bloecke = Object.fromEntries(Object.entries(e.bloecke).sort((p, q) => q[1] - p[1]).slice(0, 12));
    }
    this.merken('feed');
    this.anBrowser({ t: 'feed', eintrag: e });
  }

  // Standard-Skins (Steve, Alex, …) liegen nur im Spiel. Die Mod schickt sie einmal mit.
  private async hautSpeichern(m: Record<string, unknown>) {
    if (typeof m.res !== 'string' || !RES.test(m.res) || typeof m.png !== 'string' || m.png.length > 24_000) return;
    if (!m.png.startsWith('iVBORw0KGgo')) return; // PNG-Signatur
    if (this.haeute.get(m.res) === m.png) return;
    this.haeute.set(m.res, m.png);
    await this.ctx.storage.put(`haut:${m.res}`, m.png);
    this.anBrowser({ t: 'haut', res: m.res }, false);
  }

  async haut(res: string): Promise<string | null> {
    if (!RES.test(res)) return null;
    const da = this.haeute.get(res) ?? (await this.ctx.storage.get<string>(`haut:${res}`)) ?? null;
    if (da) this.haeute.set(res, da);
    return da;
  }

  // /bruno ecke: Die Geschäftsführung schaut im Spiel auf den Eckblock und legt damit den Standort fest.
  private async ecke(ws: WebSocket, a: Anhang, m: Record<string, unknown>) {
    const meldung = (text: string) => this.senden(ws, { t: 'meldung', text });
    if (!a.admin) return meldung('Den Standort legt nur die Geschäftsführung fest.');
    const x = m.x;
    const y = m.y;
    const z = m.z;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || Math.abs(x as number) > 3e7 || Math.abs(z as number) > 3e7 || (y as number) < -64 || (y as number) > 319) {
      return meldung('Die Koordinaten sind ungültig.');
    }
    const neu = { x: x as number, y: y as number, z: z as number };
    const alt = this.einstellung.anker;
    if (alt && !gleicherAnker(alt, neu) && m.ja !== true) {
      return meldung(`Der Standort ist schon ${alt.x} / ${alt.y} / ${alt.z}. Neu setzen startet den Live-Stand von vorn. Zum Bestätigen: /bruno ecke ja`);
    }
    const server = typeof m.server === 'string' ? m.server.trim().toLowerCase() : '';
    await this.einstellen(neu, server && SERVER.test(server) ? server : this.einstellung.server);
    meldung(`Ecke gesetzt: ${neu.x} / ${neu.y} / ${neu.z}. Von hier geht das Gebäude ${plan.gebaeude.breite} Blöcke nach Osten (+X) und ${plan.gebaeude.tiefe} nach Süden (+Z).`);
  }

  // ---------- Aufrufe aus dem Worker ----------

  async einstellen(anker: Anker | null, server: string) {
    const verschoben = !(anker === null ? this.einstellung.anker === null : gleicherAnker(anker, this.einstellung.anker));
    this.einstellung = { anker, server };
    const werte: Record<string, unknown> = { einstellung: this.einstellung };
    if (verschoben) {
      // Wer das Haus versetzt, fängt von vorn an: Die alten Blöcke stehen an anderer Stelle.
      this.gebaut = new Uint8Array(BYTES);
      this.falsch.clear();
      this.gemeldet = false;
      this.feed = [];
      werte.stand = this.standZumSpeichern();
      werte.feed = [];
    }
    await this.ctx.storage.put(werte);
    for (const w of this.ctx.getWebSockets()) {
      const x = w.deserializeAttachment() as Anhang;
      if (x.rolle === 'mod') this.senden(w, this.startFuerMod(x));
      else this.senden(w, { t: 'einstellung', anker, server, neu: verschoben });
    }
  }

  // Ergebnis des Datei-Abgleichs (scripts/bauplan-sync.mjs): ersetzt den ganzen Stand.
  async vollerStand(gebaut: string, falsch: Record<string, number[]>) {
    const bits = Uint8Array.from(atob(gebaut), (c) => c.charCodeAt(0));
    if (bits.length !== BYTES) throw new Error('Bitfeld passt nicht zum Plan.');
    this.gebaut = bits;
    this.falsch.clear();
    for (const [block, liste] of Object.entries(falsch)) {
      if (!BLOCK.test(block)) continue;
      for (const i of liste.slice(0, FALSCH_MAX)) if (Number.isInteger(i) && i >= 0 && i < plan.gesamt) this.falsch.set(i, block);
    }
    this.gemeldet = true;
    await this.ctx.storage.put('stand', this.standZumSpeichern());
    for (const w of this.ctx.getWebSockets()) {
      const x = w.deserializeAttachment() as Anhang;
      if (x.rolle === 'mod') this.senden(w, this.startFuerMod(x));
      else if (x.abo) this.senden(w, { t: 'stand', fortschritt: this.fortschritt() });
    }
  }

  async schnappschuss() {
    return this.schnappschussIntern();
  }

  private schnappschussIntern() {
    return {
      hash: plan.hash,
      anker: this.einstellung.anker,
      server: this.einstellung.server,
      fortschritt: this.fortschritt(),
      ...this.onlineListe(),
      pos: [...this.pos.values()].map((p) => p.werte),
      feed: this.feed,
    };
  }

  private fortschritt() {
    if (!this.gemeldet) return null;
    const falsch: Record<string, number[]> = {};
    for (const [i, b] of this.falsch) (falsch[b] ??= []).push(i);
    let anzahl = 0;
    for (const b of this.gebaut) for (let v = b; v; v &= v - 1) anzahl++;
    return { gebaut: base64(this.gebaut), gebaut_anzahl: anzahl, falsch };
  }

  // ---------- Wer online ist ----------

  // ohne: die Verbindung, die gerade schließt (steht während webSocketClose noch in der Liste)
  private onlineListe(ohne?: WebSocket) {
    const mitMod = new Set<string>();
    let beobachtet = false;
    const mods = this.ctx.getWebSockets('mod').filter((w) => w !== ohne);
    for (const w of mods) {
      const a = w.deserializeAttachment() as Anhang;
      if (!a.aktiv || !a.mc) continue;
      beobachtet = true;
      mitMod.add(a.mc.toLowerCase());
    }
    const spieler = new Map<string, { name: string; mitarbeiter: string | null; mit_mod: boolean; haut: Haut | null }>();
    const dazu = (name: string, haut?: Haut) => {
      const key = name.toLowerCase();
      const alt = spieler.get(key);
      if (alt) {
        alt.haut ??= haut ?? null;
        return;
      }
      spieler.set(key, { name, mitarbeiter: this.namen[key] ?? null, mit_mod: mitMod.has(key), haut: haut ?? null });
    };
    for (const liste of this.tab.values()) for (const e of liste) dazu(e.name, e.haut);
    for (const w of mods) {
      const a = w.deserializeAttachment() as Anhang;
      if (a.aktiv && a.mc) dazu(a.mc);
    }
    return { spieler: [...spieler.values()].sort((p, q) => p.name.localeCompare(q.name)), beobachtet };
  }

  private onlineSenden(ohne?: WebSocket) {
    const liste = this.onlineListe(ohne);
    const text = JSON.stringify(liste);
    if (text === this.online) return;
    this.online = text;
    this.anBrowser({ t: 'online', ...liste }, false);
  }

  // ---------- Speichern ----------

  private standZumSpeichern(): Gespeichert {
    return { hash: plan.hash, gebaut: this.gebaut, falsch: [...this.falsch], gemeldet: this.gemeldet };
  }

  private merken(was: 'stand' | 'feed' | 'namen') {
    this.schmutzig.add(was);
    if (this.alarmGesetzt) return;
    this.alarmGesetzt = true;
    this.ctx.storage.setAlarm(Date.now() + SPEICHERN_MS);
  }

  async alarm() {
    this.alarmGesetzt = false;
    const was = [...this.schmutzig];
    this.schmutzig.clear();
    const werte: Record<string, unknown> = {};
    if (was.includes('stand')) werte.stand = this.standZumSpeichern();
    if (was.includes('feed')) werte.feed = this.feed;
    if (was.includes('namen')) werte.namen = this.namen;
    if (Object.keys(werte).length) await this.ctx.storage.put(werte);
  }
}
