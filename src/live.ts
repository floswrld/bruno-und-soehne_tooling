// Live vom Minecraft-Server: Die Mod „Bruno Live“ (Ordner mod/) und die Website hängen per WebSocket am Live-Raum
// (src/liveraum.ts). Hier wird nur angemeldet und durchgereicht.
//
// Aternos erlaubt keine eigenen Server-Mods, darum kommen die Daten vom Client. Jeder Mitspieler hat einen eigenen
// Schlüssel, der nur /api/mc/* darf.
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { newToken, sha256Hex } from './crypto';
import { fail, str } from './util';
import type { Anhang } from './liveraum';
import type { Env, User } from './types';

type Vars = { user: User };
type App = Hono<{ Bindings: Env; Variables: Vars }>;
type C = Context<{ Bindings: Env; Variables: Vars }>;

export const MC_KEY_PREFIX = 'bsmc_';
const VERALTET = 'Diese Version von Bruno Live ist veraltet. Bitte im Intranet unter Profil die neue Mod herunterladen.';

// Es gibt genau einen Live-Raum: den Bau.
export const liveRaum = (env: Env) => env.LIVE.get(env.LIVE.idFromName('bau'));

// Schlüssel der Mod aus dem Authorization-Kopf
async function modBenutzer(c: C) {
  const key = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
  if (!key.startsWith(MC_KEY_PREFIX)) fail(401, 'Kein gültiger Schlüssel.');
  const u = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.role FROM mc_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND u.active = 1`
  )
    .bind(await sha256Hex(key))
    .first<{ id: number; display_name: string; role: string }>();
  if (!u) return fail(401, 'Der Schlüssel gilt nicht mehr. Bitte im Profil einen neuen erzeugen.');
  return u;
}

function ganzzahl(v: unknown, feld: string, von: number, bis: number): number {
  if (!Number.isInteger(v) || (v as number) < von || (v as number) > bis) fail(400, `${feld} ist ungültig.`);
  return v as number;
}

// WebSocket an den Live-Raum weiterreichen. Wer dran hängt, steht im Kopf x-bruno; den setzt nur der Worker.
function verbinden(c: C, anhang: Anhang) {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') fail(426, 'Erwartet eine WebSocket-Verbindung.');
  const kopf = new Headers(c.req.raw.headers);
  kopf.set('x-bruno', JSON.stringify(anhang));
  return liveRaum(c.env).fetch(new Request(c.req.raw.url, { headers: kopf }));
}

export function liveRoutes(app: App, auth: MiddlewareHandler<{ Bindings: Env; Variables: Vars }>, adminOnly: (c: C) => void) {
  // ---------- Für die Mod ----------

  app.get('/api/mc/live', async (c) => {
    const u = await modBenutzer(c);
    c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE mc_keys SET last_used_at = datetime('now') WHERE user_id = ?`).bind(u.id).run());
    return verbinden(c, { rolle: 'mod', uid: u.id, name: u.display_name, admin: u.role === 'admin' });
  });

  app.get('/api/mc/plan', async (c) => {
    await modBenutzer(c);
    return c.env.ASSETS.fetch(new Request(new URL('/rechenzentrum.plan.json', c.req.url)));
  });

  // Mod 1.x fragte alle 10 Sekunden ab. Sie bekommt einen klaren Hinweis statt stiller Fehler.
  app.all('/api/mc/config', (c) => c.json({ error: VERALTET }, 410));
  app.all('/api/mc/melden', (c) => c.json({ error: VERALTET }, 410));

  // ---------- Für die Website ----------

  app.get('/api/live/ws', auth, (c) => {
    // Nur von der eigenen Seite: Fremde Seiten dürfen keine Verbindung mit unserem Cookie aufbauen.
    const origin = c.req.header('origin');
    if (!origin || new URL(origin).host !== new URL(c.req.url).host) fail(403, 'Fremde Herkunft abgelehnt.');
    const u = c.get('user');
    return verbinden(c, { rolle: 'web', uid: u.id, name: u.display_name, admin: u.role === 'admin' });
  });

  // Stand auf einen Blick (für Tests und zum Nachsehen)
  app.get('/api/live', auth, async (c) => c.json(await liveRaum(c.env).schnappschuss()));

  // Skins: echte Skins liegen bei Mojang, die Seite holt sie über uns (kein Fremdzugriff aus dem Browser).
  app.get('/api/live/haut/:hash{[0-9a-f]{32,64}}', auth, async (c) => {
    const r = await fetch(`https://textures.minecraft.net/texture/${c.req.param('hash')}`, { cf: { cacheTtl: 30 * 86400, cacheEverything: true } });
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/png')) fail(404, 'Skin nicht gefunden.');
    return new Response(r.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=604800, immutable' } });
  });

  // Standard-Skins, die eine Mod mitgeschickt hat
  app.get('/api/live/haut', auth, async (c) => {
    const png = await liveRaum(c.env).haut(c.req.query('res') ?? '');
    if (!png) fail(404, 'Skin nicht gefunden.');
    return new Response(Uint8Array.from(atob(png!), (ch) => ch.charCodeAt(0)), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } });
  });

  // Standort und Server festlegen. Wer den Standort ändert, verwirft den Live-Stand: Die Blöcke passen nicht mehr.
  app.put('/api/bauplan/einstellung', auth, async (c) => {
    adminOnly(c);
    const b = (await c.req.json().catch(() => fail(400, 'Ungültige Anfrage.'))) as { anker?: Partial<Record<'x' | 'y' | 'z', unknown>> | null; server?: unknown };
    const a = b.anker;
    const anker = a
      ? { x: ganzzahl(a.x, 'X', -30_000_000, 30_000_000), y: ganzzahl(a.y, 'Y', -64, 319), z: ganzzahl(a.z, 'Z', -30_000_000, 30_000_000) }
      : null;
    const server = str(b.server, 'Server', { min: 0, max: 200, optional: true }).toLowerCase();
    if (server && !/^[a-z0-9.-]+(:\d{1,5})?$/.test(server)) fail(400, 'Die Server-Adresse ist ungültig.');
    await liveRaum(c.env).einstellen(anker, server);
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
