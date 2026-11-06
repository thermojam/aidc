PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE messages_new (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed', 'streaming', 'interrupted', 'stopped', 'failed')),
  conversation_id INTEGER REFERENCES conversations(id),
  parent_id INTEGER REFERENCES messages(id)
);
INSERT INTO messages_new SELECT id, role, content, status, conversation_id, parent_id FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE TABLE attempts_new (
  id INTEGER PRIMARY KEY,
  assistant_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
  status TEXT NOT NULL CHECK(status IN ('streaming', 'completed', 'interrupted', 'stopped', 'failed')),
  last_seq INTEGER NOT NULL DEFAULT 0,
  conversation_id INTEGER REFERENCES conversations(id),
  user_message_id INTEGER REFERENCES messages(id),
  model_id TEXT,
  pricing_json TEXT,
  catalog_fetched_at INTEGER,
  context_json TEXT,
  server_response_id TEXT,
  server_request_id TEXT,
  usage_json TEXT,
  error_code TEXT
);
INSERT INTO attempts_new(id, assistant_id, status, last_seq, conversation_id, user_message_id,
  model_id, pricing_json, catalog_fetched_at, context_json)
SELECT id, assistant_id, status, last_seq, conversation_id, user_message_id,
  model_id, pricing_json, catalog_fetched_at, context_json FROM attempts;
DROP TABLE attempts;
ALTER TABLE attempts_new RENAME TO attempts;
PRAGMA user_version = 5;
COMMIT;
PRAGMA foreign_keys=ON;
