-- Bruno & Söhne Intranet – Grundschema

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT 'Unbezahlter Eimerträger',
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256 des Tokens, nie das Token selbst
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_failures (
  username TEXT NOT NULL COLLATE NOCASE,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_failures ON login_failures(username, at);

CREATE TABLE time_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,             -- ISO 8601 UTC
  ended_at   TEXT,                      -- NULL = läuft gerade
  note       TEXT NOT NULL DEFAULT '',
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_time_user ON time_entries(user_id, started_at);

CREATE TABLE sprints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  goal       TEXT NOT NULL DEFAULT '',
  starts_on  TEXT NOT NULL,
  ends_on    TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'backlog'
              CHECK (status IN ('backlog', 'todo', 'doing', 'review', 'done')),
  points      INTEGER,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sprint_id   INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
  position    REAL NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_status ON tasks(status, position);
