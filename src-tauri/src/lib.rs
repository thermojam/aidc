use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{ipc::Channel, Manager, State};

type Db = Arc<Mutex<Connection>>;

struct AppState {
    db: Db,
    active: Arc<Mutex<Option<(i64, Arc<AtomicBool>)>>>,
    key_lock: Mutex<()>,
}

#[derive(Serialize)]
struct Message {
    id: i64,
    role: String,
    content: String,
    status: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
enum StreamEvent {
    Delta { attempt_id: i64, seq: i64, text: String },
    End { attempt_id: i64, status: String },
}

fn init_db(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         BEGIN;
         CREATE TABLE IF NOT EXISTS messages (
           id INTEGER PRIMARY KEY,
           role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
           content TEXT NOT NULL,
           status TEXT NOT NULL CHECK(status IN ('completed', 'streaming', 'interrupted', 'stopped'))
         );
         CREATE TABLE IF NOT EXISTS attempts (
           id INTEGER PRIMARY KEY,
           assistant_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
           status TEXT NOT NULL CHECK(status IN ('streaming', 'completed', 'interrupted', 'stopped')),
           last_seq INTEGER NOT NULL DEFAULT 0
         );
         UPDATE messages SET status='interrupted' WHERE status='streaming';
         UPDATE attempts SET status='interrupted' WHERE status='streaming';
         COMMIT;",
    )?;
    let version: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version == 0 {
        db.execute_batch(include_str!("../migrations/0002_tree.sql"))?;
    }
    Ok(())
}

#[tauri::command]
fn list_history(state: State<'_, AppState>) -> Result<Vec<Message>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut statement = db
        .prepare("SELECT id, role, content, status FROM messages ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Message {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                status: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.nikitamensky.ai-desktop-client", "simpleclaw")
        .map_err(|_| "Не удалось открыть системное хранилище".into())
}

fn save_key_for(entry: &keyring::Entry, key: &str) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("Введите ключ".into());
    }
    entry.set_password(key).map_err(|_| "Не удалось сохранить ключ".into())
}

fn key_status_for(entry: &keyring::Entry) -> Result<bool, String> {
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("Не удалось проверить ключ".into()),
    }
}

fn delete_key_for(entry: &keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Не удалось удалить ключ".into()),
    }
}

#[tauri::command]
fn save_key(key: String, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.key_lock.lock().map_err(|_| "Хранилище занято")?;
    save_key_for(&key_entry()?, &key)
}

#[tauri::command]
fn key_status(state: State<'_, AppState>) -> Result<bool, String> {
    let _guard = state.key_lock.lock().map_err(|_| "Хранилище занято")?;
    key_status_for(&key_entry()?)
}

#[tauri::command]
fn delete_key(state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.key_lock.lock().map_err(|_| "Хранилище занято")?;
    delete_key_for(&key_entry()?)
}

fn backup_history_to(db: &Connection, path: &Path) -> rusqlite::Result<()> {
    let mut target = Connection::open(path)?;
    {
        let backup = rusqlite::backup::Backup::new(db, &mut target)?;
        backup.run_to_completion(100, Duration::from_millis(50), None)?;
    }
    drop(target);
    let check = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = check.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    let foreign_keys: i64 = check.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| row.get(0))?;
    if integrity != "ok" || foreign_keys != 0 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

#[tauri::command]
fn create_backup(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let directory = app.path().app_data_dir().map_err(|_| "Не удалось открыть каталог данных")?.join("backups");
    std::fs::create_dir_all(&directory).map_err(|_| "Не удалось создать каталог копий")?;
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Не удалось создать имя копии")?.as_nanos();
    let path = directory.join(format!("history-{timestamp}.sqlite"));
    let db = state.db.lock().map_err(|_| "База занята")?;
    if let Err(_) = backup_history_to(&db, &path) {
        let _ = std::fs::remove_file(&path);
        return Err("Не удалось создать проверенную копию".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

fn create_attempt(db: &mut Connection, prompt: &str) -> rusqlite::Result<i64> {
    let tx = db.transaction()?;
    let parent_id: Option<i64> = tx.query_row(
        "SELECT active_leaf_id FROM conversations WHERE id=1",
        [],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO messages(role, content, status, conversation_id, parent_id) VALUES('user', ?1, 'completed', 1, ?2)",
        params![prompt, parent_id],
    )?;
    let user_message_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO messages(role, content, status, conversation_id, parent_id) VALUES('assistant', '', 'streaming', 1, ?1)",
        [user_message_id],
    )?;
    let assistant_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO attempts(assistant_id, status, conversation_id, user_message_id) VALUES(?1, 'streaming', 1, ?2)",
        params![assistant_id, user_message_id],
    )?;
    let attempt_id = tx.last_insert_rowid();
    tx.execute(
        "UPDATE conversations SET active_leaf_id=?1 WHERE id=1",
        [assistant_id],
    )?;
    tx.commit()?;
    Ok(attempt_id)
}

fn append_delta(db: &mut Connection, attempt_id: i64, seq: i64, text: &str) -> rusqlite::Result<()> {
    let tx = db.transaction()?;
    tx.execute(
        "UPDATE messages SET content=content || ?1 WHERE id=(SELECT assistant_id FROM attempts WHERE id=?2)",
        params![text, attempt_id],
    )?;
    tx.execute(
        "UPDATE attempts SET last_seq=?1 WHERE id=?2",
        params![seq, attempt_id],
    )?;
    tx.commit()
}

fn finish(db: &Connection, attempt_id: i64, status: &str) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE messages SET status=?1 WHERE id=(SELECT assistant_id FROM attempts WHERE id=?2)",
        params![status, attempt_id],
    )?;
    db.execute(
        "UPDATE attempts SET status=?1 WHERE id=?2",
        params![status, attempt_id],
    )?;
    Ok(())
}

// Keep raw bytes until a whole SSE event arrives; a TCP chunk may split UTF-8 or JSON.
#[derive(Default)]
struct SseParser(Vec<u8>);

impl SseParser {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.0.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(end) = self.0.windows(2).position(|bytes| bytes == b"\n\n") {
            let raw: Vec<u8> = self.0.drain(..end + 2).collect();
            let text = std::str::from_utf8(&raw).map_err(|e| e.to_string())?;
            let data = text
                .lines()
                .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() {
                events.push(data);
            }
        }
        Ok(events)
    }
}

fn mock_stream(prompt: &str) -> Vec<u8> {
    let answer = format!("Локальный тестовый ответ на: {prompt}");
    let mut bytes = Vec::new();
    for part in answer.chars().collect::<Vec<_>>().chunks(8) {
        let text: String = part.iter().collect();
        bytes.extend(format!("data: {}\n\n", serde_json::json!({ "delta": text })).as_bytes());
    }
    bytes.extend_from_slice(b"data: [DONE]\n\n");
    bytes
}

fn run_stream(db: Db, active: Arc<Mutex<Option<(i64, Arc<AtomicBool>)>>>, cancel: Arc<AtomicBool>, attempt_id: i64, bytes: Vec<u8>, on_event: Channel<StreamEvent>) {
    let mut parser = SseParser::default();
    let mut seq = 0;
    let mut status = "interrupted";
    'stream: for chunk in bytes.chunks(7) {
        if cancel.load(Ordering::SeqCst) {
            status = "stopped";
            break;
        }
        match parser.push(chunk) {
            Ok(events) => {
                for data in events {
                    if data == "[DONE]" {
                        status = "completed";
                        break;
                    }
                    let delta = serde_json::from_str::<serde_json::Value>(&data)
                        .ok()
                        .and_then(|value| value["delta"].as_str().map(str::to_owned));
                    if let Some(text) = delta {
                        if !text.is_empty() {
                            seq += 1;
                            if append_delta(&mut db.lock().unwrap(), attempt_id, seq, &text).is_err() {
                                break 'stream;
                            }
                            let _ = on_event.send(StreamEvent::Delta { attempt_id, seq, text });
                        }
                    } else {
                        break 'stream;
                    }
                }
            }
            Err(_) => break 'stream,
        }
        if status == "completed" {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    if cancel.load(Ordering::SeqCst) && status != "completed" {
        status = "stopped";
    }
    let _ = finish(&db.lock().unwrap(), attempt_id, status);
    let _ = on_event.send(StreamEvent::End { attempt_id, status: status.to_string() });
    let mut current = active.lock().unwrap();
    if current.as_ref().is_some_and(|(id, _)| *id == attempt_id) {
        *current = None;
    }
}

#[tauri::command]
fn start_mock_generation(prompt: String, on_event: Channel<StreamEvent>, state: State<'_, AppState>) -> Result<i64, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() || prompt.chars().count() > 2000 {
        return Err("Введите от 1 до 2000 символов".into());
    }
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("Дождитесь завершения текущего ответа".into());
    }
    let attempt_id = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        create_attempt(&mut db, prompt).map_err(|e| e.to_string())?
    };
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some((attempt_id, cancel.clone()));
    std::thread::spawn({
        let db = state.db.clone();
        let active = state.active.clone();
        let bytes = mock_stream(prompt);
        move || run_stream(db, active, cancel, attempt_id, bytes, on_event)
    });
    Ok(attempt_id)
}

#[tauri::command]
fn stop_generation(state: State<'_, AppState>) -> Result<(), String> {
    if let Some((_, cancel)) = state.active.lock().map_err(|e| e.to_string())?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?;
            std::fs::create_dir_all(&path)?;
            let db = Connection::open(path.join("history.sqlite"))?;
            init_db(&db)?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                active: Arc::new(Mutex::new(None)),
                key_lock: Mutex::new(()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_history, start_mock_generation, stop_generation, save_key, delete_key, key_status, create_backup])
        .run(tauri::generate_context!())
        .expect("Tauri app failed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_reopens_with_history_and_partial_attempt() {
        let path = std::env::temp_dir().join(format!("ai-desktop-backup-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Connection::open_in_memory().unwrap();
        init_db(&db).unwrap();
        let id = create_attempt(&mut db, "synthetic question").unwrap();
        append_delta(&mut db, id, 1, "partial answer").unwrap();
        backup_history_to(&db, &path).unwrap();
        let backup = Connection::open(&path).unwrap();
        let saved: (String, String, i64) = backup.query_row(
            "SELECT m.content, a.status, a.last_seq FROM messages m JOIN attempts a ON m.id=a.assistant_id WHERE a.id=?1",
            [id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(saved, ("partial answer".into(), "streaming".into(), 1));
        drop(backup);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn key_commands_report_only_presence_and_support_replace_and_delete() {
        let entry = keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        assert!(!key_status_for(&entry).unwrap());
        save_key_for(&entry, "synthetic-first").unwrap();
        assert!(key_status_for(&entry).unwrap());
        save_key_for(&entry, "synthetic-second").unwrap();
        assert_eq!(entry.get_password().unwrap(), "synthetic-second");
        delete_key_for(&entry).unwrap();
        assert!(!key_status_for(&entry).unwrap());
    }

    #[test]
    fn migrates_existing_history_into_one_conversation() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL);
             CREATE TABLE attempts (id INTEGER PRIMARY KEY, assistant_id INTEGER NOT NULL UNIQUE REFERENCES messages(id), status TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0);
             INSERT INTO messages VALUES (1, 'user', 'first', 'completed'), (2, 'assistant', 'answer', 'completed'),
                                         (3, 'user', 'second', 'completed'), (4, 'assistant', 'partial', 'streaming');
             INSERT INTO attempts VALUES (1, 2, 'completed', 1), (2, 4, 'streaming', 2);",
        ).unwrap();
        init_db(&db).unwrap();
        init_db(&db).unwrap();
        let nodes: Vec<(i64, Option<i64>, String)> = db.prepare(
            "SELECT id, parent_id, content FROM messages ORDER BY id",
        ).unwrap().query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap().map(Result::unwrap).collect();
        assert_eq!(nodes, vec![
            (1, None, "first".into()), (2, Some(1), "answer".into()),
            (3, Some(2), "second".into()), (4, Some(3), "partial".into()),
        ]);
        let attempt: (i64, i64, String, i64) = db.query_row(
            "SELECT conversation_id, user_message_id, status, last_seq FROM attempts WHERE id=2",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert_eq!(attempt, (1, 3, "interrupted".into(), 2));
        assert_eq!(create_attempt(&mut db, "third").unwrap(), 3);
        let parent: i64 = db.query_row("SELECT parent_id FROM messages WHERE id=5", [], |row| row.get(0)).unwrap();
        assert_eq!(parent, 4);
        let foreign_key_errors: i64 = db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| row.get(0)).unwrap();
        assert_eq!(foreign_key_errors, 0);
    }

    #[test]
    fn sse_handles_split_utf8_and_multiple_events() {
        let bytes = "data: {\"delta\":\"й\"}\n\ndata: {\"delta\":\"два\"}\n\n".as_bytes();
        let mut parser = SseParser::default();
        let mut output = Vec::new();
        for chunk in bytes.chunks(3) {
            output.extend(parser.push(chunk).unwrap());
        }
        assert_eq!(output.len(), 2);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&output[0]).unwrap()["delta"], "й");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&output[1]).unwrap()["delta"], "два");
    }

    #[test]
    fn restart_marks_partial_attempt_interrupted() {
        let mut db = Connection::open_in_memory().unwrap();
        init_db(&db).unwrap();
        let id = create_attempt(&mut db, "test").unwrap();
        append_delta(&mut db, id, 1, "partial").unwrap();
        init_db(&db).unwrap();
        let (content, status): (String, String) = db.query_row(
            "SELECT content, status FROM messages WHERE id=(SELECT assistant_id FROM attempts WHERE id=?1)",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!((content.as_str(), status.as_str()), ("partial", "interrupted"));
    }

    #[test]
    fn eof_without_done_keeps_partial_text_and_unique_sequence() {
        let mut connection = Connection::open_in_memory().unwrap();
        init_db(&connection).unwrap();
        let id = create_attempt(&mut connection, "test").unwrap();
        let db = Arc::new(Mutex::new(connection));
        let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let received = events.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                received.lock().unwrap().push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        let bytes = b"data: {\"delta\":\"one\"}\n\ndata: {\"delta\":\"two\"}\n\n".to_vec();
        run_stream(db.clone(), Arc::new(Mutex::new(None)), Arc::new(AtomicBool::new(false)), id, bytes, channel);
        let (content, status, seq): (String, String, i64) = db.lock().unwrap().query_row(
            "SELECT m.content, m.status, a.last_seq FROM messages m JOIN attempts a ON a.assistant_id=m.id WHERE a.id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!((content.as_str(), status.as_str(), seq), ("onetwo", "interrupted", 2));
        let received = events.lock().unwrap();
        assert_eq!(received[0]["data"]["seq"], 1);
        assert_eq!(received[1]["data"]["seq"], 2);
        assert_eq!(received[2]["data"]["status"], "interrupted");
        assert_eq!(received.len(), 3);
    }

    #[test]
    fn cancelled_stream_never_completes() {
        let mut connection = Connection::open_in_memory().unwrap();
        init_db(&connection).unwrap();
        let id = create_attempt(&mut connection, "test").unwrap();
        let db = Arc::new(Mutex::new(connection));
        let channel = Channel::new(|_| Ok(()));
        run_stream(db.clone(), Arc::new(Mutex::new(None)), Arc::new(AtomicBool::new(true)), id, mock_stream("test"), channel);
        let status: String = db.lock().unwrap().query_row("SELECT status FROM attempts WHERE id=?1", [id], |row| row.get(0)).unwrap();
        assert_eq!(status, "stopped");
    }
}
