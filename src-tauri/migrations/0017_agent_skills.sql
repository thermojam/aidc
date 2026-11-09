BEGIN;
CREATE TABLE conversation_agent_skills (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES project_materials(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1))
);
PRAGMA user_version = 16;
COMMIT;
