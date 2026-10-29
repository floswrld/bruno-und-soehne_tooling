-- MCP-Schlüssel: KI-Agenten dürfen damit nur das Scrum-Board bearbeiten.
-- Nur die Geschäftsführung legt sie an. Gespeichert wird nur der SHA-256-Hash.

CREATE TABLE mcp_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- in wessen Namen der Agent arbeitet
  key_hash     TEXT NOT NULL UNIQUE,
  hint         TEXT NOT NULL,                                            -- letzte Zeichen, zum Wiedererkennen
  label        TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX idx_mcp_keys_user ON mcp_keys(user_id);
