use std::fs;
use std::path::Path;

use anyhow::Result;

use crate::models::SignerLogEntry;
use crate::paths::AppPaths;

pub fn read_session_log(runtime_dir: &Path, paths: &AppPaths) -> Result<Vec<SignerLogEntry>> {
    let path = paths.session_log_path(runtime_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(Into::into))
        .collect()
}

pub fn append_session_log(
    paths: &AppPaths,
    runtime_dir: &Path,
    entry: &SignerLogEntry,
) -> Result<()> {
    let path = paths.session_log_path(runtime_dir);
    let mut bytes = if path.exists() {
        fs::read(&path)?
    } else {
        Vec::new()
    };
    bytes.extend_from_slice(serde_json::to_string(entry)?.as_bytes());
    bytes.push(b'\n');
    fs::write(path, bytes)?;
    Ok(())
}
