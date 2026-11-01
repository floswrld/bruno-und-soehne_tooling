-- Letzter Abgleich des Bauplans mit der Minecraft-Welt. Genau eine Zeile.
CREATE TABLE bauplan_fortschritt (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  plan_hash TEXT NOT NULL,
  gebaut TEXT NOT NULL,                -- Bitfeld als Base64, ein Bit je Planblock
  gebaut_anzahl INTEGER NOT NULL,
  falsch TEXT NOT NULL DEFAULT '{}',   -- JSON: gefundener Block -> Nummern der Planblöcke
  gescannt_am TEXT NOT NULL
);
