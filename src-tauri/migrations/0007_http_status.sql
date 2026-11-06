BEGIN;
ALTER TABLE attempts ADD COLUMN http_status INTEGER;
PRAGMA user_version = 6;
COMMIT;
