export type ShareMetadata = {
  share_id: string;
  name: string;
  member_idx: number;
  threshold: number;
  member_count: number;
  group_public_key: string;
  relay_urls: string[];
  peer_pubkeys: string[];
  created_at: number;
  updated_at: number;
};

export type ShareSummary = {
  metadata: ShareMetadata;
  path: string;
};

export type UnlockedShare = {
  metadata: ShareMetadata;
  group_package_json: string;
  share_package_json: string;
};

export type GeneratedKeysetShare = {
  name: string;
  member_idx: number;
  share_package_json: string;
};

export type GeneratedKeyset = {
  source: string;
  threshold: number;
  count: number;
  group_package_json: string;
  group_public_key: string;
  nsec: string;
  shares: GeneratedKeysetShare[];
};

export type RecoveredKey = {
  nsec: string;
  signing_key_hex: string;
};

export type AcceptedOnboardingPackage = {
  share_package_json: string;
  peer_pubkey: string;
  relay_urls: string[];
  challenge_hex32: string;
  created_at: number;
  expires_at: number;
};

export type DeviceStatus = {
  device_id: string;
  pending_ops: number;
  last_active: number;
  known_peers: number;
  request_seq: number;
};

export type PolicySnapshot = {
  peer: string;
  policy: {
    block_all: boolean;
    request: {
      echo: boolean;
      ping: boolean;
      onboard: boolean;
      sign: boolean;
      ecdh: boolean;
    };
    respond: {
      echo: boolean;
      ping: boolean;
      onboard: boolean;
      sign: boolean;
      ecdh: boolean;
    };
  };
};

export type SignerLogEntry = {
  at: number;
  level: string;
  message: string;
};

export type SessionResume = {
  share_id: string;
  share_name: string;
  relay_urls: string[];
  peer_pubkeys: string[];
  group_public_key: string;
  runtime_dir: string;
  last_started_at: number;
  last_stopped_at: number | null;
};

export type SignerSnapshot = {
  active: boolean;
  share_id: string | null;
  share_name: string | null;
  group_public_key: string | null;
  relay_urls: string[];
  peer_pubkeys: string[];
  runtime_dir: string | null;
  status: DeviceStatus | null;
  policies: PolicySnapshot[];
  logs: SignerLogEntry[];
  last_session: SessionResume | null;
};

export type AppPathsResponse = {
  app_data_dir: string;
  shares_dir: string;
  runtime_dir: string;
};

export type ProfileManifest = {
  id: string;
  label: string;
  group_ref: string;
  share_ref: string;
  relay_profile: string;
  runtime_options: unknown;
  policy_overrides: unknown;
  state_path: string;
  daemon_socket_path: string;
  created_at: number;
  last_used_at: number | null;
};

export type RelayProfile = {
  id: string;
  label: string;
  relays: string[];
};

export type ProfileImportResult =
  | {
      status: 'profile_created';
      profile: ProfileManifest;
      vault_record: {
        id: string;
        kind: string;
        source: string;
        ciphertext_path: string;
        key_source: string;
        salt_hex: string;
        created_at: number;
        updated_at: number;
      };
      warnings: string[];
    }
  | {
      status: 'onboarding_staged';
      vault_record: {
        id: string;
      };
      staged_onboarding: {
        id: string;
        vault_record_id: string;
        label: string | null;
        relay_profile: string;
        peer_pubkey: string;
        relays: string[];
        challenge_hex32: string | null;
        created_at: number;
      };
      warnings: string[];
    };

export type ProfileExportResult = {
  profile_id: string;
  out_dir: string;
  group_path: string | null;
  share_path: string;
};

export type ProfileRuntimeSnapshot = {
  active: boolean;
  profile: ProfileManifest | null;
  runtime_status: unknown;
  readiness: unknown;
  readiness_explanation: unknown;
  runtime_diagnostics: unknown;
  policies: unknown;
  daemon_log_path: string | null;
  daemon_log_lines: string[];
  daemon_metadata: {
    profile_id: string;
    pid: number;
    socket_path: string;
    token: string;
    log_path: string;
    started_at: number;
  } | null;
};

export type AppSettings = {
  close_to_tray: boolean;
  launch_on_login: boolean;
  reopen_last_session: boolean;
};

export type SignerLifecycleEvent = {
  active: boolean;
  reason: string;
  share_id: string | null;
  share_name: string | null;
  runtime_dir: string | null;
  last_session: SessionResume | null;
};

export type SignerStatusEvent = {
  status: DeviceStatus;
};

export type SignerPoliciesEvent = {
  policies: PolicySnapshot[];
};

export type SignerLogEvent = {
  entry: SignerLogEntry;
};

export type ShareInventoryEvent = {
  shares: ShareSummary[];
};

export type AppSettingsEvent = {
  settings: AppSettings;
};

export type CloseRequestEvent = {
  share_id: string | null;
  share_name: string | null;
};
