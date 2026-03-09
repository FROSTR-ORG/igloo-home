import { invoke } from '@tauri-apps/api/core';
import type {
  AcceptedOnboardingPackage,
  AppPathsResponse,
  AppSettings,
  GeneratedKeyset,
  ProfileExportResult,
  ProfileImportResult,
  ProfileManifest,
  ProfileRuntimeSnapshot,
  RecoveredKey,
  RelayProfile,
  ShareMetadata,
  ShareSummary,
  SignerLogEntry,
  SignerSnapshot,
  UnlockedShare,
} from '@/lib/types';

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
  vaultPassphrase: string;
  groupPackageJson: string;
  sharePackageJson: string;
}) {
  return invoke<ProfileImportResult>('import_profile_from_raw_command', {
    input: {
      label: input.label ?? null,
      relay_profile: input.relayProfile ?? null,
      relay_urls: input.relayUrls,
      vault_passphrase: input.vaultPassphrase,
      group_package_json: input.groupPackageJson,
      share_package_json: input.sharePackageJson,
    },
  });
}

export function importProfileFromOnboarding(input: {
  label?: string;
  relayProfile?: string | null;
  vaultPassphrase: string;
  onboardingPassword: string;
  package: string;
}) {
  return invoke<ProfileImportResult>('import_profile_from_onboarding_command', {
    input: {
      label: input.label ?? null,
      relay_profile: input.relayProfile ?? null,
      vault_passphrase: input.vaultPassphrase,
      onboarding_password: input.onboardingPassword,
      package: input.package,
    },
  });
}

export function removeProfile(profileId: string) {
  return invoke<void>('remove_profile_command', {
    input: { profile_id: profileId },
  });
}

export function exportProfile(input: {
  profileId: string;
  destinationDir: string;
  vaultPassphrase: string;
}) {
  return invoke<ProfileExportResult>('export_profile_command', {
    input: {
      profile_id: input.profileId,
      destination_dir: input.destinationDir,
      vault_passphrase: input.vaultPassphrase,
    },
  });
}

export function listShares() {
  return invoke<ShareSummary[]>('list_shares_command');
}

export function saveShare(input: {
  shareId?: string;
  name: string;
  password: string;
  groupPackageJson: string;
  sharePackageJson: string;
  relayUrls: string[];
  peerPubkeys: string[];
}) {
  return invoke<ShareMetadata>('save_share_command', {
    input: {
      share_id: input.shareId ?? null,
      name: input.name,
      password: input.password,
      group_package_json: input.groupPackageJson,
      share_package_json: input.sharePackageJson,
      relay_urls: input.relayUrls,
      peer_pubkeys: input.peerPubkeys,
    },
  });
}

export function overwriteShare(input: {
  shareId: string;
  name: string;
  password: string;
  groupPackageJson: string;
  sharePackageJson: string;
  relayUrls: string[];
  peerPubkeys: string[];
}) {
  return invoke<ShareMetadata>('overwrite_share_command', {
    input: {
      share_id: input.shareId,
      name: input.name,
      password: input.password,
      group_package_json: input.groupPackageJson,
      share_package_json: input.sharePackageJson,
      relay_urls: input.relayUrls,
      peer_pubkeys: input.peerPubkeys,
    },
  });
}

export function unlockShare(shareId: string, password: string) {
  return invoke<UnlockedShare>('unlock_share_command', {
    input: {
      share_id: shareId,
      password,
    },
  });
}

export function deleteShare(shareId: string) {
  return invoke<void>('delete_share_command', {
    input: {
      share_id: shareId,
    },
  });
}

export function importShareFile(sourcePath: string, overwrite = false) {
  return invoke<ShareSummary>('import_share_file_command', {
    input: {
      source_path: sourcePath,
      overwrite,
    },
  });
}

export function exportShareFile(shareId: string, destinationPath: string) {
  return invoke<void>('export_share_file_command', {
    input: {
      share_id: shareId,
      destination_path: destinationPath,
    },
  });
}

export function createGeneratedKeyset(threshold: number, count: number) {
  return invoke<GeneratedKeyset>('create_generated_keyset_command', {
    input: { threshold, count },
  });
}

export function createImportedKeyset(threshold: number, count: number, nsec: string) {
  return invoke<GeneratedKeyset>('create_imported_keyset_command', {
    input: { threshold, count, nsec },
  });
}

export function acceptOnboardingPackage(pkg: string, password: string) {
  return invoke<AcceptedOnboardingPackage>('accept_onboarding_package_command', {
    input: {
      package: pkg,
      password,
    },
  });
}

export function recoverNsec(groupPackageJson: string, sharePackageJsons: string[]) {
  return invoke<RecoveredKey>('recover_nsec_command', {
    input: {
      group_package_json: groupPackageJson,
      share_package_jsons: sharePackageJsons,
    },
  });
}

export function signerStatus() {
  return invoke<SignerSnapshot>('signer_status_command');
}

export function profileRuntimeSnapshot(profileId?: string | null) {
  return invoke<ProfileRuntimeSnapshot>('profile_runtime_snapshot_command', {
    profileId: profileId ?? null,
  });
}

export function startProfileSession(input: { profileId: string; vaultPassphrase: string }) {
  return invoke<ProfileRuntimeSnapshot>('start_profile_session_command', {
    input: {
      profile_id: input.profileId,
      vault_passphrase: input.vaultPassphrase,
    },
  });
}

export function startSigner(input: {
  shareId: string;
  password: string;
  relayUrls: string[];
  peerPubkeys: string[];
}) {
  return invoke<SignerSnapshot>('start_signer_command', {
    input: {
      share_id: input.shareId,
      password: input.password,
      relay_urls: input.relayUrls,
      peer_pubkeys: input.peerPubkeys,
    },
  });
}

export function stopSigner() {
  return invoke<void>('stop_signer_command');
}

export function setPeerPolicy(input: {
  peer: string;
  blockAll: boolean;
  allowPing: boolean;
  allowOnboard: boolean;
  allowSign: boolean;
  allowEcdh: boolean;
}) {
  return invoke<SignerSnapshot>('set_peer_policy_command', {
    input: {
      peer: input.peer,
      block_all: input.blockAll,
      allow_ping: input.allowPing,
      allow_onboard: input.allowOnboard,
      allow_sign: input.allowSign,
      allow_ecdh: input.allowEcdh,
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
      reopen_last_session: settings.reopen_last_session,
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
