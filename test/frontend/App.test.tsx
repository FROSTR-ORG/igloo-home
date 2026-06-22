import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    // The landing now renders WelcomeReturningHero when profiles are present.
    expect(screen.getByText('Igloo Home')).toBeInTheDocument();
    expect(screen.getAllByText('Alice Laptop').length).toBeGreaterThan(0);
    // Unlock button per profile row; Load Profile in secondary actions.
    expect(screen.getAllByRole('button', { name: 'Unlock' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Load Profile' }).length).toBeGreaterThan(0);
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

  it('shows the load-failed screen when starting the managed signer fails', async () => {
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'dashboard',
      activeDashboardTab: 'signer',
      runtimeSnapshot: null,
    };
    apiMocks.startProfileSession.mockRejectedValue(new Error('daemon failed to start'));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Signer' }));

    // The failed start routes to the dashboard's full-panel load-failed screen
    // (the message also appears in the top-level error banner — assert the
    // screen's copy specifically).
    const loadFailed = await screen.findByTestId('dashboard-load-failed');
    expect(within(loadFailed).getByText(/daemon failed to start/i)).toBeInTheDocument();
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

describe('igloo-home error banner (R6.4)', () => {
  beforeEach(() => {
    cleanup();
    for (const mock of Object.values(apiMocks)) {
      mock.mockReset();
    }
  });

  const onboardConnection = {
    preview: {
      label: 'Onboarded Device',
      share_public_key: '33'.repeat(32),
      group_public_key: '22'.repeat(32),
      relays: ['wss://relay.primal.net'],
    },
  };

  it('surfaces a passphrase-confirmation mismatch in the banner and does not finalize', async () => {
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'onboard-save',
      pendingOnboardConnection: onboardConnection,
      onboardSaveForm: { label: 'Onboarded Device', passphrase: 'pass-a', confirmPassphrase: 'pass-b' },
    };

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Device' }));

    // The guard now routes through setError → the danger banner, instead of
    // throwing into the fire-and-forget click handler where it was swallowed.
    expect(await screen.findByText('passphrase confirmation does not match')).toBeInTheDocument();
    expect(apiMocks.finalizeConnectedOnboarding).not.toHaveBeenCalled();
  });

  it('surfaces an empty passphrase in the banner and does not start the signer', async () => {
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'dashboard',
      activeDashboardTab: 'signer',
      runtimeSnapshot: null,
      passphrase: '',
    };

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Signer' }));

    expect(await screen.findByText('passphrase is required')).toBeInTheDocument();
    expect(apiMocks.startProfileSession).not.toHaveBeenCalled();
  });

  it('surfaces a finalize decrypt failure (mapped HomeError message) in the banner', async () => {
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'onboard-save',
      pendingOnboardConnection: onboardConnection,
      onboardSaveForm: { label: 'Onboarded Device', passphrase: 'match', confirmPassphrase: 'match' },
    };
    // The real api maps HomeError invalid_passphrase to this message
    // (api-decrypt.test.ts covers the mapping); assert it reaches the danger
    // banner through run()/formatError.
    apiMocks.finalizeConnectedOnboarding.mockRejectedValueOnce(new Error('Incorrect passphrase.'));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Device' }));

    expect(await screen.findByText('Incorrect passphrase.')).toBeInTheDocument();
  });

  it('surfaces a finalize invalid-package failure in the banner', async () => {
    currentVisualScenario.value = {
      ...currentVisualScenario.value,
      activeView: 'onboard-save',
      pendingOnboardConnection: onboardConnection,
      onboardSaveForm: { label: 'Onboarded Device', passphrase: 'match', confirmPassphrase: 'match' },
    };
    apiMocks.finalizeConnectedOnboarding.mockRejectedValueOnce(
      new Error('Invalid package: corrupted'),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Device' }));

    expect(await screen.findByText('Invalid package: corrupted')).toBeInTheDocument();
  });
});
