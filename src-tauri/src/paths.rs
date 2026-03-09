use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow, bail};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub shares_dir: PathBuf,
    pub runtime_dir: PathBuf,
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
        let shares_dir = app_data_dir.join("shares");
        let runtime_dir = app_data_dir.join("runtime");
        fs::create_dir_all(&shares_dir)?;
        fs::create_dir_all(&runtime_dir)?;
        Ok(Self {
            settings_path: app_data_dir.join("settings.json"),
            last_session_path: app_data_dir.join("last-session.json"),
            shares_dir,
            runtime_dir,
        })
    }

    pub fn share_file_path(&self, share_id: &str) -> Result<PathBuf> {
        Ok(self.shares_dir.join(format!(
            "{}{}",
            sanitize_share_id(share_id)?,
            ".igloo-share.json"
        )))
    }

    pub fn runtime_share_dir(&self, share_id: &str) -> Result<PathBuf> {
        Ok(self.runtime_dir.join(sanitize_share_id(share_id)?))
    }

    pub fn session_state_path(&self, runtime_dir: &Path) -> PathBuf {
        runtime_dir.join("device-state.bin")
    }

    pub fn session_config_path(&self, runtime_dir: &Path) -> PathBuf {
        runtime_dir.join("igloo-home-config.json")
    }

    pub fn session_group_path(&self, runtime_dir: &Path) -> PathBuf {
        runtime_dir.join("group.json")
    }

    pub fn session_share_path(&self, runtime_dir: &Path) -> PathBuf {
        runtime_dir.join("share.json")
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

pub fn sanitize_share_id(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("share id must be non-empty");
    }
    if trimmed.starts_with('.') || trimmed.contains('/') || trimmed.contains('\\') {
        bail!("share id contains invalid characters");
    }
    let normalized = trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if normalized.is_empty() {
        bail!("share id contains no valid characters");
    }
    Ok(normalized)
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
