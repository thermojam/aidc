BEGIN;
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  active_leaf_id INTEGER REFERENCES messages(id)
);
INSERT INTO conversations(id) VALUES (1);
ALTER TABLE messages ADD COLUMN conversation_id INTEGER REFERENCES conversations(id);
ALTER TABLE messages ADD COLUMN parent_id INTEGER REFERENCES messages(id);
ALTER TABLE attempts ADD COLUMN conversation_id INTEGER REFERENCES conversations(id);
ALTER TABLE attempts ADD COLUMN user_message_id INTEGER REFERENCES messages(id);
UPDATE messages SET conversation_id = 1;
UPDATE messages SET parent_id = (
  SELECT MAX(a.assistant_id) FROM attempts a WHERE a.assistant_id < messages.id
) WHERE role = 'user';
UPDATE messages SET parent_id = (
  SELECT MAX(u.id) FROM messages u WHERE u.role = 'user' AND u.id < messages.id
) WHERE role = 'assistant';
UPDATE attempts SET conversation_id = 1,
  user_message_id = (SELECT parent_id FROM messages WHERE id = assistant_id);
UPDATE conversations SET active_leaf_id = (SELECT MAX(id) FROM messages);
PRAGMA user_version = 1;
COMMIT;
