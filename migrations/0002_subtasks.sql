-- Teilaufgaben: eine Ebene tief, hängen fest an ihrer übergeordneten Aufgabe.
-- Sie erben deren Sprint und verschwinden mit ihr.

ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
