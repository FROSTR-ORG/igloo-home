use std::path::PathBuf;

use anyhow::{Result, anyhow};
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

use crate::events;
use crate::models::AppSettingsEvent;
use crate::paths::AppPaths;
use crate::session::{AppState, load_last_session, make_app_state, maybe_handle_close_request};

use super::tray::{handle_menu_event, sync_tray};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(result) = maybe_run_profile_daemon() {
        result.expect("run igloo-home profile daemon");
        return;
    }

    let paths = AppPaths::ensure().expect("create igloo-home paths");
    let shell_paths = resolve_shell_paths().expect("resolve shell paths");
    let settings = crate::settings::load_settings(&paths).unwrap_or_default();
    let last_session = load_last_session(&paths).unwrap_or(None);
    let app_state = make_app_state(paths.clone(), shell_paths, settings.clone(), last_session);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            #[cfg(target_os = "macos")]
            MacosLauncher::LaunchAgent,
            #[cfg(not(target_os = "macos"))]
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--from-autostart"]),
        ))
        .manage(app_state)
        .setup(move |app| {
            crate::settings::apply_launch_on_login(&app.handle(), &settings)?;
            if crate::paths::is_test_mode() {
                crate::test_mode::start_server(&app.handle())?;
            }
            let app_state = app.state::<AppState>();
            let _ = app.handle().emit(
                events::EVENT_APP_SETTINGS,
                AppSettingsEvent {
                    settings: app_state.settings.lock().unwrap().clone(),
                },
            );
            sync_tray(&app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                if crate::paths::should_show_main_window() {
                    let _ = window.show();
                } else {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_menu_event(handle_menu_event)
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                if maybe_handle_close_request(window, state.inner()).unwrap_or(false) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            super::commands::app_paths_command,
            super::commands::list_profiles_command,
            super::commands::list_relay_profiles_command,
            super::commands::import_profile_from_raw_command,
            super::commands::import_profile_from_onboarding_command,
            super::commands::connect_onboarding_package_command,
            super::commands::finalize_connected_onboarding_command,
            super::commands::discard_connected_onboarding_command,
            super::commands::import_profile_from_bfprofile_command,
            super::commands::recover_profile_from_bfshare_command,
            super::commands::apply_rotation_update_command,
            super::commands::remove_profile_command,
            super::commands::export_profile_command,
            super::commands::export_profile_package_command,
            super::commands::publish_profile_backup_command,
            super::commands::update_profile_operator_settings_command,
            super::commands::create_generated_keyset_command,
            super::commands::create_rotated_keyset_command,
            super::commands::create_generated_onboarding_package_command,
            super::commands::start_profile_session_command,
            super::commands::profile_runtime_snapshot_command,
            super::commands::refresh_runtime_peers_command,
            super::commands::stop_signer_command,
            super::settings::get_settings_command,
            super::settings::update_settings_command,
            super::commands::list_session_logs_command,
            super::commands::resolve_close_request_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running igloo-home");
}

fn maybe_run_profile_daemon() -> Option<Result<()>> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("__daemon-run") {
        return None;
    }

    let mut profile = None::<String>;
    let mut socket_path = None::<String>;
    let mut token = None::<String>;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--profile" => profile = args.next(),
            "--socket-path" => socket_path = args.next(),
            "--token" => token = args.next(),
            _ => {}
        }
    }

    Some(tauri::async_runtime::block_on(async move {
        let shell_paths = resolve_shell_paths()?;
        let profile = profile.ok_or_else(|| anyhow!("missing --profile"))?;
        let socket_path = socket_path.ok_or_else(|| anyhow!("missing --socket-path"))?;
        let token = token.ok_or_else(|| anyhow!("missing --token"))?;
        let (_profile, resolved) = crate::profiles::resolve_runtime(&shell_paths, &profile)?;
        bifrost_app::host::run_resolved_daemon(
            resolved,
            bifrost_app::host::DaemonTransportConfig {
                socket_path: socket_path.into(),
                token,
            },
        )
        .await
    }))
}

fn resolve_shell_paths() -> Result<crate::profiles::ShellPaths> {
    resolve_shell_paths_for_test_root(
        std::env::var_os("IGLOO_HOME_TEST_APP_DATA_DIR").map(PathBuf::from),
    )
}

fn resolve_shell_paths_for_test_root(
    test_root: Option<PathBuf>,
) -> Result<crate::profiles::ShellPaths> {
    if let Some(root) = test_root {
        return Ok(crate::profiles::ShellPaths::from_roots(
            root.join("config"),
            root.join("data"),
            root.join("state"),
        ));
    }

    crate::profiles::ShellPaths::resolve()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_shell_paths_uses_explicit_test_root_when_present() {
        let paths =
            resolve_shell_paths_for_test_root(Some(PathBuf::from("/tmp/igloo-home-test-root")))
                .expect("resolve shell paths from explicit test root");

        assert_eq!(
            paths.config_dir,
            PathBuf::from("/tmp/igloo-home-test-root/config/igloo-shell")
        );
        assert_eq!(
            paths.data_dir,
            PathBuf::from("/tmp/igloo-home-test-root/data/igloo-shell")
        );
        assert_eq!(
            paths.state_dir,
            PathBuf::from("/tmp/igloo-home-test-root/state/igloo-shell")
        );
    }

    #[test]
    fn resolve_shell_paths_falls_back_to_default_resolution_without_test_root() {
        let resolved =
            resolve_shell_paths_for_test_root(None).expect("resolve default shell paths");
        let direct = crate::profiles::ShellPaths::resolve().expect("resolve shell paths directly");

        assert_eq!(resolved.config_dir, direct.config_dir);
        assert_eq!(resolved.data_dir, direct.data_dir);
        assert_eq!(resolved.state_dir, direct.state_dir);
    }
}
