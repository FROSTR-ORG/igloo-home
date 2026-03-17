use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow, bail};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub settings_path: PathBuf,
    pub last_session_path: PathBuf,
}

impl AppPaths {
    pub fn ensure() -> Result<Self> {
        let app_data_dir = if let Some(value) = std::env::var_os("IGLOO_HOME_TEST_APP_DATA_DIR") {
            PathBuf::from(value)
        } else {
            base_app_data_dir()?.join("igloo-home")
        };
        let runtime_dir = app_data_dir.join("runtime");
        fs::create_dir_all(&runtime_dir)?;
        Ok(Self {
            settings_path: app_data_dir.join("settings.json"),
            last_session_path: app_data_dir.join("last-session.json"),
        })
    }

    pub fn session_log_path(&self, runtime_dir: &Path) -> PathBuf {
        runtime_dir.join("session-log.jsonl")
    }

    pub fn session_metadata_path(&self, runtime_dir: &Path) -> PathBuf {
        runtime_dir.join("session.json")
    }
}

pub fn is_test_mode() -> bool {
    matches!(
        std::env::var("IGLOO_HOME_TEST_MODE").ok().as_deref(),
        Some("1") | Some("true") | Some("yes")
    )
}

pub fn base_app_data_dir() -> Result<PathBuf> {
    if cfg!(target_os = "windows") {
        if let Some(value) = std::env::var_os("LOCALAPPDATA") {
            return Ok(PathBuf::from(value));
        }
        if let Some(value) = std::env::var_os("APPDATA") {
            return Ok(PathBuf::from(value));
        }
        bail!("LOCALAPPDATA is not set");
    }

    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("HOME is not set"))?;
    if cfg!(target_os = "macos") {
        return Ok(home.join("Library").join("Application Support"));
    }
    if let Some(value) = std::env::var_os("XDG_DATA_HOME") {
        return Ok(PathBuf::from(value));
    }
    Ok(home.join(".local").join("share"))
}
