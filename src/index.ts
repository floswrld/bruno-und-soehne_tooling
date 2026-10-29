import { Hono, type Context, type Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256Hex, tempPassword } from './crypto';

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
const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done'] as const;
const USER_COLS = 'id, username, display_name, title, role, must_change_password, active, created_at';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- Hilfsfunktionen ----------

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

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

function str(v: unknown, field: string, { min = 1, max = 200, optional = false } = {}): string {
  if (v === undefined || v === null) {
    if (optional) return '';
    return fail(400, `${field} fehlt.`);
  }
  if (typeof v !== 'string') return fail(400, `${field} muss Text sein.`);
  const s = v.trim();
  if (s.length < min) return fail(400, `${field} ist zu kurz (mindestens ${min} Zeichen).`);
  if (s.length > max) return fail(400, `${field} ist zu lang (höchstens ${max} Zeichen).`);
  return s;
}

function int(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) return fail(400, `${field} muss eine ganze Zahl sein.`);
  return n;
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

type Task = {
  id: number;
  title: string;
  description: string;
  status: (typeof STATUSES)[number];
  points: number | null;
  assignee_id: number | null;
  sprint_id: number | null;
  position: number;
  parent_id: number | null;
  created_by: number | null;
};

app.get('/api/tasks', async (c) => {
  const sprint = c.req.query('sprint');
  const parent = c.req.query('parent');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (sprint === 'none') where.push('t.sprint_id IS NULL');
  else if (sprint) {
    where.push('t.sprint_id = ?');
    binds.push(Number(sprint));
  }
  if (parent) {
    where.push('t.parent_id = ?');
    binds.push(Number(parent));
  }
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, u.display_name AS assignee_name, p.title AS parent_title,
       (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS sub_total,
       (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS sub_done
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN tasks p ON p.id = t.parent_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.position, t.id`
  )
    .bind(...binds)
    .all();
  return c.json(results);
});

// Übergeordnete Aufgabe prüfen: muss existieren und darf selbst keine Teilaufgabe sein (nur eine Ebene).
async function parentTask(db: D1Database, pid: number | null, selfId?: number): Promise<Task | null> {
  if (pid === null) return null;
  if (pid === selfId) fail(400, 'Eine Aufgabe kann nicht ihre eigene Teilaufgabe sein.');
  const p = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(pid).first<Task>();
  if (!p) fail(404, 'Übergeordnete Aufgabe nicht gefunden.');
  if (p!.parent_id) fail(400, 'Teilaufgaben können keine eigenen Teilaufgaben haben.');
  return p!;
}

async function openSubtasks(db: D1Database, id: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ? AND status != 'done'`).bind(id).first<{ n: number }>();
  return r?.n ?? 0;
}

// Eine erledigte Aufgabe mit offener Teilaufgabe ist nicht erledigt: zurück in Arbeit.
const reopenTask = (db: D1Database, id: number) =>
  db.prepare(`UPDATE tasks SET status = 'doing', updated_at = datetime('now') WHERE id = ?`).bind(id);

function status(v: unknown): string {
  if (!STATUSES.includes(v as (typeof STATUSES)[number])) return fail(400, 'Unbekannte Spalte.');
  return v as string;
}

function points(v: unknown): number | null {
  const n = int(v, 'Story Points');
  if (n !== null && (n < 0 || n > 100)) fail(400, 'Story Points: 0 bis 100.');
  return n;
}

app.post('/api/tasks', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const title = str(b.title, 'Titel', { max: 140 });
  const desc = str(b.description, 'Beschreibung', { min: 0, max: 4000, optional: true });
  const st = b.status !== undefined ? status(b.status) : 'backlog';
  const db = c.env.DB;
  const parent = await parentTask(db, int(b.parent_id, 'Übergeordnete Aufgabe'));
  // Teilaufgaben laufen immer im Sprint ihrer übergeordneten Aufgabe.
  const sprint = parent ? parent.sprint_id : int(b.sprint_id, 'Sprint');
  const max = await db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM tasks WHERE status = ?').bind(st).first<{ p: number }>();
  const stmts = [
    db
      .prepare(
        'INSERT INTO tasks (title, description, status, points, assignee_id, sprint_id, position, parent_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(title, desc, st, points(b.points), int(b.assignee_id, 'Zuständig'), sprint, (max?.p ?? 0) + 1, parent?.id ?? null, me.id),
  ];
  const reopen = parent?.status === 'done' && st !== 'done';
  if (reopen) stmts.push(reopenTask(db, parent!.id));
  const res = await db.batch(stmts);
  return c.json({ id: res[0].meta.last_row_id, reopened: reopen ? parent!.id : null }, 201);
});

app.patch('/api/tasks/:id', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Task>();
  if (!t) fail(404, 'Aufgabe nicht gefunden.');
  const b = await body(c);
  const next = {
    title: b.title !== undefined ? str(b.title, 'Titel', { max: 140 }) : t!.title,
    description: b.description !== undefined ? str(b.description, 'Beschreibung', { min: 0, max: 4000, optional: true }) : t!.description,
    status: b.status !== undefined ? status(b.status) : t!.status,
    points: b.points !== undefined ? points(b.points) : t!.points,
    assignee_id: b.assignee_id !== undefined ? int(b.assignee_id, 'Zuständig') : t!.assignee_id,
    sprint_id: b.sprint_id !== undefined ? int(b.sprint_id, 'Sprint') : t!.sprint_id,
    position: b.position !== undefined ? Number(b.position) : t!.position,
    parent_id: b.parent_id !== undefined ? int(b.parent_id, 'Übergeordnete Aufgabe') : t!.parent_id,
  };
  if (!Number.isFinite(next.position)) fail(400, 'Ungültige Position.');

  const parent = await parentTask(db, next.parent_id, id);
  if (parent && next.parent_id !== t!.parent_id && (await db.prepare('SELECT 1 FROM tasks WHERE parent_id = ? LIMIT 1').bind(id).first())) {
    fail(400, 'Diese Aufgabe hat eigene Teilaufgaben und kann keine Teilaufgabe werden.');
  }
  if (parent) next.sprint_id = parent.sprint_id;
  if (next.status === 'done' && t!.status !== 'done') {
    const open = await openSubtasks(db, id);
    if (open) fail(409, `Erst alle Teilaufgaben erledigen. ${open === 1 ? 'Eine ist' : `${open} sind`} noch offen.`);
  }

  const stmts = [
    db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, status = ?, points = ?, assignee_id = ?, sprint_id = ?, position = ?, parent_id = ?,
         updated_at = datetime('now') WHERE id = ?`
      )
      .bind(next.title, next.description, next.status, next.points, next.assignee_id, next.sprint_id, next.position, next.parent_id, id),
  ];
  // Teilaufgaben ziehen mit, wenn die Aufgabe den Sprint wechselt.
  if (next.sprint_id !== t!.sprint_id) stmts.push(db.prepare('UPDATE tasks SET sprint_id = ? WHERE parent_id = ?').bind(next.sprint_id, id));
  const reopen = parent?.status === 'done' && next.status !== 'done';
  if (reopen) stmts.push(reopenTask(db, parent!.id));
  await db.batch(stmts);

  // Letzte offene Teilaufgabe erledigt? Dann darf die übergeordnete Aufgabe nach „Erledigt“.
  const parentReady =
    parent && parent.status !== 'done' && next.status === 'done' && t!.status !== 'done' && !(await openSubtasks(db, parent.id));
  return c.json({ ok: true, reopened: reopen ? parent!.id : null, parent_ready: parentReady ? parent!.id : null });
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

// Alles andere: die Single-Page-App
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
