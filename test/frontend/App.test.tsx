import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentVisualScenario = vi.hoisted(() => ({
  value: {
    activeView: 'landing',
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
    relayProfiles: [
      {
        id: 'default',
        label: 'Default',
        relays: ['wss://relay.primal.net'],
      },
    ],
    selectedProfileId: 'alice-laptop',
    passphrase: 'desktop-pass',
    generatedKeyset: null,
    runtimeSnapshot: null,
    createForm: { mode: 'new', groupName: 'Treasury Group', threshold: '2', count: '3', sourceProfileId: '' },
    rotationSources: [{ packageText: '', packagePassword: '' }],
    importForm: {
      label: '',
      passphrase: '',
      relayUrls: '',
      groupPackageJson: '',
      sharePackageJson: '',
    },
    onboardConnectForm: {
      packageText: 'bfonboard1demo',
      password: 'package-pass',
    },
    onboardSaveForm: {
      label: 'Alice Laptop',
      passphrase: 'desktop-pass',
      confirmPassphrase: 'desktop-pass',
    },
    pendingOnboardConnection: null,
    rotationForm: {
      onboardingPackage: '',
      onboardingPassword: '',
    },
    loadMode: 'bfprofile',
    loadForm: {
      label: '',
      passphrase: '',
      packagePassword: '',
      packageText: '',
    },
    saveForms: {},
    packageDraft: {
      packagePassword: '',
    },
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
  getSettings: vi.fn(),
  importProfileFromBfprofile: vi.fn(),
  importProfileFromOnboarding: vi.fn(),
  importProfileFromRaw: vi.fn(),
  listProfiles: vi.fn(),
  listRelayProfiles: vi.fn(),
  profileRuntimeSnapshot: vi.fn(),
  recoverProfileFromBfshare: vi.fn(),
  refreshRuntimePeers: vi.fn(),
  removeProfile: vi.fn(),
  resolveCloseRequest: vi.fn(),
  startProfileSession: vi.fn(),
  stopSigner: vi.fn(),
  updateProfileOperatorSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(async () => false),
  open: vi.fn(async () => null),
}));

vi.mock('@/lib/testBridge', () => ({
  installTestBridge: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  applyRotationUpdate: apiMocks.applyRotationUpdate,
  connectOnboardingPackage: apiMocks.connectOnboardingPackage,
  createGeneratedOnboardingPackage: apiMocks.createGeneratedOnboardingPackage,
  createGeneratedKeyset: apiMocks.createGeneratedKeyset,
  createRotatedKeyset: apiMocks.createRotatedKeyset,
  discardConnectedOnboarding: apiMocks.discardConnectedOnboarding,
  exportProfilePackage: apiMocks.exportProfilePackage,
  finalizeConnectedOnboarding: apiMocks.finalizeConnectedOnboarding,
  getSettings: apiMocks.getSettings,
  importProfileFromBfprofile: apiMocks.importProfileFromBfprofile,
  importProfileFromOnboarding: apiMocks.importProfileFromOnboarding,
  importProfileFromRaw: apiMocks.importProfileFromRaw,
  listProfiles: apiMocks.listProfiles,
  listRelayProfiles: apiMocks.listRelayProfiles,
  profileRuntimeSnapshot: apiMocks.profileRuntimeSnapshot,
  recoverProfileFromBfshare: apiMocks.recoverProfileFromBfshare,
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

function makeRuntimeSnapshot(active: boolean) {
  return {
    active,
    profile: currentVisualScenario.value.profiles[0],
    runtime_status: {
      peers: [],
    },
    readiness: {
      restore_complete: active,
      sign_ready: active,
    },
    runtime_diagnostics: null,
    daemon_log_path: null,
    daemon_log_lines: [],
    daemon_metadata: null,
  };
}

describe('igloo-home landing shell', () => {
  beforeEach(() => {
    cleanup();
    for (const mock of Object.values(apiMocks)) {
      mock.mockReset();
    }
  });

  it('shows stored profiles on landing and does not render the retired inventory route', () => {
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'landing',
      activeDashboardTab: 'signer',
    };
    render(<App />);

    expect(screen.getByText('Choose one path to initialize this desktop workspace.')).toBeInTheDocument();
    expect(screen.getAllByText('Alice Laptop').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Load Profile' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete Profile' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/inventory/i)).not.toBeInTheDocument();
  });

  it('renders the unified settings actions and no wipe/reset controls', () => {
    cleanup();
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'dashboard',
      activeDashboardTab: 'settings',
    };

    render(<App />);

    expect(screen.getByRole('button', { name: 'copy profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copy share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'rotate share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'logout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wipe all data/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
  });

  it('refreshes runtime peers before reloading the runtime snapshot and shows partial failures inline', async () => {
    const callOrder: string[] = [];
    const activeSnapshot = makeRuntimeSnapshot(true);
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'dashboard',
      activeDashboardTab: 'signer',
      runtimeSnapshot: activeSnapshot,
    };
    apiMocks.refreshRuntimePeers.mockImplementation(async () => {
      callOrder.push('refresh');
      return {
        attempted: 3,
        refreshed: 2,
        failures: [{ peer: 'peer-2', error: 'ping timeout' }],
      };
    });
    apiMocks.profileRuntimeSnapshot.mockImplementation(async () => {
      callOrder.push('snapshot');
      return activeSnapshot;
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Peers' }));

    await waitFor(() => {
      expect(apiMocks.refreshRuntimePeers).toHaveBeenCalledTimes(1);
      expect(apiMocks.profileRuntimeSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(callOrder).toEqual(['refresh', 'snapshot']);
    expect(screen.getByText('Refreshed 2 of 3 peers. 1 peer refresh failed.')).toBeInTheDocument();
    expect(screen.getByText(/peer-2/i)).toBeInTheDocument();
    expect(screen.getByText(/ping timeout/i)).toBeInTheDocument();
  });

  it('clears the peer refresh summary after the signer stops', async () => {
    const activeSnapshot = makeRuntimeSnapshot(true);
    const stoppedSnapshot = makeRuntimeSnapshot(false);
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'dashboard',
      activeDashboardTab: 'signer',
      runtimeSnapshot: activeSnapshot,
    };
    apiMocks.refreshRuntimePeers.mockResolvedValue({
      attempted: 1,
      refreshed: 1,
      failures: [],
    });
    apiMocks.profileRuntimeSnapshot
      .mockResolvedValueOnce(activeSnapshot)
      .mockResolvedValueOnce(stoppedSnapshot);
    apiMocks.stopSigner.mockResolvedValue(undefined);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Peers' }));
    await screen.findByText('Refreshed 1 of 1 peers successfully.');

    fireEvent.click(screen.getByRole('button', { name: 'Stop Signer' }));

    await waitFor(() => {
      expect(apiMocks.stopSigner).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText('Refreshed 1 of 1 peers successfully.')).not.toBeInTheDocument();
    });
  });
});
