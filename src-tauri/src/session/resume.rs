use std::fs;

use anyhow::Result;

use crate::models::SessionResume;
use crate::paths::AppPaths;

pub fn load_last_session(paths: &AppPaths) -> Result<Option<SessionResume>> {
    if !paths.last_session_path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&fs::read_to_string(
        &paths.last_session_path,
    )?)?))
}
