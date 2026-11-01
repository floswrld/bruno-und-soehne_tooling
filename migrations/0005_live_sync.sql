-- Live-Abgleich aus dem Minecraft-Client (Mod „Bruno Live“, Ordner mod/).

-- Standort des Gebäudes in der Welt und Adresse des Servers. Genau eine Zeile.
CREATE TABLE bauplan_einstellung (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  anker_x INTEGER,
  anker_y INTEGER,
  anker_z INTEGER,
  server TEXT NOT NULL DEFAULT ''        -- Nur auf diesem Server meldet die Mod etwas.
);

-- Schlüssel der Mod. Je Mitarbeiter einer, gespeichert wird nur der Hash. Darf nur /api/mc/*.
CREATE TABLE mc_keys (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Letzte Meldung je Mitarbeiter: eine Zeile, die überschrieben wird. Hält die Schreibzugriffe klein.
CREATE TABLE mc_reporter (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mc_name TEXT NOT NULL,
  x INTEGER, y INTEGER, z INTEGER,
  dimension TEXT,
  online TEXT NOT NULL DEFAULT '[]',     -- JSON: alle Namen aus der Tab-Liste
  gesehen_am INTEGER NOT NULL            -- Millisekunden
);

-- Stand je Welt-Chunk. Eine Zeile je Chunk statt je Block: So bleibt das Gratis-Schreiblimit weit weg.
CREATE TABLE bauplan_live_chunk (
  cx INTEGER NOT NULL,
  cz INTEGER NOT NULL,
  plan_hash TEXT NOT NULL,
  n INTEGER NOT NULL,                    -- Planblöcke in diesem Chunk
  gebaut TEXT NOT NULL,                  -- Bitfeld als Base64, in Reihenfolge der Plannummern
  falsch TEXT NOT NULL DEFAULT '{}',     -- JSON: gefundener Block -> Positionen im Chunk
  am INTEGER NOT NULL,                   -- Millisekunden
  PRIMARY KEY (cx, cz)
);
CREATE INDEX idx_live_chunk_am ON bauplan_live_chunk(am);

-- Was zuletzt passiert ist, für die Live-Anzeige. Wird klein gehalten.
CREATE TABLE bauplan_ereignis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mc_name TEXT NOT NULL,
  plus INTEGER NOT NULL DEFAULT 0,
  minus INTEGER NOT NULL DEFAULT 0,
  falsch INTEGER NOT NULL DEFAULT 0,
  bloecke TEXT NOT NULL DEFAULT '{}',    -- JSON: Block -> Anzahl neu gesetzt
  am INTEGER NOT NULL
);
CREATE INDEX idx_ereignis_am ON bauplan_ereignis(am);
