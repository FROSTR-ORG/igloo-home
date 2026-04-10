use anyhow::{Result, bail};
use tauri::{Emitter, Manager};

use crate::events::EVENT_APP_CLOSE_REQUESTED;
use crate::models::CloseRequestEvent;

use super::AppState;

#[derive(Debug, Clone, PartialEq, Eq)]
enum CloseRequestBehavior {
    AllowClose,
    HideToTray,
    Prompt {
        share_id: String,
        share_name: String,
    },
}

pub fn resolve_close_request(app: &tauri::AppHandle, action: &str) -> Result<()> {
    match action {
        "hide" | "cancel" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        "stop_and_quit" => {
            app.exit(0);
        }
        _ => bail!("unknown close action"),
    }
    Ok(())
}

pub fn maybe_handle_close_request(window: &tauri::Window, state: &AppState) -> Result<bool> {
    let behavior = determine_close_request_behavior(
        {
            let mut close = state.close.lock().unwrap();
            if close.allow_close_once {
                close.allow_close_once = false;
                true
            } else {
                false
            }
        },
        state.settings.lock().unwrap().close_to_tray,
        state
            .signer
            .lock()
            .unwrap()
            .active
            .as_ref()
            .map(|active| (active.share_id.clone(), active.share_name.clone())),
    );

    match behavior {
        CloseRequestBehavior::AllowClose => Ok(false),
        CloseRequestBehavior::HideToTray => {
            let _ = window.hide();
            Ok(true)
        }
        CloseRequestBehavior::Prompt {
            share_id,
            share_name,
        } => {
            let _ = window.emit(
                EVENT_APP_CLOSE_REQUESTED,
                CloseRequestEvent {
                    share_id: Some(share_id),
                    share_name: Some(share_name),
                },
            );
            Ok(true)
        }
    }
}

fn determine_close_request_behavior(
    allow_close_once: bool,
    close_to_tray: bool,
    active: Option<(String, String)>,
) -> CloseRequestBehavior {
    if allow_close_once {
        return CloseRequestBehavior::AllowClose;
    }
    let Some((share_id, share_name)) = active else {
        return CloseRequestBehavior::AllowClose;
    };
    if close_to_tray {
        CloseRequestBehavior::HideToTray
    } else {
        CloseRequestBehavior::Prompt {
            share_id,
            share_name,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_is_allowed_once_when_flag_is_set() {
        assert_eq!(
            determine_close_request_behavior(
                true,
                false,
                Some(("profile-1".to_string(), "Device 1".to_string()))
            ),
            CloseRequestBehavior::AllowClose
        );
    }

    #[test]
    fn active_session_hides_to_tray_when_setting_is_enabled() {
        assert_eq!(
            determine_close_request_behavior(
                false,
                true,
                Some(("profile-1".to_string(), "Device 1".to_string()))
            ),
            CloseRequestBehavior::HideToTray
        );
    }

    #[test]
    fn active_session_prompts_when_close_to_tray_is_disabled() {
        assert_eq!(
            determine_close_request_behavior(
                false,
                false,
                Some(("profile-1".to_string(), "Device 1".to_string()))
            ),
            CloseRequestBehavior::Prompt {
                share_id: "profile-1".to_string(),
                share_name: "Device 1".to_string(),
            }
        );
    }

    #[test]
    fn inactive_session_does_not_intercept_close() {
        assert_eq!(
            determine_close_request_behavior(false, false, None),
            CloseRequestBehavior::AllowClose
        );
    }
}
