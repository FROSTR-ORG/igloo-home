use anyhow::Result;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use crate::paths;
use crate::session::AppState;

use super::window::show_main_window;

const TRAY_ID: &str = "main-tray";
const MENU_SHOW: &str = "tray.show";
const MENU_HIDE: &str = "tray.hide";
const MENU_STOP: &str = "tray.stop";
const MENU_QUIT: &str = "tray.quit";

pub fn sync_tray(app: &tauri::AppHandle) -> Result<()> {
    if paths::is_test_mode() {
        return Ok(());
    }
    let state = app.state::<AppState>();
    let signer = state.signer.lock().unwrap();
    let has_active = signer.active.is_some();
    drop(signer);

    if app.tray_by_id(TRAY_ID).is_some() {
        let _ = app.remove_tray_by_id(TRAY_ID);
    }

    let show = MenuItem::with_id(app, MENU_SHOW, "Show Igloo Home", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "Hide Window", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, MENU_STOP, "Stop Signer", has_active, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Igloo Home");
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().0.as_str() {
        MENU_SHOW => {
            let _ = show_main_window(app);
        }
        MENU_HIDE => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        MENU_STOP => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                let _ = crate::session::stop_signer(&app, state.inner(), "tray_stop").await;
                let _ = sync_tray(&app);
            });
        }
        MENU_QUIT => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                let _ = crate::session::stop_signer(&app, state.inner(), "quit").await;
                app.exit(0);
            });
        }
        _ => {}
    }
}
