use std::fs;

use anyhow::Result;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::models::AppSettings;
use crate::paths::AppPaths;

pub fn load_settings(paths: &AppPaths) -> Result<AppSettings> {
    if !paths.settings_path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(&paths.settings_path)?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_settings(paths: &AppPaths, settings: &AppSettings) -> Result<()> {
    fs::write(&paths.settings_path, serde_json::to_vec_pretty(settings)?)?;
    Ok(())
}

pub fn apply_launch_on_login(app: &AppHandle, settings: &AppSettings) -> Result<()> {
    if settings.launch_on_login {
        app.autolaunch().enable()?;
    } else {
        app.autolaunch().disable()?;
    }
    Ok(())
}
