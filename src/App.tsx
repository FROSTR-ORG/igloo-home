import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { shortProfileId } from '@/lib/profileIdentity';
import {
  AppHeader,
  Button,
  ContentCard,
  HostEntryTile,
  HostFlowShell,
  OperatorDashboardTabs,
  OperatorPermissionsPanel,
  type OperatorPeerPermissionState,
  type OperatorPendingOperation,
  OperatorSettingsPanel,
  OperatorSignerPanel,
  PageLayout,
  ProfileConfirmationCard,
  QrPayloadModal,
  StepProgress,
  StoredProfilesLandingCard,
  Textarea,
  type LogEntry,
  type OperatorSignerSettings,
  type PeerPolicy,
} from 'igloo-ui';
import {
  applyRotationUpdate,
  connectOnboardingPackage,
  createGeneratedOnboardingPackage,
  createGeneratedKeyset,
  createRotatedKeyset,
  discardConnectedOnboarding,
  exportProfilePackage,
  finalizeConnectedOnboarding,
  getSettings,
  importProfileFromBfprofile,
  importProfileFromRaw,
  listProfiles,
  listRelayProfiles,
  profileRuntimeSnapshot,
  refreshRuntimePeers,
  recoverProfileFromBfshare,
  removeProfile,
  resolveCloseRequest,
  startProfileSession,
  stopSigner,
  updateProfileOperatorSettings,
  updateSettings,
} from '@/lib/api';
import {
  EVENT_APP_CLOSE_REQUESTED,
  EVENT_APP_SETTINGS,
  EVENT_APP_TEST_NAVIGATE,
  EVENT_SIGNER_LIFECYCLE,
  EVENT_SIGNER_LOG,
  EVENT_SIGNER_STATUS,
} from '@/lib/events';
import type {
  AppSettings,
  AppSettingsEvent,
  AppTestNavigateEvent,
  ConnectedOnboardingPreview,
  CloseRequestEvent,
  GeneratedKeyset,
  GeneratedKeysetShare,
  ProfileImportResult,
  ProfileManifest,
  ProfileRuntimeSnapshot,
  RelayProfile,
  RuntimePeerRefreshResult,
  SignerLifecycleEvent,
  SignerLogEvent,
  SignerStatusEvent,
} from '@/lib/types';
import { installTestBridge } from '@/lib/testBridge';
import { resolveVisualScenario } from '@/test/visualMode';
import CreatePage from '@/pages/CreatePage';

type ViewKey = 'landing' | 'create' | 'load' | 'onboard-connect' | 'onboard-save' | 'dashboard';
type DashboardTab = 'signer' | 'permissions' | 'settings';

type SaveDraft = {
  label: string;
  passphrase: string;
  relayUrls: string;
};

type RotationSourceDraft = {
  packageText: string;
  packagePassword: string;
};

type DistributionDraft = {
  label: string;
  packagePassword: string;
  confirmPassword: string;
};

type DistributionResult = {
  kind: 'copied' | 'qr' | 'saved';
  label: string;
  packageText: string;
};

type RotationDraft = {
  onboardingPackage: string;
  onboardingPassword: string;
};

type OnboardConnectDraft = {
  packageText: string;
  password: string;
};

type OnboardSaveDraft = {
  label: string;
  passphrase: string;
  confirmPassphrase: string;
};

type PackageExportDraft = {
  packagePassword: string;
};

type RuntimeOptionsDraft = OperatorSignerSettings & {
  ecdh_timeout_secs: number;
  onboard_timeout_secs: number;
  max_future_skew_secs: number;
  request_cache_limit: number;
  ecdh_cache_capacity: number;
  ecdh_cache_ttl_secs: number;
  sig_cache_capacity: number;
  sig_cache_ttl_secs: number;
  event_kind: number;
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

type PeerRefreshSummary = {
  tone: 'success' | 'warning' | 'error';
  message: string;
  details: string[];
};

function splitTextarea(value: string) {
  return value
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function unwrapImportedProfile(result: ProfileImportResult) {
  if (result.status !== 'profile_created') {
    throw new Error('expected the onboarding flow to create a managed profile');
  }
  return result.profile;
}

function detectSettingsDraft(profile: ProfileManifest | null): RuntimeOptionsDraft {
  const runtimeOptions =
    profile?.runtime_options && typeof profile.runtime_options === 'object' && !Array.isArray(profile.runtime_options)
      ? (profile.runtime_options as Record<string, unknown>)
      : {};
  return {
    sign_timeout_secs: numberOption(runtimeOptions.sign_timeout_secs, 120),
    ping_timeout_secs: numberOption(runtimeOptions.ping_timeout_secs, 30),
    request_ttl_secs: numberOption(runtimeOptions.request_ttl_secs, 300),
    state_save_interval_secs: numberOption(runtimeOptions.state_save_interval_secs, 10),
    peer_selection_strategy:
      runtimeOptions.peer_selection_strategy === 'random' ? 'random' : 'deterministic_sorted',
    ecdh_timeout_secs: numberOption(runtimeOptions.ecdh_timeout_secs, 120),
    onboard_timeout_secs: numberOption(runtimeOptions.onboard_timeout_secs, 120),
    max_future_skew_secs: numberOption(runtimeOptions.max_future_skew_secs, 300),
    request_cache_limit: numberOption(runtimeOptions.request_cache_limit, 4096),
    ecdh_cache_capacity: numberOption(runtimeOptions.ecdh_cache_capacity, 256),
    ecdh_cache_ttl_secs: numberOption(runtimeOptions.ecdh_cache_ttl_secs, 3600),
    sig_cache_capacity: numberOption(runtimeOptions.sig_cache_capacity, 1024),
    sig_cache_ttl_secs: numberOption(runtimeOptions.sig_cache_ttl_secs, 3600),
    event_kind: numberOption(runtimeOptions.event_kind, 31337),
    router_expire_tick_ms: numberOption(runtimeOptions.router_expire_tick_ms, 1000),
    router_relay_backoff_ms: numberOption(runtimeOptions.router_relay_backoff_ms, 3000),
    router_command_queue_capacity: numberOption(runtimeOptions.router_command_queue_capacity, 256),
    router_inbound_queue_capacity: numberOption(runtimeOptions.router_inbound_queue_capacity, 512),
    router_outbound_queue_capacity: numberOption(runtimeOptions.router_outbound_queue_capacity, 512),
    router_command_overflow_policy:
      runtimeOptions.router_command_overflow_policy === 'drop_oldest' ? 'drop_oldest' : 'fail',
    router_inbound_overflow_policy:
      runtimeOptions.router_inbound_overflow_policy === 'drop_oldest' ? 'drop_oldest' : 'fail',
    router_outbound_overflow_policy:
      runtimeOptions.router_outbound_overflow_policy === 'drop_oldest' ? 'drop_oldest' : 'fail',
    router_inbound_dedupe_cache_limit: numberOption(runtimeOptions.router_inbound_dedupe_cache_limit, 4096),
  };
}

function numberOption(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatError(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function buildPeerRefreshSummary(result: RuntimePeerRefreshResult): PeerRefreshSummary {
  const details = result.failures.map(
    (failure) => `${shortProfileId(failure.peer)}: ${failure.error}`,
  );

  if (result.failures.length === 0) {
    if (result.attempted === 0) {
      return {
        tone: 'success',
        message: 'No peers were available to refresh.',
        details: [],
      };
    }
    return {
      tone: 'success',
      message: `Refreshed ${result.refreshed} of ${result.attempted} peers successfully.`,
      details: [],
    };
  }

  if (result.refreshed === 0) {
    return {
      tone: 'error',
      message: `Peer refresh failed for all ${result.attempted} attempted peers.`,
      details,
    };
  }

  return {
    tone: 'warning',
    message: `Refreshed ${result.refreshed} of ${result.attempted} peers. ${result.failures.length} peer refresh failed.`,
    details,
  };
}

function extractPeerPermissionStates(runtimeSnapshot: ProfileRuntimeSnapshot | null): OperatorPeerPermissionState[] {
  const fromRuntime =
    runtimeSnapshot?.runtime_status &&
    typeof runtimeSnapshot.runtime_status === 'object' &&
    'peer_permission_states' in runtimeSnapshot.runtime_status
      ? (runtimeSnapshot.runtime_status as { peer_permission_states?: unknown }).peer_permission_states
      : null;
  if (Array.isArray(fromRuntime)) {
    return fromRuntime
      .map((policy): OperatorPeerPermissionState | null => {
        if (typeof policy !== 'object' || policy === null) return null;
        const typed = policy as Record<string, unknown>;
        if (typeof typed.pubkey !== 'string') return null;
        return {
          pubkey: typed.pubkey,
          manualOverride: {
            request: {
              ping: ((((typed.manual_override as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.ping as 'unset' | 'allow' | 'deny') ?? 'unset'),
              onboard: ((((typed.manual_override as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.onboard as 'unset' | 'allow' | 'deny') ?? 'unset'),
              sign: ((((typed.manual_override as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.sign as 'unset' | 'allow' | 'deny') ?? 'unset'),
              ecdh: ((((typed.manual_override as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.ecdh as 'unset' | 'allow' | 'deny') ?? 'unset'),
            },
            respond: {
              ping: ((((typed.manual_override as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.ping as 'unset' | 'allow' | 'deny') ?? 'unset'),
              onboard: ((((typed.manual_override as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.onboard as 'unset' | 'allow' | 'deny') ?? 'unset'),
              sign: ((((typed.manual_override as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.sign as 'unset' | 'allow' | 'deny') ?? 'unset'),
              ecdh: ((((typed.manual_override as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.ecdh as 'unset' | 'allow' | 'deny') ?? 'unset'),
            },
          },
          remoteObservation:
            typed.remote_observation && typeof typed.remote_observation === 'object'
              ? {
                  request: {
                    ping: Boolean((((typed.remote_observation as Record<string, unknown>).request as Record<string, unknown> | undefined)?.ping)),
                    onboard: Boolean((((typed.remote_observation as Record<string, unknown>).request as Record<string, unknown> | undefined)?.onboard)),
                    sign: Boolean((((typed.remote_observation as Record<string, unknown>).request as Record<string, unknown> | undefined)?.sign)),
                    ecdh: Boolean((((typed.remote_observation as Record<string, unknown>).request as Record<string, unknown> | undefined)?.ecdh)),
                  },
                  respond: {
                    ping: Boolean((((typed.remote_observation as Record<string, unknown>).respond as Record<string, unknown> | undefined)?.ping)),
                    onboard: Boolean((((typed.remote_observation as Record<string, unknown>).respond as Record<string, unknown> | undefined)?.onboard)),
                    sign: Boolean((((typed.remote_observation as Record<string, unknown>).respond as Record<string, unknown> | undefined)?.sign)),
                    ecdh: Boolean((((typed.remote_observation as Record<string, unknown>).respond as Record<string, unknown> | undefined)?.ecdh)),
                  },
                  updated: Number((typed.remote_observation as Record<string, unknown>).updated ?? 0),
                  revision: Number((typed.remote_observation as Record<string, unknown>).revision ?? 0),
                }
              : null,
          effectivePolicy: {
            request: {
              ping: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.ping)),
              onboard: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.onboard)),
              sign: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.sign)),
              ecdh: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.ecdh)),
            },
            respond: {
              ping: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.ping)),
              onboard: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.onboard)),
              sign: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.sign)),
              ecdh: Boolean((((typed.effective_policy as Record<string, unknown> | undefined)?.respond as Record<string, unknown> | undefined)?.ecdh)),
            },
          },
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }
  return [];
}

function extractRuntimePeers(runtimeSnapshot: ProfileRuntimeSnapshot | null): PeerPolicy[] {
  const permissionStateByPubkey = new Map(
    extractPeerPermissionStates(runtimeSnapshot).map((entry) => [entry.pubkey.toLowerCase(), entry])
  );
  const runtimeStatus =
    runtimeSnapshot?.runtime_status && typeof runtimeSnapshot.runtime_status === 'object'
      ? (runtimeSnapshot.runtime_status as Record<string, unknown>)
      : null;
  const peers = Array.isArray(runtimeStatus?.peers)
    ? (runtimeStatus?.peers as Record<string, unknown>[])
    : [];
  const metadataPeers =
    runtimeStatus &&
    typeof runtimeStatus.metadata === 'object' &&
    runtimeStatus.metadata &&
    Array.isArray((runtimeStatus.metadata as Record<string, unknown>).peers)
      ? ((runtimeStatus.metadata as Record<string, unknown>).peers as unknown[])
      : [];
  const rows = new Map<string, PeerPolicy>();

  for (const [index, pubkey] of metadataPeers.entries()) {
    if (typeof pubkey !== 'string') continue;
    const normalized = pubkey.toLowerCase();
    const permissionState = permissionStateByPubkey.get(normalized);
    rows.set(normalized, {
      alias: `Peer ${index + 1}`,
      pubkey: normalized,
      send: permissionState?.effectivePolicy.request.sign ?? true,
      receive: permissionState?.effectivePolicy.respond.sign ?? true,
      state: 'idle',
      statusLabel: 'known',
      lastSeen: null,
      incomingAvailable: 0,
      outgoingAvailable: 0,
      outgoingSpent: 0,
      shouldSendNonces: false,
    });
  }

  for (const peer of peers) {
    const pubkey = typeof peer.pubkey === 'string' ? peer.pubkey.toLowerCase() : null;
    if (!pubkey) continue;
    const permissionState = permissionStateByPubkey.get(pubkey);
    const existing = rows.get(pubkey);
    const canSign = Boolean(peer.can_sign);
    const online = Boolean(peer.online);
    const known = Boolean(peer.known);
    rows.set(pubkey, {
      alias: existing?.alias ?? `Peer ${typeof peer.idx === 'number' ? peer.idx : rows.size + 1}`,
      pubkey,
      send: permissionState?.effectivePolicy.request.sign ?? existing?.send ?? true,
      receive: permissionState?.effectivePolicy.respond.sign ?? existing?.receive ?? true,
      state: canSign ? 'warning' : online ? 'online' : known ? 'idle' : 'offline',
      statusLabel: canSign ? 'sign-ready' : online ? 'online' : known ? 'known' : 'offline',
      lastSeen: typeof peer.last_seen === 'number' ? peer.last_seen : null,
      incomingAvailable: typeof peer.incoming_available === 'number' ? peer.incoming_available : 0,
      outgoingAvailable: typeof peer.outgoing_available === 'number' ? peer.outgoing_available : 0,
      outgoingSpent: typeof peer.outgoing_spent === 'number' ? peer.outgoing_spent : 0,
      shouldSendNonces: Boolean(peer.should_send_nonces),
    });
  }

  return [...rows.values()].sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

function extractPendingOperations(runtimeSnapshot: ProfileRuntimeSnapshot | null): OperatorPendingOperation[] {
  const fromRuntime =
    runtimeSnapshot?.runtime_status &&
    typeof runtimeSnapshot.runtime_status === 'object' &&
    'pending_operations' in runtimeSnapshot.runtime_status
      ? (runtimeSnapshot.runtime_status as { pending_operations?: unknown }).pending_operations
      : null;
  if (!Array.isArray(fromRuntime)) return [];
  return fromRuntime
    .map((operation): OperatorPendingOperation | null => {
      if (!operation || typeof operation !== 'object') return null;
      const typed = operation as Record<string, unknown>;
      if (typeof typed.request_id !== 'string' || typeof typed.op_type !== 'string') return null;
      return {
        request_id: typed.request_id,
        op_type: typed.op_type,
        threshold: typeof typed.threshold === 'number' ? typed.threshold : 0,
        started_at: typeof typed.started_at === 'number' ? typed.started_at : null,
        timeout_at: typeof typed.timeout_at === 'number' ? typed.timeout_at : null,
        collected_responses: Array.isArray(typed.collected_responses) ? typed.collected_responses.length : 0,
        target_peers: Array.isArray(typed.target_peers)
          ? typed.target_peers.filter((peer): peer is string => typeof peer === 'string')
          : [],
      };
    })
    .filter((entry): entry is OperatorPendingOperation => entry !== null);
}

function toLogEntries(lines: string[] = []): LogEntry[] {
  return lines.map((line, index) => ({
    id: `home-log-${index}-${line}`,
    time: new Date().toLocaleTimeString(),
    level: line.startsWith('[error]') ? 'ERROR' : line.startsWith('[warn]') ? 'WARN' : 'INFO',
    message: line.replace(/^\[[^\]]+\]\s*/, ''),
    data: { raw: line },
  }));
}

function DesktopSettingsExtras({
  settings,
  onToggle,
}: {
  settings: AppSettings;
  onToggle: (field: keyof AppSettings, checked: boolean) => void;
}) {
  return (
    <ContentCard title="Desktop Lifecycle Settings" description="Tray handling, launch behavior, and session restoration.">
      <div className="igloo-settings-grid">
        <label className="igloo-toggle-row">
          <input
            type="checkbox"
            checked={settings.close_to_tray}
            onChange={event => onToggle('close_to_tray', event.target.checked)}
          />
          <span>
            <strong>Close to tray</strong>
            <small>Hide the window instead of prompting to stop the active signer session.</small>
          </span>
        </label>
        <label className="igloo-toggle-row">
          <input
            type="checkbox"
            checked={settings.launch_on_login}
            onChange={event => onToggle('launch_on_login', event.target.checked)}
          />
          <span>
            <strong>Launch on login</strong>
            <small>Register the desktop app at system startup without unlocking a profile automatically.</small>
          </span>
        </label>
      </div>
    </ContentCard>
  );
}

export default function App() {
  const visualScenario = useMemo(() => resolveVisualScenario(), []);
  useEffect(() => {
    installTestBridge();
  }, []);

  const [activeView, setActiveView] = useState<ViewKey>(visualScenario?.activeView ?? 'landing');
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>(
    visualScenario?.activeDashboardTab ?? 'signer',
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(
    visualScenario?.settings ?? {
      close_to_tray: false,
      launch_on_login: false,
    },
  );
  const [profiles, setProfiles] = useState<ProfileManifest[]>(visualScenario?.profiles ?? []);
  const [relayProfiles, setRelayProfiles] = useState<RelayProfile[]>(visualScenario?.relayProfiles ?? []);
  const [selectedProfileId, setSelectedProfileId] = useState(visualScenario?.selectedProfileId ?? '');
  const [passphrase, setPassphrase] = useState(visualScenario?.passphrase ?? '');
  const [landingPassphrases, setLandingPassphrases] = useState<Record<string, string>>({});
  const [generatedKeyset, setGeneratedKeyset] = useState<GeneratedKeyset | null>(visualScenario?.generatedKeyset ?? null);
  const [createForm, setCreateForm] = useState(
    {
      mode: 'new',
      groupName: '',
      threshold: '2',
      count: '3',
      sourceProfileId: '',
      ...visualScenario?.createForm,
    } as { mode: 'new' | 'rotate'; groupName: string; threshold: string; count: string; sourceProfileId: string },
  );
  const [rotationSources, setRotationSources] = useState<RotationSourceDraft[]>(
    visualScenario?.rotationSources ?? [{ packageText: '', packagePassword: '' }],
  );
  const [selectedGeneratedShareIdx, setSelectedGeneratedShareIdx] = useState<number | null>(null);
  const [distributionForms, setDistributionForms] = useState<Record<number, DistributionDraft>>({});
  const [distributionResults, setDistributionResults] = useState<Record<number, DistributionResult>>({});
  const [distributionQr, setDistributionQr] = useState<{ label: string; packageText: string } | null>(null);
  const [saveForms, setSaveForms] = useState<Record<number, SaveDraft>>(visualScenario?.saveForms ?? {});
  const [importForm, setImportForm] = useState(
    visualScenario?.importForm ?? {
      label: '',
      passphrase: '',
      relayUrls: '',
      groupPackageJson: '',
      sharePackageJson: '',
    },
  );
  const [onboardConnectForm, setOnboardConnectForm] = useState<OnboardConnectDraft>(
    visualScenario?.onboardConnectForm ?? {
      packageText: '',
      password: '',
    },
  );
  const [onboardSaveForm, setOnboardSaveForm] = useState<OnboardSaveDraft>(
    visualScenario?.onboardSaveForm ?? {
      label: '',
      passphrase: '',
      confirmPassphrase: '',
    },
  );
  const [pendingOnboardConnection, setPendingOnboardConnection] = useState<ConnectedOnboardingPreview | null>(
    visualScenario?.pendingOnboardConnection ?? null,
  );
  const [rotationForm, setRotationForm] = useState<RotationDraft>(
    visualScenario?.rotationForm ?? {
      onboardingPackage: '',
      onboardingPassword: '',
    },
  );
  const [loadMode, setLoadMode] = useState<'bfprofile' | 'bfshare'>(visualScenario?.loadMode ?? 'bfprofile');
  const [loadForm, setLoadForm] = useState(
    visualScenario?.loadForm ?? {
      label: '',
      passphrase: '',
      packagePassword: '',
      packageText: '',
    },
  );
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ProfileRuntimeSnapshot | null>(
    visualScenario?.runtimeSnapshot ?? null,
  );
  const [peerRefreshSummary, setPeerRefreshSummary] = useState<PeerRefreshSummary | null>(null);
  const [packageDraft, setPackageDraft] = useState<PackageExportDraft>(
    visualScenario?.packageDraft ?? { packagePassword: '' },
  );
  const [relayDraft, setRelayDraft] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<RuntimeOptionsDraft>(detectSettingsDraft(null));

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const selectedRelayProfile = useMemo(
    () => relayProfiles.find(profile => profile.id === selectedProfile?.relay_profile) ?? null,
    [relayProfiles, selectedProfile],
  );
  const activeProfileId = runtimeSnapshot?.active ? runtimeSnapshot.profile?.id ?? null : null;

  const runtimePeers = useMemo(() => extractRuntimePeers(runtimeSnapshot), [runtimeSnapshot]);
  const peerPermissionStates = useMemo(() => extractPeerPermissionStates(runtimeSnapshot), [runtimeSnapshot]);
  const pendingOperations = useMemo(() => extractPendingOperations(runtimeSnapshot), [runtimeSnapshot]);

  useEffect(() => {
    setSettingsDraft(detectSettingsDraft(selectedProfile));
    setRelayDraft('');
    setPeerRefreshSummary(null);
  }, [selectedProfileId, selectedProfile]);

  async function run<T>(label: string, task: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      return await task();
    } catch (err) {
      const message = formatError(err);
      setError(message);
      throw err;
    } finally {
      setBusy(null);
    }
  }

  async function refreshProfiles(preferredProfileId?: string | null) {
    const [nextProfiles, nextRelayProfiles] = await Promise.all([listProfiles(), listRelayProfiles()]);
    setProfiles(nextProfiles);
    setRelayProfiles(nextRelayProfiles);
    setSelectedProfileId(current => {
      if (preferredProfileId && nextProfiles.some(profile => profile.id === preferredProfileId)) {
        return preferredProfileId;
      }
      if (current && nextProfiles.some(profile => profile.id === current)) {
        return current;
      }
      return nextProfiles[0]?.id ?? '';
    });
    setActiveView(current => {
      if (current === 'dashboard' && !nextProfiles.length) return 'landing';
      return current;
    });
  }

  async function refreshRuntime(profileId?: string | null) {
    setRuntimeSnapshot(await profileRuntimeSnapshot(profileId ?? selectedProfileId ?? null));
  }

  async function bootstrap() {
    if (visualScenario) {
      return;
    }
    setBusy('bootstrapping workspace');
    setError(null);
    try {
      const [nextSettings, nextProfiles, nextRelayProfiles] = await Promise.all([
        getSettings(),
        listProfiles(),
        listRelayProfiles(),
      ]);
      setSettings(nextSettings);
      setProfiles(nextProfiles);
      setRelayProfiles(nextRelayProfiles);
      const firstProfileId = nextProfiles[0]?.id ?? '';
      setSelectedProfileId(firstProfileId);
      setActiveView('landing');
      setRuntimeSnapshot(await profileRuntimeSnapshot(firstProfileId || null));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (visualScenario) {
      return;
    }
    void bootstrap();
  }, [visualScenario]);

  useEffect(() => {
    if (visualScenario) {
      return;
    }
    if (!selectedProfileId) {
      return;
    }
    void refreshRuntime(selectedProfileId);
  }, [selectedProfileId, visualScenario]);

  useEffect(() => {
    if (activeView === 'onboard-save' && !pendingOnboardConnection) {
      setActiveView('onboard-connect');
    }
  }, [activeView, pendingOnboardConnection]);

  useEffect(() => {
    if (!runtimeSnapshot?.active) {
      setPeerRefreshSummary(null);
    }
  }, [runtimeSnapshot?.active]);

  useEffect(() => {
    if (visualScenario) {
      return;
    }
    const unlisteners: Array<() => void> = [];
    void (async () => {
      unlisteners.push(
        await listen<AppSettingsEvent>(EVENT_APP_SETTINGS, event => {
          setSettings(event.payload.settings);
        }),
      );
      const refreshCurrent = () => {
        if (selectedProfileId) {
          void refreshRuntime(selectedProfileId);
        }
      };
      unlisteners.push(await listen<SignerStatusEvent>(EVENT_SIGNER_STATUS, refreshCurrent));
      unlisteners.push(await listen<SignerLogEvent>(EVENT_SIGNER_LOG, refreshCurrent));
      unlisteners.push(
        await listen<SignerLifecycleEvent>(EVENT_SIGNER_LIFECYCLE, event => {
          const target = event.payload.share_id ?? selectedProfileId;
          if (target) {
            void refreshRuntime(target);
          }
        }),
      );
      unlisteners.push(
        await listen<CloseRequestEvent>(EVENT_APP_CLOSE_REQUESTED, async event => {
          const stopAndQuit = await confirm(
            `Stop signer "${event.payload.share_name ?? event.payload.share_id ?? 'session'}" and quit? Press Cancel to hide to tray instead.`,
            { title: 'Signer Running', kind: 'warning' },
          );
          await resolveCloseRequest(stopAndQuit ? 'stop_and_quit' : 'hide');
        }),
      );
      unlisteners.push(
        await listen<AppTestNavigateEvent>(EVENT_APP_TEST_NAVIGATE, event => {
          if (event.payload.profile_id) {
            setSelectedProfileId(event.payload.profile_id);
          }
          const view = event.payload.view;
          if (
            view === 'landing' ||
            view === 'create' ||
            view === 'load' ||
            view === 'onboard-connect' ||
            view === 'onboard-save' ||
            view === 'dashboard'
          ) {
            setActiveView(view);
          }
          const nextTab = event.payload.signer_tab ?? null;
          if (nextTab === 'signer' || nextTab === 'permissions' || nextTab === 'settings') {
            setActiveDashboardTab(nextTab);
          }
        }),
      );
    })();
    return () => {
      unlisteners.forEach(dispose => dispose());
    };
  }, [selectedProfileId, visualScenario]);

  async function handleGenerate() {
    const groupName = createForm.groupName.trim();
    const threshold = Number(createForm.threshold);
    const count = Number(createForm.count);
    if (!groupName) {
      throw new Error('group name is required');
    }
    const generated = await run(
      createForm.mode === 'rotate' ? 'rotating keyset' : 'generating keyset',
      () =>
        createForm.mode === 'rotate'
          ? createRotatedKeyset({
              threshold,
              count,
              sources: rotationSources.map((source) => ({
                packageText: source.packageText,
                packagePassword: source.packagePassword,
              })),
            })
          : createGeneratedKeyset(groupName, threshold, count),
    );
    setGeneratedKeyset(generated);
    const sourceProfile =
      createForm.mode === 'rotate'
        ? profiles.find((profile) => profile.id === createForm.sourceProfileId) ?? null
        : null;
    const sourceRelayProfile =
      sourceProfile ? relayProfiles.find((profile) => profile.id === sourceProfile.relay_profile) ?? null : null;
    setSaveForms(
      Object.fromEntries(
        generated.shares.map(share => [
          share.member_idx,
          {
            label: createForm.mode === 'rotate' && sourceProfile ? sourceProfile.label : share.name,
            passphrase: '',
            relayUrls: sourceRelayProfile?.relays.join('\n') ?? '',
          },
        ]),
      ),
    );
    setSelectedGeneratedShareIdx(null);
    setDistributionForms(
      Object.fromEntries(
        generated.shares.map((share) => [
          share.member_idx,
          {
            label: share.name,
            packagePassword: '',
            confirmPassword: '',
          },
        ]),
      ),
    );
    setDistributionResults({});
    setDistributionQr(null);
  }

  async function handleSaveGeneratedProfile(share: GeneratedKeysetShare) {
    const draft = saveForms[share.member_idx];
    if (!draft?.label || !draft.passphrase) {
      throw new Error('profile label and passphrase are required');
    }
    const result = await run('importing generated profile', () =>
      importProfileFromRaw({
        label: draft.label,
        relayUrls: splitTextarea(draft.relayUrls),
        passphrase: draft.passphrase,
        groupPackageJson: generatedKeyset?.group_package_json ?? '',
        sharePackageJson: share.share_package_json,
      }),
    );
    const profile = unwrapImportedProfile(result);
    setPassphrase(draft.passphrase);
    await refreshProfiles(profile.id);
    setSelectedProfileId(profile.id);
    setSelectedGeneratedShareIdx(share.member_idx);
    setNotice('Local profile created. Distribute the remaining shares as bfonboard packages.');
    setActiveView('create');
  }

  async function handleDistributeGeneratedShare(memberIdx: number, kind: 'copy' | 'qr' | 'save') {
    if (!generatedKeyset || selectedGeneratedShareIdx == null) {
      throw new Error('Save the local profile before distributing remaining shares.');
    }
    const distribution = distributionForms[memberIdx];
    if (!distribution?.label.trim()) {
      throw new Error('share label is required');
    }
    if (!distribution.packagePassword || distribution.packagePassword !== distribution.confirmPassword) {
      throw new Error('package password confirmation does not match');
    }
    const localDraft = saveForms[selectedGeneratedShareIdx];
    const localShare = generatedKeyset.shares.find((share) => share.member_idx === selectedGeneratedShareIdx);
    const targetShare = generatedKeyset.shares.find((share) => share.member_idx === memberIdx);
    if (!localDraft || !localShare || !targetShare) {
      throw new Error('generated share context is incomplete');
    }
    const packageText = await run('creating onboarding package', () =>
      createGeneratedOnboardingPackage({
        sharePackageJson: targetShare.share_package_json,
        relayUrls: splitTextarea(localDraft.relayUrls),
        peerPubkey: localShare.share_public_key,
        packagePassword: distribution.packagePassword,
      }),
    );
    if (kind === 'copy' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(packageText);
    }
    if (kind === 'qr') {
      setDistributionQr({ label: distribution.label, packageText });
    }
    if (kind === 'save') {
      downloadText(`${distribution.label || `member-${memberIdx}`}-bfonboard.txt`, packageText);
    }
    setDistributionResults((current) => ({
      ...current,
      [memberIdx]: {
        kind: kind === 'copy' ? 'copied' : kind === 'save' ? 'saved' : 'qr',
        label: distribution.label,
        packageText,
      },
    }));
  }

  function handleFinishDistribution() {
    setDistributionQr(null);
    setActiveView('dashboard');
    setActiveDashboardTab('signer');
  }

  async function handleConnectOnboardingPackage() {
    const connection = await run('connecting onboarding package', () =>
      connectOnboardingPackage({
        onboardingPassword: onboardConnectForm.password,
        package: onboardConnectForm.packageText,
      }),
    );
    setPendingOnboardConnection(connection);
    setOnboardSaveForm(current => ({
      ...current,
      label: connection.preview.label,
    }));
    setActiveView('onboard-save');
  }

  async function handleFinalizeOnboardingProfile() {
    if (!pendingOnboardConnection) {
      throw new Error('connect an onboarding package first');
    }
    if (onboardSaveForm.passphrase !== onboardSaveForm.confirmPassphrase) {
      throw new Error('passphrase confirmation does not match');
    }
    const result = await run('saving onboarded device', () =>
      finalizeConnectedOnboarding({
        label: onboardSaveForm.label || undefined,
        passphrase: onboardSaveForm.passphrase,
      }),
    );
    const profile = unwrapImportedProfile(result);
    setPassphrase(onboardSaveForm.passphrase);
    setPendingOnboardConnection(null);
    await refreshProfiles(profile.id);
    setSelectedProfileId(profile.id);
    setActiveView('dashboard');
    setActiveDashboardTab('signer');
  }

  async function handleDiscardOnboardingConnection(nextView: ViewKey = 'onboard-connect') {
    if (pendingOnboardConnection) {
      await run('discarding onboarding preview', () => discardConnectedOnboarding());
      setPendingOnboardConnection(null);
    }
    setActiveView(nextView);
  }

  async function handleLoadPackage() {
    const result = await run(
      loadMode === 'bfprofile' ? 'importing bfprofile' : 'recovering bfshare',
      () =>
        loadMode === 'bfprofile'
          ? importProfileFromBfprofile({
              label: loadForm.label || undefined,
              passphrase: loadForm.passphrase,
              packagePassword: loadForm.packagePassword,
              packageText: loadForm.packageText,
            })
          : recoverProfileFromBfshare({
              label: loadForm.label || undefined,
              passphrase: loadForm.passphrase,
              packagePassword: loadForm.packagePassword,
              packageText: loadForm.packageText,
            }),
    );
    const profile = unwrapImportedProfile(result);
    setPassphrase(loadForm.passphrase);
    await refreshProfiles(profile.id);
    setSelectedProfileId(profile.id);
    setActiveView('dashboard');
    setActiveDashboardTab('signer');
  }

  async function handleRotateKey() {
    if (!selectedProfileId) {
      throw new Error('select a profile first');
    }
    const result = await run('rotating device key', () =>
      applyRotationUpdate({
        targetProfileId: selectedProfileId,
        passphrase,
        onboardingPassword: rotationForm.onboardingPassword,
        onboardingPackage: rotationForm.onboardingPackage,
      }),
    );
    const profile = unwrapImportedProfile(result);
    setRotationForm({ onboardingPackage: '', onboardingPassword: '' });
    setSelectedProfileId(profile.id);
    await refreshProfiles(profile.id);
    if (runtimeSnapshot?.active) {
      await handleStartProfileSession(profile.id);
    } else {
      setActiveView('dashboard');
      setActiveDashboardTab('settings');
    }
  }

  async function handleStartProfileSession(profileId = selectedProfileId, sessionPassphrase = passphrase) {
    if (!profileId) {
      throw new Error('select a profile first');
    }
    if (!sessionPassphrase.trim()) {
      throw new Error('passphrase is required');
    }
    if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id !== profileId) {
      await stopSigner();
    }
    const snapshot = await run('starting managed profile', () =>
      startProfileSession({
        profileId,
        passphrase: sessionPassphrase,
      }),
    );
    setPeerRefreshSummary(null);
    setRuntimeSnapshot(snapshot);
    setActiveView('dashboard');
    setActiveDashboardTab('signer');
  }

  async function handleLoadLandingProfile(profileId: string) {
    setSelectedProfileId(profileId);
    if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id === profileId) {
      setActiveView('dashboard');
      setActiveDashboardTab('signer');
      return;
    }
    const sessionPassphrase = landingPassphrases[profileId] ?? passphrase;
    setPassphrase(sessionPassphrase);
    await handleStartProfileSession(profileId, sessionPassphrase);
  }

  async function handleStopProfileSession() {
    setPeerRefreshSummary(null);
    await run('stopping managed profile', async () => {
      await stopSigner();
      await refreshRuntime(selectedProfileId || null);
    });
  }

  async function handleRefreshRuntimePeers() {
    if (!selectedProfileId || !runtimeSnapshot?.active) {
      return;
    }
    setPeerRefreshSummary(null);
    try {
      const result = await run('refreshing runtime peers', () => refreshRuntimePeers());
      setPeerRefreshSummary(buildPeerRefreshSummary(result));
      await refreshRuntime(selectedProfileId);
    } catch (err) {
      setPeerRefreshSummary({
        tone: 'error',
        message: 'Peer refresh failed before runtime state could be reloaded.',
        details: [formatError(err)],
      });
      throw err;
    }
  }

  async function handleRemoveProfile(profileId: string) {
    const profile = profiles.find((entry) => entry.id === profileId);
    const shouldDelete = await confirm(
      `Delete managed profile ${profile?.label ?? profileId} (${shortProfileId(profileId)})?`,
      {
      title: 'Delete Profile',
      kind: 'warning',
      },
    );
    if (!shouldDelete) {
      return;
    }
    await run('removing managed profile', async () => {
      if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id === profileId) {
        await stopSigner();
      }
      await removeProfile(profileId);
      await refreshProfiles(selectedProfileId === profileId ? null : selectedProfileId);
      await refreshRuntime(null);
    });
  }

  async function handleCopyProfilePackage(format: 'bfprofile' | 'bfshare') {
    if (!selectedProfileId) {
      throw new Error('select a profile first');
    }
    if (!packageDraft.packagePassword.trim()) {
      throw new Error('package password is required');
    }
    const result = await run(`exporting ${format}`, () =>
      exportProfilePackage({
        profileId: selectedProfileId,
        format,
        packagePassword: packageDraft.packagePassword,
        passphrase,
      }),
    );
    await navigator.clipboard.writeText(result.package);
    setNotice(`${format === 'bfprofile' ? 'profile' : 'share'} copied to clipboard.`);
  }

  async function handleSaveOperatorSettings() {
    if (!selectedProfileId || !selectedProfile) {
      throw new Error('select a profile first');
    }
    const relays = selectedRelayProfile?.relays ?? [];
    const updated = await run('saving profile settings', () =>
      updateProfileOperatorSettings({
        profileId: selectedProfileId,
        label: selectedProfile.label,
        relays,
        runtimeOptions: settingsDraft,
      }),
    );
    await refreshProfiles(updated.id);
    setNotice('Profile settings saved.');
  }

  async function handleToggleSetting(field: keyof AppSettings, checked: boolean) {
    await run('updating desktop settings', async () => {
      const next = await updateSettings({
        ...settings,
        [field]: checked,
      });
      setSettings(next);
    });
  }

  async function handleLogout() {
    await run('logging out', async () => {
      if (runtimeSnapshot?.active) {
        await stopSigner();
      }
      setPeerRefreshSummary(null);
      setRuntimeSnapshot(null);
      setSelectedProfileId('');
      setPassphrase('');
      setActiveDashboardTab('signer');
      setActiveView('landing');
      setNotice('Logged out.');
    });
  }

  return (
    <PageLayout maxWidth="max-w-6xl">
      <AppHeader
        title="Igloo Home"
        centered
        subtitle="Desktop operator workspace over the shell-managed FROSTR V2 backend."
      />

      {busy ? <div className="igloo-message-muted">Working: {busy}</div> : null}
      {error ? <div className="igloo-shell-alert">{error}</div> : null}
      {notice ? <div className="igloo-message-muted">{notice}</div> : null}

      {activeView === 'landing' ? (
        <ContentCard title="Welcome to Igloo" description="Choose one path to initialize this desktop workspace.">
          <section className="igloo-flow-root igloo-pwa-entry-shell">
            <div className="igloo-pwa-entry-intro">
              <p className="igloo-pwa-entry-lead">
                Create or rotate a keyset, load an existing profile, or finish onboarding a device from an accepted package.
              </p>
            </div>
            <StoredProfilesLandingCard
              profiles={profiles.map((profile) => ({
                id: profile.id,
                label: profile.label || 'Unnamed device',
                subtitle:
                  activeProfileId === profile.id
                    ? `${shortProfileId(profile.id)} · signer active`
                    : shortProfileId(profile.id),
                statusLabel: activeProfileId === profile.id ? 'Active' : 'Available',
                loadLabel: activeProfileId === profile.id ? 'Open Dashboard' : 'Load Profile',
              }))}
              description="Managed desktop profiles remain available while locked. Enter the passphrase below before loading one."
              selectedProfileId={selectedProfileId}
              onSelect={setSelectedProfileId}
              onLoad={(profileId) => void handleLoadLandingProfile(profileId)}
              onDelete={(profileId) => void handleRemoveProfile(profileId)}
              renderProfileDetail={(profile, isSelected) => (
                <div className="igloo-stack">
                  <label>
                    Passphrase
                    <input
                      type="password"
                      value={landingPassphrases[profile.id] ?? (isSelected ? passphrase : '')}
                      onFocus={() => setSelectedProfileId(profile.id)}
                      onChange={event => {
                        const value = event.target.value;
                        setLandingPassphrases((current) => ({ ...current, [profile.id]: value }));
                        if (isSelected) {
                          setPassphrase(value);
                        }
                      }}
                      placeholder="Required to unlock this desktop profile"
                    />
                  </label>
                  <p className="igloo-message-muted">
                    Use the shell passphrase for this desktop profile to unlock and start the signer session.
                  </p>
                </div>
              )}
            />
            <div className="igloo-pwa-entry-grid">
              <HostEntryTile
                kicker="Fresh setup"
                title="Create / Rotate Keyset"
                description="Generate new share material or rotate an existing keyset, save one local desktop device, and distribute the remaining shares."
                actionLabel="Start"
                tone="primary"
                onAction={() => setActiveView('create')}
                icon={<svg viewBox="0 0 24 24"><path d="M7 10a5 5 0 1 1 9.74 1.58L21 15v2h-2v2h-2v2h-3v-3.17a5 5 0 0 1-7-4.83Z" /><circle cx="10" cy="10" r="1.25" /></svg>}
              />
              <HostEntryTile
                kicker="Existing device"
                title="Load Profile"
                description="Import a full `bfprofile` package or recover a device from a protected `bfshare`."
                actionLabel="Load Profile"
                onAction={() => setActiveView('load')}
                icon={<svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 4.97 3.06 8.77 8 10 4.94-1.23 8-5.03 8-10V7l-8-4Z" /><path d="M12 8v6m0 0 3-3m-3 3-3-3" /></svg>}
              />
              <HostEntryTile
                kicker="Accepted invite"
                title="Onboard Device"
                description="Use a password-protected `bfonboard` package to complete native onboarding and save the resulting profile."
                actionLabel="Continue Onboarding"
                onAction={() => setActiveView('onboard-connect')}
                icon={<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6M9 12h6M12 16h.01" /></svg>}
              />
            </div>
          </section>
        </ContentCard>
      ) : null}

      {activeView === 'create' ? (
        <HostFlowShell
          title="Create / Rotate Keyset"
          description="Step through the same host workflow as the PWA, then save one managed desktop profile into the encrypted profile store."
          onBack={() => setActiveView('landing')}
          backTooltip="Back"
        >
          <div className="igloo-stack">
            <StepProgress steps={['Generate', 'Create profile', 'Review', 'Distribute']} active={generatedKeyset ? 1 : 0} />
            <section className="igloo-task-banner">
              <span className="igloo-task-kicker">Create or Rotate</span>
              <p>Provide the group name and threshold geometry, then create or rebuild the keyset before saving one local desktop device.</p>
              <div className="igloo-task-points">
                <span>The group name identifies the shared group and the shares issued from it.</span>
                <span>Rotation preserves the same group public key and issues fresh device shares.</span>
              </div>
            </section>
          </div>
          <CreatePage
            createForm={createForm}
            availableProfiles={profiles.map((profile) => ({ id: profile.id, label: profile.label }))}
            rotationSources={rotationSources}
            generatedKeyset={generatedKeyset}
            saveForms={saveForms}
            selectedMemberIdx={selectedGeneratedShareIdx}
            distributionForms={distributionForms}
            distributionResults={Object.fromEntries(
              Object.entries(distributionResults).map(([memberIdx, result]) => [
                Number(memberIdx),
                { kind: result.kind, label: result.label },
              ]),
            )}
            onChangeCreateForm={(field, value) => setCreateForm(current => ({ ...current, [field]: value }))}
            onChangeRotationSource={(index, field, value) =>
              setRotationSources((current) =>
                current.map((source, sourceIndex) =>
                  sourceIndex === index ? { ...source, [field]: value } : source,
                ),
              )
            }
            onAddRotationSource={() =>
              setRotationSources((current) => [...current, { packageText: '', packagePassword: '' }])
            }
            onRemoveRotationSource={(index) =>
              setRotationSources((current) => current.filter((_, sourceIndex) => sourceIndex !== index))
            }
            onGenerateFresh={() => void handleGenerate()}
            onChangeSaveForm={(memberIdx, field, value) =>
              setSaveForms(current => ({
                ...current,
                [memberIdx]: {
                  ...current[memberIdx],
                  [field]: value,
                },
              }))
            }
            onSaveGeneratedProfile={share => void handleSaveGeneratedProfile(share)}
            onChangeDistributionForm={(memberIdx, field, value) =>
              setDistributionForms((current) => ({
                ...current,
                [memberIdx]: {
                  ...(current[memberIdx] ?? { label: '', packagePassword: '', confirmPassword: '' }),
                  [field]: value,
                },
              }))
            }
            onDistributeShare={(memberIdx, kind) => void handleDistributeGeneratedShare(memberIdx, kind)}
            onFinishDistribution={handleFinishDistribution}
          />
          <QrPayloadModal
            open={Boolean(distributionQr)}
            onClose={() => setDistributionQr(null)}
            title="Onboarding Package QR"
            label={distributionQr?.label}
            payload={distributionQr?.packageText ?? ''}
          />
        </HostFlowShell>
      ) : null}

      {activeView === 'load' ? (
        <HostFlowShell
          title="Load Profile"
          description="Choose whether to import a full device profile or recover one from your protected share."
          onBack={() => setActiveView('landing')}
          backTooltip="Back"
        >
          <div className="igloo-flow-root igloo-stack">
            <StepProgress steps={['Import or recover', 'Load device']} active={0} />
            <section className="igloo-task-banner">
              <span className="igloo-task-kicker">Load a desktop device</span>
              <p>Import a protected `bfprofile` or recover from a protected `bfshare`, then save the resulting desktop profile into the local encrypted profile store.</p>
            </section>
            <div className="igloo-button-row">
              <Button
                type="button"
                size="sm"
                variant={loadMode === 'bfprofile' ? 'default' : 'secondary'}
                onClick={() => setLoadMode('bfprofile')}
              >
                Import bfprofile
              </Button>
              <Button
                type="button"
                size="sm"
                variant={loadMode === 'bfshare' ? 'default' : 'secondary'}
                onClick={() => setLoadMode('bfshare')}
              >
                Recover from bfshare
              </Button>
            </div>
            <label>
              Profile label
              <input
                value={loadForm.label}
                onChange={event => setLoadForm(current => ({ ...current, label: event.target.value }))}
                placeholder="Optional desktop label"
              />
            </label>
            <label>
              Passphrase
              <input
                type="password"
                value={loadForm.passphrase}
                onChange={event => setLoadForm(current => ({ ...current, passphrase: event.target.value }))}
                placeholder="Used for local managed storage"
              />
            </label>
            <label>
              Package password
              <input
                type="password"
                value={loadForm.packagePassword}
                onChange={event => setLoadForm(current => ({ ...current, packagePassword: event.target.value }))}
              />
            </label>
            <label>
              {loadMode}
              <Textarea
                className="min-h-[140px]"
                value={loadForm.packageText}
                onChange={event => setLoadForm(current => ({ ...current, packageText: event.target.value }))}
                placeholder={loadMode === 'bfprofile' ? 'Paste bfprofile1...' : 'Paste bfshare1...'}
              />
            </label>
            <div className="igloo-button-row">
              <Button type="button" size="sm" onClick={() => void handleLoadPackage()}>
                {loadMode === 'bfprofile' ? 'Import Profile' : 'Recover Profile'}
              </Button>
            </div>
          </div>
        </HostFlowShell>
      ) : null}

      {activeView === 'onboard-connect' ? (
        <HostFlowShell
          title="Onboard Device"
          description="Connect with a protected onboarding package, resolve the handshake, then review the device before saving it locally."
          onBack={() => setActiveView('landing')}
          backTooltip="Back"
        >
          <div className="igloo-flow-root igloo-stack">
            <StepProgress steps={['Connect with package', 'Save device']} active={0} />
            <section className="igloo-task-banner">
              <span className="igloo-task-kicker">Desktop onboarding</span>
              <p>The desktop host resolves the onboarding handshake first, then shows the same review-and-save step that the PWA uses before creating the managed profile.</p>
            </section>
            <label>
              Package password
              <input
                type="password"
                value={onboardConnectForm.password}
                onChange={event => setOnboardConnectForm(current => ({ ...current, password: event.target.value }))}
              />
            </label>
            <label>
              bfonboard
              <Textarea
                className="min-h-[160px]"
                value={onboardConnectForm.packageText}
                onChange={event => setOnboardConnectForm(current => ({ ...current, packageText: event.target.value }))}
                placeholder="Paste bfonboard1..."
              />
            </label>
            <div className="igloo-button-row">
              <Button type="button" size="sm" onClick={() => void handleConnectOnboardingPackage()}>
                Connect
              </Button>
            </div>
          </div>
        </HostFlowShell>
      ) : null}

      {activeView === 'onboard-save' && pendingOnboardConnection ? (
        <HostFlowShell
          title="Save Onboarded Device"
          description="Review the resolved profile details and choose the passphrase used to store this desktop device locally."
          onBack={() => void handleDiscardOnboardingConnection('onboard-connect')}
          backTooltip="Back to connect"
        >
          <div className="igloo-flow-root igloo-stack">
            <StepProgress steps={['Connect with package', 'Save device']} active={1} />
            <ProfileConfirmationCard
              title="Review Onboarded Profile"
              profileName={pendingOnboardConnection.preview.label}
              sharePublicKey={pendingOnboardConnection.preview.share_public_key}
              groupPublicKey={pendingOnboardConnection.preview.group_public_key}
              relays={pendingOnboardConnection.preview.relays}
            />
            <section className="igloo-task-banner">
              <span className="igloo-task-kicker">Handshake complete</span>
              <p>The onboarding package has been resolved. Confirm the device label and passphrase before saving this managed desktop profile.</p>
            </section>
            <label>
              Device label
              <input
                value={onboardSaveForm.label}
                onChange={event => setOnboardSaveForm(current => ({ ...current, label: event.target.value }))}
              />
            </label>
            <label>
              Passphrase
              <input
                type="password"
                value={onboardSaveForm.passphrase}
                onChange={event =>
                  setOnboardSaveForm(current => ({ ...current, passphrase: event.target.value }))
                }
              />
            </label>
            <label>
              Confirm passphrase
              <input
                type="password"
                value={onboardSaveForm.confirmPassphrase}
                onChange={event =>
                  setOnboardSaveForm(current => ({ ...current, confirmPassphrase: event.target.value }))
                }
              />
            </label>
            <div className="igloo-button-row">
              <Button type="button" size="sm" variant="secondary" onClick={() => void handleDiscardOnboardingConnection('onboard-connect')}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void handleFinalizeOnboardingProfile()}>
                Save Device
              </Button>
            </div>
          </div>
        </HostFlowShell>
      ) : null}

      {activeView === 'dashboard' ? (
        <HostFlowShell
          title={
            selectedProfile
              ? `Device Dashboard · ${selectedProfile.label} (${shortProfileId(selectedProfile.id)})`
              : 'Device Dashboard'
          }
          description="Desktop operator console for the selected managed signer profile."
          onBack={() => setActiveView('landing')}
          backTooltip="Back to landing"
        >
          <section className="igloo-flow-root igloo-stack">
            <OperatorDashboardTabs
              tabs={[
                { key: 'signer', label: 'Signer', description: 'runtime console' },
                { key: 'permissions', label: 'Permissions', description: 'peer policies' },
                { key: 'settings', label: 'Settings', description: 'operator controls' },
              ]}
              activeTab={activeDashboardTab}
              onChangeTab={value => setActiveDashboardTab(value as DashboardTab)}
            />

          {activeDashboardTab === 'signer' ? (
            <OperatorSignerPanel
              profile={
                selectedProfile
                  ? {
                      name: selectedProfile.label,
                      groupPublicKey:
                        typeof (runtimeSnapshot?.runtime_status as any)?.group_public_key === 'string'
                          ? (runtimeSnapshot?.runtime_status as any).group_public_key
                          : undefined,
                    }
                  : null
              }
              introMessage="The desktop signer runs through the shell-managed runtime. This dashboard mirrors the same operator workflow used by the PWA host."
              runtimeState={
                runtimeSnapshot?.active ? 'running' : busy === 'starting managed profile' ? 'connecting' : 'stopped'
              }
              runtimeControlLabel={runtimeSnapshot?.active ? 'Stop Signer' : 'Start Signer'}
              runtimeSummaryLabel={runtimeSnapshot?.active ? 'Signer Running' : 'Signer Stopped'}
              runtimeError={error}
              statusBanner={
                peerRefreshSummary ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      peerRefreshSummary.tone === 'success'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : peerRefreshSummary.tone === 'warning'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                          : 'border-red-500/30 bg-red-500/10 text-red-200'
                    }`}
                  >
                    <div>{peerRefreshSummary.message}</div>
                    {peerRefreshSummary.details.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                        {peerRefreshSummary.details.map((detail) => (
                          <li key={detail} className="break-all">
                            {detail}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null
              }
              onPrimaryAction={() =>
                void (runtimeSnapshot?.active ? handleStopProfileSession() : handleStartProfileSession())
              }
              primaryActionVariant={runtimeSnapshot?.active ? 'destructive' : 'success'}
              onRefreshPeers={() => void handleRefreshRuntimePeers()}
              refreshPeersDisabled={!selectedProfileId || !runtimeSnapshot?.active}
              peers={runtimePeers}
              pendingOperations={pendingOperations}
              logs={toLogEntries(runtimeSnapshot?.daemon_log_lines)}
            />
          ) : null}

          {activeDashboardTab === 'permissions' ? (
            <OperatorPermissionsPanel
              peerPermissions={[]}
              peerPermissionStates={peerPermissionStates}
              peerDescription="Live outbound and inbound peer policy state for the active desktop signer."
              onRefresh={() => void refreshRuntime(selectedProfileId || null)}
            />
          ) : null}

          {activeDashboardTab === 'settings' ? (
            <OperatorSettingsPanel
              hasProfile={Boolean(selectedProfile)}
              signerName={selectedProfile?.label ?? ''}
              onSignerNameChange={value =>
                setProfiles(current =>
                  current.map(profile => (profile.id === selectedProfileId ? { ...profile, label: value } : profile)),
                )
              }
              relays={selectedRelayProfile?.relays ?? []}
              newRelayUrl={relayDraft}
              onNewRelayUrlChange={setRelayDraft}
              onAddRelay={() => {
                if (!selectedRelayProfile || !relayDraft.trim()) return;
                setRelayProfiles(current =>
                  current.map(profile =>
                    profile.id === selectedRelayProfile.id
                      ? { ...profile, relays: [...profile.relays, relayDraft.trim()] }
                      : profile,
                  ),
                );
                setRelayDraft('');
              }}
              onRemoveRelay={relay =>
                selectedRelayProfile
                  ? setRelayProfiles(current =>
                      current.map(profile =>
                        profile.id === selectedRelayProfile.id
                          ? { ...profile, relays: profile.relays.filter(item => item !== relay) }
                          : profile,
                      ),
                    )
                  : undefined
              }
              signerSettings={settingsDraft}
              onSignerSettingNumberChange={(field, value) =>
                setSettingsDraft(current => ({
                  ...current,
                  [field]: Number(value) || current[field],
                }))
              }
              onPeerSelectionStrategyChange={value =>
                setSettingsDraft(current => ({ ...current, peer_selection_strategy: value }))
              }
              onSave={() => void handleSaveOperatorSettings()}
              maintenanceDescription="Desktop package export, share rotation, and session controls."
              maintenanceActions={[
                {
                  label: 'copy profile',
                  onClick: () => void handleCopyProfilePackage('bfprofile'),
                  variant: 'secondary',
                  disabled: !selectedProfileId,
                },
                {
                  label: 'copy share',
                  onClick: () => void handleCopyProfilePackage('bfshare'),
                  variant: 'secondary',
                  disabled: !selectedProfileId,
                },
                {
                  label: 'logout',
                  onClick: () => void handleLogout(),
                  variant: 'outline',
                  disabled: !selectedProfileId,
                },
              ]}
              extraSections={
                <>
                  <ContentCard title="Export Password" description="Used to protect copied profile and share packages.">
                    <label>
                      Package password
                      <input
                        type="password"
                        value={packageDraft.packagePassword}
                        onChange={event =>
                          setPackageDraft(current => ({ ...current, packagePassword: event.target.value }))
                        }
                      />
                    </label>
                  </ContentCard>
                  <ContentCard
                    title="rotate share"
                    description="Paste a rotated bfonboard package to replace the current device share in place while keeping this desktop profile context."
                  >
                    <div className="igloo-stack">
                      <label>
                        Onboarding password
                        <input
                          type="password"
                          value={rotationForm.onboardingPassword}
                          onChange={event =>
                            setRotationForm(current => ({
                              ...current,
                              onboardingPassword: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        bfonboard
                        <Textarea
                          className="min-h-[140px]"
                          placeholder="Paste bfonboard1..."
                          value={rotationForm.onboardingPackage}
                          onChange={event =>
                            setRotationForm(current => ({
                              ...current,
                              onboardingPackage: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="igloo-button-row">
                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleRotateKey()} disabled={!selectedProfileId}>
                          rotate share
                        </Button>
                      </div>
                    </div>
                  </ContentCard>
                  <DesktopSettingsExtras settings={settings} onToggle={(field, checked) => void handleToggleSetting(field, checked)} />
                </>
              }
            />
          ) : null}
          </section>
        </HostFlowShell>
      ) : null}
    </PageLayout>
  );
}
