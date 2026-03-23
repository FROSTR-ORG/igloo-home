import type {
  AppSettings,
  GeneratedKeyset,
  ProfileManifest,
  ProfileRuntimeSnapshot,
} from '@/lib/types';

export type VisualScenarioName =
  | 'landing'
  | 'create'
  | 'load'
  | 'onboard'
  | 'inventory'
  | 'dashboard-signer'
  | 'dashboard-permissions'
  | 'dashboard-settings';

type VisualScenarioState = {
  activeView: 'landing' | 'create' | 'load' | 'onboard' | 'inventory' | 'dashboard';
  activeDashboardTab: 'signer' | 'permissions' | 'settings';
  settings: AppSettings;
  profiles: ProfileManifest[];
  relayProfiles: Array<{
    id: string;
    label: string;
    relays: string[];
  }>;
  selectedProfileId: string;
  vaultPassphrase: string;
  generatedKeyset: GeneratedKeyset | null;
  runtimeSnapshot: ProfileRuntimeSnapshot | null;
  createForm: {
    mode?: 'new' | 'rotate';
    threshold: string;
    count: string;
    sourceProfileId?: string;
  };
  rotationSources?: Array<{
    packageText: string;
    packagePassword: string;
  }>;
  importForm: {
    label: string;
    vaultPassphrase: string;
    relayUrls: string;
    groupPackageJson: string;
    sharePackageJson: string;
  };
  onboardingForm: {
    packageText: string;
    password: string;
    vaultPassphrase: string;
    label: string;
  };
  rotationForm?: {
    onboardingPackage: string;
    onboardingPassword: string;
  };
  loadMode: 'bfprofile' | 'bfshare';
  loadForm: {
    label: string;
    vaultPassphrase: string;
    packagePassword: string;
    packageText: string;
  };
  saveForms: Record<number, { label: string; vaultPassphrase: string; relayUrls: string }>;
  packageDraft: {
    packagePassword: string;
  };
};

const sampleProfiles: ProfileManifest[] = [
  {
    id: 'alice-laptop',
    label: 'Alice Laptop',
    group_ref: 'managed/group/alice.json',
    share_ref: 'vault:alice',
    relay_profile: 'default',
    runtime_options: {},
    policy_overrides: {},
    state_path: '/home/demo/.local/state/igloo-home/alice-laptop',
    daemon_socket_path: '/tmp/igloo-home-alice.sock',
    created_at: 1_709_321_600,
    last_used_at: 1_709_325_200,
  },
  {
    id: 'bob-desktop',
    label: 'Bob Desktop',
    group_ref: 'managed/group/bob.json',
    share_ref: 'vault:bob',
    relay_profile: 'default',
    runtime_options: {},
    policy_overrides: {},
    state_path: '/home/demo/.local/state/igloo-home/bob-desktop',
    daemon_socket_path: '/tmp/igloo-home-bob.sock',
    created_at: 1_709_320_000,
    last_used_at: 1_709_324_000,
  },
];

const sampleGeneratedKeyset: GeneratedKeyset = {
  source: 'generated',
  threshold: 2,
  count: 3,
  group_package_json: '{\n  "threshold": 2,\n  "members": 3\n}',
  group_public_key: '02f4c66d6d912b773fd84d4f6f2306f5d0aa2dc0f4f30b53f52aa9d8c4e2af9011',
  nsec: 'nsec1v2visualpreviewexample',
  shares: [
    {
      name: 'Alice',
      member_idx: 1,
      share_public_key: '11'.repeat(32),
      share_package_json: '{\n  "idx": 1,\n  "share": "alice"\n}',
    },
    {
      name: 'Bob',
      member_idx: 2,
      share_public_key: '22'.repeat(32),
      share_package_json: '{\n  "idx": 2,\n  "share": "bob"\n}',
    },
    {
      name: 'Carol',
      member_idx: 3,
      share_public_key: '33'.repeat(32),
      share_package_json: '{\n  "idx": 3,\n  "share": "carol"\n}',
    },
  ],
};

const sampleRuntimeSnapshot: ProfileRuntimeSnapshot = {
  active: true,
  profile: sampleProfiles[0],
  runtime_status: {
    state: 'online',
    pending_ops: 1,
    known_peers: 2,
  },
  readiness: {
    ready: true,
    sign_ready_peers: 2,
    nonce_pool: 16,
  },
  runtime_diagnostics: {
    relay_status: 'connected',
  },
  daemon_log_path: '/tmp/igloo-home-alice/session-log.jsonl',
  daemon_log_lines: [
    '[info] signer daemon started',
    '[info] relays connected',
    '[info] nonce pool refreshed',
  ],
  daemon_metadata: {
    profile_id: sampleProfiles[0].id,
    pid: 42424,
    socket_path: '/tmp/igloo-home-alice.sock',
    token: 'visual-preview',
    log_path: '/tmp/igloo-home-alice/session-log.jsonl',
    started_at: 1_709_325_220,
  },
};

const baseState: VisualScenarioState = {
  activeView: 'inventory',
  activeDashboardTab: 'signer',
  settings: {
    close_to_tray: true,
    launch_on_login: false,
  },
  profiles: sampleProfiles,
  relayProfiles: [
    {
      id: 'default',
      label: 'Default',
      relays: ['wss://relay.primal.net', 'wss://relay.damus.io'],
    },
  ],
  selectedProfileId: sampleProfiles[0].id,
  vaultPassphrase: 'visual-preview-pass',
  generatedKeyset: null,
  runtimeSnapshot: null,
  createForm: {
    mode: 'new',
    threshold: '2',
    count: '3',
    sourceProfileId: '',
  },
  importForm: {
    label: 'Imported Device',
    vaultPassphrase: 'visual-preview-pass',
    relayUrls: 'wss://relay.primal.net\nwss://relay.damus.io',
    groupPackageJson: '{\n  "group": "demo"\n}',
    sharePackageJson: '{\n  "share": "demo"\n}',
  },
  onboardingForm: {
    packageText: 'bfonboard1visualpreviewpackage',
    password: 'preview-password',
    vaultPassphrase: 'visual-preview-pass',
    label: 'Preview Onboard',
  },
  loadMode: 'bfprofile',
  loadForm: {
    label: 'Recovered Desktop',
    vaultPassphrase: 'visual-preview-pass',
    packagePassword: 'preview-password',
    packageText: 'bfprofile1visualpreview',
  },
  saveForms: {
    1: { label: 'Alice Generated', vaultPassphrase: 'visual-preview-pass', relayUrls: 'wss://relay.primal.net' },
    2: { label: 'Bob Generated', vaultPassphrase: 'visual-preview-pass', relayUrls: 'wss://relay.primal.net' },
    3: { label: 'Carol Generated', vaultPassphrase: 'visual-preview-pass', relayUrls: 'wss://relay.primal.net' },
  },
  packageDraft: {
    packagePassword: 'export-preview-password',
  },
};

export function resolveVisualScenario(): VisualScenarioState | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const name = params.get('__igloo_visual');
  if (!name) return null;

  switch (name) {
    case 'landing':
      return { ...baseState, activeView: 'landing', profiles: [], selectedProfileId: '' };
    case 'load':
      return { ...baseState, activeView: 'load', loadMode: 'bfprofile' };
    case 'onboard':
      return { ...baseState, activeView: 'onboard' };
    case 'inventory':
      return { ...baseState, activeView: 'inventory' };
    case 'create':
      return { ...baseState, activeView: 'create', generatedKeyset: sampleGeneratedKeyset };
    case 'dashboard-signer':
      return {
        ...baseState,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: sampleRuntimeSnapshot,
      };
    case 'dashboard-permissions':
      return {
        ...baseState,
        activeView: 'dashboard',
        activeDashboardTab: 'permissions',
        runtimeSnapshot: sampleRuntimeSnapshot,
      };
    case 'dashboard-settings':
      return { ...baseState, activeView: 'dashboard', activeDashboardTab: 'settings' };
    default:
      return { ...baseState, activeView: 'landing', profiles: [], selectedProfileId: '' };
  }
}
