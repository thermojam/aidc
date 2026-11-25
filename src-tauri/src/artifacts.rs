use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) fn create_artifact_in_db(db: &Connection, message_id: i64, kind: &str, title: &str, content: &str) -> Result<i64, String> {
    if !["code", "html", "svg"].contains(&kind) || title.trim().is_empty() || title.len() > 120
        || content.is_empty() || content.len() > 256 * 1024 {
        return Err("Некорректный Artifact".into());
    }
    let (source, status): (String, String) = db.query_row(
        "SELECT content, status FROM messages WHERE id=?1 AND role='assistant'", [message_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| "Ответ не найден")?;
    if status != "completed" || !source.contains(content) { return Err("Код отсутствует в завершённом ответе".into()); }
    let previous: Option<i64> = db.query_row(
        "SELECT id FROM artifact_versions WHERE message_id=?1 ORDER BY id DESC LIMIT 1", [message_id], |row| row.get(0),
    ).optional().map_err(|_| "Не удалось прочитать версии")?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Не удалось определить время")?.as_secs() as i64;
    db.execute("INSERT INTO artifact_versions(message_id, previous_version_id, kind, title, content, sha256, created_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![message_id, previous, kind, title, content, format!("{:x}", Sha256::digest(content.as_bytes())), now])
        .map_err(|_| "Не удалось сохранить Artifact")?;
    Ok(db.last_insert_rowid())
}

pub(crate) fn artifacts_valid(db: &Connection) -> rusqlite::Result<bool> {
    let mut statement = db.prepare("SELECT sha256, content FROM artifact_versions")?;
    let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
    for row in rows {
        let (hash, content) = row?;
        if hash != format!("{:x}", Sha256::digest(content.as_bytes())) { return Ok(false); }
    }
    Ok(true)
}
