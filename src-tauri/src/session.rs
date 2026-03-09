use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Result, anyhow, bail};
use bifrost_app::onboarding::explain_readiness;
use bech32::{Bech32, Hrp};
use bifrost_app::runtime::{
    AppConfig, EncryptedFileStore, PeerConfig, ResolvedAppConfig, begin_run, complete_clean_run,
    load_or_init_signer, load_or_init_signer_resolved,
};
use bifrost_bridge_tokio::{Bridge, BridgeConfig, NostrSdkAdapter};
use bifrost_codec::{
    decode_group_package_json, decode_share_package_json, encode_group_package_json,
    encode_share_package_json,
};
use bifrost_core::types::{GroupPackage, PeerPolicy, SharePackage};
use bifrost_signer::DeviceStore;
use frost_secp256k1_tr_unofficial as frost;
use frost_secp256k1_tr_unofficial::keys::EvenY;
use frostr_utils::{CreateKeysetConfig, RecoverKeyInput, create_keyset, recover_key};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use igloo_shell_core::shell::{ProfileManifest, ShellPaths, daemon_log_path as profile_log_path, read_daemon_metadata, resolve_profile_runtime};

use crate::events::{
    EVENT_APP_CLOSE_REQUESTED, EVENT_SIGNER_LIFECYCLE, EVENT_SIGNER_LOG, EVENT_SIGNER_POLICIES,
    EVENT_SIGNER_RESUME_REQUESTED, EVENT_SIGNER_STATUS,
};
use crate::models::{
    AcceptedOnboardingPackage, CloseRequestEvent, GeneratedKeyset, GeneratedKeysetShare,
    PolicySnapshot, ProfileRuntimeSnapshot, RecoveredKey, SessionResume, SignerLifecycleEvent,
    SignerLogEntry, SignerLogEvent, SignerPoliciesEvent, SignerSnapshot, SignerStatusEvent,
    StartProfileSessionRequest, StartSignerRequest, UnlockShareInput,
};
use crate::paths::AppPaths;
use crate::share_store::{append_session_log, read_session_log, unlock_share};

const LOG_LIMIT: usize = 200;

#[derive(Default)]
pub struct CloseState {
    pub allow_close_once: bool,
}

pub struct AppState {
    pub paths: AppPaths,
    pub shell_paths: ShellPaths,
    pub signer: Arc<Mutex<SignerState>>,
    pub settings: Mutex<crate::models::AppSettings>,
    pub close: Mutex<CloseState>,
}

pub struct SignerState {
    pub active: Option<ActiveSigner>,
    pub logs: VecDeque<SignerLogEntry>,
    pub last_session: Option<SessionResume>,
}

impl Default for SignerState {
    fn default() -> Self {
        Self {
            active: None,
            logs: VecDeque::new(),
            last_session: None,
        }
    }
}

pub struct ActiveSigner {
    pub share_id: String,
    pub share_name: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
    pub group_public_key: String,
    pub runtime_dir: std::path::PathBuf,
    pub state_path: std::path::PathBuf,
    pub store: EncryptedFileStore,
    pub bridge: Arc<Bridge>,
    pub run_id: String,
    pub stop_flag: Arc<AtomicBool>,
    pub monitor_handle: tauri::async_runtime::JoinHandle<()>,
    pub session_resume: SessionResume,
}

pub fn make_app_state(
    paths: AppPaths,
    shell_paths: ShellPaths,
    settings: crate::models::AppSettings,
    last_session: Option<SessionResume>,
) -> AppState {
    AppState {
        paths,
        shell_paths,
        signer: Arc::new(Mutex::new(SignerState {
            active: None,
            logs: VecDeque::new(),
            last_session,
        })),
        settings: Mutex::new(settings),
        close: Mutex::new(CloseState::default()),
    }
}

pub async fn start_signer(
    app: &AppHandle,
    state: &AppState,
    input: StartSignerRequest,
) -> Result<SignerSnapshot> {
    {
        let guard = state.signer.lock().unwrap();
        if guard.active.is_some() {
            bail!("a signer session is already active");
        }
    }

    let unlocked = unlock_share(
        &state.paths,
        UnlockShareInput {
            share_id: input.share_id.clone(),
            password: input.password.clone(),
        },
    )
    .map_err(unlock_error_to_anyhow)?;

    let group = decode_group_package_json(&unlocked.group_package_json)?;
    let share = decode_share_package_json(&unlocked.share_package_json)?;
    let relay_urls = normalize_lines(input.relay_urls);
    if relay_urls.is_empty() {
        bail!("at least one relay URL is required");
    }
    let peer_pubkeys = normalize_lines(input.peer_pubkeys);

    let runtime_dir = state.paths.runtime_share_dir(&unlocked.metadata.share_id)?;
    fs::create_dir_all(&runtime_dir)?;
    fs::write(
        state.paths.session_group_path(&runtime_dir),
        unlocked.group_package_json.as_bytes(),
    )?;
    fs::write(
        state.paths.session_share_path(&runtime_dir),
        unlocked.share_package_json.as_bytes(),
    )?;
    let state_path = state.paths.session_state_path(&runtime_dir);

    let config = AppConfig {
        group_path: state
            .paths
            .session_group_path(&runtime_dir)
            .display()
            .to_string(),
        share_path: state
            .paths
            .session_share_path(&runtime_dir)
            .display()
            .to_string(),
        state_path: state_path.display().to_string(),
        relays: relay_urls.clone(),
        peers: peer_pubkeys
            .iter()
            .map(|peer| PeerConfig {
                pubkey: peer.clone(),
                policy: PeerPolicy::default(),
            })
            .collect(),
        options: Default::default(),
    };
    fs::write(
        state.paths.session_config_path(&runtime_dir),
        serde_json::to_vec_pretty(&config)?,
    )?;

    let store = EncryptedFileStore::new(state_path.clone(), share);
    let signer = load_or_init_signer(&config, &store)?;
    let run_id = begin_run(&state_path)?;
    let bridge = Arc::new(
        Bridge::start_with_config(
            NostrSdkAdapter::new(relay_urls.clone()),
            signer,
            BridgeConfig::default(),
        )
        .await?,
    );

    let session_resume = SessionResume {
        share_id: unlocked.metadata.share_id.clone(),
        share_name: unlocked.metadata.name.clone(),
        relay_urls: relay_urls.clone(),
        peer_pubkeys: peer_pubkeys.clone(),
        group_public_key: hex::encode(group.group_pk),
        runtime_dir: runtime_dir.display().to_string(),
        last_started_at: now_unix_secs(),
        last_stopped_at: None,
    };
    write_json(
        state.paths.session_metadata_path(&runtime_dir),
        &session_resume,
    )?;
    write_json(state.paths.last_session_path.clone(), &session_resume)?;

    let stop_flag = Arc::new(AtomicBool::new(false));
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
            format!("started signer session for '{}'", unlocked.metadata.name),
        );
        guard.logs.push_back(entry.clone());
        trim_logs(&mut guard.logs);
        append_session_log(&state.paths, &runtime_dir, &entry)?;
        let _ = app.emit(EVENT_SIGNER_LOG, SignerLogEvent { entry });
        guard.last_session = Some(session_resume.clone());
        guard.active = Some(ActiveSigner {
            share_id: unlocked.metadata.share_id.clone(),
            share_name: unlocked.metadata.name.clone(),
            relay_urls,
            peer_pubkeys,
            group_public_key: hex::encode(group.group_pk),
            runtime_dir: runtime_dir.clone(),
            state_path,
            store,
            bridge: bridge.clone(),
            run_id,
            stop_flag,
            monitor_handle,
            session_resume: session_resume.clone(),
        });
    }

    emit_lifecycle(app, state, "started")?;
    snapshot(app, state).await
}

pub async fn start_profile_session(
    app: &AppHandle,
    state: &AppState,
    input: StartProfileSessionRequest,
) -> Result<ProfileRuntimeSnapshot> {
    {
        let guard = state.signer.lock().unwrap();
        if guard.active.is_some() {
            bail!("a signer session is already active");
        }
    }

    let previous = std::env::var("IGLOO_SHELL_VAULT_PASSPHRASE").ok();
    unsafe {
        std::env::set_var("IGLOO_SHELL_VAULT_PASSPHRASE", &input.vault_passphrase);
    }
    let resolved = resolve_profile_runtime(&state.shell_paths, &input.profile_id);
    match previous {
        Some(value) => unsafe { std::env::set_var("IGLOO_SHELL_VAULT_PASSPHRASE", value) },
        None => unsafe { std::env::remove_var("IGLOO_SHELL_VAULT_PASSPHRASE") },
    }
    let (profile, resolved) = resolved?;
    start_profile_session_resolved(app, state, profile, resolved).await
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
        peer_pubkeys: resolved.peers.iter().map(|peer| peer.pubkey.clone()).collect(),
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

    let stop_flag = Arc::new(AtomicBool::new(false));
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
        let entry = make_log("info", format!("started profile session for '{}'", profile.label));
        guard.logs.push_back(entry.clone());
        trim_logs(&mut guard.logs);
        append_session_log(&state.paths, &runtime_dir, &entry)?;
        let _ = app.emit(EVENT_SIGNER_LOG, SignerLogEvent { entry });
        guard.last_session = Some(session_resume.clone());
        guard.active = Some(ActiveSigner {
            share_id: profile.id.clone(),
            share_name: profile.label.clone(),
            relay_urls: resolved.relays.clone(),
            peer_pubkeys: resolved.peers.iter().map(|peer| peer.pubkey.clone()).collect(),
            group_public_key: hex::encode(resolved.group.group_pk),
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

pub async fn stop_signer(app: &AppHandle, state: &AppState, reason: &str) -> Result<()> {
    let active = {
        let mut guard = state.signer.lock().unwrap();
        guard.active.take()
    };
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
        let _ = app.emit(EVENT_SIGNER_LOG, SignerLogEvent { entry });
    }
    emit_lifecycle(app, state, reason)?;
    Ok(())
}

pub async fn snapshot(app: &AppHandle, state: &AppState) -> Result<SignerSnapshot> {
    let (active_fields, logs, last_session) = {
        let guard = state.signer.lock().unwrap();
        (
            guard.active.as_ref().map(|active| {
                (
                    active.share_id.clone(),
                    active.share_name.clone(),
                    active.group_public_key.clone(),
                    active.relay_urls.clone(),
                    active.peer_pubkeys.clone(),
                    active.runtime_dir.display().to_string(),
                    active.bridge.clone(),
                )
            }),
            guard.logs.iter().cloned().collect::<Vec<_>>(),
            guard.last_session.clone(),
        )
    };

    let Some((
        share_id,
        share_name,
        group_public_key,
        relay_urls,
        peer_pubkeys,
        runtime_dir,
        bridge,
    )) = active_fields
    else {
        return Ok(SignerSnapshot {
            active: false,
            share_id: None,
            share_name: None,
            group_public_key: None,
            relay_urls: Vec::new(),
            peer_pubkeys: Vec::new(),
            runtime_dir: None,
            status: None,
            policies: Vec::new(),
            logs,
            last_session,
        });
    };

    let status = bridge.status().await?;
    let mut policies = bridge
        .policies()
        .await?
        .into_iter()
        .map(|(peer, policy)| PolicySnapshot { peer, policy })
        .collect::<Vec<_>>();
    policies.sort_by(|a, b| a.peer.cmp(&b.peer));

    let snapshot = SignerSnapshot {
        active: true,
        share_id: Some(share_id),
        share_name: Some(share_name),
        group_public_key: Some(group_public_key),
        relay_urls,
        peer_pubkeys,
        runtime_dir: Some(runtime_dir),
        status: Some(status.clone()),
        policies: policies.clone(),
        logs,
        last_session,
    };
    let _ = app.emit(EVENT_SIGNER_STATUS, SignerStatusEvent { status });
    let _ = app.emit(EVENT_SIGNER_POLICIES, SignerPoliciesEvent { policies });
    Ok(snapshot)
}

pub async fn profile_session_snapshot(
    _app: &AppHandle,
    state: &AppState,
    profile_id: Option<String>,
) -> Result<ProfileRuntimeSnapshot> {
    let requested_profile = profile_id
        .or_else(|| state.signer.lock().unwrap().last_session.as_ref().map(|item| item.share_id.clone()));
    let Some(profile_id) = requested_profile else {
        return Ok(ProfileRuntimeSnapshot {
            active: false,
            profile: None,
            runtime_status: None,
            readiness: None,
            readiness_explanation: None,
            runtime_diagnostics: None,
            policies: None,
            daemon_log_path: None,
            daemon_log_lines: Vec::new(),
            daemon_metadata: None,
        });
    };

    let profile = igloo_shell_core::shell::read_profile(&state.shell_paths, &profile_id).ok();
    let daemon_metadata = read_daemon_metadata(&state.shell_paths, &profile_id).ok();
    let daemon_log_path = profile
        .as_ref()
        .map(|_| profile_log_path(&state.shell_paths, &profile_id).display().to_string());
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
    let policies = if let Some(bridge) = &bridge {
        Some(serde_json::to_value(bridge.policies().await?)?)
    } else {
        None
    };
    let readiness_explanation = if let Some(runtime_status) = &runtime_status {
        let status: bifrost_signer::RuntimeStatusSummary =
            serde_json::from_value(runtime_status.clone())?;
        Some(serde_json::to_value(explain_readiness(
            &status.readiness,
            &status.peers,
        ))?)
    } else {
        None
    };
    let runtime_diagnostics = match (&runtime_status, &policies, &readiness_explanation) {
        (Some(runtime_status), Some(policies), Some(readiness_explanation)) => Some(
            serde_json::json!({
                "runtime_status": runtime_status,
                "policies": policies,
                "readiness_explanation": readiness_explanation,
            }),
        ),
        _ => None,
    };

    Ok(ProfileRuntimeSnapshot {
        active,
        profile,
        runtime_status,
        readiness,
        readiness_explanation,
        runtime_diagnostics,
        policies,
        daemon_log_path,
        daemon_log_lines: log_lines,
        daemon_metadata,
    })
}

pub fn emit_lifecycle(app: &AppHandle, state: &AppState, reason: &str) -> Result<()> {
    let (active, share_id, share_name, runtime_dir, last_session) = {
        let guard = state.signer.lock().unwrap();
        let active = guard.active.as_ref();
        (
            active.is_some(),
            active.as_ref().map(|item| item.share_id.clone()),
            active.as_ref().map(|item| item.share_name.clone()),
            active
                .as_ref()
                .map(|item| item.runtime_dir.display().to_string()),
            guard.last_session.clone(),
        )
    };
    let _ = app.emit(
        EVENT_SIGNER_LIFECYCLE,
        SignerLifecycleEvent {
            active,
            reason: reason.to_string(),
            share_id,
            share_name,
            runtime_dir,
            last_session,
        },
    );
    Ok(())
}

pub fn load_last_session(paths: &AppPaths) -> Result<Option<SessionResume>> {
    if !paths.last_session_path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&fs::read_to_string(
        &paths.last_session_path,
    )?)?))
}

pub fn resolve_close_request(app: &AppHandle, action: &str) -> Result<()> {
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
    let allow_close = {
        let mut close = state.close.lock().unwrap();
        if close.allow_close_once {
            close.allow_close_once = false;
            true
        } else {
            false
        }
    };
    if allow_close {
        return Ok(false);
    }

    let settings = state.settings.lock().unwrap().clone();
    let active = state
        .signer
        .lock()
        .unwrap()
        .active
        .as_ref()
        .map(|active| (active.share_id.clone(), active.share_name.clone()));
    let Some((share_id, share_name)) = active else {
        return Ok(false);
    };

    if settings.close_to_tray {
        let _ = window.hide();
    } else {
        let _ = window.emit(
            EVENT_APP_CLOSE_REQUESTED,
            CloseRequestEvent {
                share_id: Some(share_id),
                share_name: Some(share_name),
            },
        );
    }
    Ok(true)
}

pub fn request_resume(app: &AppHandle, state: &AppState) -> Result<()> {
    let should_emit = {
        let settings = state.settings.lock().unwrap().clone();
        let signer = state.signer.lock().unwrap();
        !signer.active.is_some() && settings.reopen_last_session
    };
    if !should_emit {
        return Ok(());
    }
    if let Some(session) = state.signer.lock().unwrap().last_session.clone() {
        let _ = app.emit(EVENT_SIGNER_RESUME_REQUESTED, session);
    }
    Ok(())
}

pub fn make_generated_keyset(threshold: u16, count: u16) -> Result<GeneratedKeyset> {
    let bundle = create_keyset(CreateKeysetConfig { threshold, count })?;
    generated_keyset_response("generated", bundle.group, bundle.shares)
}

pub fn make_imported_keyset(threshold: u16, count: u16, nsec: &str) -> Result<GeneratedKeyset> {
    let (group, shares) = split_existing_nsec(nsec, threshold, count)?;
    generated_keyset_response("imported_nsec", group, shares)
}

pub fn recover_nsec(
    group_package_json: &str,
    share_package_jsons: &[String],
) -> Result<RecoveredKey> {
    let group = decode_group_package_json(group_package_json)?;
    let shares = share_package_jsons
        .iter()
        .map(|raw| decode_share_package_json(raw))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let recovered = recover_key(&RecoverKeyInput { group, shares })?;
    Ok(RecoveredKey {
        nsec: encode_nsec(&recovered.signing_key32)?,
        signing_key_hex: hex::encode(recovered.signing_key32),
    })
}

pub fn accept_onboarding_package(
    package: &str,
    password: &str,
) -> Result<AcceptedOnboardingPackage> {
    let decoded = frostr_utils::decode_onboarding_package(package, Some(password))
        .map_err(|error| anyhow!(error.to_string()))?;
    let challenge = decoded
        .challenge
        .ok_or_else(|| anyhow!("onboarding package is missing challenge metadata"))?;
    let created_at = decoded
        .created_at
        .ok_or_else(|| anyhow!("onboarding package is missing created_at"))?;
    let expires_at = decoded
        .expires_at
        .ok_or_else(|| anyhow!("onboarding package is missing expires_at"))?;
    Ok(AcceptedOnboardingPackage {
        share_package_json: encode_share_package_json(&decoded.share)?,
        peer_pubkey: hex::encode(decoded.peer_pk),
        relay_urls: decoded.relays,
        challenge_hex32: hex::encode(challenge),
        created_at,
        expires_at,
    })
}

fn spawn_monitor(
    app: AppHandle,
    signer_state: Arc<Mutex<SignerState>>,
    paths: AppPaths,
    runtime_dir: std::path::PathBuf,
    bridge: Arc<Bridge>,
    stop_flag: Arc<AtomicBool>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut last_status = None::<String>;
        let mut last_policies = None::<String>;
        while !stop_flag.load(Ordering::Relaxed) {
            if let Ok(status) = bridge.status().await {
                if let Ok(encoded) = serde_json::to_string(&status) {
                    if last_status.as_ref() != Some(&encoded) {
                        last_status = Some(encoded);
                        let _ = app.emit(EVENT_SIGNER_STATUS, SignerStatusEvent { status });
                    }
                }
            } else {
                let entry = make_log("error", "signer status poll failed".to_string());
                if let Ok(mut guard) = signer_state.lock() {
                    guard.logs.push_back(entry.clone());
                    trim_logs(&mut guard.logs);
                }
                let _ = append_session_log(&paths, &runtime_dir, &entry);
                let _ = app.emit(EVENT_SIGNER_LOG, SignerLogEvent { entry });
            }
            if let Ok(policies) = bridge.policies().await {
                let mut snapshot = policies
                    .into_iter()
                    .map(|(peer, policy)| PolicySnapshot { peer, policy })
                    .collect::<Vec<_>>();
                snapshot.sort_by(|a, b| a.peer.cmp(&b.peer));
                if let Ok(encoded) = serde_json::to_string(&snapshot) {
                    if last_policies.as_ref() != Some(&encoded) {
                        last_policies = Some(encoded);
                        let _ = app.emit(
                            EVENT_SIGNER_POLICIES,
                            SignerPoliciesEvent { policies: snapshot },
                        );
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    })
}

fn trim_logs(logs: &mut VecDeque<SignerLogEntry>) {
    while logs.len() > LOG_LIMIT {
        logs.pop_front();
    }
}

fn generated_keyset_response(
    source: &str,
    group: GroupPackage,
    shares: Vec<SharePackage>,
) -> Result<GeneratedKeyset> {
    let group_package_json = encode_group_package_json(&group)?;
    let mut share_entries = Vec::new();
    for share in &shares {
        share_entries.push(GeneratedKeysetShare {
            name: format!("Member {}", share.idx),
            member_idx: share.idx,
            share_package_json: encode_share_package_json(share)?,
        });
    }
    let recovered = recover_key(&RecoverKeyInput {
        group: group.clone(),
        shares: shares
            .iter()
            .take(group.threshold as usize)
            .cloned()
            .collect(),
    })?;
    Ok(GeneratedKeyset {
        source: source.to_string(),
        threshold: group.threshold,
        count: shares.len() as u16,
        group_package_json,
        group_public_key: hex::encode(group.group_pk),
        nsec: encode_nsec(&recovered.signing_key32)?,
        shares: share_entries,
    })
}

fn split_existing_nsec(
    nsec: &str,
    threshold: u16,
    count: u16,
) -> Result<(GroupPackage, Vec<SharePackage>)> {
    if threshold < 2 {
        bail!("threshold must be at least 2");
    }
    if count < threshold {
        bail!("count must be greater than or equal to threshold");
    }
    let secret_bytes = decode_nsec(nsec)?;
    let signing_key = frost::SigningKey::deserialize(&secret_bytes)
        .map_err(|e| anyhow!("invalid nsec secret: {e}"))?;
    let (shares, public_key_package) = frost::keys::split(
        &signing_key,
        count,
        threshold,
        frost::keys::IdentifierList::Default,
        &mut rand_core::OsRng,
    )
    .map_err(|e| anyhow!("split existing key failed: {e}"))?;
    let public_key_package = public_key_package.into_even_y(None);

    let mut group_pk = [0u8; 32];
    group_pk.copy_from_slice(
        &public_key_package
            .verifying_key()
            .serialize()
            .map_err(|e| anyhow!("serialize group public key: {e}"))?[1..],
    );

    let mut members = Vec::new();
    let mut share_packages = Vec::new();
    for (identifier, secret_share) in shares {
        let key_package = frost::keys::KeyPackage::try_from(secret_share)
            .map_err(|e| anyhow!("derive key package: {e}"))?
            .into_even_y(None);
        let id_ser = identifier.serialize();
        let idx = id_ser[31] as u16;

        let mut member_pk = [0u8; 33];
        member_pk.copy_from_slice(
            &key_package
                .verifying_share()
                .serialize()
                .map_err(|e| anyhow!("serialize verifying share: {e}"))?,
        );

        let mut seckey = [0u8; 32];
        seckey.copy_from_slice(&key_package.signing_share().serialize());

        members.push(bifrost_core::types::MemberPackage {
            idx,
            pubkey: member_pk,
        });
        share_packages.push(SharePackage { idx, seckey });
    }
    members.sort_by_key(|member| member.idx);
    share_packages.sort_by_key(|share| share.idx);
    Ok((
        GroupPackage {
            group_pk,
            threshold,
            members,
        },
        share_packages,
    ))
}

fn encode_nsec(secret: &[u8; 32]) -> Result<String> {
    let hrp = Hrp::parse("nsec")?;
    Ok(bech32::encode::<Bech32>(hrp, secret)?)
}

fn decode_nsec(value: &str) -> Result<[u8; 32]> {
    let (hrp, bytes) = bech32::decode(value)?;
    if hrp.to_string() != "nsec" {
        bail!("expected nsec prefix, got {hrp}");
    }
    if bytes.len() != 32 {
        bail!("nsec must decode to 32 bytes");
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn normalize_lines(values: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for value in values {
        for line in value.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !out.iter().any(|existing| existing == trimmed) {
                out.push(trimmed.to_string());
            }
        }
    }
    out
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn make_log(level: &str, message: String) -> SignerLogEntry {
    SignerLogEntry {
        at: now_unix_secs(),
        level: level.to_string(),
        message,
    }
}

fn write_json<T: Serialize>(path: std::path::PathBuf, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn unlock_error_to_anyhow(error: crate::share_store::UnlockFailure) -> anyhow::Error {
    match error {
        crate::share_store::UnlockFailure::WrongPassword => anyhow!("wrong password"),
        crate::share_store::UnlockFailure::CorruptFile(message) => anyhow!(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nsec_roundtrip() {
        let bytes = [7u8; 32];
        let encoded = encode_nsec(&bytes).expect("encode");
        assert_eq!(decode_nsec(&encoded).expect("decode"), bytes);
    }
}
