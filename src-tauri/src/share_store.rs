use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow, bail};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use bifrost_codec::{decode_group_package_json, decode_share_package_json};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit},
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;

use crate::events::EVENT_SHARES_INVENTORY;
use crate::models::{
    ShareInventoryEvent, ShareMetadata, ShareSummary, UnlockShareInput, UnlockedShare,
};
use crate::paths::{AppPaths, sanitize_share_id};

const FORMAT_VERSION: u8 = 2;
const SALT_SIZE: usize = 16;
const NONCE_SIZE: usize = 24;
const KEY_SIZE: usize = 32;
const ARGON2_M_COST_KIB: u32 = 19 * 1024;
const ARGON2_T_COST: u32 = 2;
const ARGON2_P_COST: u32 = 1;
const MIN_PASSWORD_LEN: usize = 8;
const SAVED_WITH: &str = "igloo-home/0.2";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EncryptedPayload {
    salt_b64: String,
    nonce_b64: String,
    ciphertext_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ShareSecretPayload {
    group_package_json: String,
    share_package_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ShareFile {
    format_version: u8,
    saved_with: String,
    metadata: ShareMetadata,
    encrypted: EncryptedPayload,
    checksum_hex: String,
}

#[derive(Debug, Clone)]
pub enum UnlockFailure {
    WrongPassword,
    CorruptFile(String),
}

#[derive(Debug, Clone)]
pub struct ShareSaveRequest {
    pub share_id: Option<String>,
    pub name: String,
    pub password: String,
    pub group_package_json: String,
    pub share_package_json: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
}

pub fn list_shares(paths: &AppPaths) -> Result<Vec<ShareSummary>> {
    let mut items = Vec::new();
    for entry in fs::read_dir(&paths.shares_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || !path.to_string_lossy().ends_with(".igloo-share.json") {
            continue;
        }
        let file = read_share_file(&path)?;
        items.push(ShareSummary {
            metadata: file.metadata,
            path: path.display().to_string(),
        });
    }
    items.sort_by(|a, b| a.metadata.name.cmp(&b.metadata.name));
    Ok(items)
}

pub fn emit_inventory(app: &tauri::AppHandle, paths: &AppPaths) -> Result<()> {
    let shares = list_shares(paths)?;
    let _ = app.emit(
        EVENT_SHARES_INVENTORY,
        ShareInventoryEvent {
            shares: shares.clone(),
        },
    );
    Ok(())
}

pub fn save_share(
    paths: &AppPaths,
    input: ShareSaveRequest,
    overwrite: bool,
) -> Result<ShareMetadata> {
    if input.password.len() < MIN_PASSWORD_LEN {
        bail!("password must be at least {MIN_PASSWORD_LEN} characters");
    }
    if input.name.trim().is_empty() {
        bail!("share name is required");
    }
    let group = decode_group_package_json(&input.group_package_json)?;
    let share = decode_share_package_json(&input.share_package_json)?;
    let share_id_source = input.share_id.clone().unwrap_or_else(|| {
        format!(
            "{}-member-{}",
            input.name.trim().to_lowercase().replace(' ', "-"),
            share.idx
        )
    });
    let share_id = sanitize_share_id(&share_id_source)?;
    let path = paths.share_file_path(&share_id)?;
    if path.exists() && !overwrite {
        bail!("share '{}' already exists", share_id);
    }

    let metadata = ShareMetadata {
        share_id,
        name: input.name.trim().to_string(),
        member_idx: share.idx,
        threshold: group.threshold,
        member_count: group.members.len(),
        group_public_key: hex::encode(group.group_pk),
        relay_urls: normalize_lines(input.relay_urls),
        peer_pubkeys: normalize_lines(input.peer_pubkeys),
        created_at: now_unix_secs(),
        updated_at: now_unix_secs(),
    };
    let secret = ShareSecretPayload {
        group_package_json: input.group_package_json,
        share_package_json: input.share_package_json,
    };
    let encrypted = encrypt_secret(&secret, &input.password)?;
    let checksum_hex = compute_checksum_hex(FORMAT_VERSION, SAVED_WITH, &metadata, &encrypted)?;
    let file = ShareFile {
        format_version: FORMAT_VERSION,
        saved_with: SAVED_WITH.to_string(),
        metadata: metadata.clone(),
        encrypted,
        checksum_hex,
    };
    write_json(&path, &file)?;
    Ok(metadata)
}

pub fn overwrite_share(paths: &AppPaths, input: ShareSaveRequest) -> Result<ShareMetadata> {
    let requested_share_id = input
        .share_id
        .clone()
        .ok_or_else(|| anyhow!("share_id is required when overwriting"))?;
    let path = paths.share_file_path(&requested_share_id)?;
    if !path.exists() {
        bail!("share '{}' does not exist", requested_share_id);
    }
    save_share(paths, input, true)
}

pub fn unlock_share(
    paths: &AppPaths,
    input: UnlockShareInput,
) -> Result<UnlockedShare, UnlockFailure> {
    let file = read_share_file(
        &paths
            .share_file_path(&input.share_id)
            .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?,
    )
    .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    let expected_checksum = compute_checksum_hex(
        file.format_version,
        &file.saved_with,
        &file.metadata,
        &file.encrypted,
    )
    .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    if expected_checksum != file.checksum_hex {
        return Err(UnlockFailure::CorruptFile(
            "share checksum mismatch".to_string(),
        ));
    }
    let secret = decrypt_secret(&file.encrypted, &input.password)?;
    Ok(UnlockedShare {
        metadata: file.metadata,
        group_package_json: secret.group_package_json,
        share_package_json: secret.share_package_json,
    })
}

pub fn delete_share(paths: &AppPaths, share_id: &str) -> Result<()> {
    let path = paths.share_file_path(share_id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn export_share_file(paths: &AppPaths, share_id: &str, destination_path: &Path) -> Result<()> {
    let source = paths.share_file_path(share_id)?;
    if !source.exists() {
        bail!("share '{}' does not exist", share_id);
    }
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination_path)?;
    Ok(())
}

pub fn import_share_file(
    paths: &AppPaths,
    source_path: &Path,
    overwrite: bool,
) -> Result<ShareSummary> {
    let file = read_share_file(source_path)?;
    let expected_checksum = compute_checksum_hex(
        file.format_version,
        &file.saved_with,
        &file.metadata,
        &file.encrypted,
    )?;
    if expected_checksum != file.checksum_hex {
        bail!("share checksum mismatch");
    }
    let destination = paths.share_file_path(&file.metadata.share_id)?;
    if destination.exists() && !overwrite {
        bail!("share '{}' already exists", file.metadata.share_id);
    }
    write_json(&destination, &file)?;
    Ok(ShareSummary {
        metadata: file.metadata,
        path: destination.display().to_string(),
    })
}

pub fn read_session_log(
    runtime_dir: &Path,
    paths: &AppPaths,
) -> Result<Vec<crate::models::SignerLogEntry>> {
    let path = paths.session_log_path(runtime_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(Into::into))
        .collect()
}

pub fn append_session_log(
    paths: &AppPaths,
    runtime_dir: &Path,
    entry: &crate::models::SignerLogEntry,
) -> Result<()> {
    let path = paths.session_log_path(runtime_dir);
    let mut bytes = if path.exists() {
        fs::read(&path)?
    } else {
        Vec::new()
    };
    bytes.extend_from_slice(serde_json::to_string(entry)?.as_bytes());
    bytes.push(b'\n');
    fs::write(path, bytes)?;
    Ok(())
}

fn read_share_file(path: &Path) -> Result<ShareFile> {
    let raw =
        fs::read_to_string(path).with_context(|| format!("read share file {}", path.display()))?;
    let file: ShareFile = serde_json::from_str(&raw)?;
    if file.format_version != FORMAT_VERSION {
        bail!("unsupported share file version {}", file.format_version);
    }
    Ok(file)
}

fn encrypt_secret(secret: &ShareSecretPayload, password: &str) -> Result<EncryptedPayload> {
    let plaintext = serde_json::to_vec(secret)?;
    let mut salt = [0u8; SALT_SIZE];
    let mut nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let key = derive_key(password, &salt)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key)?;
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|_| anyhow!("share encryption failed"))?;
    Ok(EncryptedPayload {
        salt_b64: BASE64.encode(salt),
        nonce_b64: BASE64.encode(nonce),
        ciphertext_b64: BASE64.encode(ciphertext),
    })
}

fn decrypt_secret(
    encrypted: &EncryptedPayload,
    password: &str,
) -> Result<ShareSecretPayload, UnlockFailure> {
    let salt = decode_fixed::<SALT_SIZE>(&encrypted.salt_b64, "salt")
        .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    let nonce = decode_fixed::<NONCE_SIZE>(&encrypted.nonce_b64, "nonce")
        .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    let ciphertext = BASE64
        .decode(&encrypted.ciphertext_b64)
        .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    let key = derive_key(password, &salt).map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    let plaintext = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| UnlockFailure::WrongPassword)?;
    let secret: ShareSecretPayload = serde_json::from_slice(&plaintext)
        .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    decode_group_package_json(&secret.group_package_json)
        .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    decode_share_package_json(&secret.share_package_json)
        .map_err(|e| UnlockFailure::CorruptFile(e.to_string()))?;
    Ok(secret)
}

fn derive_key(password: &str, salt: &[u8; SALT_SIZE]) -> Result<[u8; KEY_SIZE]> {
    let mut key = [0u8; KEY_SIZE];
    let params = Params::new(
        ARGON2_M_COST_KIB,
        ARGON2_T_COST,
        ARGON2_P_COST,
        Some(KEY_SIZE),
    )
    .map_err(|error| anyhow!("argon2 params: {error}"))?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| anyhow!("argon2 derive key: {error}"))?;
    Ok(key)
}

fn decode_fixed<const N: usize>(value: &str, label: &str) -> Result<[u8; N]> {
    let decoded = BASE64
        .decode(value)
        .with_context(|| format!("decode {label}"))?;
    if decoded.len() != N {
        bail!("invalid {label} length");
    }
    let mut out = [0u8; N];
    out.copy_from_slice(&decoded);
    Ok(out)
}

fn compute_checksum_hex(
    format_version: u8,
    saved_with: &str,
    metadata: &ShareMetadata,
    encrypted: &EncryptedPayload,
) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update([format_version]);
    hasher.update(saved_with.as_bytes());
    hasher.update(serde_json::to_vec(metadata)?);
    hasher.update(encrypted.salt_b64.as_bytes());
    hasher.update(encrypted.nonce_b64.as_bytes());
    hasher.update(encrypted.ciphertext_b64.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
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

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<()> {
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
    fn checksum_detects_mutation() {
        let metadata = ShareMetadata {
            share_id: "test".to_string(),
            name: "Test".to_string(),
            member_idx: 1,
            threshold: 2,
            member_count: 3,
            group_public_key: "abc".to_string(),
            relay_urls: vec![],
            peer_pubkeys: vec![],
            created_at: 1,
            updated_at: 1,
        };
        let encrypted = EncryptedPayload {
            salt_b64: "aGVsbG8=".to_string(),
            nonce_b64: "d29ybGQ=".to_string(),
            ciphertext_b64: "Zm9v".to_string(),
        };
        let a = compute_checksum_hex(FORMAT_VERSION, SAVED_WITH, &metadata, &encrypted).unwrap();
        let mut changed = metadata.clone();
        changed.name = "Other".to_string();
        let b = compute_checksum_hex(FORMAT_VERSION, SAVED_WITH, &changed, &encrypted).unwrap();
        assert_ne!(a, b);
    }
}
