// Aufgaben des Scrum-Boards: eine Logik für App-API und MCP, damit die Regeln überall gleich gelten.

import { fail, int, str } from './util';

export const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export type Task = {
  id: number;
  title: string;
  description: string;
  status: Status;
  assignee_id: number | null;
  sprint_id: number | null;
  position: number;
  parent_id: number | null;
  created_by: number | null;
};

// Wie Task, ergänzt um Namen und Fortschritt der Teilaufgaben
export type TaskRow = Task & { assignee_name: string | null; parent_title: string | null; sub_total: number; sub_done: number };

export type TaskFilter = {
  id?: number;
  sprint?: string; // Sprint-ID oder 'none'
  parent?: number;
  assignee?: number | 'none';
  status?: Status;
  query?: string;
};

export async function listTasks(db: D1Database, f: TaskFilter = {}): Promise<TaskRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.id) {
    where.push('t.id = ?');
    binds.push(f.id);
  }
  if (f.sprint === 'none') where.push('t.sprint_id IS NULL');
  else if (f.sprint) {
    where.push('t.sprint_id = ?');
    binds.push(Number(f.sprint));
  }
  if (f.parent) {
    where.push('t.parent_id = ?');
    binds.push(f.parent);
  }
  if (f.assignee === 'none') where.push('t.assignee_id IS NULL');
  else if (f.assignee) {
    where.push('t.assignee_id = ?');
    binds.push(f.assignee);
  }
  if (f.status) {
    where.push('t.status = ?');
    binds.push(f.status);
  }
  if (f.query) {
    where.push(`(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')`);
    const like = '%' + f.query.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
    binds.push(like, like);
  }
  const { results } = await db
    .prepare(
      `SELECT t.*, u.display_name AS assignee_name, p.title AS parent_title,
         (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS sub_total,
         (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS sub_done
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN tasks p ON p.id = t.parent_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.position, t.id`
    )
    .bind(...binds)
    .all<TaskRow>();
  return results;
}

export async function getTask(db: D1Database, id: number): Promise<Task> {
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Task>();
  if (!t) fail(404, `Aufgabe #${id} nicht gefunden.`);
  return t!;
}

export function status(v: unknown): Status {
  if (!STATUSES.includes(v as Status)) return fail(400, 'Unbekannte Spalte.');
  return v as Status;
}

// Übergeordnete Aufgabe prüfen: muss existieren und darf selbst keine Teilaufgabe sein (nur eine Ebene).
async function parentTask(db: D1Database, pid: number | null, selfId?: number): Promise<Task | null> {
  if (pid === null) return null;
  if (pid === selfId) fail(400, 'Eine Aufgabe kann nicht ihre eigene Teilaufgabe sein.');
  const p = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(pid).first<Task>();
  if (!p) fail(404, 'Übergeordnete Aufgabe nicht gefunden.');
  if (p!.parent_id) fail(400, 'Teilaufgaben können keine eigenen Teilaufgaben haben.');
  return p!;
}

async function checkAssignee(db: D1Database, id: number | null) {
  if (id === null) return;
  const u = await db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').bind(id).first();
  if (!u) fail(404, `Mitarbeiter #${id} nicht gefunden oder deaktiviert.`);
}

async function checkSprint(db: D1Database, id: number | null) {
  if (id === null) return;
  const s = await db.prepare('SELECT 1 FROM sprints WHERE id = ?').bind(id).first();
  if (!s) fail(404, `Sprint #${id} nicht gefunden.`);
}

export async function openSubtasks(db: D1Database, id: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ? AND status != 'done'`).bind(id).first<{ n: number }>();
  return r?.n ?? 0;
}

// Eine erledigte Aufgabe mit offener Teilaufgabe ist nicht erledigt: zurück in Arbeit.
const reopenTask = (db: D1Database, id: number) =>
  db.prepare(`UPDATE tasks SET status = 'doing', updated_at = datetime('now') WHERE id = ?`).bind(id);

// Position am Ende (oder Anfang) einer Spalte
export async function edgePosition(db: D1Database, st: Status, where: 'top' | 'bottom' = 'bottom'): Promise<number> {
  const r = await db
    .prepare(`SELECT COALESCE(${where === 'top' ? 'MIN' : 'MAX'}(position), 0) AS p FROM tasks WHERE status = ?`)
    .bind(st)
    .first<{ p: number }>();
  return where === 'top' ? (r?.p ?? 0) - 1 : (r?.p ?? 0) + 1;
}

export async function createTask(db: D1Database, userId: number, b: Record<string, unknown>) {
  const title = str(b.title, 'Titel', { max: 140 });
  const desc = str(b.description, 'Beschreibung', { min: 0, max: 4000, optional: true });
  const st = b.status !== undefined ? status(b.status) : 'backlog';
  const assignee = int(b.assignee_id, 'Zuständig');
  await checkAssignee(db, assignee);
  const parent = await parentTask(db, int(b.parent_id, 'Übergeordnete Aufgabe'));
  // Teilaufgaben laufen immer im Sprint ihrer übergeordneten Aufgabe.
  const sprint = parent ? parent.sprint_id : int(b.sprint_id, 'Sprint');
  await checkSprint(db, sprint);
  const stmts = [
    db
      .prepare(
        'INSERT INTO tasks (title, description, status, assignee_id, sprint_id, position, parent_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(title, desc, st, assignee, sprint, await edgePosition(db, st), parent?.id ?? null, userId),
  ];
  const reopen = parent?.status === 'done' && st !== 'done';
  if (reopen) stmts.push(reopenTask(db, parent!.id));
  const res = await db.batch(stmts);
  return { id: Number(res[0].meta.last_row_id), reopened: reopen ? parent!.id : null };
}

export async function updateTask(db: D1Database, id: number, b: Record<string, unknown>) {
  const t = await getTask(db, id);
  const next = {
    title: b.title !== undefined ? str(b.title, 'Titel', { max: 140 }) : t.title,
    description: b.description !== undefined ? str(b.description, 'Beschreibung', { min: 0, max: 4000, optional: true }) : t.description,
    status: b.status !== undefined ? status(b.status) : t.status,
    assignee_id: b.assignee_id !== undefined ? int(b.assignee_id, 'Zuständig') : t.assignee_id,
    sprint_id: b.sprint_id !== undefined ? int(b.sprint_id, 'Sprint') : t.sprint_id,
    position: b.position !== undefined ? Number(b.position) : t.position,
    parent_id: b.parent_id !== undefined ? int(b.parent_id, 'Übergeordnete Aufgabe') : t.parent_id,
  };
  if (!Number.isFinite(next.position)) fail(400, 'Ungültige Position.');
  if (next.assignee_id !== t.assignee_id) await checkAssignee(db, next.assignee_id);

  const parent = await parentTask(db, next.parent_id, id);
  if (parent && next.parent_id !== t.parent_id && (await db.prepare('SELECT 1 FROM tasks WHERE parent_id = ? LIMIT 1').bind(id).first())) {
    fail(400, 'Diese Aufgabe hat eigene Teilaufgaben und kann keine Teilaufgabe werden.');
  }
  if (parent) next.sprint_id = parent.sprint_id;
  if (next.sprint_id !== t.sprint_id) await checkSprint(db, next.sprint_id);
  if (next.status === 'done' && t.status !== 'done') {
    const open = await openSubtasks(db, id);
    if (open) fail(409, `Erst alle Teilaufgaben erledigen. ${open === 1 ? 'Eine ist' : `${open} sind`} noch offen.`);
  }

  const stmts = [
    db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, status = ?, assignee_id = ?, sprint_id = ?, position = ?, parent_id = ?,
         updated_at = datetime('now') WHERE id = ?`
      )
      .bind(next.title, next.description, next.status, next.assignee_id, next.sprint_id, next.position, next.parent_id, id),
  ];
  // Teilaufgaben ziehen mit, wenn die Aufgabe den Sprint wechselt.
  if (next.sprint_id !== t.sprint_id) stmts.push(db.prepare('UPDATE tasks SET sprint_id = ? WHERE parent_id = ?').bind(next.sprint_id, id));
  const reopen = parent?.status === 'done' && next.status !== 'done';
  if (reopen) stmts.push(reopenTask(db, parent!.id));
  await db.batch(stmts);

  // Letzte offene Teilaufgabe erledigt? Dann darf die übergeordnete Aufgabe nach „Erledigt“.
  const parentReady =
    parent && parent.status !== 'done' && next.status === 'done' && t.status !== 'done' && !(await openSubtasks(db, parent.id));
  return { reopened: reopen ? parent!.id : null, parent_ready: parentReady ? parent!.id : null };
}
