// Live-Abgleich: Die Mod „Bruno Live“ (Ordner mod/) meldet aus dem Minecraft-Client, wer online ist und welche
// Blöcke des Plans stehen. Das Intranet zeigt beides an.
//
// Aternos erlaubt keine eigenen Server-Mods, darum kommen die Daten vom Client. Jeder Mitspieler hat einen eigenen
// Schlüssel, der nur /api/mc/* darf. Gespeichert wird je Chunk, nicht je Block: Das hält die Schreibzugriffe im
// Gratis-Tarif von D1 weit unter dem Limit, auch wenn alle gleichzeitig bauen.
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { newToken, sha256Hex } from './crypto';
import { fail, str } from './util';
import plan from './rechenzentrum.meta.json';
import type { Env, User } from './types';

type Vars = { user: User };
type App = Hono<{ Bindings: Env; Variables: Vars }>;
type C = Context<{ Bindings: Env; Variables: Vars }>;

export const MC_KEY_PREFIX = 'bsmc_';
const ONLINE_MS = 35_000; // Die Mod meldet alle 10 Sekunden. Nach drei verpassten Meldungen gilt jemand als weg.
const MAX_CHUNKS = 16; // je Meldung
const MAX_JE_CHUNK = 16 * 16 * 512;
const EREIGNISSE_BEHALTEN = 200;
const NAME = /^[A-Za-z0-9_.*-]{1,32}$/;
const BLOCK = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;

type Anker = { x: number; y: number; z: number };
type Einstellung = { anker: Anker | null; server: string };

async function einstellung(db: D1Database): Promise<Einstellung> {
  const r = await db.prepare('SELECT anker_x, anker_y, anker_z, server FROM bauplan_einstellung WHERE id = 1').first<{
    anker_x: number | null;
    anker_y: number | null;
    anker_z: number | null;
    server: string;
  }>();
  if (!r) return { anker: null, server: '' };
  const anker = r.anker_x === null || r.anker_y === null || r.anker_z === null ? null : { x: r.anker_x, y: r.anker_y, z: r.anker_z };
  return { anker, server: r.server };
}

// Wer online ist. Jede Mod meldet die ganze Tab-Liste, also sieht man auch Mitspieler ohne Mod.
export async function spielerLesen(db: D1Database, jetzt: number) {
  const { results } = await db
    .prepare(
      `SELECT r.user_id, r.mc_name, r.x, r.y, r.z, r.dimension, r.online, r.gesehen_am, u.display_name
       FROM mc_reporter r JOIN users u ON u.id = r.user_id`
    )
    .all<{ user_id: number; mc_name: string; x: number | null; y: number | null; z: number | null; dimension: string | null; online: string; gesehen_am: number; display_name: string }>();
  const mitarbeiter = new Map(results.map((r) => [r.mc_name.toLowerCase(), r.display_name]));
  const frisch = results.filter((r) => jetzt - r.gesehen_am < ONLINE_MS);
  const spieler = new Map<string, { name: string; mitarbeiter: string | null; x?: number | null; y?: number | null; z?: number | null; dimension?: string | null; mit_mod: boolean }>();
  for (const r of frisch) {
    for (const name of JSON.parse(r.online) as string[]) {
      const key = name.toLowerCase();
      if (!spieler.has(key)) spieler.set(key, { name, mitarbeiter: mitarbeiter.get(key) ?? null, mit_mod: false });
    }
  }
  for (const r of frisch) {
    spieler.set(r.mc_name.toLowerCase(), { name: r.mc_name, mitarbeiter: r.display_name, x: r.x, y: r.y, z: r.z, dimension: r.dimension, mit_mod: true });
  }
  return { spieler: [...spieler.values()].sort((a, b) => a.name.localeCompare(b.name)), beobachtet: frisch.length > 0 };
}

export async function liveChunks(db: D1Database, seit: number) {
  const { results } = await db
    .prepare('SELECT cx, cz, n, gebaut, falsch, am FROM bauplan_live_chunk WHERE am > ? AND plan_hash = ?')
    .bind(seit, plan.hash)
    .all<{ cx: number; cz: number; n: number; gebaut: string; falsch: string; am: number }>();
  return results.map((r) => ({ ...r, falsch: JSON.parse(r.falsch) }));
}

export async function liveEinstellung(db: D1Database) {
  return einstellung(db);
}

// Schlüssel der Mod aus dem Authorization-Kopf
async function modBenutzer(c: C) {
  const key = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
  if (!key.startsWith(MC_KEY_PREFIX)) fail(401, 'Kein gültiger Schlüssel.');
  const u = await c.env.DB.prepare(
    `SELECT u.id, u.display_name FROM mc_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND u.active = 1`
  )
    .bind(await sha256Hex(key))
    .first<{ id: number; display_name: string }>();
  if (!u) return fail(401, 'Der Schlüssel gilt nicht mehr. Bitte im Profil einen neuen erzeugen.');
  return u;
}

function ganzzahl(v: unknown, feld: string, von: number, bis: number): number {
  if (!Number.isInteger(v) || (v as number) < von || (v as number) > bis) fail(400, `${feld} ist ungültig.`);
  return v as number;
}

// Bereich der Chunks, in denen der Plan liegt. Alles andere wird nicht gespeichert.
function chunkBereich(a: Anker) {
  const wx0 = a.x - plan.gebaeude.x;
  const wz0 = a.z - plan.gebaeude.z;
  return { cx0: wx0 >> 4, cx1: (wx0 + plan.groesse.x - 1) >> 4, cz0: wz0 >> 4, cz1: (wz0 + plan.groesse.z - 1) >> 4 };
}

function chunkPruefen(c: unknown, bereich: ReturnType<typeof chunkBereich>) {
  const q = (c ?? {}) as Record<string, unknown>;
  const cx = ganzzahl(q.cx, 'cx', bereich.cx0, bereich.cx1);
  const cz = ganzzahl(q.cz, 'cz', bereich.cz0, bereich.cz1);
  const n = ganzzahl(q.n, 'n', 1, MAX_JE_CHUNK);
  const laenge = 4 * Math.ceil(Math.ceil(n / 8) / 3);
  if (typeof q.gebaut !== 'string' || q.gebaut.length !== laenge || !/^[A-Za-z0-9+/]+={0,2}$/.test(q.gebaut)) fail(400, 'Das Bitfeld passt nicht zum Chunk.');
  const falsch = (q.falsch ?? {}) as Record<string, unknown>;
  if (typeof falsch !== 'object' || Array.isArray(falsch)) fail(400, 'Die Liste der falschen Blöcke ist ungültig.');
  for (const [block, liste] of Object.entries(falsch)) {
    if (!BLOCK.test(block) || !Array.isArray(liste) || !liste.every((i) => Number.isInteger(i) && i >= 0 && i < n)) fail(400, 'Die Liste der falschen Blöcke ist ungültig.');
  }
  return { cx, cz, n, gebaut: q.gebaut as string, falsch: JSON.stringify(falsch) };
}

export function liveRoutes(app: App, auth: MiddlewareHandler<{ Bindings: Env; Variables: Vars }>, adminOnly: (c: C) => void) {
  // ---------- Für die Mod ----------

  app.get('/api/mc/config', async (c) => {
    const u = await modBenutzer(c);
    const e = await einstellung(c.env.DB);
    c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE mc_keys SET last_used_at = datetime('now') WHERE user_id = ?`).bind(u.id).run());
    return c.json({ plan_hash: plan.hash, anker: e.anker, server: e.server, name: u.display_name });
  });

  app.get('/api/mc/plan', async (c) => {
    await modBenutzer(c);
    return c.env.ASSETS.fetch(new Request(new URL('/rechenzentrum.plan.json', c.req.url)));
  });

  app.post('/api/mc/melden', async (c) => {
    const u = await modBenutzer(c);
    const b = (await c.req.json().catch(() => fail(400, 'Ungültige Anfrage.'))) as Record<string, unknown>;
    const jetzt = Date.now();

    const name = str(b.mc_name, 'Spielername', { max: 32 });
    if (!NAME.test(name)) fail(400, 'Der Spielername ist ungültig.');
    // Abgemeldet: sofort aus der Liste, statt 35 Sekunden zu warten.
    if (b.offline === true) {
      await c.env.DB.prepare('UPDATE mc_reporter SET gesehen_am = 0 WHERE user_id = ?').bind(u.id).run();
      return c.json({ ok: true });
    }
    const online = Array.isArray(b.online) ? b.online.filter((n) => typeof n === 'string' && NAME.test(n)).slice(0, 200) : [];
    const koordinate = (v: unknown) => (Number.isFinite(v) ? Math.round(v as number) : null);
    const dimension = typeof b.dimension === 'string' ? b.dimension.slice(0, 64) : null;

    const befehle = [
      c.env.DB.prepare(
        `INSERT INTO mc_reporter (user_id, mc_name, x, y, z, dimension, online, gesehen_am) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET mc_name = excluded.mc_name, x = excluded.x, y = excluded.y, z = excluded.z,
           dimension = excluded.dimension, online = excluded.online, gesehen_am = excluded.gesehen_am`
      ).bind(u.id, name, koordinate(b.x), koordinate(b.y), koordinate(b.z), dimension, JSON.stringify(online), jetzt),
    ];

    const chunks = b.chunks;
    if (chunks !== undefined) {
      if (!Array.isArray(chunks) || chunks.length > MAX_CHUNKS) fail(400, 'Zu viele Chunks in einer Meldung.');
      const e = await einstellung(c.env.DB);
      // Ein alter Plan oder ein alter Standort passen nicht zu den Daten: Die Mod holt sich dann den neuen Stand.
      if (b.plan_hash !== plan.hash) fail(409, 'Der Plan wurde geändert.');
      const anker = b.anker as Anker | undefined;
      if (!e.anker || !anker || anker.x !== e.anker.x || anker.y !== e.anker.y || anker.z !== e.anker.z) fail(409, 'Der Standort wurde geändert.');
      const bereich = chunkBereich(e.anker!);
      for (const roh of chunks as unknown[]) {
        const q = chunkPruefen(roh, bereich);
        // Ändert sich nichts, schreibt die Datenbank auch nichts.
        befehle.push(
          c.env.DB.prepare(
            `INSERT INTO bauplan_live_chunk (cx, cz, plan_hash, n, gebaut, falsch, am) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (cx, cz) DO UPDATE SET plan_hash = excluded.plan_hash, n = excluded.n, gebaut = excluded.gebaut, falsch = excluded.falsch, am = excluded.am
             WHERE bauplan_live_chunk.gebaut <> excluded.gebaut OR bauplan_live_chunk.falsch <> excluded.falsch OR bauplan_live_chunk.plan_hash <> excluded.plan_hash`
          ).bind(q.cx, q.cz, plan.hash, q.n, q.gebaut, q.falsch, jetzt)
        );
      }
    }

    const e = b.ereignis as { plus?: unknown; minus?: unknown; falsch?: unknown; bloecke?: unknown } | undefined;
    if (e && typeof e === 'object') {
      const plus = ganzzahl(e.plus ?? 0, 'plus', 0, 1_000_000);
      const minus = ganzzahl(e.minus ?? 0, 'minus', 0, 1_000_000);
      const falsch = ganzzahl(e.falsch ?? 0, 'falsch', 0, 1_000_000);
      const roh = e.bloecke && typeof e.bloecke === 'object' ? Object.entries(e.bloecke as Record<string, unknown>) : [];
      const bloecke = Object.fromEntries(roh.filter(([k, v]) => BLOCK.test(k) && Number.isInteger(v)).slice(0, 12));
      if (plus || minus || falsch) {
        befehle.push(
          c.env.DB.prepare('INSERT INTO bauplan_ereignis (user_id, mc_name, plus, minus, falsch, bloecke, am) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(u.id, name, plus, minus, falsch, JSON.stringify(bloecke), jetzt)
        );
        // Aufräumen nur ab und zu: Jede gelöschte Zeile zählt aufs Schreiblimit.
        if (Math.random() < 0.05) {
          befehle.push(c.env.DB.prepare(`DELETE FROM bauplan_ereignis WHERE id <= (SELECT MAX(id) FROM bauplan_ereignis) - ?`).bind(EREIGNISSE_BEHALTEN));
        }
      }
    }
    await c.env.DB.batch(befehle);
    return c.json({ ok: true, plan_hash: plan.hash });
  });

  // ---------- Für die Website ----------

  // nur=spieler: nur wer online ist, für Seitenleiste und Übersicht. Sonst auch Chunks und Ereignisse seit dem letzten Abruf.
  app.get('/api/live', auth, async (c) => {
    const jetzt = Date.now();
    const db = c.env.DB;
    const { spieler, beobachtet } = await spielerLesen(db, jetzt);
    if (c.req.query('nur') === 'spieler') return c.json({ jetzt, spieler, beobachtet });
    const seit = Number(c.req.query('seit')) || 0;
    const [chunks, ereignisse] = await Promise.all([
      liveChunks(db, seit),
      db
        .prepare('SELECT id, mc_name, plus, minus, falsch, bloecke, am FROM bauplan_ereignis WHERE am > ? ORDER BY id DESC LIMIT 30')
        .bind(seit)
        .all<{ id: number; mc_name: string; plus: number; minus: number; falsch: number; bloecke: string; am: number }>(),
    ]);
    return c.json({ jetzt, spieler, beobachtet, chunks, ereignisse: ereignisse.results.map((r) => ({ ...r, bloecke: JSON.parse(r.bloecke) })) });
  });

  // Standort und Server festlegen. Wer den Standort ändert, verwirft den Live-Stand: Die Chunks passen nicht mehr.
  app.put('/api/bauplan/einstellung', auth, async (c) => {
    adminOnly(c);
    const b = (await c.req.json().catch(() => fail(400, 'Ungültige Anfrage.'))) as { anker?: Partial<Anker> | null; server?: unknown };
    const a = b.anker;
    const anker = a
      ? { x: ganzzahl(a.x, 'X', -30_000_000, 30_000_000), y: ganzzahl(a.y, 'Y', -64, 319), z: ganzzahl(a.z, 'Z', -30_000_000, 30_000_000) }
      : null;
    const server = str(b.server, 'Server', { min: 0, max: 200, optional: true }).toLowerCase();
    if (server && !/^[a-z0-9.-]+(:\d{1,5})?$/.test(server)) fail(400, 'Die Server-Adresse ist ungültig.');
    const alt = await einstellung(c.env.DB);
    const verschoben = JSON.stringify(alt.anker) !== JSON.stringify(anker);
    const befehle = [
      c.env.DB.prepare(
        `INSERT INTO bauplan_einstellung (id, anker_x, anker_y, anker_z, server) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET anker_x = excluded.anker_x, anker_y = excluded.anker_y, anker_z = excluded.anker_z, server = excluded.server`
      ).bind(anker?.x ?? null, anker?.y ?? null, anker?.z ?? null, server),
    ];
    if (verschoben) befehle.push(c.env.DB.prepare('DELETE FROM bauplan_live_chunk'), c.env.DB.prepare('DELETE FROM bauplan_ereignis'));
    await c.env.DB.batch(befehle);
    return c.json({ ok: true });
  });

  // Eigener Schlüssel der Mod. Ein neuer ersetzt den alten.
  app.get('/api/me/mc-key', async (c) => {
    const r = await c.env.DB.prepare('SELECT hint, created_at, last_used_at FROM mc_keys WHERE user_id = ?').bind(c.get('user').id).first();
    return c.json({ key: r ?? null });
  });

  app.post('/api/me/mc-key', async (c) => {
    const key = MC_KEY_PREFIX + newToken();
    await c.env.DB.prepare(
      `INSERT INTO mc_keys (user_id, key_hash, hint) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET key_hash = excluded.key_hash, hint = excluded.hint, created_at = datetime('now'), last_used_at = NULL`
    )
      .bind(c.get('user').id, await sha256Hex(key), key.slice(-4))
      .run();
    // Wird nur jetzt einmal ausgeliefert: als fertige Datei für den config-Ordner.
    return c.json({ konfig: { url: new URL(c.req.url).origin, schluessel: key } }, 201);
  });

  app.delete('/api/me/mc-key', async (c) => {
    await c.env.DB.prepare('DELETE FROM mc_keys WHERE user_id = ?').bind(c.get('user').id).run();
    return c.json({ ok: true });
  });
}
