BEGIN;
CREATE TABLE project_folders (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL
);
PRAGMA user_version = 12;
COMMIT;
