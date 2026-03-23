mod events;
mod models;
mod paths;
mod profiles;
mod session;
mod session_log;
mod settings;
mod test_mode;

use std::path::PathBuf;

use anyhow::{Result, anyhow};
use models::{
    AppPathsResponse, AppSettings, AppSettingsEvent, ApplyRotationUpdateInput, CreateGeneratedOnboardingPackageInput,
    ExportProfileInput, ExportProfilePackageInput, ImportProfileFromBfprofileInput,
    ImportProfileFromOnboardingInput, ImportProfileFromRawInput, ListSessionLogsInput,
    ProfileRuntimeSnapshot, PublishProfileBackupInput, RecoverProfileFromBfshareInput, RotateKeysetRequest,
    RemoveProfileInput, ResolveCloseRequestInput, SettingsUpdateInput,
    StartProfileSessionRequest, UpdateProfileOperatorSettingsInput,
};
use paths::AppPaths;
use session::{
    AppState, load_last_session, make_app_state, maybe_handle_close_request,
};
use session_log::read_session_log;
use settings::{apply_launch_on_login, load_settings, save_settings};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

const TRAY_ID: &str = "main-tray";
const MENU_SHOW: &str = "tray.show";
const MENU_HIDE: &str = "tray.hide";
const MENU_STOP: &str = "tray.stop";
const MENU_QUIT: &str = "tray.quit";

#[tauri::command]
async fn app_paths(
    state: tauri::State<'_, AppState>,
) -> std::result::Result<AppPathsResponse, String> {
    Ok(profiles::shell_paths_response(&state.shell_paths))
}

#[tauri::command]
async fn list_profiles_command(
    state: tauri::State<'_, AppState>,
) -> std::result::Result<Vec<igloo_shell_core::shell::ProfileManifest>, String> {
    profiles::list_managed_profiles(&state.shell_paths).map_err(error_message)
}

#[tauri::command]
async fn list_relay_profiles_command(
    state: tauri::State<'_, AppState>,
) -> std::result::Result<Vec<igloo_shell_core::shell::RelayProfile>, String> {
    profiles::list_relay_profiles_managed(&state.shell_paths).map_err(error_message)
}

#[tauri::command]
async fn import_profile_from_raw_command(
    state: tauri::State<'_, AppState>,
    input: ImportProfileFromRawInput,
) -> std::result::Result<igloo_shell_core::shell::ProfileImportResult, String> {
    profiles::import_profile_from_raw_json(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        &input.relay_urls,
        Some(input.vault_passphrase),
        &input.group_package_json,
        &input.share_package_json,
    )
    .map_err(error_message)
}

#[tauri::command]
async fn import_profile_from_onboarding_command(
    state: tauri::State<'_, AppState>,
    input: ImportProfileFromOnboardingInput,
) -> std::result::Result<igloo_shell_core::shell::ProfileImportResult, String> {
    profiles::import_profile_from_onboarding(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        Some(input.vault_passphrase),
        Some(input.onboarding_password),
        &input.package,
    )
    .await
    .map_err(error_message)
}

#[tauri::command]
async fn import_profile_from_bfprofile_command(
    state: tauri::State<'_, AppState>,
    input: ImportProfileFromBfprofileInput,
) -> std::result::Result<igloo_shell_core::shell::ProfileImportResult, String> {
    profiles::import_profile_from_bfprofile(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        Some(input.vault_passphrase),
        input.package_password,
        &input.package,
    )
    .map_err(error_message)
}

#[tauri::command]
async fn recover_profile_from_bfshare_command(
    state: tauri::State<'_, AppState>,
    input: RecoverProfileFromBfshareInput,
) -> std::result::Result<igloo_shell_core::shell::ProfileImportResult, String> {
    profiles::recover_profile_from_bfshare(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        Some(input.vault_passphrase),
        input.package_password,
        &input.package,
    )
    .await
    .map_err(error_message)
}

#[tauri::command]
async fn remove_profile_command(
    state: tauri::State<'_, AppState>,
    input: RemoveProfileInput,
) -> std::result::Result<(), String> {
    profiles::remove_managed_profile(&state.shell_paths, &input.profile_id).map_err(error_message)
}

#[tauri::command]
async fn export_profile_command(
    state: tauri::State<'_, AppState>,
    input: ExportProfileInput,
) -> std::result::Result<igloo_shell_core::shell::ProfileExportResult, String> {
    profiles::export_managed_profile(
        &state.shell_paths,
        &input.profile_id,
        PathBuf::from(input.destination_dir).as_path(),
        Some(input.vault_passphrase),
    )
    .map_err(error_message)
}

#[tauri::command]
async fn export_profile_package_command(
    state: tauri::State<'_, AppState>,
    input: ExportProfilePackageInput,
) -> std::result::Result<crate::models::ProfilePackageExportResult, String> {
    let result = profiles::export_managed_profile_package(
        &state.shell_paths,
        &input.profile_id,
        &input.format,
        input.package_password,
        Some(input.vault_passphrase),
    )
    .map_err(error_message)?;
    Ok(crate::models::ProfilePackageExportResult {
        profile_id: result.profile_id,
        format: result.format,
        out_path: result.out_path,
        package: result.package,
    })
}

#[tauri::command]
async fn publish_profile_backup_command(
    state: tauri::State<'_, AppState>,
    input: PublishProfileBackupInput,
) -> std::result::Result<crate::models::ProfileBackupPublishResult, String> {
    let result = profiles::publish_managed_profile_backup(
        &state.shell_paths,
        &input.profile_id,
        Some(input.vault_passphrase),
    )
    .await
    .map_err(error_message)?;
    Ok(crate::models::ProfileBackupPublishResult {
        profile_id: result.profile_id,
        relays: result.relays,
        event_id: result.event_id,
        author_pubkey: result.author_pubkey,
    })
}

#[tauri::command]
async fn update_profile_operator_settings_command(
    state: tauri::State<'_, AppState>,
    input: UpdateProfileOperatorSettingsInput,
) -> std::result::Result<igloo_shell_core::shell::ProfileManifest, String> {
    profiles::update_managed_profile_settings(
        &state.shell_paths,
        &input.profile_id,
        input.label,
        input.relays,
        input.runtime_options,
    )
    .map_err(error_message)
}

#[tauri::command]
async fn create_generated_keyset_command(
    input: models::CreateKeysetRequest,
) -> std::result::Result<models::GeneratedKeyset, String> {
    session::make_generated_keyset(input.threshold, input.count).map_err(error_message)
}

#[tauri::command]
async fn create_rotated_keyset_command(
    input: RotateKeysetRequest,
) -> std::result::Result<models::GeneratedKeyset, String> {
    session::make_rotated_keyset(input.threshold, input.count, input.sources)
        .await
        .map_err(error_message)
}

#[tauri::command]
async fn create_generated_onboarding_package_command(
    input: CreateGeneratedOnboardingPackageInput,
) -> std::result::Result<String, String> {
    session::make_generated_onboarding_package(
        &input.share_package_json,
        input.relay_urls,
        input.peer_pubkey,
        input.package_password,
    )
    .map_err(error_message)
}

#[tauri::command]
async fn start_profile_session_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    input: StartProfileSessionRequest,
) -> std::result::Result<ProfileRuntimeSnapshot, String> {
    let snapshot = session::start_profile_session(&app, state.inner(), input)
        .await
        .map_err(error_message)?;
    sync_tray(&app).map_err(error_message)?;
    Ok(snapshot)
}

#[tauri::command]
async fn profile_runtime_snapshot_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    profile_id: Option<String>,
) -> std::result::Result<ProfileRuntimeSnapshot, String> {
    session::profile_session_snapshot(&app, state.inner(), profile_id)
        .await
        .map_err(error_message)
}

#[tauri::command]
async fn apply_rotation_update_command(
    state: tauri::State<'_, AppState>,
    input: ApplyRotationUpdateInput,
) -> std::result::Result<igloo_shell_core::shell::ProfileImportResult, String> {
    igloo_shell_core::shell::apply_rotation_update_from_bfonboard_value(
        &state.shell_paths,
        &input.target_profile_id,
        &input.onboarding_package,
        input.onboarding_password,
        Some(input.vault_passphrase),
    )
    .await
    .map_err(error_message)
}

#[tauri::command]
async fn stop_signer_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> std::result::Result<(), String> {
    session::stop_signer(&app, state.inner(), "stopped")
        .await
        .map_err(error_message)?;
    sync_tray(&app).map_err(error_message)?;
    Ok(())
}

#[tauri::command]
async fn get_settings_command(
    state: tauri::State<'_, AppState>,
) -> std::result::Result<AppSettings, String> {
    Ok(state.settings.lock().unwrap().clone())
}

#[tauri::command]
async fn update_settings_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    input: SettingsUpdateInput,
) -> std::result::Result<AppSettings, String> {
    let settings = AppSettings {
        close_to_tray: input.close_to_tray,
        launch_on_login: input.launch_on_login,
    };
    save_settings(&state.paths, &settings).map_err(error_message)?;
    apply_launch_on_login(&app, &settings).map_err(error_message)?;
    *state.settings.lock().unwrap() = settings.clone();
    let _ = app.emit(
        events::EVENT_APP_SETTINGS,
        AppSettingsEvent {
            settings: settings.clone(),
        },
    );
    sync_tray(&app).map_err(error_message)?;
    Ok(settings)
}

#[tauri::command]
async fn list_session_logs_command(
    state: tauri::State<'_, AppState>,
    input: ListSessionLogsInput,
) -> std::result::Result<Vec<models::SignerLogEntry>, String> {
    let runtime_dir = if let Some(value) = input.runtime_dir {
        PathBuf::from(value)
    } else {
        let guard = state.signer.lock().unwrap();
        guard
            .last_session
            .as_ref()
            .map(|session| PathBuf::from(&session.runtime_dir))
            .ok_or_else(|| "no session logs available".to_string())?
    };
    read_session_log(&runtime_dir, &state.paths).map_err(error_message)
}

#[tauri::command]
async fn resolve_close_request_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    input: ResolveCloseRequestInput,
) -> std::result::Result<(), String> {
    match input.action.as_str() {
        "hide" | "cancel" => {
            session::resolve_close_request(&app, &input.action).map_err(error_message)?
        }
        "stop_and_quit" => {
            session::stop_signer(&app, state.inner(), "quit")
                .await
                .map_err(error_message)?;
            session::resolve_close_request(&app, "stop_and_quit").map_err(error_message)?;
        }
        _ => return Err("unknown close action".to_string()),
    }
    Ok(())
}

fn error_message(error: impl ToString) -> String {
    error.to_string()
}

fn show_main_window(app: &tauri::AppHandle) -> Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow!("main window not found"))?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

fn sync_tray(app: &tauri::AppHandle) -> Result<()> {
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

fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
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
                let _ = session::stop_signer(&app, state.inner(), "tray_stop").await;
                let _ = sync_tray(&app);
            });
        }
        MENU_QUIT => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                let _ = session::stop_signer(&app, state.inner(), "quit").await;
                app.exit(0);
            });
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(result) = maybe_run_profile_daemon() {
        result.expect("run igloo-home profile daemon");
        return;
    }

    if let Some(root) = std::env::var_os("IGLOO_HOME_TEST_APP_DATA_DIR") {
        let root = PathBuf::from(root);
        unsafe {
            std::env::set_var("XDG_CONFIG_HOME", root.join("config"));
            std::env::set_var("XDG_DATA_HOME", root.join("data"));
            std::env::set_var("XDG_STATE_HOME", root.join("state"));
        }
    }
    let paths = AppPaths::ensure().expect("create igloo-home paths");
    let shell_paths = igloo_shell_core::shell::ShellPaths::resolve().expect("resolve shell paths");
    let settings = load_settings(&paths).unwrap_or_default();
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
            apply_launch_on_login(&app.handle(), &settings)?;
            if paths::is_test_mode() {
                test_mode::start_server(&app.handle())?;
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
                let _ = window.show();
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
            app_paths,
            list_profiles_command,
            list_relay_profiles_command,
            import_profile_from_raw_command,
            import_profile_from_onboarding_command,
            import_profile_from_bfprofile_command,
            recover_profile_from_bfshare_command,
            apply_rotation_update_command,
            remove_profile_command,
            export_profile_command,
            export_profile_package_command,
            publish_profile_backup_command,
            update_profile_operator_settings_command,
            create_generated_keyset_command,
            create_rotated_keyset_command,
            create_generated_onboarding_package_command,
            start_profile_session_command,
            profile_runtime_snapshot_command,
            stop_signer_command,
            get_settings_command,
            update_settings_command,
            list_session_logs_command,
            resolve_close_request_command
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
        let shell_paths = igloo_shell_core::shell::ShellPaths::resolve()?;
        let profile = profile.ok_or_else(|| anyhow!("missing --profile"))?;
        let socket_path = socket_path.ok_or_else(|| anyhow!("missing --socket-path"))?;
        let token = token.ok_or_else(|| anyhow!("missing --token"))?;
        let (_profile, resolved) = igloo_shell_core::shell::resolve_profile_runtime(&shell_paths, &profile)?;
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
