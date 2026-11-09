BEGIN;
ALTER TABLE conversations ADD COLUMN title TEXT NOT NULL DEFAULT 'Локальный чат';
ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1));
PRAGMA user_version = 8;
COMMIT;
