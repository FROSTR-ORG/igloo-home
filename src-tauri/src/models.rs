use bifrost_app::runtime::AppOptions;
use bifrost_signer::DeviceStatus;
use igloo_shell_core::shell::{DaemonMetadata, ProfileManifest};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKeysetRequest {
    pub threshold: u16,
    pub count: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationSourceInput {
    pub package: String,
    pub package_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotateKeysetRequest {
    pub threshold: u16,
    pub count: u16,
    pub sources: Vec<RotationSourceInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedKeysetShare {
    pub name: String,
    pub member_idx: u16,
    pub share_public_key: String,
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
pub struct CreateGeneratedOnboardingPackageInput {
    pub share_package_json: String,
    pub relay_urls: Vec<String>,
    pub peer_pubkey: String,
    pub package_password: String,
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
pub struct ImportProfileFromBfprofileInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    pub vault_passphrase: String,
    pub package_password: String,
    pub package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoverProfileFromBfshareInput {
    pub label: Option<String>,
    pub relay_profile: Option<String>,
    pub vault_passphrase: String,
    pub package_password: String,
    pub package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyRotationUpdateInput {
    pub target_profile_id: String,
    pub vault_passphrase: String,
    pub onboarding_password: String,
    pub onboarding_package: String,
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
pub struct ExportProfilePackageInput {
    pub profile_id: String,
    pub package_password: String,
    pub vault_passphrase: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfilePackageExportResult {
    pub profile_id: String,
    pub format: String,
    pub out_path: Option<String>,
    pub package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishProfileBackupInput {
    pub profile_id: String,
    pub vault_passphrase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileBackupPublishResult {
    pub profile_id: String,
    pub relays: Vec<String>,
    pub event_id: String,
    pub author_pubkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartProfileSessionRequest {
    pub profile_id: String,
    pub vault_passphrase: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettings {
    pub close_to_tray: bool,
    pub launch_on_login: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_to_tray: false,
            launch_on_login: false,
        }
    }
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
