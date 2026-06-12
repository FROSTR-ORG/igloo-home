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
  RecoveredGroupKey,
  RelayProfile,
  RuntimePeerRefreshResult,
  SignerLogEntry,
} from '@/lib/types';

/**
 * Discriminated union emitted by Tauri commands. Mirrors the server-side
 * `HomeError` enum in `src-tauri/src/error.rs`. The shape is stable:
 * `{ kind: <snake_case>, detail: <payload_or_null> }`.
 */
export type HomeErrorPayload =
  | { kind: 'profile_already_exists'; detail: { id: string } }
  | { kind: 'invalid_passphrase'; detail: null }
  | { kind: 'invalid_package'; detail: { reason: string } }
  | { kind: 'onboarding_pending'; detail: { profile_id: string } }
  | { kind: 'path_outside_allowed_roots'; detail: { path: string } }
  | { kind: 'session_not_active'; detail: null }
  | { kind: 'runtime'; detail: { message: string } }
  | { kind: 'bifrost'; detail: { message: string } }
  | { kind: 'internal'; detail: { message: string } };

const HOME_ERROR_KINDS: ReadonlySet<HomeErrorPayload['kind']> = new Set([
  'profile_already_exists',
  'invalid_passphrase',
  'invalid_package',
  'onboarding_pending',
  'path_outside_allowed_roots',
  'session_not_active',
  'runtime',
  'bifrost',
  'internal',
]);

/**
 * Narrow an unknown value (typically from a Tauri `invoke(...).catch(...)`
 * handler) to a `HomeErrorPayload`. Matches on the `kind` discriminator;
 * avoids regex-matching on free-form error text.
 */
export function isHomeError(value: unknown): value is HomeErrorPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const maybe = value as { kind?: unknown };
  return typeof maybe.kind === 'string'
    && HOME_ERROR_KINDS.has(maybe.kind as HomeErrorPayload['kind']);
}

/**
 * Render a typed `HomeErrorPayload` as a human-friendly message. Every
 * variant of `HomeError` maps to a specific sentence here — the frontend
 * is no longer allowed to regex-match on error strings.
 */
export function homeErrorMessageForUser(err: HomeErrorPayload): string {
  switch (err.kind) {
    case 'profile_already_exists':
      return 'Device profile already exists. Delete the existing device profile before importing this share.';
    case 'invalid_passphrase':
      return 'Incorrect passphrase.';
    case 'invalid_package':
      return `Invalid package: ${err.detail.reason}`;
    case 'onboarding_pending':
      return `An onboarding operation is already in progress for profile ${err.detail.profile_id}.`;
    case 'path_outside_allowed_roots':
      return `Path ${err.detail.path} is outside the allowed scope.`;
    case 'session_not_active':
      return 'No active signer session.';
    case 'runtime':
      return err.detail.message;
    case 'bifrost':
      return err.detail.message;
    case 'internal':
      return `Internal error: ${err.detail.message}`;
  }
}

/**
 * `catch` handler for Tauri invocations that may return a typed
 * `HomeError`. If the rejection value matches the discriminated union we
 * rethrow a plain `Error` carrying the user-facing message plus the
 * original payload (attached as `cause`) so callers can inspect the
 * `kind` without re-parsing. Non-`HomeError` rejections are rethrown
 * unchanged.
 */
function rethrowHomeError(error: unknown): never {
  if (isHomeError(error)) {
    const message = homeErrorMessageForUser(error);
    const wrapped: Error & { homeError?: HomeErrorPayload } = new Error(message);
    wrapped.homeError = error;
    throw wrapped;
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
  }).catch(rethrowHomeError);
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
  }).catch(rethrowHomeError);
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
  }).catch(rethrowHomeError);
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
  }).catch(rethrowHomeError);
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
  }).catch(rethrowHomeError);
}

export function recoverGroupKey(input: {
  profileId: string;
  devicePassphrase: string;
  sources: Array<{
    packageText: string;
    packagePassword: string;
  }>;
}) {
  return invoke<RecoveredGroupKey>('recover_group_key_command', {
    input: {
      profile_id: input.profileId,
      device_passphrase: input.devicePassphrase,
      sources: input.sources.map((source) => ({
        package: source.packageText,
        package_password: source.packagePassword,
      })),
    },
  }).catch(rethrowHomeError);
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
  }).catch(rethrowHomeError);
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
  sourceProfileId: string;
  sources: Array<{
    packageText: string;
    packagePassword: string;
  }>;
}) {
  return invoke<GeneratedKeyset>('create_rotated_keyset_command', {
    input: {
      threshold: input.threshold,
      count: input.count,
      source_profile_id: input.sourceProfileId,
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
