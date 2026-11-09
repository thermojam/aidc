BEGIN;
CREATE TABLE agent_tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('awaiting_approval', 'completed', 'denied')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE agent_task_steps (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  action TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('pending', 'approved', 'denied')),
  result TEXT,
  decided_at INTEGER,
  UNIQUE(task_id, ordinal)
);
CREATE UNIQUE INDEX one_pending_agent_step ON agent_task_steps(task_id) WHERE decision='pending';
PRAGMA user_version = 14;
COMMIT;
