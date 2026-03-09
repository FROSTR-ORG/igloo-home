use bifrost_core::types::PeerPolicy;
use bifrost_signer::DeviceStatus;
use igloo_shell_core::shell::{DaemonMetadata, ProfileManifest};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShareMetadata {
    pub share_id: String,
    pub name: String,
    pub member_idx: u16,
    pub threshold: u16,
    pub member_count: usize,
    pub group_public_key: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShareSummary {
    pub metadata: ShareMetadata,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveShareInput {
    pub share_id: Option<String>,
    pub name: String,
    pub password: String,
    pub group_package_json: String,
    pub share_package_json: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockShareInput {
    pub share_id: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteShareInput {
    pub share_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverwriteShareInput {
    pub share_id: String,
    pub name: String,
    pub password: String,
    pub group_package_json: String,
    pub share_package_json: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockedShare {
    pub metadata: ShareMetadata,
    pub group_package_json: String,
    pub share_package_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKeysetRequest {
    pub threshold: u16,
    pub count: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateImportedKeysetRequest {
    pub threshold: u16,
    pub count: u16,
    pub nsec: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedKeysetShare {
    pub name: String,
    pub member_idx: u16,
    pub share_package_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedKeyset {
    pub source: String,
    pub threshold: u16,
    pub count: u16,
    pub group_package_json: String,
    pub group_public_key: String,
    pub nsec: String,
    pub shares: Vec<GeneratedKeysetShare>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoverKeyRequest {
    pub group_package_json: String,
    pub share_package_jsons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveredKey {
    pub nsec: String,
    pub signing_key_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptOnboardingPackageInput {
    pub package: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptedOnboardingPackage {
    pub share_package_json: String,
    pub peer_pubkey: String,
    pub relay_urls: Vec<String>,
    pub challenge_hex32: String,
    pub created_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProfileFromRawInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    pub relay_urls: Vec<String>,
    pub vault_passphrase: String,
    pub group_package_json: String,
    pub share_package_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProfileFromOnboardingInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    pub vault_passphrase: String,
    pub onboarding_password: String,
    pub package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveProfileInput {
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProfileInput {
    pub profile_id: String,
    pub destination_dir: String,
    pub vault_passphrase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartProfileSessionRequest {
    pub profile_id: String,
    pub vault_passphrase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileRuntimeSnapshot {
    pub active: bool,
    pub profile: Option<ProfileManifest>,
    pub runtime_status: Option<serde_json::Value>,
    pub readiness: Option<serde_json::Value>,
    pub readiness_explanation: Option<serde_json::Value>,
    pub runtime_diagnostics: Option<serde_json::Value>,
    pub policies: Option<serde_json::Value>,
    pub daemon_log_path: Option<String>,
    pub daemon_log_lines: Vec<String>,
    pub daemon_metadata: Option<DaemonMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartSignerRequest {
    pub share_id: String,
    pub password: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignerLogEntry {
    pub at: u64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicySnapshot {
    pub peer: String,
    pub policy: PeerPolicy,
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
pub struct SignerSnapshot {
    pub active: bool,
    pub share_id: Option<String>,
    pub share_name: Option<String>,
    pub group_public_key: Option<String>,
    pub relay_urls: Vec<String>,
    pub peer_pubkeys: Vec<String>,
    pub runtime_dir: Option<String>,
    pub status: Option<DeviceStatus>,
    pub policies: Vec<PolicySnapshot>,
    pub logs: Vec<SignerLogEntry>,
    pub last_session: Option<SessionResume>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPathsResponse {
    pub app_data_dir: String,
    pub shares_dir: String,
    pub runtime_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettings {
    pub close_to_tray: bool,
    pub launch_on_login: bool,
    pub reopen_last_session: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_to_tray: false,
            launch_on_login: false,
            reopen_last_session: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsUpdateInput {
    pub close_to_tray: bool,
    pub launch_on_login: bool,
    pub reopen_last_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetPeerPolicyRequest {
    pub peer: String,
    pub block_all: bool,
    pub allow_ping: bool,
    pub allow_onboard: bool,
    pub allow_sign: bool,
    pub allow_ecdh: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportShareFileInput {
    pub source_path: String,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportShareFileInput {
    pub share_id: String,
    pub destination_path: String,
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
pub struct SignerPoliciesEvent {
    pub policies: Vec<PolicySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerLogEvent {
    pub entry: SignerLogEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareInventoryEvent {
    pub shares: Vec<ShareSummary>,
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
