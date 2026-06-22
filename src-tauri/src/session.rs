mod close;
mod controller;
mod lifecycle;
mod resume;

use std::collections::{HashSet, VecDeque};
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
use bifrost_core::secret::Passphrase;
use bifrost_core::types::{GroupPackage, SharePackage};
use frostr_utils::{
    BfOnboardPayload, CreateKeysetConfig, RecoverKeyInput, RotateKeysetRequest, create_keyset,
    decode_bfshare_package, encode_bfonboard_package, recover_key, rotate_keyset_dealer,
};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::events::{EVENT_SIGNER_LOG, EVENT_SIGNER_STATUS};
use crate::models::{
    GeneratedKeyset, GeneratedKeysetShare, RecoveredGroupKey, RotationSourceInput, SessionResume,
    SignerLogEntry, SignerLogEvent, SignerStatusEvent,
};
use crate::paths::AppPaths;
use crate::profiles::{
    ConnectedOnboardingImport, ShellPaths, read_profile_group_package,
    resolve_runtime_for_passphrase,
};
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

#[derive(Default)]
pub struct SignerState {
    pub active: Option<ActiveSigner>,
    pub logs: VecDeque<SignerLogEntry>,
    pub last_session: Option<SessionResume>,
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
    // `::new` defaults the reconciled `signing_key32` (imported-nsec) field to
    // None — a freshly generated desktop keyset has no imported signing key.
    let bundle = create_keyset(CreateKeysetConfig::new(group_name, threshold, count))?;
    generated_keyset_response("generated", bundle.group, bundle.shares)
}

pub fn make_rotated_keyset(
    paths: &ShellPaths,
    threshold: u16,
    count: u16,
    source_profile_id: &str,
    sources: Vec<RotationSourceInput>,
) -> Result<GeneratedKeyset> {
    if sources.is_empty() {
        bail!("at least one bfshare source is required");
    }

    // The current group package comes from a local profile the operator holds
    // (plaintext `group_ref`, no passphrase). Each source bfshare contributes a
    // share secret mapped to its member index via that group — there is no relay
    // backup to recover the group from anymore.
    let current_group = read_profile_group_package(paths, source_profile_id)?;

    let mut shares = Vec::with_capacity(sources.len());
    let mut seen_idx = HashSet::new();
    for source in sources {
        let decoded = decode_bfshare_package(
            source.package.trim(),
            source.package_password.expose_secret().trim(),
        )
        .map_err(|error| anyhow!("decode source bfshare: {error}"))?;
        let share = share_from_secret(&current_group, &decoded.share_secret)?;
        if !seen_idx.insert(share.idx) {
            bail!("member {} was supplied more than once", share.idx);
        }
        shares.push(share);
    }

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

/// Reconstruct the group secret key (nsec) from a threshold of shares, fully
/// local. The recovering device's `profile_id` supplies the group package and
/// its own share (unlocked with `device_passphrase`); `sources` are the other
/// members' password-sealed bfshares. Each pasted share secret is mapped to its
/// member index via the group and fails loudly if it is not a member. No relay.
///
/// In-transit secret note: unlike the `igloo-shell` recover path — which writes
/// the recovered group `nsec` straight to a `0o600` file and never renders it —
/// the home host returns the plaintext `nsec`/hex in [`RecoveredGroupKey`] so
/// the operator can view and save it. That value therefore crosses the
/// Tauri IPC boundary into the webview in the clear; the struct's redacted
/// `Debug` (see `models.rs`) only keeps it out of logs, it does not protect the
/// IPC payload itself. This is an accepted, operator-initiated exposure on a
/// local-only flow (no relay), surfaced to the operator in the recover view.
pub fn recover_group_key_from_shares(
    paths: &ShellPaths,
    profile_id: &str,
    device_passphrase: Passphrase,
    sources: Vec<RotationSourceInput>,
) -> Result<RecoveredGroupKey> {
    let (_manifest, resolved) =
        resolve_runtime_for_passphrase(paths, profile_id, &device_passphrase)?;
    let group = resolved.group.clone();

    // The local device contributes its own share first.
    let mut seen_idx = HashSet::new();
    seen_idx.insert(resolved.share.idx);
    let mut shares = vec![resolved.share.clone()];

    for source in sources {
        let decoded = decode_bfshare_package(
            source.package.trim(),
            source.package_password.expose_secret().trim(),
        )
        .map_err(|error| anyhow!("decode bfshare: {error}"))?;
        let share = share_from_secret(&group, &decoded.share_secret)?;
        if !seen_idx.insert(share.idx) {
            bail!(
                "member {} was supplied more than once (the local profile already \
                 contributes its own share; paste only the other members' bfshares)",
                share.idx
            );
        }
        shares.push(share);
    }

    if shares.len() < group.threshold as usize {
        bail!(
            "insufficient shares to recover the group key: need {} (have {})",
            group.threshold,
            shares.len()
        );
    }

    let recovered = recover_key(&RecoverKeyInput {
        group: group.clone(),
        shares,
    })?;
    let signing_key = recovered.signing_key32.expose_bytes();
    Ok(RecoveredGroupKey {
        nsec: encode_nsec(signing_key)?,
        signing_key_hex: hex::encode(signing_key),
        group_public_key: hex::encode(group.group_pk),
    })
}

pub fn make_generated_onboarding_package(
    share_package_json: &str,
    relay_urls: Vec<String>,
    peer_pubkey: String,
    package_password: Passphrase,
) -> Result<String> {
    if relay_urls.is_empty() {
        bail!("at least one relay is required");
    }
    let share = parse_share_package(share_package_json)
        .map_err(|error| anyhow!("parse share package: {error}"))?;
    encode_bfonboard_package(
        &BfOnboardPayload {
            share_secret: hex::encode(share.seckey.expose_bytes()),
            relays: relay_urls,
            peer_pk: peer_pubkey,
        },
        // encode_bfonboard_package borrows the password as `&str`.
        package_password.expose_secret(),
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
                if let Ok(encoded) = serde_json::to_string(&status)
                    && last_status.as_ref() != Some(&encoded)
                {
                    last_status = Some(encoded);
                    let _ = app.emit(EVENT_SIGNER_STATUS, SignerStatusEvent { status });
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
                &k256::SecretKey::from_slice(share.seckey.expose_bytes())
                    .map_err(|error| anyhow!("invalid share seckey: {error}"))?
                    .public_key()
                    .to_encoded_point(true)
                    .as_bytes()[1..],
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
        nsec: encode_nsec(recovered.signing_key32.expose_bytes())?,
        shares: share_entries,
    })
}

/// Map a raw share secret (hex) to its `SharePackage` within `group`, matching
/// on member public key. Fails loudly if the secret is not a member of the
/// group (mirrors the browser `shareWireFromSecret`).
fn share_from_secret(group: &GroupPackage, share_secret: &str) -> Result<SharePackage> {
    let share_secret =
        hex::decode(share_secret).map_err(|e| anyhow!("invalid share secret: {e}"))?;
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
        .ok_or_else(|| anyhow!("share secret does not match any member in the group"))?;
    Ok(SharePackage {
        idx: member.idx,
        seckey: bifrost_core::secret::SharePrivateKey::new(seckey),
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

#[cfg(test)]
mod recover_rotate_tests {
    use super::*;
    use crate::profiles::{
        ProfileImportResult, RelayProfile, import_profile_from_raw_json,
        replace_managed_relay_profile,
    };
    use bifrost_core::types::SharePackage;
    use frostr_utils::{BfSharePayload, KeysetBundle, encode_bfshare_package};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(1);
    const PASS: &str = "device-passphrase";

    fn test_paths(label: &str) -> ShellPaths {
        let root = std::env::temp_dir().join(format!(
            "igloo-home-recover-test-{label}-{}",
            COUNTER.fetch_add(1, Ordering::Relaxed)
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

    fn relays() -> Vec<String> {
        vec!["ws://127.0.0.1:8194".to_string()]
    }

    /// Import a profile holding `bundle.shares[share_pos]` and return its id.
    fn import_profile(paths: &ShellPaths, bundle: &KeysetBundle, share_pos: usize) -> String {
        paths.ensure().expect("ensure paths");
        replace_managed_relay_profile(
            paths,
            RelayProfile {
                id: "local".to_string(),
                label: "Local".to_string(),
                relays: relays(),
            },
        )
        .expect("relay profile");
        let group_json = encode_group_package_json(&bundle.group).expect("group json");
        let share_json = encode_share_package_json(&bundle.shares[share_pos]).expect("share json");
        let result = import_profile_from_raw_json(
            paths,
            Some("Desktop".to_string()),
            Some("local".to_string()),
            &relays(),
            Some(Passphrase::new(PASS.to_string())),
            &group_json,
            &share_json,
        )
        .expect("import profile");
        match result {
            ProfileImportResult::ProfileCreated { profile, .. } => profile.id,
            other => panic!("expected ProfileCreated, got {other:?}"),
        }
    }

    fn bfshare_source(share: &SharePackage, password: &str) -> RotationSourceInput {
        bfshare_source_with(share, password, password)
    }

    /// Build a bfshare source whose ciphertext is encrypted with `encode_password`
    /// but whose supplied `package_password` is `supplied_password` — so the two
    /// can be made to mismatch to exercise the decode-failure path.
    fn bfshare_source_with(
        share: &SharePackage,
        encode_password: &str,
        supplied_password: &str,
    ) -> RotationSourceInput {
        let package = encode_bfshare_package(
            &BfSharePayload {
                share_secret: hex::encode(share.seckey.expose_bytes()),
                relays: relays(),
            },
            encode_password,
        )
        .expect("encode bfshare");
        RotationSourceInput {
            package,
            package_password: Passphrase::new(supplied_password.to_string()),
        }
    }

    /// Flip one character in the middle of a bech32 package body. The bech32
    /// checksum makes any single-character change fail to decode.
    fn corrupt_package(package: &str) -> String {
        let mut chars: Vec<char> = package.chars().collect();
        let mid = chars.len() / 2;
        chars[mid] = if chars[mid] == 'q' { 'p' } else { 'q' };
        chars.into_iter().collect()
    }

    #[test]
    fn recover_group_key_happy_path() {
        let paths = test_paths("recover-happy");
        let bundle = create_keyset(CreateKeysetConfig::new("Recover Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        let sources = vec![bfshare_source(&bundle.shares[1], "share-1-pw")];
        let recovered = recover_group_key_from_shares(
            &paths,
            &profile_id,
            Passphrase::new(PASS.into()),
            sources,
        )
        .expect("recover");
        assert_eq!(
            recovered.group_public_key,
            hex::encode(bundle.group.group_pk)
        );
        assert!(
            recovered.nsec.starts_with("nsec1"),
            "expected bech32 nsec, got {}",
            recovered.nsec
        );
    }

    #[test]
    fn recover_group_key_rejects_non_member_share() {
        let paths = test_paths("recover-nonmember");
        let bundle = create_keyset(CreateKeysetConfig::new("Group A", 2, 3)).expect("keyset a");
        let foreign = create_keyset(CreateKeysetConfig::new("Group B", 2, 3)).expect("keyset b");
        let profile_id = import_profile(&paths, &bundle, 0);
        let sources = vec![bfshare_source(&foreign.shares[1], "pw")];
        let err = recover_group_key_from_shares(
            &paths,
            &profile_id,
            Passphrase::new(PASS.into()),
            sources,
        )
        .expect_err("non-member share must fail loudly");
        assert!(
            err.to_string().contains("does not match any member"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn recover_group_key_rejects_insufficient_shares() {
        let paths = test_paths("recover-insufficient");
        let bundle = create_keyset(CreateKeysetConfig::new("Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        // The device share alone (1) is below the threshold (2); no pasted sources.
        let err = recover_group_key_from_shares(
            &paths,
            &profile_id,
            Passphrase::new(PASS.into()),
            vec![],
        )
        .expect_err("insufficient shares must fail");
        assert!(
            err.to_string().contains("insufficient"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn recover_group_key_rejects_duplicate_member() {
        let paths = test_paths("recover-duplicate");
        let bundle = create_keyset(CreateKeysetConfig::new("Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        // Paste the device's own member (shares[0]) again.
        let sources = vec![bfshare_source(&bundle.shares[0], "pw")];
        let err = recover_group_key_from_shares(
            &paths,
            &profile_id,
            Passphrase::new(PASS.into()),
            sources,
        )
        .expect_err("duplicate member must fail");
        assert!(
            err.to_string().contains("more than once"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rotate_keyset_happy_path_preserves_group_key() {
        let paths = test_paths("rotate-happy");
        let bundle = create_keyset(CreateKeysetConfig::new("Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        let sources = vec![
            bfshare_source(&bundle.shares[0], "pw0"),
            bfshare_source(&bundle.shares[1], "pw1"),
        ];
        let rotated = make_rotated_keyset(&paths, 2, 3, &profile_id, sources).expect("rotate");
        assert_eq!(rotated.source, "rotated");
        assert_eq!(rotated.threshold, 2);
        assert_eq!(rotated.count, 3);
        assert_eq!(rotated.shares.len(), 3);
        // Rotation re-shares the same secret: the group public key is preserved.
        assert_eq!(rotated.group_public_key, hex::encode(bundle.group.group_pk));
    }

    #[test]
    fn rotate_keyset_rejects_non_member_source() {
        let paths = test_paths("rotate-nonmember");
        let bundle = create_keyset(CreateKeysetConfig::new("Group A", 2, 3)).expect("keyset a");
        let foreign = create_keyset(CreateKeysetConfig::new("Group B", 2, 3)).expect("keyset b");
        let profile_id = import_profile(&paths, &bundle, 0);
        let sources = vec![
            bfshare_source(&bundle.shares[0], "pw0"),
            bfshare_source(&foreign.shares[1], "pw1"),
        ];
        let err = make_rotated_keyset(&paths, 2, 3, &profile_id, sources)
            .expect_err("non-member source must fail loudly");
        assert!(
            err.to_string().contains("does not match any member"),
            "unexpected error: {err}"
        );
    }

    // --- Adversarial decrypt / failure-path coverage (audit R6.4) ---

    #[test]
    fn resolve_runtime_rejects_wrong_device_passphrase() {
        let paths = test_paths("unlock-wrong-pass");
        let bundle = create_keyset(CreateKeysetConfig::new("Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        // The encrypted device share must not unlock under a passphrase other than
        // the one it was imported with.
        resolve_runtime_for_passphrase(
            &paths,
            &profile_id,
            &Passphrase::new("not-the-passphrase".to_string()),
        )
        .expect_err("a wrong device passphrase must not unlock the share");
        // Sanity: the correct passphrase still unlocks, so the rejection above is
        // about the passphrase and not a broken fixture.
        resolve_runtime_for_passphrase(&paths, &profile_id, &Passphrase::new(PASS.to_string()))
            .expect("correct passphrase unlocks");
    }

    #[test]
    fn recover_group_key_rejects_wrong_share_password() {
        let paths = test_paths("recover-wrong-share-pw");
        let bundle = create_keyset(CreateKeysetConfig::new("Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        // Source encrypted with one password but supplied with another — the
        // bfshare decode must fail rather than yield garbage share material.
        let sources = vec![bfshare_source_with(
            &bundle.shares[1],
            "correct-share-pw",
            "wrong-share-pw",
        )];
        recover_group_key_from_shares(
            &paths,
            &profile_id,
            Passphrase::new(PASS.into()),
            sources,
        )
        .expect_err("a wrong share password must fail to decode the source");
    }

    #[test]
    fn recover_group_key_rejects_corrupted_share_package() {
        let paths = test_paths("recover-corrupt-share");
        let bundle = create_keyset(CreateKeysetConfig::new("Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        let mut source = bfshare_source(&bundle.shares[1], "share-pw");
        source.package = corrupt_package(&source.package);
        recover_group_key_from_shares(
            &paths,
            &profile_id,
            Passphrase::new(PASS.into()),
            vec![source],
        )
        .expect_err("a corrupted share package must fail to decode");
    }

    #[test]
    fn rotate_keyset_rejects_wrong_source_password() {
        let paths = test_paths("rotate-wrong-source-pw");
        let bundle = create_keyset(CreateKeysetConfig::new("Group", 2, 3)).expect("keyset");
        let profile_id = import_profile(&paths, &bundle, 0);
        // One good source, one whose supplied password does not match its ciphertext.
        let sources = vec![
            bfshare_source(&bundle.shares[0], "pw0"),
            bfshare_source_with(&bundle.shares[1], "correct-pw1", "wrong-pw1"),
        ];
        make_rotated_keyset(&paths, 2, 3, &profile_id, sources)
            .expect_err("a wrong source password must fail the rotation decode");
    }
}
