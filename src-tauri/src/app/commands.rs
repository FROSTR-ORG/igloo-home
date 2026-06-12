use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Result, bail};
use tauri::{AppHandle, Manager, State};

use crate::error::HomeError;
use crate::path_scope;

use crate::models::{
    AppPathsResponse, ApplyRotationUpdateInput, ConnectOnboardingPackageInput,
    CreateGeneratedOnboardingPackageInput, DiscardConnectedOnboardingResult, ExportProfileInput,
    ExportProfilePackageInput, FinalizeConnectedOnboardingInput, ImportProfileFromBfprofileInput,
    ImportProfileFromOnboardingInput, ImportProfileFromRawInput, ListSessionLogsInput,
    ProfileRuntimeSnapshot, RecoverGroupKeyInput, RemoveProfileInput, ResolveCloseRequestInput,
    RotateKeysetRequest, RuntimePeerRefreshFailure, RuntimePeerRefreshResult,
    StartProfileSessionRequest, UpdateProfileOperatorSettingsInput,
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

pub fn recover_group_key(
    state: &AppState,
    input: RecoverGroupKeyInput,
) -> Result<crate::models::RecoveredGroupKey> {
    session::recover_group_key_from_shares(
        &state.shell_paths,
        &input.profile_id,
        input.device_passphrase,
        input.sources,
    )
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

pub fn create_rotated_keyset(
    state: &AppState,
    input: RotateKeysetRequest,
) -> Result<crate::models::GeneratedKeyset> {
    session::make_rotated_keyset(
        &state.shell_paths,
        input.threshold,
        input.count,
        &input.source_profile_id,
        input.sources,
    )
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

pub async fn refresh_runtime_peers(state: &AppState) -> Result<RuntimePeerRefreshResult> {
    let bridge = {
        let guard = state.signer.lock().unwrap();
        guard
            .active
            .as_ref()
            .map(|active| active.bridge.clone())
            .ok_or_else(|| anyhow::anyhow!("no active signer session"))?
    };
    let peers = bridge.runtime_metadata().await?.peers;
    let mut refreshed = 0usize;
    let mut failures = Vec::new();

    for peer in &peers {
        match bridge.ping(peer.clone(), Duration::from_secs(20)).await {
            Ok(_) => refreshed += 1,
            Err(error) => failures.push(RuntimePeerRefreshFailure {
                peer: peer.clone(),
                error: error.to_string(),
            }),
        }
    }

    Ok(RuntimePeerRefreshResult {
        attempted: peers.len(),
        refreshed,
        failures,
    })
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

#[tauri::command]
pub async fn app_paths_command(
    state: State<'_, AppState>,
) -> std::result::Result<AppPathsResponse, HomeError> {
    Ok(app_paths(state.inner()))
}

#[tauri::command]
pub async fn list_profiles_command(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<profiles::ProfileManifest>, HomeError> {
    Ok(list_profiles(state.inner())?)
}

#[tauri::command]
pub async fn list_relay_profiles_command(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<profiles::RelayProfile>, HomeError> {
    Ok(list_relay_profiles(state.inner())?)
}

#[tauri::command]
pub async fn import_profile_from_raw_command(
    state: State<'_, AppState>,
    input: ImportProfileFromRawInput,
) -> std::result::Result<profiles::ProfileImportResult, HomeError> {
    Ok(import_profile_from_raw(state.inner(), input)?)
}

#[tauri::command]
pub async fn import_profile_from_onboarding_command(
    state: State<'_, AppState>,
    input: ImportProfileFromOnboardingInput,
) -> std::result::Result<profiles::ProfileImportResult, HomeError> {
    Ok(import_profile_from_onboarding(state.inner(), input).await?)
}

#[tauri::command]
pub async fn connect_onboarding_package_command(
    state: State<'_, AppState>,
    input: ConnectOnboardingPackageInput,
) -> std::result::Result<crate::models::ConnectedOnboardingPreview, HomeError> {
    Ok(connect_onboarding_package(state.inner(), input).await?)
}

#[tauri::command]
pub async fn finalize_connected_onboarding_command(
    state: State<'_, AppState>,
    input: FinalizeConnectedOnboardingInput,
) -> std::result::Result<profiles::ProfileImportResult, HomeError> {
    Ok(finalize_connected_onboarding(state.inner(), input)?)
}

#[tauri::command]
pub async fn discard_connected_onboarding_command(
    state: State<'_, AppState>,
) -> std::result::Result<DiscardConnectedOnboardingResult, HomeError> {
    Ok(discard_connected_onboarding(state.inner()))
}

#[tauri::command]
pub async fn import_profile_from_bfprofile_command(
    state: State<'_, AppState>,
    input: ImportProfileFromBfprofileInput,
) -> std::result::Result<profiles::ProfileImportResult, HomeError> {
    Ok(import_profile_from_bfprofile(state.inner(), input)?)
}

#[tauri::command]
pub async fn recover_group_key_command(
    state: State<'_, AppState>,
    input: RecoverGroupKeyInput,
) -> std::result::Result<crate::models::RecoveredGroupKey, HomeError> {
    Ok(recover_group_key(state.inner(), input)?)
}

#[tauri::command]
pub async fn apply_rotation_update_command(
    state: State<'_, AppState>,
    input: ApplyRotationUpdateInput,
) -> std::result::Result<profiles::ProfileImportResult, HomeError> {
    Ok(apply_rotation_update(state.inner(), input).await?)
}

#[tauri::command]
pub async fn remove_profile_command(
    state: State<'_, AppState>,
    input: RemoveProfileInput,
) -> std::result::Result<(), HomeError> {
    Ok(remove_profile(state.inner(), input)?)
}

#[tauri::command]
pub async fn export_profile_command(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportProfileInput,
) -> std::result::Result<profiles::ProfileExportResult, HomeError> {
    let roots = export_profile_allowed_roots(&app);
    let canonical = path_scope::canonicalize_under_scope(&input.destination_dir, &roots)?;
    let mut input = input;
    input.destination_dir = canonical
        .to_str()
        .ok_or_else(|| HomeError::Runtime {
            message: "destination_dir path contains invalid UTF-8".to_string(),
        })?
        .to_string();
    Ok(export_profile(state.inner(), input)?)
}

/// Resolve the set of roots an operator-supplied export destination may
/// live under. AppData is always included; Document is added when the
/// host exposes a documents directory (may be absent in sandboxes / CI).
fn export_profile_allowed_roots(app: &AppHandle) -> Vec<PathBuf> {
    let resolver = app.path();
    let mut roots = Vec::with_capacity(2);
    if let Ok(path) = resolver.app_data_dir() {
        roots.push(path);
    }
    if let Ok(path) = resolver.document_dir() {
        roots.push(path);
    }
    roots
}

#[tauri::command]
pub async fn export_profile_package_command(
    state: State<'_, AppState>,
    input: ExportProfilePackageInput,
) -> std::result::Result<crate::models::ProfilePackageExportResult, HomeError> {
    Ok(export_profile_package(state.inner(), input)?)
}

#[tauri::command]
pub async fn update_profile_operator_settings_command(
    state: State<'_, AppState>,
    input: UpdateProfileOperatorSettingsInput,
) -> std::result::Result<profiles::ProfileManifest, HomeError> {
    Ok(update_profile_operator_settings(state.inner(), input)?)
}

#[tauri::command]
pub async fn create_generated_keyset_command(
    input: crate::models::CreateKeysetRequest,
) -> std::result::Result<crate::models::GeneratedKeyset, HomeError> {
    Ok(create_generated_keyset(
        input.group_name,
        input.threshold,
        input.count,
    )?)
}

#[tauri::command]
pub async fn create_rotated_keyset_command(
    state: State<'_, AppState>,
    input: RotateKeysetRequest,
) -> std::result::Result<crate::models::GeneratedKeyset, HomeError> {
    Ok(create_rotated_keyset(state.inner(), input)?)
}

#[tauri::command]
pub async fn create_generated_onboarding_package_command(
    input: CreateGeneratedOnboardingPackageInput,
) -> std::result::Result<String, HomeError> {
    Ok(create_generated_onboarding_package(input)?)
}

#[tauri::command]
pub async fn start_profile_session_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartProfileSessionRequest,
) -> std::result::Result<ProfileRuntimeSnapshot, HomeError> {
    Ok(start_profile_session(&app, state.inner(), input).await?)
}

#[tauri::command]
pub async fn profile_runtime_snapshot_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> std::result::Result<ProfileRuntimeSnapshot, HomeError> {
    Ok(profile_runtime_snapshot(&app, state.inner(), profile_id).await?)
}

#[tauri::command]
pub async fn refresh_runtime_peers_command(
    state: State<'_, AppState>,
) -> std::result::Result<RuntimePeerRefreshResult, HomeError> {
    Ok(refresh_runtime_peers(state.inner()).await?)
}

#[tauri::command]
pub async fn stop_signer_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<(), HomeError> {
    Ok(stop_signer(&app, state.inner(), "stopped").await?)
}

#[tauri::command]
pub async fn list_session_logs_command(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ListSessionLogsInput,
) -> std::result::Result<Vec<crate::models::SignerLogEntry>, HomeError> {
    let input = canonicalize_session_log_input(&app, input)?;
    Ok(list_session_logs(state.inner(), input)?)
}

/// Canonicalize an operator-supplied `runtime_dir` under the app's
/// AppData root. When `runtime_dir` is None the fallback path
/// (`state.last_session.runtime_dir`) is internally-sourced and not
/// re-validated here.
fn canonicalize_session_log_input(
    app: &AppHandle,
    input: ListSessionLogsInput,
) -> std::result::Result<ListSessionLogsInput, HomeError> {
    let Some(raw) = input.runtime_dir.as_deref() else {
        return Ok(input);
    };
    let roots = session_log_allowed_roots(app);
    let canonical = path_scope::canonicalize_under_scope(raw, &roots)?;
    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| HomeError::Runtime {
            message: "runtime_dir path contains invalid UTF-8".to_string(),
        })?
        .to_string();
    Ok(ListSessionLogsInput {
        runtime_dir: Some(canonical_str),
    })
}

/// Session logs may only live under the app's AppData directory.
fn session_log_allowed_roots(app: &AppHandle) -> Vec<PathBuf> {
    let resolver = app.path();
    let mut roots = Vec::with_capacity(1);
    if let Ok(path) = resolver.app_data_dir() {
        roots.push(path);
    }
    roots
}

#[tauri::command]
pub async fn resolve_close_request_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ResolveCloseRequestInput,
) -> std::result::Result<(), HomeError> {
    Ok(resolve_close_request(&app, state.inner(), input).await?)
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
}
