import { invoke } from '@tauri-apps/api/core';
import type {
  AppPathsResponse,
  AppSettings,
  ConnectedOnboardingPreview,
  DiscardConnectedOnboardingResult,
  GeneratedKeyset,
  ProfileImportResult,
  ProfileManifest,
  ProfilePackageExportResult,
  ProfileRuntimeSnapshot,
  RelayProfile,
  RuntimePeerRefreshResult,
  SignerLogEntry,
} from '@/lib/types';

function normalizeHomeImportError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/already exists/i.test(message)) {
    throw new Error('Device profile already exists. Delete the existing device profile before importing this share.');
  }
  throw error;
}

export function appPaths() {
  return invoke<AppPathsResponse>('app_paths');
}

export function listProfiles() {
  return invoke<ProfileManifest[]>('list_profiles_command');
}

export function listRelayProfiles() {
  return invoke<RelayProfile[]>('list_relay_profiles_command');
}

export function importProfileFromRaw(input: {
  label?: string;
  relayProfile?: string | null;
  relayUrls: string[];
  passphrase: string;
  groupPackageJson: string;
  sharePackageJson: string;
}) {
  return invoke<ProfileImportResult>('import_profile_from_raw_command', {
    input: {
      label: input.label ?? null,
      relay_profile: input.relayProfile ?? null,
      relay_urls: input.relayUrls,
      passphrase: input.passphrase,
      group_package_json: input.groupPackageJson,
      share_package_json: input.sharePackageJson,
    },
  }).catch(normalizeHomeImportError);
}

export function importProfileFromOnboarding(input: {
  label?: string;
  relayProfile?: string | null;
  passphrase: string;
  onboardingPassword: string;
  package: string;
}) {
  return invoke<ProfileImportResult>('import_profile_from_onboarding_command', {
    input: {
      label: input.label ?? null,
      relay_profile: input.relayProfile ?? null,
      passphrase: input.passphrase,
      onboarding_password: input.onboardingPassword,
      package: input.package,
    },
  }).catch(normalizeHomeImportError);
}

export function connectOnboardingPackage(input: {
  onboardingPassword: string;
  package: string;
}) {
  return invoke<ConnectedOnboardingPreview>('connect_onboarding_package_command', {
    input: {
      onboarding_password: input.onboardingPassword,
      package: input.package,
    },
  }).catch(normalizeHomeImportError);
}

export function finalizeConnectedOnboarding(input: {
  label?: string;
  relayProfile?: string | null;
  passphrase: string;
}) {
  return invoke<ProfileImportResult>('finalize_connected_onboarding_command', {
    input: {
      label: input.label ?? null,
      relay_profile: input.relayProfile ?? null,
      passphrase: input.passphrase,
    },
  }).catch(normalizeHomeImportError);
}

export function discardConnectedOnboarding() {
  return invoke<DiscardConnectedOnboardingResult>('discard_connected_onboarding_command');
}

export function importProfileFromBfprofile(input: {
  label?: string;
  relayProfile?: string | null;
  passphrase: string;
  packagePassword: string;
  packageText: string;
}) {
  return invoke<ProfileImportResult>('import_profile_from_bfprofile_command', {
    input: {
      label: input.label ?? null,
      relay_profile: input.relayProfile ?? null,
      passphrase: input.passphrase,
      package_password: input.packagePassword,
      package: input.packageText,
    },
  }).catch(normalizeHomeImportError);
}

export function recoverProfileFromBfshare(input: {
  label?: string;
  relayProfile?: string | null;
  passphrase: string;
  packagePassword: string;
  packageText: string;
}) {
  return invoke<ProfileImportResult>('recover_profile_from_bfshare_command', {
    input: {
      label: input.label ?? null,
      relay_profile: input.relayProfile ?? null,
      passphrase: input.passphrase,
      package_password: input.packagePassword,
      package: input.packageText,
    },
  }).catch(normalizeHomeImportError);
}

export function applyRotationUpdate(input: {
  targetProfileId: string;
  passphrase: string;
  onboardingPassword: string;
  onboardingPackage: string;
}) {
  return invoke<ProfileImportResult>('apply_rotation_update_command', {
    input: {
      target_profile_id: input.targetProfileId,
      passphrase: input.passphrase,
      onboarding_password: input.onboardingPassword,
      onboarding_package: input.onboardingPackage,
    },
  }).catch(normalizeHomeImportError);
}

export function removeProfile(profileId: string) {
  return invoke<void>('remove_profile_command', {
    input: { profile_id: profileId },
  });
}

export function exportProfilePackage(input: {
  profileId: string;
  packagePassword: string;
  passphrase: string;
  format: 'bfprofile' | 'bfshare';
}) {
  return invoke<ProfilePackageExportResult>('export_profile_package_command', {
    input: {
      profile_id: input.profileId,
      package_password: input.packagePassword,
      passphrase: input.passphrase,
      format: input.format,
    },
  });
}

export function createGeneratedKeyset(groupName: string, threshold: number, count: number) {
  return invoke<GeneratedKeyset>('create_generated_keyset_command', {
    input: { group_name: groupName, threshold, count },
  });
}

export function createRotatedKeyset(input: {
  threshold: number;
  count: number;
  sources: Array<{
    packageText: string;
    packagePassword: string;
  }>;
}) {
  return invoke<GeneratedKeyset>('create_rotated_keyset_command', {
    input: {
      threshold: input.threshold,
      count: input.count,
      sources: input.sources.map((source) => ({
        package: source.packageText,
        package_password: source.packagePassword,
      })),
    },
  });
}

export function createGeneratedOnboardingPackage(input: {
  sharePackageJson: string;
  relayUrls: string[];
  peerPubkey: string;
  packagePassword: string;
}) {
  return invoke<string>('create_generated_onboarding_package_command', {
    input: {
      share_package_json: input.sharePackageJson,
      relay_urls: input.relayUrls,
      peer_pubkey: input.peerPubkey,
      package_password: input.packagePassword,
    },
  });
}

export function profileRuntimeSnapshot(profileId?: string | null) {
  return invoke<ProfileRuntimeSnapshot>('profile_runtime_snapshot_command', {
    profileId: profileId ?? null,
  });
}

export function startProfileSession(input: { profileId: string; passphrase: string }) {
  return invoke<ProfileRuntimeSnapshot>('start_profile_session_command', {
    input: {
      profile_id: input.profileId,
      passphrase: input.passphrase,
    },
  });
}

export function refreshRuntimePeers() {
  return invoke<RuntimePeerRefreshResult>('refresh_runtime_peers_command');
}

export function stopSigner() {
  return invoke<void>('stop_signer_command');
}

export function updateProfileOperatorSettings(input: {
  profileId: string;
  label: string;
  relays: string[];
  runtimeOptions: {
    sign_timeout_secs: number;
    ecdh_timeout_secs: number;
    ping_timeout_secs: number;
    onboard_timeout_secs: number;
    request_ttl_secs: number;
    max_future_skew_secs: number;
    request_cache_limit: number;
    ecdh_cache_capacity: number;
    ecdh_cache_ttl_secs: number;
    sig_cache_capacity: number;
    sig_cache_ttl_secs: number;
    state_save_interval_secs: number;
    event_kind: number;
    peer_selection_strategy: 'deterministic_sorted' | 'random';
    router_expire_tick_ms: number;
    router_relay_backoff_ms: number;
    router_command_queue_capacity: number;
    router_inbound_queue_capacity: number;
    router_outbound_queue_capacity: number;
    router_command_overflow_policy: 'fail' | 'drop_oldest';
    router_inbound_overflow_policy: 'fail' | 'drop_oldest';
    router_outbound_overflow_policy: 'fail' | 'drop_oldest';
    router_inbound_dedupe_cache_limit: number;
  };
}) {
  return invoke<ProfileManifest>('update_profile_operator_settings_command', {
    input: {
      profile_id: input.profileId,
      label: input.label,
      relays: input.relays,
      runtime_options: input.runtimeOptions,
    },
  });
}

export function getSettings() {
  return invoke<AppSettings>('get_settings_command');
}

export function updateSettings(settings: AppSettings) {
  return invoke<AppSettings>('update_settings_command', {
    input: {
      close_to_tray: settings.close_to_tray,
      launch_on_login: settings.launch_on_login,
    },
  });
}

export function listSessionLogs(runtimeDir?: string | null) {
  return invoke<SignerLogEntry[]>('list_session_logs_command', {
    input: {
      runtime_dir: runtimeDir ?? null,
    },
  });
}

export function resolveCloseRequest(action: 'hide' | 'stop_and_quit' | 'cancel') {
  return invoke<void>('resolve_close_request_command', {
    input: { action },
  });
}
