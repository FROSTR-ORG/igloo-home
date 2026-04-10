use std::path::PathBuf;

use anyhow::{Result, bail};
use tauri::State;

use crate::models::{
    AppPathsResponse, ApplyRotationUpdateInput, ConnectOnboardingPackageInput,
    CreateGeneratedOnboardingPackageInput, DiscardConnectedOnboardingResult, ExportProfileInput,
    ExportProfilePackageInput, FinalizeConnectedOnboardingInput, ImportProfileFromBfprofileInput,
    ImportProfileFromOnboardingInput, ImportProfileFromRawInput, ListSessionLogsInput,
    ProfileRuntimeSnapshot, PublishProfileBackupInput, RecoverProfileFromBfshareInput,
    RemoveProfileInput, ResolveCloseRequestInput, RotateKeysetRequest, StartProfileSessionRequest,
    UpdateProfileOperatorSettingsInput,
};
use crate::profiles;
use crate::session::{self, AppState};
use crate::session_log::read_session_log;

use super::tray::sync_tray;

pub fn app_paths(state: &AppState) -> AppPathsResponse {
    profiles::shell_paths_response(&state.shell_paths)
}

pub fn list_profiles(state: &AppState) -> Result<Vec<profiles::ProfileManifest>> {
    profiles::list_managed_profiles(&state.shell_paths)
}

pub fn list_relay_profiles(state: &AppState) -> Result<Vec<profiles::RelayProfile>> {
    profiles::list_relay_profiles_managed(&state.shell_paths)
}

pub fn import_profile_from_raw(
    state: &AppState,
    input: ImportProfileFromRawInput,
) -> Result<profiles::ProfileImportResult> {
    profiles::import_profile_from_raw_json(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        &input.relay_urls,
        Some(input.passphrase),
        &input.group_package_json,
        &input.share_package_json,
    )
}

pub async fn import_profile_from_onboarding(
    state: &AppState,
    input: ImportProfileFromOnboardingInput,
) -> Result<profiles::ProfileImportResult> {
    profiles::import_profile_from_onboarding(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        Some(input.passphrase),
        Some(input.onboarding_password),
        &input.package,
    )
    .await
}

pub async fn connect_onboarding_package(
    state: &AppState,
    input: ConnectOnboardingPackageInput,
) -> Result<crate::models::ConnectedOnboardingPreview> {
    profiles::connect_onboarding_package(state, input.onboarding_password, &input.package).await
}

pub fn finalize_connected_onboarding(
    state: &AppState,
    input: FinalizeConnectedOnboardingInput,
) -> Result<profiles::ProfileImportResult> {
    profiles::finalize_connected_onboarding(
        state,
        input.label,
        input.relay_profile,
        input.passphrase,
    )
}

pub fn discard_connected_onboarding(state: &AppState) -> DiscardConnectedOnboardingResult {
    profiles::discard_connected_onboarding(state)
}

pub fn import_profile_from_bfprofile(
    state: &AppState,
    input: ImportProfileFromBfprofileInput,
) -> Result<profiles::ProfileImportResult> {
    profiles::import_profile_from_bfprofile(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        Some(input.passphrase),
        input.package_password,
        &input.package,
    )
}

pub async fn recover_profile_from_bfshare(
    state: &AppState,
    input: RecoverProfileFromBfshareInput,
) -> Result<profiles::ProfileImportResult> {
    profiles::recover_profile_from_bfshare(
        &state.shell_paths,
        input.label,
        input.relay_profile,
        Some(input.passphrase),
        input.package_password,
        &input.package,
    )
    .await
}

pub async fn apply_rotation_update(
    state: &AppState,
    input: ApplyRotationUpdateInput,
) -> Result<profiles::ProfileImportResult> {
    profiles::apply_rotation_update(
        &state.shell_paths,
        &input.target_profile_id,
        &input.onboarding_package,
        input.onboarding_password,
        input.passphrase,
    )
    .await
}

pub fn remove_profile(state: &AppState, input: RemoveProfileInput) -> Result<()> {
    profiles::remove_managed_profile(&state.shell_paths, &input.profile_id)
}

pub fn export_profile(
    state: &AppState,
    input: ExportProfileInput,
) -> Result<profiles::ProfileExportResult> {
    profiles::export_managed_profile(
        &state.shell_paths,
        &input.profile_id,
        PathBuf::from(input.destination_dir).as_path(),
        Some(input.passphrase),
    )
}

pub fn export_profile_package(
    state: &AppState,
    input: ExportProfilePackageInput,
) -> Result<crate::models::ProfilePackageExportResult> {
    let result = profiles::export_managed_profile_package(
        &state.shell_paths,
        &input.profile_id,
        &input.format,
        input.package_password,
        Some(input.passphrase),
    )?;
    Ok(project_profile_package_export_result(result))
}

pub async fn publish_profile_backup(
    state: &AppState,
    input: PublishProfileBackupInput,
) -> Result<crate::models::ProfileBackupPublishResult> {
    let result = profiles::publish_managed_profile_backup(
        &state.shell_paths,
        &input.profile_id,
        Some(input.passphrase),
    )
    .await?;
    Ok(project_profile_backup_publish_result(result))
}

pub fn update_profile_operator_settings(
    state: &AppState,
    input: UpdateProfileOperatorSettingsInput,
) -> Result<profiles::ProfileManifest> {
    profiles::update_managed_profile_settings(
        &state.shell_paths,
        &input.profile_id,
        input.label,
        input.relays,
        input.runtime_options,
    )
}

pub fn create_generated_keyset(
    group_name: String,
    threshold: u16,
    count: u16,
) -> Result<crate::models::GeneratedKeyset> {
    session::make_generated_keyset(group_name, threshold, count)
}

pub async fn create_rotated_keyset(
    input: RotateKeysetRequest,
) -> Result<crate::models::GeneratedKeyset> {
    session::make_rotated_keyset(input.threshold, input.count, input.sources).await
}

pub fn create_generated_onboarding_package(
    input: CreateGeneratedOnboardingPackageInput,
) -> Result<String> {
    session::make_generated_onboarding_package(
        &input.share_package_json,
        input.relay_urls,
        input.peer_pubkey,
        input.package_password,
    )
}

pub async fn start_profile_session(
    app: &tauri::AppHandle,
    state: &AppState,
    input: StartProfileSessionRequest,
) -> Result<ProfileRuntimeSnapshot> {
    let snapshot = session::start_profile_session(app, state, input).await?;
    sync_tray(app)?;
    Ok(snapshot)
}

pub async fn profile_runtime_snapshot(
    app: &tauri::AppHandle,
    state: &AppState,
    profile_id: Option<String>,
) -> Result<ProfileRuntimeSnapshot> {
    session::profile_session_snapshot(app, state, profile_id).await
}

pub async fn stop_signer(app: &tauri::AppHandle, state: &AppState, reason: &str) -> Result<()> {
    session::stop_signer(app, state, reason).await?;
    sync_tray(app)?;
    Ok(())
}

pub fn list_session_logs(
    state: &AppState,
    input: ListSessionLogsInput,
) -> Result<Vec<crate::models::SignerLogEntry>> {
    let runtime_dir = resolve_session_log_runtime_dir(state, input.runtime_dir)?;
    read_session_log(&runtime_dir, &state.paths)
}

pub async fn resolve_close_request(
    app: &tauri::AppHandle,
    state: &AppState,
    input: ResolveCloseRequestInput,
) -> Result<()> {
    match parse_close_request_action(&input.action)? {
        CloseRequestAction::HideOrCancel(action) => session::resolve_close_request(app, action),
        CloseRequestAction::StopAndQuit => {
            stop_signer(app, state, "quit").await?;
            session::resolve_close_request(app, "stop_and_quit")
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CloseRequestAction<'a> {
    HideOrCancel(&'a str),
    StopAndQuit,
}

fn parse_close_request_action(action: &str) -> Result<CloseRequestAction<'_>> {
    match action {
        "hide" | "cancel" => Ok(CloseRequestAction::HideOrCancel(action)),
        "stop_and_quit" => Ok(CloseRequestAction::StopAndQuit),
        _ => bail!("unknown close action"),
    }
}

fn resolve_session_log_runtime_dir(
    state: &AppState,
    runtime_dir: Option<String>,
) -> Result<PathBuf> {
    if let Some(value) = runtime_dir {
        return Ok(PathBuf::from(value));
    }
    let guard = state.signer.lock().unwrap();
    guard
        .last_session
        .as_ref()
        .map(|session| PathBuf::from(&session.runtime_dir))
        .ok_or_else(|| anyhow::anyhow!("no session logs available"))
}

fn project_profile_package_export_result(
    result: profiles::ProfilePackageExportResult,
) -> crate::models::ProfilePackageExportResult {
    crate::models::ProfilePackageExportResult {
        profile_id: result.profile_id,
        format: result.format,
        out_path: result.out_path,
        package: result.package,
    }
}

fn project_profile_backup_publish_result(
    result: profiles::ProfileBackupPublishResult,
) -> crate::models::ProfileBackupPublishResult {
    crate::models::ProfileBackupPublishResult {
        profile_id: result.profile_id,
        relays: result.relays,
        event_id: result.event_id,
        author_pubkey: result.author_pubkey,
    }
}

#[tauri::command]
pub async fn app_paths_command(
    state: State<'_, AppState>,
) -> std::result::Result<AppPathsResponse, String> {
    Ok(app_paths(state.inner()))
}

#[tauri::command]
pub async fn list_profiles_command(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<profiles::ProfileManifest>, String> {
    list_profiles(state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_relay_profiles_command(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<profiles::RelayProfile>, String> {
    list_relay_profiles(state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_profile_from_raw_command(
    state: State<'_, AppState>,
    input: ImportProfileFromRawInput,
) -> std::result::Result<profiles::ProfileImportResult, String> {
    import_profile_from_raw(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_profile_from_onboarding_command(
    state: State<'_, AppState>,
    input: ImportProfileFromOnboardingInput,
) -> std::result::Result<profiles::ProfileImportResult, String> {
    import_profile_from_onboarding(state.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connect_onboarding_package_command(
    state: State<'_, AppState>,
    input: ConnectOnboardingPackageInput,
) -> std::result::Result<crate::models::ConnectedOnboardingPreview, String> {
    connect_onboarding_package(state.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn finalize_connected_onboarding_command(
    state: State<'_, AppState>,
    input: FinalizeConnectedOnboardingInput,
) -> std::result::Result<profiles::ProfileImportResult, String> {
    finalize_connected_onboarding(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn discard_connected_onboarding_command(
    state: State<'_, AppState>,
) -> std::result::Result<DiscardConnectedOnboardingResult, String> {
    Ok(discard_connected_onboarding(state.inner()))
}

#[tauri::command]
pub async fn import_profile_from_bfprofile_command(
    state: State<'_, AppState>,
    input: ImportProfileFromBfprofileInput,
) -> std::result::Result<profiles::ProfileImportResult, String> {
    import_profile_from_bfprofile(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn recover_profile_from_bfshare_command(
    state: State<'_, AppState>,
    input: RecoverProfileFromBfshareInput,
) -> std::result::Result<profiles::ProfileImportResult, String> {
    recover_profile_from_bfshare(state.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn apply_rotation_update_command(
    state: State<'_, AppState>,
    input: ApplyRotationUpdateInput,
) -> std::result::Result<profiles::ProfileImportResult, String> {
    apply_rotation_update(state.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn remove_profile_command(
    state: State<'_, AppState>,
    input: RemoveProfileInput,
) -> std::result::Result<(), String> {
    remove_profile(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_profile_command(
    state: State<'_, AppState>,
    input: ExportProfileInput,
) -> std::result::Result<profiles::ProfileExportResult, String> {
    export_profile(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_profile_package_command(
    state: State<'_, AppState>,
    input: ExportProfilePackageInput,
) -> std::result::Result<crate::models::ProfilePackageExportResult, String> {
    export_profile_package(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn publish_profile_backup_command(
    state: State<'_, AppState>,
    input: PublishProfileBackupInput,
) -> std::result::Result<crate::models::ProfileBackupPublishResult, String> {
    publish_profile_backup(state.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_profile_operator_settings_command(
    state: State<'_, AppState>,
    input: UpdateProfileOperatorSettingsInput,
) -> std::result::Result<profiles::ProfileManifest, String> {
    update_profile_operator_settings(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_generated_keyset_command(
    input: crate::models::CreateKeysetRequest,
) -> std::result::Result<crate::models::GeneratedKeyset, String> {
    create_generated_keyset(input.group_name, input.threshold, input.count)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_rotated_keyset_command(
    input: RotateKeysetRequest,
) -> std::result::Result<crate::models::GeneratedKeyset, String> {
    create_rotated_keyset(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_generated_onboarding_package_command(
    input: CreateGeneratedOnboardingPackageInput,
) -> std::result::Result<String, String> {
    create_generated_onboarding_package(input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_profile_session_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartProfileSessionRequest,
) -> std::result::Result<ProfileRuntimeSnapshot, String> {
    start_profile_session(&app, state.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn profile_runtime_snapshot_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> std::result::Result<ProfileRuntimeSnapshot, String> {
    profile_runtime_snapshot(&app, state.inner(), profile_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn stop_signer_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    stop_signer(&app, state.inner(), "stopped")
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_session_logs_command(
    state: State<'_, AppState>,
    input: ListSessionLogsInput,
) -> std::result::Result<Vec<crate::models::SignerLogEntry>, String> {
    list_session_logs(state.inner(), input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn resolve_close_request_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ResolveCloseRequestInput,
) -> std::result::Result<(), String> {
    resolve_close_request(&app, state.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;
    use crate::models::SessionResume;
    use crate::paths::AppPaths;
    use crate::session::make_app_state;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn test_shell_paths(label: &str) -> profiles::ShellPaths {
        let root = std::env::temp_dir().join(format!(
            "igloo-home-app-commands-test-{label}-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        profiles::ShellPaths {
            config_dir: root.join("config").join("igloo-shell"),
            data_dir: root.join("data").join("igloo-shell"),
            state_dir: root.join("state").join("igloo-shell"),
            profiles_dir: root.join("config").join("igloo-shell").join("profiles"),
            groups_dir: root.join("data").join("igloo-shell").join("groups"),
            encrypted_profiles_dir: root
                .join("data")
                .join("igloo-shell")
                .join("encrypted-profiles"),
            state_profiles_dir: root.join("state").join("igloo-shell").join("profiles"),
            rotations_dir: root.join("state").join("igloo-shell").join("rotations"),
            config_path: root.join("config").join("igloo-shell").join("config.json"),
            relay_profiles_path: root
                .join("config")
                .join("igloo-shell")
                .join("relay-profiles.json"),
            imports_dir: root.join("data").join("igloo-shell").join("imports"),
        }
    }

    fn test_app_paths(label: &str) -> AppPaths {
        let root = std::env::temp_dir().join(format!(
            "igloo-home-app-commands-app-test-{label}-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create app path root");
        AppPaths {
            settings_path: root.join("settings.json"),
            last_session_path: root.join("last-session.json"),
        }
    }

    #[test]
    fn parse_close_request_action_accepts_current_actions() {
        assert_eq!(
            parse_close_request_action("hide").expect("hide action"),
            CloseRequestAction::HideOrCancel("hide")
        );
        assert_eq!(
            parse_close_request_action("cancel").expect("cancel action"),
            CloseRequestAction::HideOrCancel("cancel")
        );
        assert_eq!(
            parse_close_request_action("stop_and_quit").expect("stop action"),
            CloseRequestAction::StopAndQuit
        );
        assert_eq!(
            parse_close_request_action("wat").unwrap_err().to_string(),
            "unknown close action"
        );
    }

    #[test]
    fn resolve_session_log_runtime_dir_uses_explicit_input_first() {
        let state = make_app_state(
            test_app_paths("session-log-explicit"),
            test_shell_paths("session-log-explicit"),
            crate::models::AppSettings::default(),
            None,
        );
        let runtime_dir =
            resolve_session_log_runtime_dir(&state, Some("/tmp/igloo-home-runtime".to_string()))
                .expect("explicit runtime dir");
        assert_eq!(runtime_dir, PathBuf::from("/tmp/igloo-home-runtime"));
    }

    #[test]
    fn resolve_session_log_runtime_dir_falls_back_to_last_session() {
        let state = make_app_state(
            test_app_paths("session-log-fallback"),
            test_shell_paths("session-log-fallback"),
            crate::models::AppSettings::default(),
            Some(SessionResume {
                share_id: "profile-1".to_string(),
                share_name: "Device 1".to_string(),
                relay_urls: vec!["ws://127.0.0.1:8194".to_string()],
                peer_pubkeys: vec![],
                group_public_key: "abcd".to_string(),
                runtime_dir: "/tmp/igloo-home-runtime-fallback".to_string(),
                last_started_at: 1,
                last_stopped_at: None,
            }),
        );
        let runtime_dir =
            resolve_session_log_runtime_dir(&state, None).expect("fallback runtime dir");
        assert_eq!(
            runtime_dir,
            PathBuf::from("/tmp/igloo-home-runtime-fallback")
        );
    }

    #[test]
    fn resolve_session_log_runtime_dir_errors_without_any_session_path() {
        let state = make_app_state(
            test_app_paths("session-log-missing"),
            test_shell_paths("session-log-missing"),
            crate::models::AppSettings::default(),
            None,
        );
        assert_eq!(
            resolve_session_log_runtime_dir(&state, None)
                .unwrap_err()
                .to_string(),
            "no session logs available"
        );
    }

    #[test]
    fn project_profile_package_export_result_preserves_wire_shape() {
        let result = project_profile_package_export_result(profiles::ProfilePackageExportResult {
            profile_id: "profile-1".to_string(),
            format: "bfprofile".to_string(),
            out_path: Some("/tmp/profile.bfprofile".to_string()),
            package: "package-data".to_string(),
        });
        assert_eq!(result.profile_id, "profile-1");
        assert_eq!(result.format, "bfprofile");
        assert_eq!(result.out_path, Some("/tmp/profile.bfprofile".to_string()));
        assert_eq!(result.package, "package-data");
    }

    #[test]
    fn project_profile_backup_publish_result_preserves_wire_shape() {
        let result = project_profile_backup_publish_result(profiles::ProfileBackupPublishResult {
            profile_id: "profile-1".to_string(),
            relays: vec!["ws://127.0.0.1:8194".to_string()],
            event_id: "event-1".to_string(),
            author_pubkey: "pubkey-1".to_string(),
        });
        assert_eq!(result.profile_id, "profile-1");
        assert_eq!(result.relays, vec!["ws://127.0.0.1:8194".to_string()]);
        assert_eq!(result.event_id, "event-1");
        assert_eq!(result.author_pubkey, "pubkey-1");
    }
}
