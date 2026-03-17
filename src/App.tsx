import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import { shortProfileId } from '@/lib/profileIdentity';
import {
  AppHeader,
  Button,
  ContentCard,
  ManagedProfilesPanel,
  OperatorDashboardTabs,
  OperatorPermissionsPanel,
  type OperatorPeerPermissionState,
  type OperatorPendingOperation,
  OperatorSettingsPanel,
  OperatorSignerPanel,
  PageLayout,
  Textarea,
  type LogEntry,
  type OperatorSignerSettings,
  type PeerPolicy,
} from 'igloo-ui';
import {
  createGeneratedKeyset,
  createImportedKeyset,
  exportProfile,
  exportProfilePackage,
  getSettings,
  importProfileFromBfprofile,
  importProfileFromOnboarding,
  importProfileFromRaw,
  listProfiles,
  listRelayProfiles,
  profileRuntimeSnapshot,
  publishProfileBackup,
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
  CloseRequestEvent,
  GeneratedKeyset,
  GeneratedKeysetShare,
  ProfileImportResult,
  ProfileManifest,
  ProfileRuntimeSnapshot,
  RelayProfile,
  SignerLifecycleEvent,
  SignerLogEvent,
  SignerStatusEvent,
} from '@/lib/types';
import { installTestBridge } from '@/lib/testBridge';
import { resolveVisualScenario } from '@/test/visualMode';
import CreatePage from '@/pages/CreatePage';
import SharesPage from '@/pages/SharesPage';

type ViewKey = 'landing' | 'create' | 'load' | 'onboard' | 'inventory' | 'dashboard';
type DashboardTab = 'signer' | 'permissions' | 'settings';

type SaveDraft = {
  label: string;
  vaultPassphrase: string;
  relayUrls: string;
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

function splitTextarea(value: string) {
  return value
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
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

function LandingIcon({ children }: { children: React.ReactNode }) {
  return <div className="igloo-pwa-entry-icon" aria-hidden="true">{children}</div>;
}

function EntryTile({
  kicker,
  title,
  description,
  actionLabel,
  tone = 'secondary',
  icon,
  onAction,
}: {
  kicker: string;
  title: string;
  description: string;
  actionLabel: string;
  tone?: 'primary' | 'secondary';
  icon: React.ReactNode;
  onAction: () => void;
}) {
  return (
    <section className={`igloo-panel igloo-pwa-entry-tile ${tone === 'primary' ? 'is-primary' : ''}`}>
      <div className="igloo-pwa-entry-head">
        <LandingIcon>{icon}</LandingIcon>
        <div className="igloo-pwa-entry-copy">
          <span className="igloo-pwa-entry-kicker">{kicker}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <Button type="button" size="sm" variant={tone === 'primary' ? 'default' : 'secondary'} onClick={onAction}>
        {actionLabel}
      </Button>
    </section>
  );
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
  const [vaultPassphrase, setVaultPassphrase] = useState(visualScenario?.vaultPassphrase ?? '');
  const [generatedKeyset, setGeneratedKeyset] = useState<GeneratedKeyset | null>(visualScenario?.generatedKeyset ?? null);
  const [createForm, setCreateForm] = useState(
    visualScenario?.createForm ?? { threshold: '2', count: '3', nsec: '' },
  );
  const [saveForms, setSaveForms] = useState<Record<number, SaveDraft>>(visualScenario?.saveForms ?? {});
  const [importForm, setImportForm] = useState(
    visualScenario?.importForm ?? {
      label: '',
      vaultPassphrase: '',
      relayUrls: '',
      groupPackageJson: '',
      sharePackageJson: '',
    },
  );
  const [onboardingForm, setOnboardingForm] = useState(
    visualScenario?.onboardingForm ?? {
      packageText: '',
      password: '',
      vaultPassphrase: '',
      label: '',
    },
  );
  const [loadMode, setLoadMode] = useState<'bfprofile' | 'bfshare'>(visualScenario?.loadMode ?? 'bfprofile');
  const [loadForm, setLoadForm] = useState(
    visualScenario?.loadForm ?? {
      label: '',
      vaultPassphrase: '',
      packagePassword: '',
      packageText: '',
    },
  );
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ProfileRuntimeSnapshot | null>(
    visualScenario?.runtimeSnapshot ?? null,
  );
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
  }, [selectedProfileId, selectedProfile]);

  async function run<T>(label: string, task: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      return await task();
    } catch (err) {
      const message = String(err);
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
      if (!nextProfiles.length) return 'landing';
      return current === 'landing' ? 'inventory' : current;
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
      setActiveView(nextProfiles.length ? 'inventory' : 'landing');
      setRuntimeSnapshot(await profileRuntimeSnapshot(firstProfileId || null));
    } catch (err) {
      setError(String(err));
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
            view === 'inventory' ||
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

  async function handleGenerate(imported = false) {
    const threshold = Number(createForm.threshold);
    const count = Number(createForm.count);
    const generated = await run(imported ? 'generating imported keyset' : 'generating keyset', () =>
      imported
        ? createImportedKeyset(threshold, count, createForm.nsec.trim())
        : createGeneratedKeyset(threshold, count),
    );
    setGeneratedKeyset(generated);
    setSaveForms(
      Object.fromEntries(
        generated.shares.map(share => [
          share.member_idx,
          {
            label: share.name,
            vaultPassphrase: '',
            relayUrls: '',
          },
        ]),
      ),
    );
  }

  async function handleSaveGeneratedProfile(share: GeneratedKeysetShare) {
    const draft = saveForms[share.member_idx];
    if (!draft?.label || !draft.vaultPassphrase) {
      throw new Error('profile label and vault passphrase are required');
    }
    const result = await run('importing generated profile', () =>
      importProfileFromRaw({
        label: draft.label,
        relayUrls: splitTextarea(draft.relayUrls),
        vaultPassphrase: draft.vaultPassphrase,
        groupPackageJson: generatedKeyset?.group_package_json ?? '',
        sharePackageJson: share.share_package_json,
      }),
    );
    const profile = unwrapImportedProfile(result);
    setVaultPassphrase(draft.vaultPassphrase);
    await refreshProfiles(profile.id);
    setSelectedProfileId(profile.id);
    setActiveView('dashboard');
  }

  async function handleImportRawProfile() {
    const result = await run('importing raw profile', () =>
      importProfileFromRaw({
        label: importForm.label || undefined,
        relayUrls: splitTextarea(importForm.relayUrls),
        vaultPassphrase: importForm.vaultPassphrase,
        groupPackageJson: importForm.groupPackageJson,
        sharePackageJson: importForm.sharePackageJson,
      }),
    );
    const profile = unwrapImportedProfile(result);
    setVaultPassphrase(importForm.vaultPassphrase);
    await refreshProfiles(profile.id);
    setActiveView('dashboard');
  }

  async function handleOnboardProfile() {
    const result = await run('onboarding managed profile', () =>
      importProfileFromOnboarding({
        label: onboardingForm.label || undefined,
        vaultPassphrase: onboardingForm.vaultPassphrase,
        onboardingPassword: onboardingForm.password,
        package: onboardingForm.packageText,
      }),
    );
    const profile = unwrapImportedProfile(result);
    setVaultPassphrase(onboardingForm.vaultPassphrase);
    await refreshProfiles(profile.id);
    setSelectedProfileId(profile.id);
    setActiveView('dashboard');
  }

  async function handleLoadPackage() {
    const result = await run(
      loadMode === 'bfprofile' ? 'importing bfprofile' : 'recovering bfshare',
      () =>
        loadMode === 'bfprofile'
          ? importProfileFromBfprofile({
              label: loadForm.label || undefined,
              vaultPassphrase: loadForm.vaultPassphrase,
              packagePassword: loadForm.packagePassword,
              packageText: loadForm.packageText,
            })
          : recoverProfileFromBfshare({
              label: loadForm.label || undefined,
              vaultPassphrase: loadForm.vaultPassphrase,
              packagePassword: loadForm.packagePassword,
              packageText: loadForm.packageText,
            }),
    );
    const profile = unwrapImportedProfile(result);
    setVaultPassphrase(loadForm.vaultPassphrase);
    await refreshProfiles(profile.id);
    setSelectedProfileId(profile.id);
    setActiveView('dashboard');
  }

  async function handleStartProfileSession(profileId = selectedProfileId) {
    if (!profileId) {
      throw new Error('select a profile first');
    }
    if (!vaultPassphrase.trim()) {
      throw new Error('vault passphrase is required');
    }
    if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id !== profileId) {
      await stopSigner();
    }
    const snapshot = await run('starting managed profile', () =>
      startProfileSession({
        profileId,
        vaultPassphrase,
      }),
    );
    setRuntimeSnapshot(snapshot);
    setActiveView('dashboard');
    setActiveDashboardTab('signer');
  }

  async function handleStopProfileSession() {
    await run('stopping managed profile', async () => {
      await stopSigner();
      await refreshRuntime(selectedProfileId || null);
    });
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

  async function handleExportRawProfile(profileId: string) {
    const destinationDir = await open({ directory: true, multiple: false });
    if (!destinationDir || Array.isArray(destinationDir)) {
      return;
    }
    await run('exporting managed profile', () =>
      exportProfile({
        profileId,
        destinationDir,
        vaultPassphrase,
      }),
    );
    setNotice('Raw profile export completed.');
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
        vaultPassphrase,
      }),
    );
    await navigator.clipboard.writeText(result.package);
    setNotice(`${format} copied to clipboard.`);
  }

  async function handlePublishBackup() {
    if (!selectedProfileId) {
      throw new Error('select a profile first');
    }
    const result = await run('publishing encrypted backup', () =>
      publishProfileBackup({
        profileId: selectedProfileId,
        vaultPassphrase,
      }),
    );
    setNotice(`Backup published to ${result.relays.length} relay(s).`);
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

  async function handleResetWorkspace() {
    const shouldReset = await confirm(
      'Delete every managed profile and clear the active runtime? This returns the desktop app to the landing screen.',
      { title: 'Reset Workspace', kind: 'warning' },
    );
    if (!shouldReset) {
      return;
    }
    await run('resetting workspace', async () => {
      if (runtimeSnapshot?.active) {
        await stopSigner();
      }
      for (const profile of profiles) {
        await removeProfile(profile.id);
      }
      setSelectedProfileId('');
      setRuntimeSnapshot(null);
      await refreshProfiles(null);
      setActiveView('landing');
      setNotice('Workspace reset.');
    });
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

  const headerActions = profiles.length ? (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setActiveView('inventory')}>
        Profiles
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setActiveView('create')}>
        Create Keyset
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setActiveView('load')}>
        Load Profile
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setActiveView('onboard')}>
        Onboard Device
      </Button>
      {selectedProfile ? (
        <Button type="button" size="sm" onClick={() => setActiveView('dashboard')}>
          Open Dashboard
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <PageLayout>
      <AppHeader
        title="igloo"
        subtitle="Desktop multi-profile operator over the shell-managed FROSTR V2 backend."
        right={headerActions}
      />

      {busy ? <div className="igloo-message-muted">Working: {busy}</div> : null}
      {error ? <div className="igloo-shell-alert">{error}</div> : null}
      {notice ? <div className="igloo-message-muted">{notice}</div> : null}

      {activeView === 'landing' ? (
        <ContentCard title="Welcome to Igloo Home" description="Choose how to initialize this desktop workspace.">
          <section className="igloo-flow-root igloo-pwa-entry-shell">
            <div className="igloo-pwa-entry-intro">
              <p className="igloo-pwa-entry-lead">
                Create a new keyset, load an encrypted device profile, or onboard a new device from a protected package.
              </p>
            </div>
            <div className="igloo-pwa-entry-grid">
              <EntryTile
                kicker="Fresh setup"
                title="Create Keyset"
                description="Generate new share material and save one managed desktop profile into the shell store."
                actionLabel="Start Creating"
                tone="primary"
                onAction={() => setActiveView('create')}
                icon={<svg viewBox="0 0 24 24"><path d="M7 10a5 5 0 1 1 9.74 1.58L21 15v2h-2v2h-2v2h-3v-3.17a5 5 0 0 1-7-4.83Z" /><circle cx="10" cy="10" r="1.25" /></svg>}
              />
              <EntryTile
                kicker="Existing device"
                title="Load Profile"
                description="Import a full `bfprofile` package or recover a device from a protected `bfshare`."
                actionLabel="Load Profile"
                onAction={() => setActiveView('load')}
                icon={<svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 4.97 3.06 8.77 8 10 4.94-1.23 8-5.03 8-10V7l-8-4Z" /><path d="M12 8v6m0 0 3-3m-3 3-3-3" /></svg>}
              />
              <EntryTile
                kicker="Accepted invite"
                title="Onboard Device"
                description="Use a password-protected `bfonboard` package to complete native onboarding and save the resulting profile."
                actionLabel="Continue Onboarding"
                onAction={() => setActiveView('onboard')}
                icon={<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6M9 12h6M12 16h.01" /></svg>}
              />
            </div>
          </section>
        </ContentCard>
      ) : null}

      {activeView === 'create' ? (
        <ContentCard
          title="Create Keyset"
          description="Generate key material and save one managed desktop profile into the shell-managed vault."
          onBack={() => setActiveView(profiles.length ? 'inventory' : 'landing')}
          backButtonTooltip="Back"
        >
          <CreatePage
            createForm={createForm}
            importForm={importForm}
            onboardingForm={onboardingForm}
            generatedKeyset={generatedKeyset}
            saveForms={saveForms}
            onChangeCreateForm={(field, value) => setCreateForm(current => ({ ...current, [field]: value }))}
            onGenerateFresh={() => void handleGenerate(false)}
            onGenerateImported={() => void handleGenerate(true)}
            onChangeImportForm={(field, value) => setImportForm(current => ({ ...current, [field]: value }))}
            onChangeOnboardingForm={(field, value) => setOnboardingForm(current => ({ ...current, [field]: value }))}
            onImportOnboardingProfile={() => void handleOnboardProfile()}
            onImportRawProfile={() => void handleImportRawProfile()}
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
          />
        </ContentCard>
      ) : null}

      {activeView === 'load' ? (
        <ContentCard
          title="Load Profile"
          description="Import a protected `bfprofile` or recover a desktop profile from `bfshare + kind:10000`."
          onBack={() => setActiveView(profiles.length ? 'inventory' : 'landing')}
          backButtonTooltip="Back"
        >
          <div className="igloo-flow-root igloo-stack">
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
              Vault passphrase
              <input
                type="password"
                value={loadForm.vaultPassphrase}
                onChange={event => setLoadForm(current => ({ ...current, vaultPassphrase: event.target.value }))}
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
        </ContentCard>
      ) : null}

      {activeView === 'onboard' ? (
        <ContentCard
          title="Onboard Device"
          description="Import a protected onboarding package and save the resulting native desktop profile."
          onBack={() => setActiveView(profiles.length ? 'inventory' : 'landing')}
          backButtonTooltip="Back"
        >
          <div className="igloo-flow-root igloo-stack">
            <label>
              Device label
              <input
                value={onboardingForm.label}
                onChange={event => setOnboardingForm(current => ({ ...current, label: event.target.value }))}
              />
            </label>
            <label>
              Vault passphrase
              <input
                type="password"
                value={onboardingForm.vaultPassphrase}
                onChange={event =>
                  setOnboardingForm(current => ({ ...current, vaultPassphrase: event.target.value }))
                }
              />
            </label>
            <label>
              Package password
              <input
                type="password"
                value={onboardingForm.password}
                onChange={event => setOnboardingForm(current => ({ ...current, password: event.target.value }))}
              />
            </label>
            <label>
              bfonboard
              <Textarea
                className="min-h-[160px]"
                value={onboardingForm.packageText}
                onChange={event => setOnboardingForm(current => ({ ...current, packageText: event.target.value }))}
                placeholder="Paste bfonboard1..."
              />
            </label>
            <div className="igloo-button-row">
              <Button type="button" size="sm" onClick={() => void handleOnboardProfile()}>
                Onboard Device
              </Button>
            </div>
          </div>
        </ContentCard>
      ) : null}

      {activeView === 'inventory' ? (
        <ContentCard
          title="Managed Profiles"
          description="Desktop inventory for all shell-managed profiles. Select one and open the operator dashboard."
        >
          <div className="igloo-button-row">
            <Button type="button" size="sm" onClick={() => setActiveView('create')}>
              Create Keyset
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setActiveView('load')}>
              Load Profile
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setActiveView('onboard')}>
              Onboard Device
            </Button>
          </div>
          <SharesPage
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            activeProfileId={activeProfileId}
            selectedProfile={selectedProfile}
            vaultPassphrase={vaultPassphrase}
            onSelectProfile={setSelectedProfileId}
            onOpenSigner={profileId => {
              setSelectedProfileId(profileId);
              setActiveView('dashboard');
              setActiveDashboardTab('signer');
            }}
            onActivateProfile={profileId => void handleStartProfileSession(profileId)}
            onStopActiveProfile={() => void handleStopProfileSession()}
            onChangeVaultPassphrase={setVaultPassphrase}
            onDelete={profileId => void handleRemoveProfile(profileId)}
            onExport={profileId => void handleExportRawProfile(profileId)}
            onRefresh={() => void refreshProfiles(selectedProfileId)}
          />
        </ContentCard>
      ) : null}

      {activeView === 'dashboard' ? (
        <section className="igloo-flow-root igloo-stack">
          <ContentCard
            title={
              selectedProfile
                ? `${selectedProfile.label} (${shortProfileId(selectedProfile.id)})`
                : 'Operator Dashboard'
            }
            description="Shared operator controls for the selected managed desktop profile."
            onBack={() => setActiveView('inventory')}
            backButtonTooltip="Back to profiles"
          >
            <OperatorDashboardTabs
              tabs={[
                { key: 'signer', label: 'Signer', description: 'Runtime, peers, and diagnostics' },
                { key: 'permissions', label: 'Permissions', description: 'Peer policy state' },
                { key: 'settings', label: 'Settings', description: 'Profile, relay, and desktop controls' },
              ]}
              activeTab={activeDashboardTab}
              onChangeTab={value => setActiveDashboardTab(value as DashboardTab)}
            />
          </ContentCard>

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
              introMessage="Operate the active native signer session for the selected shell-managed profile."
              runtimeState={
                runtimeSnapshot?.active ? 'running' : busy === 'starting managed profile' ? 'connecting' : 'stopped'
              }
              runtimeControlLabel={runtimeSnapshot?.active ? 'Stop Signer' : 'Start Signer'}
              runtimeSummaryLabel={runtimeSnapshot?.active ? 'Signer Running' : 'Signer Stopped'}
              runtimeError={error}
              onPrimaryAction={() =>
                void (runtimeSnapshot?.active ? handleStopProfileSession() : handleStartProfileSession())
              }
              primaryActionVariant={runtimeSnapshot?.active ? 'destructive' : 'success'}
              onRefreshPeers={() => void refreshRuntime(selectedProfileId || null)}
              refreshPeersDisabled={!selectedProfileId}
              peers={runtimePeers}
              pendingOperations={pendingOperations}
              logs={toLogEntries(runtimeSnapshot?.daemon_log_lines)}
            />
          ) : null}

          {activeDashboardTab === 'permissions' ? (
            <OperatorPermissionsPanel
              peerPermissions={[]}
              peerPermissionStates={peerPermissionStates}
              peerDescription="Peer policy state persisted for the selected managed profile."
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
              maintenanceDescription="Desktop operator actions for package export, backup publication, and full workspace reset."
              maintenanceActions={[
                {
                  label: 'Copy bfprofile',
                  onClick: () => void handleCopyProfilePackage('bfprofile'),
                  variant: 'secondary',
                  disabled: !selectedProfileId,
                },
                {
                  label: 'Copy bfshare',
                  onClick: () => void handleCopyProfilePackage('bfshare'),
                  variant: 'secondary',
                  disabled: !selectedProfileId,
                },
                {
                  label: 'Publish Backup',
                  onClick: () => void handlePublishBackup(),
                  variant: 'secondary',
                  disabled: !selectedProfileId,
                },
                {
                  label: 'Delete Profile',
                  onClick: () => selectedProfileId && void handleRemoveProfile(selectedProfileId),
                  variant: 'destructive',
                  disabled: !selectedProfileId,
                },
                {
                  label: 'Reset Workspace',
                  onClick: () => void handleResetWorkspace(),
                  variant: 'destructive',
                },
              ]}
              extraSections={
                <>
                  <ContentCard title="Package Export Password" description="Used to protect copied bfprofile and bfshare packages.">
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
                  <DesktopSettingsExtras settings={settings} onToggle={(field, checked) => void handleToggleSetting(field, checked)} />
                </>
              }
            />
          ) : null}
        </section>
      ) : null}
    </PageLayout>
  );
}
