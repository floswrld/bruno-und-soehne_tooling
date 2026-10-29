import { Hono, type Context, type Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256Hex, tempPassword } from './crypto';
import { HttpError, fail, str, int } from './util';
import { listTasks, createTask, updateTask } from './tasks';
import { mcpUser, handleMcp, MCP_KEY_PREFIX } from './mcp';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SETUP_TOKEN?: string;
};

type User = {
  id: number;
  username: string;
  display_name: string;
  title: string;
  role: 'admin' | 'user';
  must_change_password: number;
  active: number;
  created_at: string;
};

type Vars = { user: User };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const COOKIE = 'bs_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 8; // pro Benutzername in 15 Minuten
const USER_COLS = 'id, username, display_name, title, role, must_change_password, active, created_at';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- Hilfsfunktionen ----------

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'Interner Fehler. Bitte später erneut versuchen.' }, 500);
});

async function body<T = Record<string, unknown>>(c: C): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return fail(400, 'Ungültige Anfrage.');
  }
}

function iso(v: unknown, field: string): string {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return fail(400, `${field} ist kein gültiger Zeitpunkt.`);
  return new Date(v).toISOString();
}

function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10) return fail(400, 'Das Passwort braucht mindestens 10 Zeichen.');
  if (pw.length > 200) return fail(400, 'Das Passwort ist zu lang.');
  return pw;
}

async function createSession(c: C, userId: number) {
  const token = newToken();
  const id = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expires).run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

// ---------- Schutz gegen Cross-Site-Anfragen ----------
// Schreibende Anfragen müssen JSON sein und vom eigenen Origin kommen.
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) fail(403, 'Fremde Herkunft abgelehnt.');
    const ct = c.req.header('content-type') ?? '';
    if (!ct.includes('application/json')) fail(415, 'Bitte JSON senden.');
  }
  await next();
  c.header('Cache-Control', 'no-store');
});

// ---------- Ersteinrichtung ----------

app.get('/api/setup', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return c.json({ needed: (row?.n ?? 0) === 0 });
});

app.post('/api/setup', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((row?.n ?? 0) > 0) fail(409, 'Die Firma ist bereits gegründet.');
  if (!c.env.SETUP_TOKEN) fail(503, 'SETUP_TOKEN ist auf dem Server nicht gesetzt.');
  const b = await body(c);
  if (b.token !== c.env.SETUP_TOKEN) fail(403, 'Der Gründungsschlüssel stimmt nicht.');
  const username = str(b.username, 'Benutzername', { min: 3, max: 32 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) fail(400, 'Benutzername: nur a–z, 0–9, Punkt, Bindestrich, Unterstrich.');
  const display = str(b.display_name, 'Anzeigename', { max: 60 });
  const pw = validatePassword(b.password);
  const hash = await hashPassword(pw);
  const res = await c.env.DB.prepare(
    `INSERT INTO users (username, display_name, title, role, password_hash, must_change_password)
     VALUES (?, ?, 'CEO & Patriarch', 'admin', ?, 0)`
  )
    .bind(username, display, hash)
    .run();
  await createSession(c, Number(res.meta.last_row_id));
  return c.json({ ok: true });
});

// ---------- Login / Logout ----------

app.post('/api/auth/login', async (c) => {
  const b = await body(c);
  const username = str(b.username, 'Benutzername', { max: 64 }).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';

  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_failures WHERE username = ? AND at > datetime('now', '-15 minutes')`
  )
    .bind(username)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FAILURES) fail(429, 'Zu viele Fehlversuche. Warte 15 Minuten.');

  const u = await c.env.DB.prepare('SELECT id, password_hash, active FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: number; password_hash: string; active: number }>();
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);

  if (!u || !ok || !u.active) {
    await c.env.DB.prepare('INSERT INTO login_failures (username) VALUES (?)').bind(username).run();
    fail(401, u && ok && !u.active ? 'Dieser Zugang wurde deaktiviert.' : 'Benutzername oder Passwort stimmt nicht.');
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM login_failures WHERE username = ?').bind(username),
    c.env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(new Date().toISOString()),
  ]);
  await createSession(c, u!.id);
  return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ---------- Ab hier nur angemeldet ----------

async function auth(c: C, next: Next) {
  const token = getCookie(c, COOKIE);
  if (!token) fail(401, 'Bitte anmelden.');
  const id = await sha256Hex(token!);
  const u = await c.env.DB.prepare(
    `SELECT ${USER_COLS.split(', ').map((col) => 'u.' + col).join(', ')}
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`
  )
    .bind(id, new Date().toISOString())
    .first<User>();
  if (!u) fail(401, 'Sitzung abgelaufen. Bitte neu anmelden.');
  c.set('user', u!);
  // Wer ein Einmal-Passwort hat, darf nur das Passwort ändern.
  const path = new URL(c.req.url).pathname;
  if (u!.must_change_password && !['/api/me', '/api/me/password'].includes(path)) {
    fail(403, 'Bitte zuerst ein eigenes Passwort festlegen.');
  }
  await next();
}

function adminOnly(c: C) {
  if (c.get('user').role !== 'admin') fail(403, 'Nur für die Geschäftsführung.');
}

app.use('/api/me', auth);
app.use('/api/me/*', auth);
app.use('/api/users', auth);
app.use('/api/users/*', auth);
app.use('/api/time', auth);
app.use('/api/time/*', auth);
app.use('/api/sprints', auth);
app.use('/api/sprints/*', auth);
app.use('/api/tasks', auth);
app.use('/api/tasks/*', auth);

app.get('/api/me', (c) => c.json(c.get('user')));

app.post('/api/me/password', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(me.id).first<{ password_hash: string }>();
  if (!(await verifyPassword(String(b.current ?? ''), row!.password_hash))) fail(400, 'Das aktuelle Passwort stimmt nicht.');
  const pw = validatePassword(b.next);
  if (pw === b.current) fail(400, 'Das neue Passwort muss sich vom alten unterscheiden.');
  const token = getCookie(c, COOKIE)!;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').bind(await hashPassword(pw), me.id),
    // alle anderen Sitzungen beenden
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(me.id, await sha256Hex(token)),
  ]);
  return c.json({ ok: true });
});

// ---------- Personal ----------

app.get('/api/users', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${USER_COLS} FROM users ORDER BY role = 'admin' DESC, display_name`).all<User>();
  return c.json(results);
});

app.post('/api/users', async (c) => {
  adminOnly(c);
  const b = await body(c);
  const username = str(b.username, 'Benutzername', { min: 3, max: 32 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) fail(400, 'Benutzername: nur a–z, 0–9, Punkt, Bindestrich, Unterstrich.');
  const display = str(b.display_name, 'Anzeigename', { max: 60 });
  const title = str(b.title, 'Titel', { max: 40, optional: true }) || 'Unbezahlter Eimerträger';
  const role = b.role === 'admin' ? 'admin' : 'user';
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) fail(409, `„${username}“ ist bereits vergeben.`);
  const pw = tempPassword();
  const res = await c.env.DB.prepare(
    'INSERT INTO users (username, display_name, title, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)'
  )
    .bind(username, display, title, role, await hashPassword(pw))
    .run();
  return c.json({ id: res.meta.last_row_id, temp_password: pw }, 201);
});

async function adminCount(db: D1Database) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).first<{ n: number }>();
  return r?.n ?? 0;
}

app.patch('/api/users/:id', async (c) => {
  adminOnly(c);
  const id = Number(c.req.param('id'));
  const target = await c.env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) fail(404, 'Mitarbeiter nicht gefunden.');
  const b = await body(c);
  const display = b.display_name !== undefined ? str(b.display_name, 'Anzeigename', { max: 60 }) : target!.display_name;
  const title = b.title !== undefined ? str(b.title, 'Titel', { max: 40 }) : target!.title;
  const role = b.role === 'admin' || b.role === 'user' ? b.role : target!.role;
  const active = b.active === undefined ? target!.active : b.active ? 1 : 0;

  const losesAdmin = target!.role === 'admin' && target!.active && (role !== 'admin' || !active);
  if (losesAdmin && (await adminCount(c.env.DB)) <= 1) fail(400, 'Die Firma braucht mindestens eine aktive Geschäftsführung.');

  const stmts = [
    c.env.DB.prepare('UPDATE users SET display_name = ?, title = ?, role = ?, active = ? WHERE id = ?').bind(display, title, role, active, id),
  ];
  if (!active) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

app.post('/api/users/:id/reset-password', async (c) => {
  adminOnly(c);
  const id = Number(c.req.param('id'));
  const pw = tempPassword();
  const res = await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .bind(await hashPassword(pw), id)
    .run();
  if (!res.meta.changes) fail(404, 'Mitarbeiter nicht gefunden.');
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  return c.json({ temp_password: pw });
});

// MCP-Schlüssel: KI-Agenten dürfen damit im Namen des Mitarbeiters nur das Scrum-Board bearbeiten.
// Anlegen, ansehen und widerrufen darf nur die Geschäftsführung.

app.get('/api/users/:id/mcp-keys', async (c) => {
  adminOnly(c);
  const { results } = await c.env.DB.prepare(
    `SELECT k.id, k.label, k.hint, k.created_at, k.last_used_at, u.display_name AS created_by_name
     FROM mcp_keys k LEFT JOIN users u ON u.id = k.created_by WHERE k.user_id = ? ORDER BY k.created_at DESC`
  )
    .bind(Number(c.req.param('id')))
    .all();
  return c.json(results);
});

app.post('/api/users/:id/mcp-keys', async (c) => {
  adminOnly(c);
  const id = Number(c.req.param('id'));
  const u = await c.env.DB.prepare('SELECT active FROM users WHERE id = ?').bind(id).first<{ active: number }>();
  if (!u) fail(404, 'Mitarbeiter nicht gefunden.');
  if (!u!.active) fail(400, 'Deaktivierte Mitarbeiter bekommen keinen Schlüssel.');
  const b = await body(c);
  const label = str(b.label, 'Bezeichnung', { min: 0, max: 60, optional: true });
  const key = MCP_KEY_PREFIX + newToken();
  await c.env.DB.prepare('INSERT INTO mcp_keys (user_id, key_hash, hint, label, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(id, await sha256Hex(key), key.slice(-4), label, c.get('user').id)
    .run();
  return c.json({ key }, 201); // wird nur jetzt einmal angezeigt
});

app.delete('/api/users/:id/mcp-keys/:keyId', async (c) => {
  adminOnly(c);
  const res = await c.env.DB.prepare('DELETE FROM mcp_keys WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('keyId')), Number(c.req.param('id')))
    .run();
  if (!res.meta.changes) fail(404, 'Schlüssel nicht gefunden.');
  return c.json({ ok: true });
});

// ---------- Zeiterfassung ----------

type Entry = { id: number; user_id: number; started_at: string; ended_at: string | null; note: string; task_id: number | null };

app.get('/api/time', async (c) => {
  const me = c.get('user');
  const from = iso(c.req.query('from'), 'from');
  const to = iso(c.req.query('to'), 'to');
  const who = c.req.query('user');
  let userFilter = 'AND e.user_id = ?';
  const binds: unknown[] = [from, to];
  if (who === 'all') {
    adminOnly(c);
    userFilter = '';
  } else {
    const uid = who ? Number(who) : me.id;
    if (uid !== me.id) adminOnly(c);
    binds.push(uid);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, u.display_name, t.title AS task_title
     FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN tasks t ON t.id = e.task_id
     WHERE e.started_at >= ? AND e.started_at < ? ${userFilter}
     ORDER BY e.started_at DESC`
  )
    .bind(...binds)
    .all();
  return c.json(results);
});

app.get('/api/time/current', async (c) => {
  const e = await c.env.DB.prepare(
    `SELECT e.*, t.title AS task_title FROM time_entries e LEFT JOIN tasks t ON t.id = e.task_id
     WHERE e.user_id = ? AND e.ended_at IS NULL ORDER BY e.started_at DESC LIMIT 1`
  )
    .bind(c.get('user').id)
    .first();
  return c.json(e ?? null);
});

app.post('/api/time/start', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const open = await c.env.DB.prepare('SELECT id FROM time_entries WHERE user_id = ? AND ended_at IS NULL').bind(me.id).first();
  if (open) fail(409, 'Du bist bereits eingestempelt.');
  const note = str(b.note, 'Notiz', { min: 0, max: 300, optional: true });
  const task = int(b.task_id, 'Aufgabe');
  const res = await c.env.DB.prepare('INSERT INTO time_entries (user_id, started_at, note, task_id) VALUES (?, ?, ?, ?)')
    .bind(me.id, new Date().toISOString(), note, task)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.post('/api/time/stop', async (c) => {
  const me = c.get('user');
  const res = await c.env.DB.prepare('UPDATE time_entries SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL')
    .bind(new Date().toISOString(), me.id)
    .run();
  if (!res.meta.changes) fail(409, 'Du bist gerade nicht eingestempelt.');
  return c.json({ ok: true });
});

app.post('/api/time', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const start = iso(b.started_at, 'Beginn');
  const end = iso(b.ended_at, 'Ende');
  if (end <= start) fail(400, 'Das Ende muss nach dem Beginn liegen.');
  if (Date.parse(end) - Date.parse(start) > 16 * 3600e3) fail(400, 'Ein Eintrag darf höchstens 16 Stunden lang sein.');
  const note = str(b.note, 'Notiz', { min: 0, max: 300, optional: true });
  const task = int(b.task_id, 'Aufgabe');
  const res = await c.env.DB.prepare('INSERT INTO time_entries (user_id, started_at, ended_at, note, task_id) VALUES (?, ?, ?, ?, ?)')
    .bind(me.id, start, end, note, task)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

async function ownEntry(c: C) {
  const id = Number(c.req.param('id'));
  const e = await c.env.DB.prepare('SELECT * FROM time_entries WHERE id = ?').bind(id).first<Entry>();
  if (!e) fail(404, 'Eintrag nicht gefunden.');
  if (e!.user_id !== c.get('user').id) adminOnly(c);
  return e!;
}

app.patch('/api/time/:id', async (c) => {
  const e = await ownEntry(c);
  const b = await body(c);
  const start = b.started_at !== undefined ? iso(b.started_at, 'Beginn') : e.started_at;
  const end = b.ended_at !== undefined ? (b.ended_at === null ? null : iso(b.ended_at, 'Ende')) : e.ended_at;
  if (end && end <= start) fail(400, 'Das Ende muss nach dem Beginn liegen.');
  const note = b.note !== undefined ? str(b.note, 'Notiz', { min: 0, max: 300, optional: true }) : e.note;
  const task = b.task_id !== undefined ? int(b.task_id, 'Aufgabe') : e.task_id;
  await c.env.DB.prepare('UPDATE time_entries SET started_at = ?, ended_at = ?, note = ?, task_id = ? WHERE id = ?')
    .bind(start, end, note, task, e.id)
    .run();
  return c.json({ ok: true });
});

app.delete('/api/time/:id', async (c) => {
  const e = await ownEntry(c);
  await c.env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(e.id).run();
  return c.json({ ok: true });
});

// Wochenbilanz für alle: wer hat wie viel geschuftet?
app.get('/api/time/team', async (c) => {
  const from = iso(c.req.query('from'), 'from');
  const to = iso(c.req.query('to'), 'to');
  const now = new Date().toISOString();
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, u.title,
       COALESCE(SUM((julianday(COALESCE(e.ended_at, ?)) - julianday(e.started_at)) * 86400), 0) AS seconds,
       MAX(CASE WHEN e.ended_at IS NULL AND e.id IS NOT NULL THEN 1 ELSE 0 END) AS clocked_in
     FROM users u
     LEFT JOIN time_entries e ON e.user_id = u.id AND e.started_at >= ? AND e.started_at < ?
     WHERE u.active = 1
     GROUP BY u.id ORDER BY seconds DESC`
  )
    .bind(now, from, to)
    .all();
  return c.json(results);
});

// ---------- Sprints ----------

app.get('/api/sprints', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM sprints ORDER BY starts_on DESC').all();
  return c.json(results);
});

function dateOnly(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail(400, `${field} muss ein Datum sein.`);
  return v;
}

app.post('/api/sprints', async (c) => {
  adminOnly(c);
  const b = await body(c);
  const name = str(b.name, 'Name', { max: 60 });
  const goal = str(b.goal, 'Ziel', { min: 0, max: 300, optional: true });
  const s = dateOnly(b.starts_on, 'Start');
  const e = dateOnly(b.ends_on, 'Ende');
  if (e < s) fail(400, 'Der Sprint muss nach seinem Start enden.');
  const stmts = [];
  if (b.active) stmts.push(c.env.DB.prepare('UPDATE sprints SET active = 0'));
  stmts.push(
    c.env.DB.prepare('INSERT INTO sprints (name, goal, starts_on, ends_on, active) VALUES (?, ?, ?, ?, ?)').bind(name, goal, s, e, b.active ? 1 : 0)
  );
  const res = await c.env.DB.batch(stmts);
  return c.json({ id: res[res.length - 1].meta.last_row_id }, 201);
});

app.patch('/api/sprints/:id', async (c) => {
  adminOnly(c);
  const id = Number(c.req.param('id'));
  const sp = await c.env.DB.prepare('SELECT * FROM sprints WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!sp) fail(404, 'Sprint nicht gefunden.');
  const b = await body(c);
  const name = b.name !== undefined ? str(b.name, 'Name', { max: 60 }) : sp!.name;
  const goal = b.goal !== undefined ? str(b.goal, 'Ziel', { min: 0, max: 300, optional: true }) : sp!.goal;
  const s = b.starts_on !== undefined ? dateOnly(b.starts_on, 'Start') : sp!.starts_on;
  const e = b.ends_on !== undefined ? dateOnly(b.ends_on, 'Ende') : sp!.ends_on;
  const stmts = [];
  if (b.active) stmts.push(c.env.DB.prepare('UPDATE sprints SET active = 0'));
  const active = b.active === undefined ? sp!.active : b.active ? 1 : 0;
  stmts.push(c.env.DB.prepare('UPDATE sprints SET name = ?, goal = ?, starts_on = ?, ends_on = ?, active = ? WHERE id = ?').bind(name, goal, s, e, active, id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---------- Aufgaben (Scrum-Board) ----------
// Die Regeln stehen in tasks.ts und gelten genauso für den MCP-Zugang.

app.get('/api/tasks', async (c) => {
  const parent = Number(c.req.query('parent')) || undefined;
  return c.json(await listTasks(c.env.DB, { sprint: c.req.query('sprint'), parent }));
});

app.post('/api/tasks', async (c) => {
  return c.json(await createTask(c.env.DB, c.get('user').id, await body(c)), 201);
});

app.patch('/api/tasks/:id', async (c) => {
  const res = await updateTask(c.env.DB, Number(c.req.param('id')), await body(c));
  return c.json({ ok: true, ...res });
});

app.delete('/api/tasks/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await c.env.DB.prepare('SELECT created_by FROM tasks WHERE id = ?').bind(id).first<{ created_by: number }>();
  if (!t) fail(404, 'Aufgabe nicht gefunden.');
  if (t!.created_by !== c.get('user').id) adminOnly(c);
  // Teilaufgaben gehen mit (ON DELETE CASCADE, hier zur Sicherheit ausdrücklich).
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM tasks WHERE parent_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

app.all('/api/*', (c) => c.json({ error: 'Unbekannter Endpunkt.' }, 404));

// ---------- MCP für KI-Agenten (nur Scrum-Board) ----------
// Eigener Zugang per Bearer-Schlüssel. Sitzungs-Cookies gelten hier nicht, MCP-Schlüssel nicht unter /api.

app.all('/mcp', async (c) => {
  // Browser dürfen den Endpunkt nicht von fremden Seiten aus ansprechen (DNS-Rebinding).
  const origin = c.req.header('origin');
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: 'Fremde Herkunft abgelehnt.' }, 403);
  const user = await mcpUser(c.env.DB, c.req.header('authorization'));
  if (!user) {
    return c.json({ error: 'Gültiger MCP-Schlüssel fehlt.' }, 401, { 'WWW-Authenticate': 'Bearer realm="Bruno & Söhne Scrum-Board"' });
  }
  c.executionCtx.waitUntil(
    c.env.DB.prepare(`UPDATE mcp_keys SET last_used_at = datetime('now') WHERE id = ?`).bind(user.key_id).run()
  );
  return handleMcp(c.req.raw, c.env.DB, user);
});

// Alles andere: die Single-Page-App
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
