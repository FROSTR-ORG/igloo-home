use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use bifrost_app::runtime::AppOptions;
use igloo_shell_core::shell::{
    ProfileBackupPublishResult, ProfileExportResult, ProfileImportResult, ProfileManifest,
    ProfilePackageExportResult, RelayProfile, ShellPaths, connect_onboarding_package_preview,
    export_profile, export_profile_as_bfprofile, export_profile_as_bfshare,
    finalize_connected_onboarding_import, import_profile_from_bfprofile_value,
    import_profile_from_files, import_profile_from_onboarding_value, list_profiles,
    load_relay_profiles, load_shell_config, publish_profile_backup, read_profile,
    recover_profile_from_bfshare_value, remove_profile, replace_relay_profile,
    set_default_relay_profile, write_profile,
};

use crate::models::{ConnectedOnboardingPreview, DiscardConnectedOnboardingResult};
use crate::session::{AppState, PendingOnboardingState};

pub fn list_managed_profiles(paths: &ShellPaths) -> Result<Vec<ProfileManifest>> {
    paths.ensure()?;
    list_profiles(paths)
}

pub fn list_relay_profiles_managed(paths: &ShellPaths) -> Result<Vec<RelayProfile>> {
    paths.ensure()?;
    load_relay_profiles(paths)
}

pub fn import_profile_from_raw_json(
    paths: &ShellPaths,
    label: Option<String>,
    relay_profile: Option<String>,
    relay_urls: &[String],
    vault_passphrase: Option<String>,
    group_package_json: &str,
    share_package_json: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    let relay_profile =
        resolve_or_create_relay_profile(paths, relay_profile, label.as_deref(), relay_urls)?;
    let temp_root = paths.imports_dir.join(format!(
        "raw-import-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&temp_root).with_context(|| format!("create {}", temp_root.display()))?;
    let group_path = temp_root.join("group.json");
    let share_path = temp_root.join("share.json");
    fs::write(&group_path, group_package_json)
        .with_context(|| format!("write {}", group_path.display()))?;
    fs::write(&share_path, share_package_json)
        .with_context(|| format!("write {}", share_path.display()))?;
    let result = import_profile_from_files(
        paths,
        &group_path,
        &share_path,
        label,
        Some(relay_profile),
        vault_passphrase,
    );
    let _ = fs::remove_dir_all(&temp_root);
    result
}

pub async fn import_profile_from_onboarding(
    paths: &ShellPaths,
    label: Option<String>,
    relay_profile: Option<String>,
    vault_passphrase: Option<String>,
    onboarding_password: Option<String>,
    package_raw: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    let package_raw = package_raw.trim();
    let onboarding_password = onboarding_password.map(|value| value.trim().to_string());
    import_profile_from_onboarding_value(
        paths,
        package_raw,
        label,
        relay_profile,
        vault_passphrase,
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
    let connected = connect_onboarding_package_preview(
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
    vault_passphrase: String,
) -> Result<ProfileImportResult> {
    state.shell_paths.ensure()?;
    let pending = state
        .pending_onboarding
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| anyhow::anyhow!("connect an onboarding package first"))?;
    finalize_connected_onboarding_import(
        &state.shell_paths,
        pending.connected,
        label,
        relay_profile,
        Some(vault_passphrase),
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
    vault_passphrase: Option<String>,
    package_password: String,
    package_raw: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    import_profile_from_bfprofile_value(
        paths,
        package_raw.trim(),
        package_password.trim().to_string(),
        label,
        relay_profile,
        vault_passphrase,
    )
}

pub async fn recover_profile_from_bfshare(
    paths: &ShellPaths,
    label: Option<String>,
    relay_profile: Option<String>,
    vault_passphrase: Option<String>,
    package_password: String,
    package_raw: &str,
) -> Result<ProfileImportResult> {
    paths.ensure()?;
    recover_profile_from_bfshare_value(
        paths,
        package_raw.trim(),
        package_password.trim().to_string(),
        label,
        relay_profile,
        vault_passphrase,
    )
    .await
}

pub fn export_managed_profile(
    paths: &ShellPaths,
    profile_id: &str,
    out_dir: &Path,
    vault_passphrase: Option<String>,
) -> Result<ProfileExportResult> {
    paths.ensure()?;
    export_profile(paths, profile_id, out_dir, vault_passphrase)
}

pub fn export_managed_profile_package(
    paths: &ShellPaths,
    profile_id: &str,
    format: &str,
    package_password: String,
    vault_passphrase: Option<String>,
) -> Result<ProfilePackageExportResult> {
    paths.ensure()?;
    match format {
        "bfprofile" => {
            export_profile_as_bfprofile(paths, profile_id, package_password, vault_passphrase, None)
        }
        "bfshare" => {
            export_profile_as_bfshare(paths, profile_id, package_password, vault_passphrase, None)
        }
        _ => bail!("unsupported export format {format}; expected bfprofile or bfshare"),
    }
}

pub async fn publish_managed_profile_backup(
    paths: &ShellPaths,
    profile_id: &str,
    vault_passphrase: Option<String>,
) -> Result<ProfileBackupPublishResult> {
    paths.ensure()?;
    publish_profile_backup(paths, profile_id, vault_passphrase).await
}

pub fn remove_managed_profile(paths: &ShellPaths, profile_id: &str) -> Result<()> {
    paths.ensure()?;
    remove_profile(paths, profile_id)
}

pub fn update_managed_profile_settings(
    paths: &ShellPaths,
    profile_id: &str,
    label: String,
    relays: Vec<String>,
    runtime_options: AppOptions,
) -> Result<ProfileManifest> {
    paths.ensure()?;
    let mut profile = read_profile(paths, profile_id)?;
    let mut relay_profile =
        igloo_shell_core::shell::read_relay_profile(paths, &profile.relay_profile)?;
    relay_profile.label = label.clone();
    relay_profile.relays = relays;
    replace_relay_profile(paths, relay_profile)?;
    profile.label = label;
    profile.runtime_options =
        serde_json::to_value(runtime_options).context("serialize runtime options")?;
    write_profile(paths, &profile)?;
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
            replace_relay_profile(
                paths,
                RelayProfile {
                    id: profile_id.clone(),
                    label: label.unwrap_or(&profile_id).to_string(),
                    relays: relay_urls.to_vec(),
                },
            )?;
            ensure_default_relay_profile(paths, &profile_id)?;
            return Ok(profile_id);
        }
        return Ok(profile_id);
    }

    if relay_urls.is_empty() {
        let mut relays = load_relay_profiles(paths)?;
        if let Some(existing) = relays.pop() {
            return Ok(existing.id);
        }
        anyhow::bail!("at least one relay URL is required when no relay profile exists");
    }

    if let Some(existing) = load_relay_profiles(paths)?
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
    replace_relay_profile(
        paths,
        RelayProfile {
            id: profile_id.clone(),
            label: label.unwrap_or("Igloo Home").to_string(),
            relays: relay_urls.to_vec(),
        },
    )?;
    ensure_default_relay_profile(paths, &profile_id)?;
    Ok(profile_id)
}

fn ensure_default_relay_profile(paths: &ShellPaths, profile_id: &str) -> Result<()> {
    let config = load_shell_config(paths)?;
    if config.default_relay_profile_id.is_none() {
        set_default_relay_profile(paths, profile_id)?;
    }
    Ok(())
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use bifrost_app::onboarding::{BootstrapImportResult, BootstrapStateSnapshot};
    use bifrost_core::types::DerivedPublicNonce;
    use bifrost_signer::DeviceState;
    use frostr_utils::{CreateKeysetConfig, create_keyset};
    use igloo_shell_core::shell::{ConnectedOnboardingImport, ProfileImportResult, ProfilePreview};

    use super::*;
    use crate::paths::AppPaths;
    use crate::session::{PendingOnboardingState, make_app_state};

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
            vault_dir: root.join("data").join("igloo-shell").join("vault"),
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
        replace_relay_profile(
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
                "vault-pass".to_string(),
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
            "vault-pass".to_string(),
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
                "vault-pass".to_string(),
            )
            .is_err()
        );
    }
}
