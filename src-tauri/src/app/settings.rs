use anyhow::Result;
use tauri::{Emitter, State};

use crate::events;
use crate::models::{AppSettings, AppSettingsEvent, SettingsUpdateInput};
use crate::session::AppState;

use super::tray::sync_tray;

pub fn get_settings(state: &AppState) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

pub fn update_settings(
    app: &tauri::AppHandle,
    state: &AppState,
    input: SettingsUpdateInput,
) -> Result<AppSettings> {
    let settings = AppSettings {
        close_to_tray: input.close_to_tray,
        launch_on_login: input.launch_on_login,
    };
    crate::settings::save_settings(&state.paths, &settings)?;
    crate::settings::apply_launch_on_login(app, &settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    let _ = app.emit(
        events::EVENT_APP_SETTINGS,
        AppSettingsEvent {
            settings: settings.clone(),
        },
    );
    sync_tray(app)?;
    Ok(settings)
}

#[tauri::command]
pub async fn get_settings_command(
    state: State<'_, AppState>,
) -> std::result::Result<AppSettings, String> {
    Ok(get_settings(state.inner()))
}

#[tauri::command]
pub async fn update_settings_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SettingsUpdateInput,
) -> std::result::Result<AppSettings, String> {
    update_settings(&app, state.inner(), input).map_err(|error| error.to_string())
}
