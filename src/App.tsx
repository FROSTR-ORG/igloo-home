import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { shortProfileId } from '@/lib/profileIdentity';
import type {
  RuntimeOnboardingStatus,
  RuntimePeerStatus,
} from 'igloo-shared';
import {
  extractPeerPermissionStates,
  extractPendingApprovals,
  extractPendingOperations,
  extractRuntimePeers,
  parseRuntimeStatus,
} from '@/lib/runtime-status';
import {
  Alert,
  AppHeader,
  deriveDashboardState,
  OperatorSignerPanel,
  PageLayout,
  WelcomeDeleteModal,
  WelcomeUnlockModal,
  downloadText,
  type LogEntry,
  type OperatorSignerSettings,
  type SharedDistributionAction,
  type SharedDistributionResult,
  type SharedDistributionStatus,
  type SharedRecoverSource,
  type WelcomeReturningProfileModel,
} from 'igloo-ui';
import {
  buildPolicyDashboardView,
  buildSignerDashboardView,
} from '@/lib/dashboard-view';
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
  getProfileThreshold,
  profileRuntimeSnapshot,
  refreshRuntimePeers,
  recoverGroupKey,
  removeProfile,
  resolveApproval,
  resolveCloseRequest,
  startProfileSession,
  stopSigner,
  updatePeerPolicy,
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
  RecoveredGroupKey,
  RelayProfile,
  RuntimePeerRefreshResult,
  SignerLifecycleEvent,
  SignerLogEvent,
  SignerStatusEvent,
} from '@/lib/types';
import { installTestBridge } from '@/lib/testBridge';
import { resolveVisualScenario } from '@/test/visualMode';
import CreateWorkspacePage from '@/pages/CreateWorkspacePage';
import DashboardPage from '@/pages/DashboardPage';
import LandingPage from '@/pages/LandingPage';
import LoadProfilePage from '@/pages/LoadProfilePage';
import OnboardConnectPage from '@/pages/OnboardConnectPage';
import OnboardSavePage from '@/pages/OnboardSavePage';
import RecoverKeyPage from '@/pages/RecoverKeyPage';

type ViewKey =
  | 'landing'
  | 'create'
  | 'load'
  | 'recover-key'
  | 'onboard-connect'
  | 'onboard-save'
  | 'dashboard';
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
  status: SharedDistributionStatus;
  label: string;
  packageText: string;
  targetPeerPubkey: string;
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

const ACTIVE_RUNTIME_POLL_INTERVAL_MS = 2_000;

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

const iglooLogoSrc = '/igloo-paper-mark.png';

function formatWelcomeKey(value: string) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function deriveHomeReturningProfile(profile: ProfileManifest): WelcomeReturningProfileModel {
  return {
    id: profile.id,
    label: profile.label || 'My Desktop Key',
    // Home's ProfileManifest does not carry group_package_json / member_idx /
    // share_public_key at the manifest level — those live inside the encrypted
    // profile artifact. Pass empty strings so the meta row omits those fields
    // rather than showing placeholder dashes.
    thresholdLabel: '',
    memberLabel: '',
    publicKeyLabel: formatWelcomeKey(profile.id),
    canRotate: true,
    canRecover: true,
    canDelete: true,
  };
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

function deriveDistributionResults(
  results: Record<number, DistributionResult>,
  shares: GeneratedKeysetShare[],
  runtimeSnapshot: ProfileRuntimeSnapshot | null,
): Record<number, SharedDistributionResult> {
  const runtimeStatus = parseRuntimeStatus(runtimeSnapshot?.runtime_status ?? null);
  const runtimePeers = new Map(
    (runtimeStatus?.peers ?? [])
      .filter((peer): peer is RuntimePeerStatus => typeof peer?.pubkey === 'string')
      .map((peer) => [peer.pubkey.toLowerCase(), peer]),
  );
  const onboardingStatuses = new Map(
    (runtimeStatus?.onboarding_statuses ?? [])
      .filter((status): status is RuntimeOnboardingStatus => typeof status?.pubkey === 'string')
      .map((status) => [status.pubkey.toLowerCase(), status]),
  );

  return Object.fromEntries(
    Object.entries(results).map(([memberIdx, result]) => {
      const memberNumber = Number(memberIdx);
      const targetPeerPubkey =
        result.targetPeerPubkey?.toLowerCase() ??
        shares.find((share) => share.member_idx === memberNumber)?.share_public_key?.toLowerCase() ??
        '';
      const peer = targetPeerPubkey ? runtimePeers.get(targetPeerPubkey) : null;
      const onboarding = targetPeerPubkey ? onboardingStatuses.get(targetPeerPubkey) : null;

      // The result already carries a Paper status-lifecycle stage; promote it to
      // `onboarded` once the live runtime shows the peer online / handshake done
      // (fine-grained per-stage tracking stays deferred by the reconcile).
      const onboarded = Boolean(peer?.can_sign) || onboarding?.stage === 'handshake_completed';
      const status: SharedDistributionStatus = onboarded ? 'onboarded' : result.status;

      return [
        memberNumber,
        {
          status,
          label: result.label,
          packageText: result.packageText,
        } satisfies SharedDistributionResult,
      ];
    }),
  );
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

export default function App() {
  const visualScenario = useMemo(() => resolveVisualScenario(), []);
  useEffect(() => {
    // The test bridge calls Tauri `invoke()` at mount, which throws in a plain
    // browser. Skip it under a visual scenario so the frontend renders headlessly
    // (e.g. `make screenshot CLIENT=home`); all other Tauri calls are already
    // guarded by `if (visualScenario) return`.
    if (visualScenario) return;
    installTestBridge();
  }, [visualScenario]);

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
  const [welcomeUnlockProfileId, setWelcomeUnlockProfileId] = useState<string | null>(null);
  const [welcomeUnlockPassword, setWelcomeUnlockPassword] = useState('');
  const [welcomeUnlockError, setWelcomeUnlockError] = useState<string | null>(null);
  const [welcomeUnlockSubmitting, setWelcomeUnlockSubmitting] = useState(false);
  const [welcomeDeleteProfileId, setWelcomeDeleteProfileId] = useState<string | null>(null);
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
  const [loadForm, setLoadForm] = useState(
    visualScenario?.loadForm ?? {
      label: '',
      passphrase: '',
      packagePassword: '',
      packageText: '',
    },
  );
  // Recover the group secret key (nsec) from a threshold of shares: the selected
  // local profile contributes its own share (unlocked with the device
  // passphrase) plus the pasted bfshares. Fully local — no relay.
  const [recoverProfileId, setRecoverProfileId] = useState(visualScenario?.recoverProfileId ?? '');
  const [recoverDevicePassphrase, setRecoverDevicePassphrase] = useState(
    visualScenario?.recoverDevicePassphrase ?? '',
  );
  const [recoverSources, setRecoverSources] = useState<SharedRecoverSource[]>(
    visualScenario?.recoverSources ?? [{ packageText: '', packagePassword: '' }],
  );
  const [recoveredKey, setRecoveredKey] = useState<RecoveredGroupKey | null>(
    visualScenario?.recoveredKey ?? null,
  );
  // Recovery threshold for the selected profile (read from its plaintext group
  // package), driving an accurate "collected of threshold" meter.
  const [recoverThreshold, setRecoverThreshold] = useState<number | null>(
    visualScenario?.recoverThreshold ?? null,
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
  const pendingApprovals = useMemo(
    () => extractPendingApprovals(runtimeSnapshot, runtimePeers),
    [runtimeSnapshot, runtimePeers],
  );
  // Keyset identity (group/share keys + member index) is surfaced by the live
  // runtime status metadata, not the persisted profile manifest.
  const runtimeStatusSummary = useMemo(
    () => parseRuntimeStatus(runtimeSnapshot?.runtime_status ?? null),
    [runtimeSnapshot],
  );
  const runtimeMetadata = runtimeStatusSummary?.metadata ?? null;

  const welcomeUnlockProfileModel = useMemo(() => {
    const p = profiles.find((entry) => entry.id === welcomeUnlockProfileId);
    return p ? deriveHomeReturningProfile(p) : null;
  }, [profiles, welcomeUnlockProfileId]);
  const welcomeDeleteProfileModel = useMemo(() => {
    const p = profiles.find((entry) => entry.id === welcomeDeleteProfileId);
    return p ? deriveHomeReturningProfile(p) : null;
  }, [profiles, welcomeDeleteProfileId]);

  // request_id of a signing-failed banner the operator dismissed.
  const [dismissedSignFailureId, setDismissedSignFailureId] = useState<string | null>(null);
  // Set when starting the managed daemon fails (no runtime to query), so the
  // dashboard shows the full-panel load-failed screen. Cleared on success/stop.
  const [dashboardLoadError, setDashboardLoadError] = useState<{ message: string; at: number } | null>(null);
  const dashboardState = deriveDashboardState({
    active: Boolean(runtimeSnapshot?.active),
    status: runtimeStatusSummary,
    loadError: dashboardLoadError,
    dismissedSignFailureId,
  });

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

  // Clear the reconstructed key + recovery inputs whenever the operator leaves
  // the recover-key view, so the group nsec does not linger in app state.
  useEffect(() => {
    if (activeView !== 'recover-key') {
      setRecoveredKey(null);
      setRecoverDevicePassphrase('');
      setRecoverSources([{ packageText: '', packagePassword: '' }]);
    }
  }, [activeView]);

  // Clear the generated keyset + its secret-bearing form drafts whenever the
  // operator leaves the create view, so the group nsec / raw shares / chosen
  // passphrases do not linger in app state (mirrors the recover-key cleanup).
  useEffect(() => {
    if (activeView !== 'create') {
      setGeneratedKeyset(null);
      setSelectedGeneratedShareIdx(null);
      setSaveForms({});
      setDistributionForms({});
    }
  }, [activeView]);

  // Load the selected profile's recovery threshold (from its plaintext group
  // package) so the collected-shares meter is accurate.
  useEffect(() => {
    if (visualScenario) {
      return;
    }
    if (!recoverProfileId) {
      setRecoverThreshold(null);
      return;
    }
    let cancelled = false;
    void getProfileThreshold(recoverProfileId)
      .then((threshold) => {
        if (!cancelled) {
          setRecoverThreshold(threshold);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecoverThreshold(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [recoverProfileId, visualScenario]);

  useEffect(() => {
    if (visualScenario) {
      return;
    }
    const activeProfileId = runtimeSnapshot?.active ? runtimeSnapshot.profile?.id ?? null : null;
    if (!activeProfileId) {
      return;
    }

    let cancelled = false;

    const syncRuntime = async () => {
      try {
        const snapshot = await profileRuntimeSnapshot(activeProfileId);
        if (cancelled) {
          return;
        }
        setRuntimeSnapshot((current) => {
          if (!current?.active || current.profile?.id !== activeProfileId) {
            return current;
          }
          return snapshot;
        });
      } catch {
        // Ignore transient read failures while the runtime is stopping or being replaced.
      }
    };

    const interval = window.setInterval(() => {
      void syncRuntime();
    }, ACTIVE_RUNTIME_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [runtimeSnapshot?.active, runtimeSnapshot?.profile?.id, visualScenario]);

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
    if (createForm.mode === 'rotate' && !createForm.sourceProfileId) {
      throw new Error('select the source profile whose keyset you are rotating');
    }
    let generated: GeneratedKeyset;
    try {
      generated = await run(
        createForm.mode === 'rotate' ? 'rotating keyset' : 'generating keyset',
        () =>
          createForm.mode === 'rotate'
            ? createRotatedKeyset({
                threshold,
                count,
                sourceProfileId: createForm.sourceProfileId,
                sources: rotationSources.map((source) => ({
                  packageText: source.packageText,
                  packagePassword: source.packagePassword,
                })),
              })
            : createGeneratedKeyset(groupName, threshold, count),
      );
    } catch {
      return;
    }
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
    try {
      if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id !== profile.id) {
        await stopSigner();
      }
      const snapshot = await run('starting managed profile', () =>
        startProfileSession({
          profileId: profile.id,
          passphrase: draft.passphrase,
        }),
      );
      setPeerRefreshSummary(null);
      setRuntimeSnapshot(snapshot);
      setNotice('Local profile created. Distribute the remaining shares as bfonboard packages.');
    } catch (err) {
      setNotice(
        `Local profile created, but live onboarding tracking is paused until the signer starts: ${formatError(err)}`,
      );
    }
    setSelectedGeneratedShareIdx(share.member_idx);
    setActiveView('create');
  }

  async function handleDistributeGeneratedShare(memberIdx: number, action: SharedDistributionAction) {
    if (!generatedKeyset || selectedGeneratedShareIdx == null) {
      throw new Error('Save the local profile before distributing remaining shares.');
    }
    const existing = distributionResults[memberIdx];

    const writeResult = (next: DistributionResult | null) => {
      setDistributionResults((current) => {
        const updated = { ...current };
        if (next) {
          updated[memberIdx] = next;
        } else {
          delete updated[memberIdx];
        }
        return updated;
      });
      // Discarding the package also clears any QR still showing it.
      if (next == null && existing?.packageText) {
        setDistributionQr((qr) => (qr?.packageText === existing.packageText ? null : qr));
      }
    };

    // Status-only transitions that operate on the already-prepared package.
    if (action === 'mark') {
      if (!existing) throw new Error('Create the onboarding package before marking it delivered.');
      writeResult({ ...existing, status: 'delivered' });
      return;
    }
    if (action === 'revert') {
      if (!existing) throw new Error('No distributed share to revert.');
      writeResult({ ...existing, status: 'packaged' });
      return;
    }
    if (action === 'cancel') {
      writeResult(null);
      return;
    }

    if (action === 'prepare') {
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
      writeResult({
        status: 'packaged',
        label: distribution.label,
        packageText,
        targetPeerPubkey: targetShare.share_public_key,
      });
      return;
    }

    // copy / qr / save operate on the package built by `prepare`.
    if (!existing?.packageText) {
      throw new Error('Create the onboarding package before sharing it.');
    }
    if (action === 'copy') {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(existing.packageText);
      }
      return;
    }
    if (action === 'qr') {
      setDistributionQr({ label: existing.label, packageText: existing.packageText });
      return;
    }
    if (action === 'save') {
      downloadText(`${existing.label || `member-${memberIdx}`}-bfonboard.txt`, existing.packageText);
      writeResult({ ...existing, status: 'saved' });
      return;
    }
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
    // Surface validation failures in the error banner. These guards previously
    // threw before `run()`, so the rejection was swallowed by the fire-and-forget
    // `void handleFinalizeOnboardingProfile()` call site and the operator saw
    // nothing.
    if (!pendingOnboardConnection) {
      setError('connect an onboarding package first');
      return;
    }
    if (onboardSaveForm.passphrase !== onboardSaveForm.confirmPassphrase) {
      setError('passphrase confirmation does not match');
      return;
    }
    let result;
    try {
      result = await run('saving onboarded device', () =>
        finalizeConnectedOnboarding({
          label: onboardSaveForm.label || undefined,
          passphrase: onboardSaveForm.passphrase,
        }),
      );
    } catch {
      // run() already surfaced the failure in the error banner; swallow the
      // rejection so it doesn't leak out of the fire-and-forget `void` click
      // handler as an unhandled rejection.
      return;
    }
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
    // Restoring a lost device = importing its self-contained `bfprofile`. A bare
    // `bfshare` can no longer rebuild a device (it carries no group package).
    const result = await run('importing bfprofile', () =>
      importProfileFromBfprofile({
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

  function updateRecoverSource(index: number, field: 'packageText' | 'packagePassword', value: string) {
    setRecoverSources((current) =>
      current.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, [field]: value } : source,
      ),
    );
  }

  async function handleRecoverGroupKey() {
    if (!recoverProfileId) {
      throw new Error('select a local profile to supply the group package');
    }
    let recovered: RecoveredGroupKey;
    try {
      recovered = await run('recovering group key', () =>
        recoverGroupKey({
          profileId: recoverProfileId,
          devicePassphrase: recoverDevicePassphrase,
          sources: recoverSources.filter((source) => source.packageText.trim().length > 0),
        }),
      );
    } catch {
      return;
    }
    setRecoveredKey(recovered);
    setNotice('Group secret key recovered locally and masked until you reveal it. Move it to an encrypted store, then leave this screen to clear it.');
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

  async function handleStartProfileSession(
    profileId = selectedProfileId,
    sessionPassphrase = passphrase,
    nextView: ViewKey = 'dashboard',
    options: { rethrowStartFailure?: boolean } = {},
  ) {
    // Surface validation failures in the error banner rather than throwing into
    // the fire-and-forget `void handleStartProfileSession()` call sites (where
    // the rejection was swallowed and the operator saw nothing).
    if (!profileId) {
      setError('select a profile first');
      return;
    }
    if (!sessionPassphrase.trim()) {
      setError('passphrase is required');
      return;
    }
    if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id !== profileId) {
      await stopSigner();
    }
    let snapshot;
    try {
      snapshot = await run('starting managed profile', () =>
        startProfileSession({
          profileId,
          passphrase: sessionPassphrase,
        }),
      );
    } catch (err) {
      if (options.rethrowStartFailure) {
        throw err;
      }
      // The daemon never came up to be queried, so surface the failure as the
      // full-panel load-failed screen on the dashboard (Retry) in addition to
      // the transient error banner `run()` already set. The failure is fully
      // surfaced via state, so we don't rethrow — the fire-and-forget
      // onPrimaryAction call sites would otherwise leak an unhandled rejection.
      setDashboardLoadError({ message: formatError(err), at: Math.floor(Date.now() / 1000) });
      setActiveView('dashboard');
      setActiveDashboardTab('signer');
      return;
    }
    setDashboardLoadError(null);
    setPeerRefreshSummary(null);
    setRuntimeSnapshot(snapshot);
    setActiveView(nextView);
    if (nextView === 'dashboard') {
      setActiveDashboardTab('signer');
    }
  }

  function openWelcomeUnlock(profileId: string) {
    setWelcomeUnlockProfileId(profileId);
    setWelcomeUnlockPassword('');
    setWelcomeUnlockError(null);
    setWelcomeUnlockSubmitting(false);
  }

  function closeWelcomeUnlock() {
    setWelcomeUnlockProfileId(null);
    setWelcomeUnlockPassword('');
    setWelcomeUnlockError(null);
    setWelcomeUnlockSubmitting(false);
  }

  async function submitWelcomeUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!welcomeUnlockProfileId) return;
    try {
      setWelcomeUnlockSubmitting(true);
      setWelcomeUnlockError(null);
      await handleLoadLandingProfile(welcomeUnlockProfileId, welcomeUnlockPassword);
      closeWelcomeUnlock();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setWelcomeUnlockError(
        /incorrect passphrase/i.test(message)
          ? 'Incorrect password. Please try again.'
          : message || 'Could not unlock this device.',
      );
      setWelcomeUnlockSubmitting(false);
    }
  }

  function openWelcomeDelete(profileId: string) {
    setWelcomeDeleteProfileId(profileId);
  }

  function closeWelcomeDelete() {
    setWelcomeDeleteProfileId(null);
  }

  async function confirmWelcomeDelete() {
    if (!welcomeDeleteProfileId) return;
    const profileId = welcomeDeleteProfileId;
    setWelcomeDeleteProfileId(null);
    await run('removing managed profile', async () => {
      if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id === profileId) {
        await stopSigner();
      }
      await removeProfile(profileId);
      await refreshProfiles(selectedProfileId === profileId ? null : selectedProfileId);
      await refreshRuntime(null);
    });
  }

  async function handleLoadLandingProfile(profileId: string, providedPassphrase?: string) {
    setSelectedProfileId(profileId);
    if (runtimeSnapshot?.active && runtimeSnapshot.profile?.id === profileId) {
      setActiveView('dashboard');
      setActiveDashboardTab('signer');
      return;
    }
    const sessionPassphrase = providedPassphrase ?? passphrase;
    setPassphrase(sessionPassphrase);
    await handleStartProfileSession(profileId, sessionPassphrase, 'dashboard', {
      rethrowStartFailure: Boolean(providedPassphrase),
    });
  }

  async function handleStopProfileSession() {
    setPeerRefreshSummary(null);
    setDashboardLoadError(null);
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

  async function handleResolveApproval(requestId: string, approved: boolean) {
    if (!selectedProfileId || !runtimeSnapshot?.active) return;
    await run('resolving approval', () => resolveApproval(requestId, approved));
    await refreshRuntime(selectedProfileId);
  }

  async function handleAlwaysAllowApproval(requestId: string) {
    if (!selectedProfileId || !runtimeSnapshot?.active) return;
    const row = pendingApprovals.find((approval) => approval.id === requestId);
    if (!row) return;
    // Approve this request, then persist an Allow override so future requests
    // for this peer+method skip the queue.
    await run('allowing peer', async () => {
      await resolveApproval(requestId, true);
      await updatePeerPolicy(row.pubkey, 'respond', row.method, 'allow');
    });
    await refreshRuntime(selectedProfileId);
  }

  async function handlePeerPolicyChange(
    pubkey: string,
    direction: 'request' | 'respond',
    method: 'ping' | 'onboard' | 'sign' | 'ecdh',
    value: 'unset' | 'allow' | 'deny' | 'ask',
  ) {
    if (!selectedProfileId || !runtimeSnapshot?.active) return;
    await run('updating peer policy', () => updatePeerPolicy(pubkey, direction, method, value));
    await refreshRuntime(selectedProfileId);
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
        mode={activeView === 'dashboard' ? 'dashboard' : activeView === 'landing' ? 'welcome' : 'task'}
        logoSrc={iglooLogoSrc}
        taskLabel="Igloo Home"
        profileName={selectedProfile?.label}
      />

      <WelcomeUnlockModal
        open={Boolean(welcomeUnlockProfileId)}
        profile={welcomeUnlockProfileModel}
        password={welcomeUnlockPassword}
        error={welcomeUnlockError}
        submitting={welcomeUnlockSubmitting}
        onPasswordChange={(v) => { setWelcomeUnlockPassword(v); setWelcomeUnlockError(null); }}
        onSubmit={(e) => void submitWelcomeUnlock(e)}
        onClose={closeWelcomeUnlock}
      />
      <WelcomeDeleteModal
        open={Boolean(welcomeDeleteProfileId)}
        profile={welcomeDeleteProfileModel}
        onConfirm={() => void confirmWelcomeDelete()}
        onClose={closeWelcomeDelete}
      />
      {busy ? <div className="igloo-message-muted">Working: {busy}</div> : null}
      {/* Suppress the top-level banner when a start failure is showing as the
          full-panel load-failed screen (it carries the same message). */}
      {error && !dashboardLoadError ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <div className="igloo-message-muted">{notice}</div> : null}

      {activeView === 'landing' ? (
        <LandingPage
          logoSrc={iglooLogoSrc}
          profiles={profiles.map(deriveHomeReturningProfile)}
          onCreate={() => setActiveView('create')}
          onLoad={() => setActiveView('load')}
          onOnboard={() => setActiveView('onboard-connect')}
          onUnlock={openWelcomeUnlock}
          onRotate={(profileId) => {
            setSelectedProfileId(profileId);
            setCreateForm((prev) => ({ ...prev, mode: 'rotate', sourceProfileId: profileId }));
            setActiveView('create');
          }}
          onRecover={(profileId) => {
            setRecoveredKey(null);
            setRecoverProfileId(profileId);
            setActiveView('recover-key');
          }}
          onDelete={openWelcomeDelete}
        />
      ) : null}

      {activeView === 'create' ? (
        <CreateWorkspacePage
          createForm={createForm}
          availableProfiles={profiles.map((profile) => ({ id: profile.id, label: profile.label }))}
          rotationSources={rotationSources}
          generatedKeyset={generatedKeyset}
          saveForms={saveForms}
          selectedMemberIdx={selectedGeneratedShareIdx}
          distributionForms={distributionForms}
          distributionResults={deriveDistributionResults(
            distributionResults,
            generatedKeyset?.shares ?? [],
            runtimeSnapshot,
          )}
          distributionQr={distributionQr}
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
          onCloseDistributionQr={() => setDistributionQr(null)}
          onBack={() => setActiveView('landing')}
          distributionBeforeCards={selectedProfile ? (
            <>
              {!runtimeSnapshot?.active ? (
                <Alert tone="default">Live onboarding tracking is paused until the host signer is running.</Alert>
              ) : null}
              <OperatorSignerPanel
                view={buildSignerDashboardView({
                  profileName: selectedProfile.label,
                  groupPublicKey: runtimeMetadata?.group_public_key,
                  sharePublicKey: runtimeMetadata?.share_public_key,
                  memberIdx: runtimeMetadata?.member_idx,
                  running: Boolean(runtimeSnapshot?.active),
                  peers: runtimePeers,
                  pendingApprovals,
                  pendingOperations,
                  logLines: runtimeSnapshot?.daemon_log_lines,
                })}
                onApproveOnce={(id) => void handleResolveApproval(id, true)}
                onDenyApproval={(id) => void handleResolveApproval(id, false)}
                onAlwaysAllow={(id) => void handleAlwaysAllowApproval(id)}
                runtimeControlLabel={runtimeSnapshot?.active ? 'Stop Signer' : 'Start Signer'}
                onPrimaryAction={() =>
                  void (runtimeSnapshot?.active
                    ? handleStopProfileSession()
                    : handleStartProfileSession(
                        selectedProfile.id,
                        passphrase,
                        'create',
                      ))
                }
                primaryActionVariant={runtimeSnapshot?.active ? 'destructive' : 'success'}
                onRefreshPeers={() => void handleRefreshRuntimePeers()}
                refreshPeersDisabled={!selectedProfileId || !runtimeSnapshot?.active}
              />
            </>
          ) : null}
        />
      ) : null}

      {activeView === 'load' ? (
        <LoadProfilePage
          loadForm={loadForm}
          onChange={(field, value) => setLoadForm(current => ({ ...current, [field]: value }))}
          onImport={() => void handleLoadPackage()}
          onBack={() => setActiveView('landing')}
        />
      ) : null}

      {activeView === 'recover-key' ? (
        <RecoverKeyPage
          profiles={profiles}
          recoverProfileId={recoverProfileId}
          recoverDevicePassphrase={recoverDevicePassphrase}
          recoverSources={recoverSources}
          recoverThreshold={recoverThreshold}
          recoveredKey={recoveredKey}
          onChangeProfileId={setRecoverProfileId}
          onChangeDevicePassphrase={setRecoverDevicePassphrase}
          onChangeSource={updateRecoverSource}
          onAddSource={() => setRecoverSources(current => [...current, { packageText: '', packagePassword: '' }])}
          onRemoveSource={index => setRecoverSources(current => current.filter((_, sourceIndex) => sourceIndex !== index))}
          onRecover={() => void handleRecoverGroupKey()}
          onBack={() => setActiveView('landing')}
        />
      ) : null}

      {activeView === 'onboard-connect' ? (
        <OnboardConnectPage
          form={onboardConnectForm}
          onChange={(field, value) => setOnboardConnectForm(current => ({ ...current, [field]: value }))}
          onConnect={() => void handleConnectOnboardingPackage()}
          onBack={() => setActiveView('landing')}
        />
      ) : null}

      {activeView === 'onboard-save' && pendingOnboardConnection ? (
        <OnboardSavePage
          connection={pendingOnboardConnection}
          form={onboardSaveForm}
          onChange={(field, value) => setOnboardSaveForm(current => ({ ...current, [field]: value }))}
          onCancel={() => void handleDiscardOnboardingConnection('onboard-connect')}
          onSave={() => void handleFinalizeOnboardingProfile()}
        />
      ) : null}

      {activeView === 'dashboard' ? (
        <DashboardPage
          selectedProfile={selectedProfile}
          selectedProfileId={selectedProfileId}
          selectedRelayProfile={selectedRelayProfile}
          activeDashboardTab={activeDashboardTab}
          runtimeActive={Boolean(runtimeSnapshot?.active)}
          runtimeMetadata={runtimeMetadata}
          runtimeLogLines={runtimeSnapshot?.daemon_log_lines}
          dashboardState={dashboardState}
          runtimePeers={runtimePeers}
          peerPermissionStates={peerPermissionStates}
          pendingApprovals={pendingApprovals}
          pendingOperations={pendingOperations}
          peerRefreshSummary={peerRefreshSummary}
          settings={settings}
          settingsDraft={settingsDraft}
          relayDraft={relayDraft}
          packageDraft={packageDraft}
          rotationForm={rotationForm}
          onBack={() => setActiveView('landing')}
          onChangeTab={setActiveDashboardTab}
          onDismissSignFailure={setDismissedSignFailureId}
          onRetryLoad={() => void handleStartProfileSession()}
          onApproveOnce={(id) => void handleResolveApproval(id, true)}
          onDenyApproval={(id) => void handleResolveApproval(id, false)}
          onAlwaysAllow={(id) => void handleAlwaysAllowApproval(id)}
          onRuntimePrimaryAction={() =>
            void (runtimeSnapshot?.active ? handleStopProfileSession() : handleStartProfileSession())
          }
          onRefreshPeers={() => void handleRefreshRuntimePeers()}
          onRefreshPermissions={() => void refreshRuntime(selectedProfileId || null)}
          onPeerPolicyChange={(pubkey, direction, method, value) =>
            void handlePeerPolicyChange(pubkey, direction, method, value)
          }
          onSignerNameChange={value =>
            setProfiles(current =>
              current.map(profile => (profile.id === selectedProfileId ? { ...profile, label: value } : profile)),
            )
          }
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
          onRemoveRelay={relay => {
            if (!selectedRelayProfile) return;
            setRelayProfiles(current =>
              current.map(profile =>
                profile.id === selectedRelayProfile.id
                  ? { ...profile, relays: profile.relays.filter(item => item !== relay) }
                  : profile,
              ),
            );
          }}
          onSignerSettingNumberChange={(field, value) =>
            setSettingsDraft(current => ({
              ...current,
              [field]: Number(value) || current[field],
            }))
          }
          onPeerSelectionStrategyChange={value =>
            setSettingsDraft(current => ({ ...current, peer_selection_strategy: value }))
          }
          onSaveSettings={() => void handleSaveOperatorSettings()}
          onCopyProfilePackage={(format) => void handleCopyProfilePackage(format)}
          onLogout={() => void handleLogout()}
          onPackagePasswordChange={(value) => setPackageDraft(current => ({ ...current, packagePassword: value }))}
          onRotationFormChange={(field, value) => setRotationForm(current => ({ ...current, [field]: value }))}
          onRotateKey={() => void handleRotateKey()}
          onToggleSetting={(field, checked) => void handleToggleSetting(field, checked)}
        />
      ) : null}
    </PageLayout>
  );
}
