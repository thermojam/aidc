BEGIN;
CREATE TABLE model_categories (
  model_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('thinking', 'speed', 'economy')),
  source TEXT NOT NULL DEFAULT 'user',
  updated_at INTEGER NOT NULL
);
PRAGMA user_version = 4;
COMMIT;
