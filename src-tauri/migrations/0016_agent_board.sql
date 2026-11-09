BEGIN;
CREATE TABLE agent_plan_steps (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  UNIQUE(conversation_id, ordinal)
);
CREATE TABLE agent_queue_items (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'submitted')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  submitted_at INTEGER
);
CREATE TABLE agent_steering_notes (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'submitted')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  submitted_at INTEGER
);
CREATE INDEX agent_plan_conversation_order ON agent_plan_steps(conversation_id, ordinal);
CREATE INDEX agent_queue_conversation_order ON agent_queue_items(conversation_id, id);
CREATE INDEX agent_steering_conversation_order ON agent_steering_notes(conversation_id, id);
PRAGMA user_version = 15;
COMMIT;
