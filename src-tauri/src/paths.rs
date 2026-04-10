use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::{Mutex, OnceLock};

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

pub fn should_show_test_window() -> bool {
    matches!(
        std::env::var("IGLOO_HOME_TEST_SHOW_WINDOW").ok().as_deref(),
        Some("1") | Some("true") | Some("yes")
    )
}

pub fn should_show_main_window() -> bool {
    !is_test_mode() || should_show_test_window()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn shows_main_window_for_normal_app_runs() {
        let _guard = env_lock().lock().unwrap();
        unsafe {
            std::env::remove_var("IGLOO_HOME_TEST_MODE");
            std::env::remove_var("IGLOO_HOME_TEST_SHOW_WINDOW");
        }

        assert!(should_show_main_window());
    }

    #[test]
    fn hides_main_window_for_hidden_test_mode() {
        let _guard = env_lock().lock().unwrap();
        unsafe {
            std::env::set_var("IGLOO_HOME_TEST_MODE", "1");
            std::env::remove_var("IGLOO_HOME_TEST_SHOW_WINDOW");
        }

        assert!(!should_show_main_window());
    }

    #[test]
    fn shows_main_window_for_explicit_desktop_smoke() {
        let _guard = env_lock().lock().unwrap();
        unsafe {
            std::env::set_var("IGLOO_HOME_TEST_MODE", "1");
            std::env::set_var("IGLOO_HOME_TEST_SHOW_WINDOW", "1");
        }

        assert!(should_show_main_window());
    }
}
