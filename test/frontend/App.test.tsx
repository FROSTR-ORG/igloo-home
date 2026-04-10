import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  removeProfile: vi.fn(),
  resolveCloseRequest: vi.fn(),
  startProfileSession: vi.fn(),
  stopSigner: vi.fn(),
  updateProfileOperatorSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('@/test/visualMode', () => ({
  resolveVisualScenario: () => currentVisualScenario.value,
}));

import App from '@/App';

describe('igloo-home landing shell', () => {
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
});
