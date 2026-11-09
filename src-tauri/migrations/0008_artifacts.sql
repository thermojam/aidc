BEGIN;
CREATE TABLE artifact_versions (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  previous_version_id INTEGER REFERENCES artifact_versions(id),
  kind TEXT NOT NULL CHECK(kind IN ('code', 'html', 'svg')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
PRAGMA user_version = 7;
COMMIT;
