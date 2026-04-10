use anyhow::{Result, anyhow};
use tauri::Manager;

pub fn show_main_window(app: &tauri::AppHandle) -> Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow!("main window not found"))?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}
