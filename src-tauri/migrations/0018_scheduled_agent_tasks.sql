BEGIN;
CREATE TABLE scheduled_agent_tasks (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
  prompt TEXT NOT NULL CHECK(length(trim(prompt)) BETWEEN 1 AND 2000),
  interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 1 AND 10080),
  next_run_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'awaiting_confirmation', 'stopped')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  due_at INTEGER
);
CREATE UNIQUE INDEX one_active_schedule_per_prompt
  ON scheduled_agent_tasks(conversation_id, prompt)
  WHERE status IN ('active', 'awaiting_confirmation');
PRAGMA user_version = 17;
COMMIT;
