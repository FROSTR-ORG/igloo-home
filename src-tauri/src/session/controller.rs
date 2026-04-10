use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use anyhow::{Result, bail};
use bifrost_app::runtime::{
    EncryptedFileStore, ResolvedAppConfig, begin_run, complete_clean_run,
    load_or_init_signer_resolved,
};
use bifrost_bridge_tokio::{Bridge, BridgeConfig, NostrSdkAdapter};
use bifrost_signer::DeviceStore;
use tauri::{AppHandle, Emitter};

use crate::models::{ProfileRuntimeSnapshot, SessionResume, StartProfileSessionRequest};
use crate::profiles::{
    ProfileManifest, ShellPaths, daemon_log_path_for_profile, read_managed_profile,
    read_profile_daemon_metadata, resolve_runtime_for_passphrase,
};
use crate::session_log::{append_session_log, read_session_log};

use super::{
    ActiveSigner, AppState, emit_lifecycle, make_log, now_unix_secs, spawn_monitor, trim_logs,
    write_json,
};

pub async fn start_profile_session(
    app: &AppHandle,
    state: &AppState,
    input: StartProfileSessionRequest,
) -> Result<ProfileRuntimeSnapshot> {
    validate_start_preconditions(state.signer.lock().unwrap().active.is_some())?;
    let (profile, resolved) =
        resolve_runtime_for_start(&state.shell_paths, &input.profile_id, &input.passphrase)?;
    start_profile_session_resolved(app, state, profile, resolved).await
}

fn resolve_runtime_for_start(
    shell_paths: &ShellPaths,
    profile_id: &str,
    passphrase: &str,
) -> Result<(ProfileManifest, ResolvedAppConfig)> {
    resolve_runtime_for_passphrase(shell_paths, profile_id, passphrase)
}

fn validate_start_preconditions(has_active_signer: bool) -> Result<()> {
    if has_active_signer {
        bail!("a signer session is already active");
    }
    Ok(())
}

async fn start_profile_session_resolved(
    app: &AppHandle,
    state: &AppState,
    profile: ProfileManifest,
    resolved: ResolvedAppConfig,
) -> Result<ProfileRuntimeSnapshot> {
    let runtime_dir = resolved
        .state_path
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| state.shell_paths.profile_state_dir(&profile.id));
    fs::create_dir_all(&runtime_dir)?;
    let state_path = resolved.state_path.clone();

    let store = EncryptedFileStore::new(state_path.clone(), resolved.share.clone());
    let signer = load_or_init_signer_resolved(&resolved, &store)?;
    let run_id = begin_run(&state_path)?;
    let bridge = Arc::new(
        Bridge::start_with_config(
            NostrSdkAdapter::new(resolved.relays.clone()),
            signer,
            BridgeConfig::default(),
        )
        .await?,
    );

    let session_resume = SessionResume {
        share_id: profile.id.clone(),
        share_name: profile.label.clone(),
        relay_urls: resolved.relays.clone(),
        peer_pubkeys: resolved.peers.clone(),
        group_public_key: hex::encode(resolved.group.group_pk),
        runtime_dir: runtime_dir.display().to_string(),
        last_started_at: now_unix_secs(),
        last_stopped_at: None,
    };
    write_json(
        state.paths.session_metadata_path(&runtime_dir),
        &session_resume,
    )?;
    write_json(state.paths.last_session_path.clone(), &session_resume)?;

    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let monitor_handle = spawn_monitor(
        app.clone(),
        state.signer.clone(),
        state.paths.clone(),
        runtime_dir.clone(),
        bridge.clone(),
        stop_flag.clone(),
    );

    {
        let mut guard = state.signer.lock().unwrap();
        let entry = make_log(
            "info",
            format!("started profile session for '{}'", profile.label),
        );
        guard.logs.push_back(entry.clone());
        trim_logs(&mut guard.logs);
        append_session_log(&state.paths, &runtime_dir, &entry)?;
        let _ = app.emit(
            crate::events::EVENT_SIGNER_LOG,
            crate::models::SignerLogEvent { entry },
        );
        guard.last_session = Some(session_resume.clone());
        guard.active = Some(ActiveSigner {
            share_id: profile.id.clone(),
            share_name: profile.label.clone(),
            runtime_dir: runtime_dir.clone(),
            state_path,
            store,
            bridge,
            run_id,
            stop_flag,
            monitor_handle,
            session_resume,
        });
    }

    emit_lifecycle(app, state, "started")?;
    profile_session_snapshot(app, state, Some(profile.id)).await
}

fn empty_profile_runtime_snapshot() -> ProfileRuntimeSnapshot {
    ProfileRuntimeSnapshot {
        active: false,
        profile: None,
        runtime_status: None,
        readiness: None,
        runtime_diagnostics: None,
        daemon_log_path: None,
        daemon_log_lines: Vec::new(),
        daemon_metadata: None,
    }
}

pub async fn stop_signer(app: &AppHandle, state: &AppState, reason: &str) -> Result<()> {
    let active = take_active_signer(state);
    let Some(active) = active else {
        return Ok(());
    };

    active.stop_flag.store(true, Ordering::Relaxed);
    let _ = active.monitor_handle.await;
    let snapshot_state = active.bridge.snapshot_state().await?;
    active.store.save(&snapshot_state)?;
    complete_clean_run(&active.state_path, &active.run_id, &snapshot_state)?;
    if let Ok(bridge) = Arc::try_unwrap(active.bridge) {
        bridge.shutdown().await;
    }

    let mut session_resume = active.session_resume.clone();
    session_resume.last_stopped_at = Some(now_unix_secs());
    write_json(
        state.paths.session_metadata_path(&active.runtime_dir),
        &session_resume,
    )?;
    write_json(state.paths.last_session_path.clone(), &session_resume)?;

    {
        let mut guard = state.signer.lock().unwrap();
        guard.last_session = Some(session_resume.clone());
        let entry = make_log(
            "info",
            format!("stopped signer session for '{}'", active.share_name),
        );
        guard.logs.push_back(entry.clone());
        trim_logs(&mut guard.logs);
        append_session_log(&state.paths, &active.runtime_dir, &entry)?;
        let _ = app.emit(
            crate::events::EVENT_SIGNER_LOG,
            crate::models::SignerLogEvent { entry },
        );
    }
    emit_lifecycle(app, state, reason)?;
    Ok(())
}

fn take_active_signer(state: &AppState) -> Option<ActiveSigner> {
    let mut guard = state.signer.lock().unwrap();
    guard.active.take()
}

pub async fn profile_session_snapshot(
    _app: &AppHandle,
    state: &AppState,
    profile_id: Option<String>,
) -> Result<ProfileRuntimeSnapshot> {
    let requested_profile = profile_id.or_else(|| {
        state
            .signer
            .lock()
            .unwrap()
            .last_session
            .as_ref()
            .map(|item| item.share_id.clone())
    });
    let Some(profile_id) = requested_profile else {
        return Ok(empty_profile_runtime_snapshot());
    };

    let profile = read_managed_profile(&state.shell_paths, &profile_id).ok();
    let daemon_metadata = read_profile_daemon_metadata(&state.shell_paths, &profile_id).ok();
    let daemon_log_path = profile.as_ref().map(|_| {
        daemon_log_path_for_profile(&state.shell_paths, &profile_id)
            .display()
            .to_string()
    });
    let active = {
        let guard = state.signer.lock().unwrap();
        guard
            .active
            .as_ref()
            .map(|item| item.share_id == profile_id)
            .unwrap_or(false)
    };

    let log_lines = if let Some(profile) = &profile {
        let runtime_dir = PathBuf::from(&profile.state_path)
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| state.shell_paths.profile_state_dir(&profile.id));
        read_session_log(&runtime_dir, &state.paths)?
            .into_iter()
            .map(|entry| format!("[{}] {} {}", entry.at, entry.level, entry.message))
            .collect()
    } else {
        Vec::new()
    };

    let bridge = {
        let guard = state.signer.lock().unwrap();
        guard
            .active
            .as_ref()
            .filter(|item| item.share_id == profile_id)
            .map(|item| item.bridge.clone())
    };
    let runtime_status = if let Some(bridge) = &bridge {
        Some(serde_json::to_value(bridge.runtime_status().await?)?)
    } else {
        None
    };
    let readiness = if let Some(bridge) = &bridge {
        Some(serde_json::to_value(bridge.readiness().await?)?)
    } else {
        None
    };
    let runtime_diagnostics = match &runtime_status {
        Some(runtime_status) => Some(serde_json::json!({
            "runtime_status": runtime_status,
        })),
        None => None,
    };

    Ok(ProfileRuntimeSnapshot {
        active,
        profile,
        runtime_status,
        readiness,
        runtime_diagnostics,
        daemon_log_path,
        daemon_log_lines: log_lines,
        daemon_metadata,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;
    use crate::paths::AppPaths;
    use crate::profiles::{ProfileImportResult, RelayProfile};
    use crate::session::make_app_state;
    use bifrost_codec::{encode_group_package_json, encode_share_package_json};
    use frostr_utils::{CreateKeysetConfig, create_keyset};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn test_shell_paths(label: &str) -> ShellPaths {
        let root = std::env::temp_dir().join(format!(
            "igloo-home-session-controller-test-{label}-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        ShellPaths {
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
            "igloo-home-session-controller-app-test-{label}-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create app path root");
        AppPaths {
            settings_path: root.join("settings.json"),
            last_session_path: root.join("last-session.json"),
        }
    }

    fn import_test_profile(shell_paths: &ShellPaths, passphrase: &str) -> ProfileManifest {
        shell_paths.ensure().expect("ensure shell paths");
        crate::profiles::replace_managed_relay_profile(
            shell_paths,
            RelayProfile {
                id: "local".to_string(),
                label: "Local".to_string(),
                relays: vec!["ws://127.0.0.1:8194".to_string()],
            },
        )
        .expect("write relay profile");
        let bundle = create_keyset(CreateKeysetConfig {
            group_name: "Session Test Group".to_string(),
            threshold: 2,
            count: 3,
        })
        .expect("create keyset");
        let group_json = encode_group_package_json(&bundle.group).expect("group json");
        let share_json = encode_share_package_json(&bundle.shares[1]).expect("share package json");
        let result = crate::profiles::import_profile_from_raw_json(
            shell_paths,
            Some("Desktop Session Test".to_string()),
            Some("local".to_string()),
            &["ws://127.0.0.1:8194".to_string()],
            Some(passphrase.to_string()),
            &group_json,
            &share_json,
        )
        .expect("import profile");
        match result {
            ProfileImportResult::ProfileCreated { profile, .. } => profile,
            other => panic!("expected profile_created, got {other:?}"),
        }
    }

    #[test]
    fn validate_start_preconditions_rejects_active_session() {
        assert!(validate_start_preconditions(false).is_ok());
        assert_eq!(
            validate_start_preconditions(true).unwrap_err().to_string(),
            "a signer session is already active"
        );
    }

    #[test]
    fn resolve_runtime_for_start_uses_explicit_passphrase_without_env() {
        let shell_paths = test_shell_paths("explicit-passphrase");
        let profile = import_test_profile(&shell_paths, "encrypted-profile-pass");
        unsafe {
            std::env::remove_var("IGLOO_SHELL_PROFILE_PASSPHRASE");
        }

        assert!(crate::profiles::resolve_runtime(&shell_paths, &profile.id).is_err());

        let (resolved_profile, resolved) =
            resolve_runtime_for_start(&shell_paths, &profile.id, "encrypted-profile-pass")
                .expect("resolve runtime with explicit passphrase");
        assert_eq!(resolved_profile.id, profile.id);
        assert_eq!(resolved.relays, vec!["ws://127.0.0.1:8194".to_string()]);
    }

    #[test]
    fn take_active_signer_returns_none_when_inactive() {
        let state = make_app_state(
            test_app_paths("inactive-stop"),
            test_shell_paths("inactive-stop"),
            crate::models::AppSettings::default(),
            None,
        );
        assert!(take_active_signer(&state).is_none());
    }

    #[test]
    fn empty_snapshot_matches_current_cold_shape() {
        let snapshot = empty_profile_runtime_snapshot();
        assert!(!snapshot.active);
        assert!(snapshot.profile.is_none());
        assert!(snapshot.runtime_status.is_none());
        assert!(snapshot.readiness.is_none());
        assert!(snapshot.runtime_diagnostics.is_none());
        assert!(snapshot.daemon_log_path.is_none());
        assert!(snapshot.daemon_metadata.is_none());
        assert!(snapshot.daemon_log_lines.is_empty());
    }
}
