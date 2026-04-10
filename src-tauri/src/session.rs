mod close;
mod controller;
mod lifecycle;
mod resume;

use std::collections::VecDeque;
use std::fs;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Result, anyhow, bail};
use bech32::{Bech32, Hrp};
use bifrost_bridge_tokio::Bridge;
use bifrost_codec::{encode_group_package_json, encode_share_package_json, parse_share_package};
use bifrost_core::get_group_id;
use bifrost_core::types::{GroupPackage, SharePackage};
use frostr_utils::{
    BfOnboardPayload, CreateKeysetConfig, RecoverKeyInput, RotateKeysetRequest, create_keyset,
    encode_bfonboard_package, recover_key, rotate_keyset_dealer,
};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::events::{EVENT_SIGNER_LOG, EVENT_SIGNER_STATUS};
use crate::models::{
    GeneratedKeyset, GeneratedKeysetShare, RotationSourceInput, SessionResume, SignerLogEntry,
    SignerLogEvent, SignerStatusEvent,
};
use crate::paths::AppPaths;
use crate::profiles::{ConnectedOnboardingImport, ShellPaths, preview_bfshare_recovery_package};
use crate::session_log::append_session_log;

pub use close::{maybe_handle_close_request, resolve_close_request};
pub use controller::{profile_session_snapshot, start_profile_session, stop_signer};
pub use lifecycle::emit_lifecycle;
pub use resume::load_last_session;

const LOG_LIMIT: usize = 200;

#[derive(Default)]
pub struct CloseState {
    pub allow_close_once: bool,
}

pub struct AppState {
    pub paths: AppPaths,
    pub shell_paths: ShellPaths,
    pub signer: Arc<Mutex<SignerState>>,
    pub pending_onboarding: Mutex<Option<PendingOnboardingState>>,
    pub settings: Mutex<crate::models::AppSettings>,
    pub close: Mutex<CloseState>,
}

pub struct PendingOnboardingState {
    pub connected: ConnectedOnboardingImport,
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
    pub runtime_dir: std::path::PathBuf,
    pub state_path: std::path::PathBuf,
    pub store: bifrost_app::runtime::EncryptedFileStore,
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
        pending_onboarding: Mutex::new(None),
        settings: Mutex::new(settings),
        close: Mutex::new(CloseState::default()),
    }
}

pub fn make_generated_keyset(
    group_name: String,
    threshold: u16,
    count: u16,
) -> Result<GeneratedKeyset> {
    let bundle = create_keyset(CreateKeysetConfig {
        group_name,
        threshold,
        count,
    })?;
    generated_keyset_response("generated", bundle.group, bundle.shares)
}

pub async fn make_rotated_keyset(
    threshold: u16,
    count: u16,
    sources: Vec<RotationSourceInput>,
) -> Result<GeneratedKeyset> {
    if sources.is_empty() {
        bail!("at least one bfshare source is required");
    }

    let mut recovered = Vec::new();
    for source in sources {
        let (_, payload) =
            preview_bfshare_recovery_package(&source.package, source.package_password).await?;
        recovered.push(payload);
    }

    let current_group = group_from_payload(&recovered[0])?;
    let current_group_id = hex::encode(get_group_id(&current_group)?);
    let current_group_pk = hex::encode(current_group.group_pk);

    for payload in recovered.iter().skip(1) {
        let candidate = group_from_payload(payload)?;
        if hex::encode(candidate.group_pk) != current_group_pk {
            bail!("rotation sources do not share the same group public key");
        }
        if hex::encode(get_group_id(&candidate)?) != current_group_id {
            bail!("rotation sources do not belong to the same current group configuration");
        }
    }

    let shares = recovered
        .iter()
        .map(|payload| share_from_payload(&current_group, payload))
        .collect::<Result<Vec<_>>>()?;

    let rotated = rotate_keyset_dealer(
        &current_group,
        RotateKeysetRequest {
            shares,
            threshold,
            count,
        },
    )
    .map_err(|error| anyhow!("rotate keyset: {error}"))?;

    generated_keyset_response("rotated", rotated.next.group, rotated.next.shares)
}

pub fn make_generated_onboarding_package(
    share_package_json: &str,
    relay_urls: Vec<String>,
    peer_pubkey: String,
    package_password: String,
) -> Result<String> {
    if relay_urls.is_empty() {
        bail!("at least one relay is required");
    }
    let share = parse_share_package(share_package_json)
        .map_err(|error| anyhow!("parse share package: {error}"))?;
    encode_bfonboard_package(
        &BfOnboardPayload {
            share_secret: hex::encode(share.seckey),
            relays: relay_urls,
            peer_pk: peer_pubkey,
        },
        &package_password,
    )
    .map_err(|error| anyhow!("encode bfonboard package: {error}"))
}

pub(crate) fn spawn_monitor(
    app: AppHandle,
    signer_state: Arc<Mutex<SignerState>>,
    paths: AppPaths,
    runtime_dir: std::path::PathBuf,
    bridge: Arc<Bridge>,
    stop_flag: Arc<AtomicBool>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut last_status = None::<String>;
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
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    })
}

pub(crate) fn trim_logs(logs: &mut VecDeque<SignerLogEntry>) {
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
            share_public_key: hex::encode(
                k256::SecretKey::from_slice(&share.seckey)
                    .map_err(|error| anyhow!("invalid share seckey: {error}"))?
                    .public_key()
                    .to_encoded_point(true)
                    .as_bytes()[1..]
                    .to_vec(),
            ),
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

fn group_from_payload(payload: &frostr_utils::BfProfilePayload) -> Result<GroupPackage> {
    payload
        .group_package
        .clone()
        .try_into()
        .map_err(|e: bifrost_codec::CodecError| anyhow!("invalid group package: {e}"))
}

fn share_from_payload(
    group: &GroupPackage,
    payload: &frostr_utils::BfProfilePayload,
) -> Result<SharePackage> {
    let share_secret = hex::decode(&payload.device.share_secret)?;
    let seckey: [u8; 32] = share_secret
        .try_into()
        .map_err(|_| anyhow!("invalid share secret"))?;
    let share_public_key = hex::encode(
        k256::SecretKey::from_slice(&seckey)
            .map_err(|error| anyhow!("invalid share secret: {error}"))?
            .public_key()
            .to_sec1_bytes(),
    );
    let xonly = share_public_key
        .strip_prefix("02")
        .or_else(|| share_public_key.strip_prefix("03"))
        .unwrap_or(&share_public_key)
        .to_string();
    let member = group
        .members
        .iter()
        .find(|member| hex::encode(&member.pubkey[1..]) == xonly)
        .ok_or_else(|| anyhow!("share secret does not match any member in the recovered group"))?;
    Ok(SharePackage {
        idx: member.idx,
        seckey,
    })
}

#[cfg(test)]
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

fn encode_nsec(secret: &[u8; 32]) -> Result<String> {
    let hrp = Hrp::parse("nsec")?;
    Ok(bech32::encode::<Bech32>(hrp, secret)?)
}

pub(crate) fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn make_log(level: &str, message: String) -> SignerLogEntry {
    SignerLogEntry {
        at: now_unix_secs(),
        level: level.to_string(),
        message,
    }
}

pub(crate) fn write_json<T: Serialize>(path: std::path::PathBuf, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_lines_dedupes_and_trims() {
        assert_eq!(
            normalize_lines(vec![
                " wss://relay.one \n\nwss://relay.two".into(),
                "wss://relay.one\nwss://relay.three ".into(),
            ]),
            vec![
                "wss://relay.one".to_string(),
                "wss://relay.two".to_string(),
                "wss://relay.three".to_string(),
            ]
        );
    }
}
