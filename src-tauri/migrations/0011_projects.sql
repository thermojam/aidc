BEGIN;
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1))
);
ALTER TABLE conversations ADD COLUMN project_id INTEGER REFERENCES projects(id);
PRAGMA user_version = 10;
COMMIT;
