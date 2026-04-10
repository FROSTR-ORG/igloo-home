use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use bifrost_app::native_runtime;
use bifrost_app::runtime::AppOptions;
use bifrost_app::runtime::ResolvedAppConfig;
use bifrost_profile::{
    FilesystemProfileDomain, FilesystemProfileManifestStore, FilesystemRelayProfileStore,
    ProfileManifestStore, ProfilePaths, RelayProfileStore, load_shell_config_file,
    save_shell_config_file,
};
use frostr_utils::BfProfilePayload;

use crate::models::{ConnectedOnboardingPreview, DiscardConnectedOnboardingResult};
use crate::session::{AppState, PendingOnboardingState};
pub use bifrost_app::native_runtime::{
    ConnectedOnboardingImport, DaemonMetadata,
};
pub use bifrost_profile::{
    ProfileBackupPublishResult, ProfileExportResult, ProfileImportResult, ProfileManifest,
    ProfilePackageExportResult, ProfilePreview, RelayProfile,
};
pub type ShellPaths = ProfilePaths;

fn profile_manifest_store(paths: &ShellPaths) -> FilesystemProfileManifestStore {
    FilesystemProfileManifestStore::new(&paths.profiles_dir)
}

fn relay_profile_store(paths: &ShellPaths) -> FilesystemRelayProfileStore {
    FilesystemRelayProfileStore::new(&paths.relay_profiles_path)
}

fn profile_domain(paths: &ShellPaths) -> FilesystemProfileDomain {
    FilesystemProfileDomain::new(
        &paths.config_path,
        &paths.relay_profiles_path,
        &paths.profiles_dir,
        &paths.groups_dir,
        &paths.encrypted_profiles_dir,
        &paths.state_profiles_dir,
    )
}

pub fn list_managed_profiles(paths: &ShellPaths) -> Result<Vec<ProfileManifest>> {
    paths.ensure()?;
    if !paths.profiles_dir.exists() {
        return Ok(Vec::new());
    }

    let mut profiles = Vec::new();
    for entry in
        fs::read_dir(&paths.profiles_dir).with_context(|| format!("read {}", paths.profiles_dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        match read_profile_manifest_lenient(&path) {
            Ok(profile) => profiles.push(profile),
            Err(error) => {
                eprintln!(
                    "warning: ignoring malformed profile manifest {}: {error}",
                    path.display()
                );
            }
        }
    }

    profiles.sort_by(|a, b| a.label.cmp(&b.label).then_with(|| a.id.cmp(&b.id)));
    Ok(profiles)
}

pub fn list_relay_profiles_managed(paths: &ShellPaths) -> Result<Vec<RelayProfile>> {
    paths.ensure()?;
    relay_profile_store(paths).list_relay_profiles()
}

pub fn read_managed_profile(paths: &ShellPaths, profile_id: &str) -> Result<ProfileManifest> {
    paths.ensure()?;
    profile_manifest_store(paths).read_profile(profile_id)
}

pub fn read_managed_relay_profile(
    paths: &ShellPaths,
    relay_profile_id: &str,
) -> Result<RelayProfile> {
    paths.ensure()?;
    profile_domain(paths).read_relay_profile(relay_profile_id)
}

#[cfg(test)]
pub fn replace_managed_relay_profile(
    paths: &ShellPaths,
    relay_profile: RelayProfile,
) -> Result<()> {
    paths.ensure()?;
    profile_domain(paths).replace_relay_profile(relay_profile)
}

pub fn resolve_runtime(
    paths: &ShellPaths,
    profile_id: &str,
) -> Result<(ProfileManifest, ResolvedAppConfig)> {
    paths.ensure()?;
    native_runtime::resolve_profile_runtime(paths, profile_id)
}

pub fn resolve_runtime_for_passphrase(
    paths: &ShellPaths,
    profile_id: &str,
    passphrase: &str,
) -> Result<(ProfileManifest, ResolvedAppConfig)> {
    paths.ensure()?;
    native_runtime::resolve_profile_runtime_for_passphrase(
        paths,
        profile_id,
        Some(passphrase.to_string()),
    )
}

pub fn read_profile_daemon_metadata(
    paths: &ShellPaths,
    profile_id: &str,
) -> Result<DaemonMetadata> {
    paths.ensure()?;
    native_runtime::read_daemon_metadata(paths, profile_id)
}

pub fn daemon_log_path_for_profile(paths: &ShellPaths, profile_id: &str) -> std::path::PathBuf {
    native_runtime::daemon_log_path(paths, profile_id)
}

pub async fn preview_bfshare_recovery_package(
    package_raw: &str,
    package_password: String,
) -> Result<(ProfilePreview, BfProfilePayload)> {
    bifrost_profile::preview_bfshare_recovery(package_raw, package_password, None).await
}

pub async fn apply_rotation_update(
    paths: &ShellPaths,
    target_profile_id: &str,
    onboarding_package: &str,
    onboarding_password: String,
    passphrase: String,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    native_runtime::apply_rotation_update_from_bfonboard_value(
        paths,
        target_profile_id,
        onboarding_package,
        onboarding_password,
        Some(passphrase),
    )
    .await
}

pub fn import_profile_from_raw_json(
    paths: &ShellPaths,
    label: Option<String>,
    relay_profile: Option<String>,
    relay_urls: &[String],
    passphrase: Option<String>,
    group_package_json: &str,
    share_package_json: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    let relay_profile =
        resolve_or_create_relay_profile(paths, relay_profile, label.as_deref(), relay_urls)?;
    let temp_root = raw_import_temp_root(paths);
    fs::create_dir_all(&temp_root).with_context(|| format!("create {}", temp_root.display()))?;
    let group_path = temp_root.join("group.json");
    let share_path = temp_root.join("share.json");
    fs::write(&group_path, group_package_json)
        .with_context(|| format!("write {}", group_path.display()))?;
    fs::write(&share_path, share_package_json)
        .with_context(|| format!("write {}", share_path.display()))?;
    let result = bifrost_profile::import_profile_from_files(
        paths,
        &group_path,
        &share_path,
        label,
        Some(relay_profile),
        passphrase,
    );
    let _ = fs::remove_dir_all(&temp_root);
    result
}

fn raw_import_temp_root(paths: &ShellPaths) -> std::path::PathBuf {
    paths.imports_dir.join(format!(
        "raw-import-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    ))
}

pub async fn import_profile_from_onboarding(
    paths: &ShellPaths,
    label: Option<String>,
    relay_profile: Option<String>,
    passphrase: Option<String>,
    onboarding_password: Option<String>,
    package_raw: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    let package_raw = package_raw.trim();
    let onboarding_password = onboarding_password.map(|value| value.trim().to_string());
    native_runtime::import_profile_from_onboarding_value(
        paths,
        package_raw,
        label,
        relay_profile,
        passphrase,
        onboarding_password,
    )
    .await
}

pub async fn connect_onboarding_package(
    state: &AppState,
    onboarding_password: String,
    package_raw: &str,
) -> Result<ConnectedOnboardingPreview> {
    state.shell_paths.ensure()?;
    let connected = native_runtime::connect_onboarding_package_preview(
        package_raw.trim(),
        onboarding_password.trim().to_string(),
    )
    .await?;
    let preview = ConnectedOnboardingPreview {
        preview: connected.preview.clone().into(),
    };
    *state.pending_onboarding.lock().unwrap() = Some(PendingOnboardingState { connected });
    Ok(preview)
}

pub fn finalize_connected_onboarding(
    state: &AppState,
    label: Option<String>,
    relay_profile: Option<String>,
    passphrase: String,
) -> Result<ProfileImportResult> {
    state.shell_paths.ensure()?;
    let pending = state
        .pending_onboarding
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| anyhow::anyhow!("connect an onboarding package first"))?;
    native_runtime::finalize_connected_onboarding_import(
        &state.shell_paths,
        pending.connected,
        label,
        relay_profile,
        Some(passphrase),
    )
}

pub fn discard_connected_onboarding(state: &AppState) -> DiscardConnectedOnboardingResult {
    let discarded = state.pending_onboarding.lock().unwrap().take().is_some();
    DiscardConnectedOnboardingResult { discarded }
}

pub fn import_profile_from_bfprofile(
    paths: &ShellPaths,
    label: Option<String>,
    relay_profile: Option<String>,
    passphrase: Option<String>,
    package_password: String,
    package_raw: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    bifrost_profile::import_profile_from_bfprofile_value(
        paths,
        package_raw.trim(),
        package_password.trim().to_string(),
        label,
        relay_profile,
        passphrase,
    )
}

pub async fn recover_profile_from_bfshare(
    paths: &ShellPaths,
    label: Option<String>,
    relay_profile: Option<String>,
    passphrase: Option<String>,
    package_password: String,
    package_raw: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    bifrost_profile::recover_profile_from_bfshare_value(
        paths,
        package_raw.trim(),
        package_password.trim().to_string(),
        label,
        relay_profile,
        passphrase,
    )
    .await
}

pub fn export_managed_profile(
    paths: &ShellPaths,
    profile_id: &str,
    out_dir: &Path,
    passphrase: Option<String>,
) -> Result<ProfileExportResult> {
    paths.ensure()?;
    bifrost_profile::export_profile(paths, profile_id, out_dir, passphrase)
}

pub fn export_managed_profile_package(
    paths: &ShellPaths,
    profile_id: &str,
    format: &str,
    package_password: String,
    passphrase: Option<String>,
) -> Result<ProfilePackageExportResult> {
    paths.ensure()?;
    match format {
        "bfprofile" => bifrost_profile::export_profile_as_bfprofile(
            paths,
            profile_id,
            package_password,
            passphrase,
            None,
        ),
        "bfshare" => bifrost_profile::export_profile_as_bfshare(
            paths,
            profile_id,
            package_password,
            passphrase,
            None,
        ),
        _ => bail!("unsupported export format {format}; expected bfprofile or bfshare"),
    }
}

pub async fn publish_managed_profile_backup(
    paths: &ShellPaths,
    profile_id: &str,
    passphrase: Option<String>,
) -> Result<ProfileBackupPublishResult> {
    paths.ensure()?;
    bifrost_profile::publish_profile_backup(paths, profile_id, passphrase).await
}

pub fn remove_managed_profile(paths: &ShellPaths, profile_id: &str) -> Result<()> {
    paths.ensure()?;
    bifrost_profile::remove_profile(paths, profile_id)
}

pub fn update_managed_profile_settings(
    paths: &ShellPaths,
    profile_id: &str,
    label: String,
    relays: Vec<String>,
    runtime_options: AppOptions,
) -> Result<ProfileManifest> {
    paths.ensure()?;
    let mut profile = read_managed_profile(paths, profile_id)?;
    let mut relay_profile = read_managed_relay_profile(paths, &profile.relay_profile)?;
    relay_profile.label = label.clone();
    relay_profile.relays = relays;
    profile_domain(paths).replace_relay_profile(relay_profile)?;
    profile.label = label;
    profile.runtime_options =
        serde_json::to_value(runtime_options).context("serialize runtime options")?;
    profile_manifest_store(paths).write_profile(&profile)?;
    Ok(profile)
}

pub fn shell_paths_response(paths: &ShellPaths) -> crate::models::AppPathsResponse {
    crate::models::AppPathsResponse {
        app_data_dir: paths.data_dir.display().to_string(),
        profiles_dir: paths.profiles_dir.display().to_string(),
        runtime_dir: paths.state_profiles_dir.display().to_string(),
    }
}

fn resolve_or_create_relay_profile(
    paths: &ShellPaths,
    requested: Option<String>,
    label: Option<&str>,
    relay_urls: &[String],
) -> Result<String> {
    if let Some(profile_id) = requested {
        if !relay_urls.is_empty() {
            profile_domain(paths).replace_relay_profile(RelayProfile {
                id: profile_id.clone(),
                label: label.unwrap_or(&profile_id).to_string(),
                relays: relay_urls.to_vec(),
            })?;
            ensure_default_relay_profile(paths, &profile_id)?;
            return Ok(profile_id);
        }
        return Ok(profile_id);
    }

    if relay_urls.is_empty() {
        let mut relays = list_relay_profiles_managed(paths)?;
        if let Some(existing) = relays.pop() {
            return Ok(existing.id);
        }
        anyhow::bail!("at least one relay URL is required when no relay profile exists");
    }

    if let Some(existing) = list_relay_profiles_managed(paths)?
        .into_iter()
        .find(|profile| profile.relays == relay_urls)
    {
        ensure_default_relay_profile(paths, &existing.id)?;
        return Ok(existing.id);
    }

    let profile_id = format!(
        "home-{}",
        label
            .unwrap_or("desktop")
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            })
            .collect::<String>()
            .trim_matches('-')
            .to_string()
    );
    let profile_id = if profile_id == "home-" {
        format!("home-{}", now_unix_secs())
    } else {
        format!("{profile_id}-{}", now_unix_secs())
    };
    profile_domain(paths).replace_relay_profile(RelayProfile {
        id: profile_id.clone(),
        label: label.unwrap_or("Igloo Home").to_string(),
        relays: relay_urls.to_vec(),
    })?;
    ensure_default_relay_profile(paths, &profile_id)?;
    Ok(profile_id)
}

fn ensure_default_relay_profile(paths: &ShellPaths, profile_id: &str) -> Result<()> {
    let mut config = load_shell_config_file(&paths.config_path)?;
    if config.default_relay_profile_id.is_none() {
        config.default_relay_profile_id = Some(profile_id.to_string());
        save_shell_config_file(&paths.config_path, &config)?;
    }
    Ok(())
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn read_profile_manifest_lenient(path: &Path) -> Result<ProfileManifest> {
    let raw = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;
    use crate::paths::AppPaths;
    use crate::session::{PendingOnboardingState, make_app_state};
    use bifrost_app::onboarding::{BootstrapImportResult, BootstrapStateSnapshot};
    use bifrost_core::types::DerivedPublicNonce;
    use bifrost_signer::DeviceState;
    use frostr_utils::{CreateKeysetConfig, create_keyset};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn test_shell_paths(label: &str) -> ShellPaths {
        let root = std::env::temp_dir().join(format!(
            "igloo-home-profiles-test-{label}-{}",
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
            "igloo-home-app-test-{label}-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create app path root");
        AppPaths {
            settings_path: root.join("settings.json"),
            last_session_path: root.join("last-session.json"),
        }
    }

    fn sample_connected_onboarding() -> ConnectedOnboardingImport {
        let bundle = create_keyset(CreateKeysetConfig {
            group_name: "Desktop Test Group".to_string(),
            threshold: 2,
            count: 3,
        })
        .expect("create keyset");
        let group = bundle.group.clone();
        let share = bundle
            .shares
            .iter()
            .find(|share| share.idx == 2)
            .cloned()
            .expect("share");
        let inviter = group
            .members
            .iter()
            .find(|member| member.idx == 1)
            .expect("inviter");
        let onboarding_nonce = DerivedPublicNonce {
            binder_pn: [4u8; 33],
            hidden_pn: [5u8; 33],
            code: [6u8; 32],
        };
        let mut onboarding_state = DeviceState::new(share.idx, share.seckey);
        onboarding_state
            .nonce_pool
            .store_incoming(1, vec![onboarding_nonce.clone()]);
        onboarding_state
            .nonce_pool
            .generate_for_peer(1, 4)
            .expect("bootstrap outgoing");

        let completion = BootstrapImportResult {
            request_id: "req-home-test".to_string(),
            group_member_count: group.members.len(),
            group: group.clone(),
            share: share.clone(),
            relays: vec!["ws://127.0.0.1:8194".to_string()],
            peer_pubkey: hex::encode(&inviter.pubkey[1..]),
            bootstrap_nonces: vec![onboarding_nonce],
            bootstrap_state: BootstrapStateSnapshot {
                device_state_hex: {
                    let encoded =
                        bincode::serialize(&onboarding_state).expect("serialize device state");
                    hex::encode(encoded)
                },
            },
        };
        let preview = ProfilePreview {
            profile_id: "preview-profile".to_string(),
            label: "Desktop Pending Device".to_string(),
            share_public_key: hex::encode(&inviter.pubkey[1..]),
            group_public_key: hex::encode(group.group_pk),
            threshold: usize::from(group.threshold),
            total_count: group.members.len(),
            relays: vec!["ws://127.0.0.1:8194".to_string()],
            peer_pubkey: Some(hex::encode(&inviter.pubkey[1..])),
            source: "bfonboard",
        };
        ConnectedOnboardingImport {
            preview,
            completion,
        }
    }

    #[test]
    fn discard_and_finalize_pending_onboarding_lifecycle() {
        let shell_paths = test_shell_paths("pending-lifecycle");
        shell_paths.ensure().expect("ensure shell paths");
        replace_managed_relay_profile(
            &shell_paths,
            RelayProfile {
                id: "local".to_string(),
                label: "Local".to_string(),
                relays: vec!["ws://127.0.0.1:8194".to_string()],
            },
        )
        .expect("write relay profile");
        let state = make_app_state(
            test_app_paths("pending-lifecycle"),
            shell_paths.clone(),
            crate::models::AppSettings::default(),
            None,
        );

        assert!(!discard_connected_onboarding(&state).discarded);
        assert!(
            finalize_connected_onboarding(
                &state,
                Some("Desktop Pending Device".to_string()),
                Some("local".to_string()),
                "encrypted-profile-pass".to_string(),
            )
            .is_err()
        );

        *state.pending_onboarding.lock().unwrap() = Some(PendingOnboardingState {
            connected: sample_connected_onboarding(),
        });
        assert!(discard_connected_onboarding(&state).discarded);
        assert!(state.pending_onboarding.lock().unwrap().is_none());

        *state.pending_onboarding.lock().unwrap() = Some(PendingOnboardingState {
            connected: sample_connected_onboarding(),
        });
        let result = finalize_connected_onboarding(
            &state,
            Some("Desktop Pending Device".to_string()),
            Some("local".to_string()),
            "encrypted-profile-pass".to_string(),
        )
        .expect("finalize pending onboarding");
        match result {
            ProfileImportResult::ProfileCreated { profile, .. } => {
                assert_eq!(profile.label, "Desktop Pending Device");
            }
            other => panic!("expected profile_created, got {other:?}"),
        }
        assert!(state.pending_onboarding.lock().unwrap().is_none());
        assert!(
            finalize_connected_onboarding(
                &state,
                Some("Desktop Pending Device".to_string()),
                Some("local".to_string()),
                "encrypted-profile-pass".to_string(),
            )
            .is_err()
        );
    }

    #[test]
    fn raw_import_cleans_up_temp_staging_on_failure() {
        let shell_paths = test_shell_paths("raw-import-cleanup");
        shell_paths.ensure().expect("ensure shell paths");

        let err = import_profile_from_raw_json(
            &shell_paths,
            Some("Broken Import".to_string()),
            None,
            &["ws://127.0.0.1:8194".to_string()],
            Some("encrypted-profile-pass".to_string()),
            "{\"invalid\":true}",
            "{\"invalid\":true}",
        )
        .expect_err("invalid raw import must fail");
        assert!(err.to_string().contains("parse group package"));

        let entries = if shell_paths.imports_dir.exists() {
            fs::read_dir(&shell_paths.imports_dir)
                .expect("read imports dir")
                .count()
        } else {
            0
        };
        assert_eq!(entries, 0, "raw import staging should be cleaned up");
    }

    #[test]
    fn relay_profile_resolution_reuses_matching_relays_and_sets_default_once() {
        let shell_paths = test_shell_paths("relay-defaulting");
        shell_paths.ensure().expect("ensure shell paths");

        let relay_urls = vec![
            "wss://relay.one.example".to_string(),
            "wss://relay.two.example".to_string(),
        ];
        let created = resolve_or_create_relay_profile(
            &shell_paths,
            None,
            Some("Desktop"),
            &relay_urls,
        )
        .expect("create relay profile");
        let reused = resolve_or_create_relay_profile(
            &shell_paths,
            None,
            Some("Different Label"),
            &relay_urls,
        )
        .expect("reuse relay profile");

        assert_eq!(created, reused);
        let config = load_shell_config_file(&shell_paths.config_path).expect("load shell config");
        assert_eq!(config.default_relay_profile_id.as_deref(), Some(created.as_str()));
        let relays = list_relay_profiles_managed(&shell_paths).expect("list relay profiles");
        assert_eq!(relays.len(), 1);
        assert_eq!(relays[0].id, created);
    }

    #[test]
    fn list_managed_profiles_skips_malformed_manifest_files() {
        let shell_paths = test_shell_paths("skip-malformed-profile");
        shell_paths.ensure().expect("ensure shell paths");

        let valid = ProfileManifest {
            id: "valid-profile".to_string(),
            label: "Valid Profile".to_string(),
            group_ref: "managed/group/valid.json".to_string(),
            encrypted_profile_ref: "encrypted-profile:valid".to_string(),
            relay_profile: "default".to_string(),
            runtime_options: serde_json::json!({}),
            policy_overrides: serde_json::json!({}),
            state_path: "/tmp/valid".to_string(),
            daemon_socket_path: "/tmp/valid.sock".to_string(),
            created_at: 1,
            last_used_at: Some(2),
        };

        fs::write(
            shell_paths.profiles_dir.join("valid-profile.json"),
            serde_json::to_vec_pretty(&valid).expect("serialize valid profile"),
        )
        .expect("write valid profile");
        fs::write(
            shell_paths.profiles_dir.join("broken-profile.json"),
            br#"{"id":"broken-profile","label":"Broken Profile""#,
        )
        .expect("write malformed profile");

        let profiles = list_managed_profiles(&shell_paths).expect("list profiles");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "valid-profile");
    }
}
