use bifrost_app::runtime::AppOptions;
use bifrost_core::secret::Passphrase;
use bifrost_profile::{ProfileManifest, ProfilePreview};
use bifrost_signer::DeviceStatus;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::profiles::DaemonMetadata;

/// Deserialize a JSON string into a zeroizing [`Passphrase`].
///
/// `Passphrase` intentionally does not implement `Deserialize` (so it can
/// never be accidentally pulled out of a persisted struct). This shim is the
/// single, explicit conversion point at the Tauri IPC boundary: the frontend
/// still sends a plain JSON string, and it is wrapped in the `ZeroizeOnDrop`
/// newtype the moment it crosses into Rust.
fn deserialize_passphrase<'de, D>(deserializer: D) -> Result<Passphrase, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Passphrase::new(String::deserialize(deserializer)?))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKeysetRequest {
    pub group_name: String,
    pub threshold: u16,
    pub count: u16,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct RotationSourceInput {
    pub package: String,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub package_password: Passphrase,
}

// Holds `RotationSourceInput` (secret-bearing), so it is deserialize-only.
#[derive(Debug, Deserialize)]
pub struct RotateKeysetRequest {
    pub threshold: u16,
    pub count: u16,
    // The local profile whose (plaintext) group package supplies the member
    // indices for the source shares — the new model has no relay backup to
    // recover the group from, so it comes from a profile the operator holds.
    pub source_profile_id: String,
    pub sources: Vec<RotationSourceInput>,
}

/// One generated share returned to the frontend. `share_package_json` carries the
/// raw secret share, so the field zeroizes on drop and is redacted in `Debug`
/// (mirroring [`RecoveredGroupKey`]); the rest are public metadata.
#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
pub struct GeneratedKeysetShare {
    #[zeroize(skip)]
    pub name: String,
    #[zeroize(skip)]
    pub member_idx: u16,
    #[zeroize(skip)]
    pub share_public_key: String,
    pub share_package_json: String,
}

impl std::fmt::Debug for GeneratedKeysetShare {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GeneratedKeysetShare")
            .field("name", &self.name)
            .field("member_idx", &self.member_idx)
            .field("share_public_key", &self.share_public_key)
            .field("share_package_json", &"<redacted>")
            .finish()
    }
}

/// Freshly-generated keyset returned to the frontend. The secret material (the group
/// `nsec` and each share's `share_package_json`) zeroizes on drop — scrubbing the
/// Rust-side heap copy once the IPC layer has serialized the response — and is redacted
/// in `Debug`, matching [`RecoveredGroupKey`].
#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
pub struct GeneratedKeyset {
    #[zeroize(skip)]
    pub source: String,
    #[zeroize(skip)]
    pub threshold: u16,
    #[zeroize(skip)]
    pub count: u16,
    #[zeroize(skip)]
    pub group_package_json: String,
    #[zeroize(skip)]
    pub group_public_key: String,
    pub nsec: String,
    pub shares: Vec<GeneratedKeysetShare>,
}

impl std::fmt::Debug for GeneratedKeyset {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GeneratedKeyset")
            .field("source", &self.source)
            .field("threshold", &self.threshold)
            .field("count", &self.count)
            .field("group_package_json", &self.group_package_json)
            .field("group_public_key", &self.group_public_key)
            .field("nsec", &"<redacted>")
            .field("shares", &self.shares)
            .finish()
    }
}

// Secret-bearing IPC input. Holds a `Passphrase`, so it drops `Clone` and
// `Serialize` (this struct is only ever deserialized) and relies on the
// redacted `Passphrase` `Debug`.
#[derive(Debug, Deserialize)]
pub struct CreateGeneratedOnboardingPackageInput {
    pub share_package_json: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkey: String,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub package_password: Passphrase,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct ImportProfileFromRawInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    pub relay_urls: Vec<String>,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
    pub group_package_json: String,
    pub share_package_json: String,
}

#[derive(Debug, Deserialize)]
pub struct ResolveApprovalInput {
    pub request_id: String,
    pub approved: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePeerPolicyInput {
    pub pubkey: String,
    /// `request` | `respond`
    pub direction: String,
    /// `ping` | `onboard` | `sign` | `ecdh`
    pub method: String,
    /// `unset` | `allow` | `deny` | `ask`
    pub value: String,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct ImportProfileFromOnboardingInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub onboarding_password: Passphrase,
    pub package: String,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct ConnectOnboardingPackageInput {
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub onboarding_password: Passphrase,
    pub package: String,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct FinalizeConnectedOnboardingInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscardConnectedOnboardingResult {
    pub discarded: bool,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct ImportProfileFromBfprofileInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub package_password: Passphrase,
    pub package: String,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
//
// The device passphrase unlocks the recovering profile's own share so it counts
// toward the threshold; `sources` are the other members' password-sealed
// bfshares. Reconstruction is fully local — no relay.
#[derive(Debug, Deserialize)]
pub struct RecoverGroupKeyInput {
    pub profile_id: String,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub device_passphrase: Passphrase,
    pub sources: Vec<RotationSourceInput>,
}

/// Reconstructed group secret-key material returned to the frontend. The secret
/// fields zeroize on drop (scrubbing the Rust-side heap copy once the IPC layer
/// has serialized the response) and are redacted in `Debug`.
#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
pub struct RecoveredGroupKey {
    pub nsec: String,
    pub signing_key_hex: String,
    #[zeroize(skip)]
    pub group_public_key: String,
}

impl std::fmt::Debug for RecoveredGroupKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecoveredGroupKey")
            .field("nsec", &"<redacted>")
            .field("signing_key_hex", &"<redacted>")
            .field("group_public_key", &self.group_public_key)
            .finish()
    }
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct ApplyRotationUpdateInput {
    pub target_profile_id: String,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub onboarding_password: Passphrase,
    pub onboarding_package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveProfileInput {
    pub profile_id: String,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct ExportProfileInput {
    pub profile_id: String,
    pub destination_dir: String,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct ExportProfilePackageInput {
    pub profile_id: String,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub package_password: Passphrase,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfilePackageExportResult {
    pub profile_id: String,
    pub format: String,
    pub out_path: Option<String>,
    pub package: String,
}

// Secret-bearing IPC input; see note above. Deserialize-only.
#[derive(Debug, Deserialize)]
pub struct StartProfileSessionRequest {
    pub profile_id: String,
    #[serde(deserialize_with = "deserialize_passphrase")]
    pub passphrase: Passphrase,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProfileOperatorSettingsInput {
    pub profile_id: String,
    pub label: String,
    pub relays: Vec<String>,
    pub runtime_options: AppOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileRuntimeSnapshot {
    pub active: bool,
    pub profile: Option<ProfileManifest>,
    pub runtime_status: Option<serde_json::Value>,
    pub readiness: Option<serde_json::Value>,
    pub runtime_diagnostics: Option<serde_json::Value>,
    pub daemon_log_path: Option<String>,
    pub daemon_log_lines: Vec<String>,
    pub daemon_metadata: Option<DaemonMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimePeerRefreshFailure {
    pub peer: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimePeerRefreshResult {
    pub attempted: usize,
    pub refreshed: usize,
    pub failures: Vec<RuntimePeerRefreshFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignerLogEntry {
    pub at: u64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionResume {
    pub share_id: String,
    pub share_name: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
    pub group_public_key: String,
    pub runtime_dir: String,
    pub last_started_at: u64,
    pub last_stopped_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPathsResponse {
    pub app_data_dir: String,
    pub profiles_dir: String,
    pub runtime_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AppSettings {
    pub close_to_tray: bool,
    pub launch_on_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsUpdateInput {
    pub close_to_tray: bool,
    pub launch_on_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListSessionLogsInput {
    pub runtime_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveCloseRequestInput {
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerLifecycleEvent {
    pub active: bool,
    pub reason: String,
    pub share_id: Option<String>,
    pub share_name: Option<String>,
    pub runtime_dir: Option<String>,
    pub last_session: Option<SessionResume>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerStatusEvent {
    pub status: DeviceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerLogEvent {
    pub entry: SignerLogEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettingsEvent {
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseRequestEvent {
    pub share_id: Option<String>,
    pub share_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingPreview {
    pub profile_id: String,
    pub label: String,
    pub share_public_key: String,
    pub group_public_key: String,
    pub threshold: usize,
    pub total_count: usize,
    pub relays: Vec<String>,
    pub peer_pubkey: Option<String>,
    pub source: String,
}

impl From<ProfilePreview> for OnboardingPreview {
    fn from(value: ProfilePreview) -> Self {
        Self {
            profile_id: value.profile_id,
            label: value.label,
            share_public_key: value.share_public_key,
            group_public_key: value.group_public_key,
            threshold: value.threshold,
            total_count: value.total_count,
            relays: value.relays,
            peer_pubkey: value.peer_pubkey,
            source: value.source.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectedOnboardingPreview {
    pub preview: OnboardingPreview,
}

#[cfg(test)]
mod tests {
    use super::*;

    // The generated-keyset secrets must not leak through `Debug` (logs/panics),
    // mirroring `RecoveredGroupKey`. Public metadata stays visible.
    #[test]
    fn generated_keyset_debug_redacts_secrets() {
        let keyset = GeneratedKeyset {
            source: "generated".to_string(),
            threshold: 2,
            count: 3,
            group_package_json: "{\"group\":true}".to_string(),
            group_public_key: "deadbeef".to_string(),
            nsec: "nsec1secretvalue".to_string(),
            shares: vec![GeneratedKeysetShare {
                name: "device-1".to_string(),
                member_idx: 1,
                share_public_key: "abc123".to_string(),
                share_package_json: "{\"seckey\":\"super-secret\"}".to_string(),
            }],
        };
        let rendered = format!("{keyset:?}");
        assert!(!rendered.contains("nsec1secretvalue"), "nsec leaked: {rendered}");
        assert!(!rendered.contains("super-secret"), "share secret leaked: {rendered}");
        assert!(rendered.contains("<redacted>"));
        // Public metadata remains visible for diagnostics.
        assert!(rendered.contains("deadbeef"));
        assert!(rendered.contains("device-1"));
    }
}
