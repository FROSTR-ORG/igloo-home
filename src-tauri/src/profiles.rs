use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use igloo_shell_core::shell::{
    ProfileExportResult, ProfileImportResult, ProfileManifest, RelayProfile, ShellPaths,
    export_profile, import_profile_from_files, import_profile_from_onboarding_value, list_profiles,
    load_relay_profiles, load_shell_config, remove_profile, replace_relay_profile,
    set_default_relay_profile,
};

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
    let relay_profile = resolve_or_create_relay_profile(paths, relay_profile, label.as_deref(), relay_urls)?;
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

pub fn export_managed_profile(
    paths: &ShellPaths,
    profile_id: &str,
    out_dir: &Path,
    vault_passphrase: Option<String>,
) -> Result<ProfileExportResult> {
    paths.ensure()?;
    export_profile(paths, profile_id, out_dir, vault_passphrase)
}

pub fn remove_managed_profile(paths: &ShellPaths, profile_id: &str) -> Result<()> {
    paths.ensure()?;
    remove_profile(paths, profile_id)
}

pub fn shell_paths_response(paths: &ShellPaths) -> crate::models::AppPathsResponse {
    crate::models::AppPathsResponse {
        app_data_dir: paths.data_dir.display().to_string(),
        shares_dir: paths.profiles_dir.display().to_string(),
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
            .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
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
