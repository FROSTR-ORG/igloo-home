import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentVisualScenario = vi.hoisted(() => ({
  value: {
    activeView: 'recover-key',
    activeDashboardTab: 'signer',
    settings: { close_to_tray: false, launch_on_login: false },
    profiles: [
      {
        id: 'alice-laptop',
        label: 'Alice Laptop',
        group_ref: 'managed/group/alice.json',
        encrypted_profile_ref: 'encrypted-profile:alice',
        relay_profile: 'default',
        runtime_options: {},
        policy_overrides: {},
        state_path: '/tmp/alice',
        daemon_socket_path: '/tmp/alice.sock',
        created_at: 1,
        last_used_at: 2,
      },
    ],
    relayProfiles: [{ id: 'default', label: 'Default', relays: ['wss://relay.primal.net'] }],
    selectedProfileId: 'alice-laptop',
    passphrase: 'desktop-pass',
    generatedKeyset: null,
    runtimeSnapshot: null,
    createForm: { mode: 'new', groupName: '', threshold: '2', count: '3', sourceProfileId: '' },
    rotationSources: [{ packageText: '', packagePassword: '' }],
    importForm: { label: '', passphrase: '', relayUrls: '', groupPackageJson: '', sharePackageJson: '' },
    onboardConnectForm: { packageText: '', password: '' },
    onboardSaveForm: { label: '', passphrase: '', confirmPassphrase: '' },
    pendingOnboardConnection: null,
    rotationForm: { onboardingPackage: '', onboardingPassword: '' },
    loadForm: { label: '', passphrase: '', packagePassword: '', packageText: '' },
    recoverProfileId: 'alice-laptop',
    recoverDevicePassphrase: 'device-pass',
    recoverSources: [{ packageText: 'bfshare1bobsource', packagePassword: 'bob-pw' }],
    recoveredKey: null,
    recoverThreshold: 2,
    saveForms: {},
    packageDraft: { packagePassword: '' },
  },
}));

const apiMocks = vi.hoisted(() => ({
  applyRotationUpdate: vi.fn(),
  connectOnboardingPackage: vi.fn(),
  createGeneratedOnboardingPackage: vi.fn(),
  createGeneratedKeyset: vi.fn(),
  createRotatedKeyset: vi.fn(),
  discardConnectedOnboarding: vi.fn(),
  exportProfilePackage: vi.fn(),
  finalizeConnectedOnboarding: vi.fn(),
  getProfileThreshold: vi.fn(),
  getSettings: vi.fn(),
  importProfileFromBfprofile: vi.fn(),
  importProfileFromOnboarding: vi.fn(),
  importProfileFromRaw: vi.fn(),
  listProfiles: vi.fn(),
  listRelayProfiles: vi.fn(),
  profileRuntimeSnapshot: vi.fn(),
  recoverGroupKey: vi.fn(),
  refreshRuntimePeers: vi.fn(),
  removeProfile: vi.fn(),
  resolveCloseRequest: vi.fn(),
  startProfileSession: vi.fn(),
  stopSigner: vi.fn(),
  updateProfileOperatorSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(async () => false),
  open: vi.fn(async () => null),
}));
vi.mock('@/lib/testBridge', () => ({ installTestBridge: vi.fn() }));

vi.mock('@/lib/api', () => ({
  applyRotationUpdate: apiMocks.applyRotationUpdate,
  connectOnboardingPackage: apiMocks.connectOnboardingPackage,
  createGeneratedOnboardingPackage: apiMocks.createGeneratedOnboardingPackage,
  createGeneratedKeyset: apiMocks.createGeneratedKeyset,
  createRotatedKeyset: apiMocks.createRotatedKeyset,
  discardConnectedOnboarding: apiMocks.discardConnectedOnboarding,
  exportProfilePackage: apiMocks.exportProfilePackage,
  finalizeConnectedOnboarding: apiMocks.finalizeConnectedOnboarding,
  getProfileThreshold: apiMocks.getProfileThreshold,
  getSettings: apiMocks.getSettings,
  importProfileFromBfprofile: apiMocks.importProfileFromBfprofile,
  importProfileFromOnboarding: apiMocks.importProfileFromOnboarding,
  importProfileFromRaw: apiMocks.importProfileFromRaw,
  listProfiles: apiMocks.listProfiles,
  listRelayProfiles: apiMocks.listRelayProfiles,
  profileRuntimeSnapshot: apiMocks.profileRuntimeSnapshot,
  recoverGroupKey: apiMocks.recoverGroupKey,
  refreshRuntimePeers: apiMocks.refreshRuntimePeers,
  removeProfile: apiMocks.removeProfile,
  resolveCloseRequest: apiMocks.resolveCloseRequest,
  startProfileSession: apiMocks.startProfileSession,
  stopSigner: apiMocks.stopSigner,
  updateProfileOperatorSettings: apiMocks.updateProfileOperatorSettings,
  updateSettings: apiMocks.updateSettings,
}));

vi.mock('@/test/visualMode', () => ({
  resolveVisualScenario: () => currentVisualScenario.value,
}));

import App from '@/App';

describe('igloo-home recover-key view', () => {
  beforeEach(() => {
    cleanup();
    for (const mock of Object.values(apiMocks)) {
      mock.mockReset();
    }
  });

  it('reconstructs the group key from the local profile + pasted shares and shows the result', async () => {
    apiMocks.recoverGroupKey.mockResolvedValue({
      nsec: 'nsec1reconstructedkey',
      signing_key_hex: 'a1b2c3',
      group_public_key: 'ff00 ',
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Recover Key' }));

    await waitFor(() => {
      expect(apiMocks.recoverGroupKey).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.recoverGroupKey).toHaveBeenCalledWith({
      profileId: 'alice-laptop',
      devicePassphrase: 'device-pass',
      sources: [{ packageText: 'bfshare1bobsource', packagePassword: 'bob-pw' }],
    });
    // The recovered material panel renders with the group public key in plain text.
    await waitFor(() => {
      expect(screen.getByText(/Group public key:/)).toBeInTheDocument();
    });
  });

  it('masks the recovered nsec and signing key until revealed', async () => {
    apiMocks.recoverGroupKey.mockResolvedValue({
      nsec: 'nsec1homerecoveredsecretvalue',
      signing_key_hex: 'deadbeefcafe1234',
      group_public_key: 'ff00 ',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Recover Key' }));

    await waitFor(() => {
      expect(screen.getByText(/Group public key:/)).toBeInTheDocument();
    });

    // The nsec + signing key render through SensitiveTextarea (masked by default),
    // so the secret material must not be in the DOM text until the operator reveals it.
    expect(document.body.textContent).not.toContain('nsec1homerecoveredsecretvalue');
    expect(document.body.textContent).not.toContain('deadbeefcafe1234');

    // Revealing the nsec field exposes it.
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Recovered nsec' }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('nsec1homerecoveredsecretvalue');
    });
  });
});
