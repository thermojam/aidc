BEGIN;
CREATE TABLE model_catalog_snapshots (
  id INTEGER PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  data_json TEXT NOT NULL
);
ALTER TABLE attempts ADD COLUMN model_id TEXT;
ALTER TABLE attempts ADD COLUMN pricing_json TEXT;
ALTER TABLE attempts ADD COLUMN catalog_fetched_at INTEGER;
ALTER TABLE attempts ADD COLUMN context_json TEXT;
PRAGMA user_version = 3;
COMMIT;
