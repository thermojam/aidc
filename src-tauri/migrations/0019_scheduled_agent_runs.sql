BEGIN;
CREATE TABLE scheduled_agent_runs (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES scheduled_agent_tasks(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL,
  assistant_id INTEGER UNIQUE REFERENCES messages(id),
  notified_at INTEGER,
  UNIQUE(task_id, due_at)
);
PRAGMA user_version = 18;
COMMIT;
