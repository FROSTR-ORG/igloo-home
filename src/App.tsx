import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import {
  appPaths,
  createGeneratedKeyset,
  createImportedKeyset,
  exportProfile,
  getSettings,
  importProfileFromOnboarding,
  importProfileFromRaw,
  listProfiles,
  profileRuntimeSnapshot,
  recoverNsec,
  removeProfile,
  resolveCloseRequest,
  startProfileSession,
  stopSigner,
  updateSettings,
} from '@/lib/api';
import {
  EVENT_APP_CLOSE_REQUESTED,
  EVENT_APP_SETTINGS,
  EVENT_SIGNER_LIFECYCLE,
  EVENT_SIGNER_LOG,
  EVENT_SIGNER_POLICIES,
  EVENT_SIGNER_STATUS,
} from '@/lib/events';
import type {
  AppPathsResponse,
  AppSettings,
  AppSettingsEvent,
  CloseRequestEvent,
  GeneratedKeyset,
  GeneratedKeysetShare,
  ProfileImportResult,
  ProfileManifest,
  ProfileRuntimeSnapshot,
  RecoveredKey,
  SignerLifecycleEvent,
  SignerLogEvent,
  SignerPoliciesEvent,
  SignerStatusEvent,
} from '@/lib/types';
import { installTestBridge } from '@/lib/testBridge';
import CreatePage from '@/pages/CreatePage';
import RecoverPage from '@/pages/RecoverPage';
import SettingsPage from '@/pages/SettingsPage';
import SharesPage from '@/pages/SharesPage';
import SignerPage from '@/pages/SignerPage';

type TabKey = 'shares' | 'create' | 'signer' | 'recover' | 'settings';

type SaveDraft = {
  label: string;
  vaultPassphrase: string;
  relayUrls: string;
};

const tabs: { key: TabKey; label: string; detail: string }[] = [
  { key: 'shares', label: 'Profiles', detail: 'Inventory, export, and remove' },
  { key: 'create', label: 'Create / Import', detail: 'Create keysets and import managed profiles' },
  { key: 'signer', label: 'Signer', detail: 'Run the selected managed profile' },
  { key: 'recover', label: 'Recover', detail: 'Reconstruct an nsec from threshold shares' },
  { key: 'settings', label: 'Settings', detail: 'Tray, startup, and restore behavior' },
];

function splitTextarea(value: string) {
  return value
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

function unwrapImportedProfile(result: ProfileImportResult) {
  if (result.status !== 'profile_created') {
    throw new Error('onboarding package was staged instead of creating a managed profile');
  }
  return result.profile;
}

export default function App() {
  useEffect(() => {
    installTestBridge();
  }, []);

  const [activeTab, setActiveTab] = useState<TabKey>('shares');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paths, setPaths] = useState<AppPathsResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    close_to_tray: false,
    launch_on_login: false,
    reopen_last_session: false,
  });
  const [profiles, setProfiles] = useState<ProfileManifest[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [generatedKeyset, setGeneratedKeyset] = useState<GeneratedKeyset | null>(null);
  const [recoveredKey, setRecoveredKey] = useState<RecoveredKey | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ProfileRuntimeSnapshot | null>(null);

  const [createForm, setCreateForm] = useState({
    threshold: '2',
    count: '3',
    nsec: '',
  });
  const [saveForms, setSaveForms] = useState<Record<number, SaveDraft>>({});
  const [importForm, setImportForm] = useState({
    label: '',
    vaultPassphrase: '',
    relayUrls: '',
    groupPackageJson: '',
    sharePackageJson: '',
  });
  const [onboardingForm, setOnboardingForm] = useState({
    packageText: '',
    password: '',
    vaultPassphrase: '',
    label: '',
  });
  const [recoverForm, setRecoverForm] = useState({
    groupPackageJson: '',
    sharePackageJsons: [''],
  });

  const selectedProfile = profiles.find(item => item.id === selectedProfileId) ?? null;

  async function run<T>(label: string, task: () => Promise<T>) {
    setBusy(label);
    setError(null);
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
    const next = await listProfiles();
    setProfiles(next);
    setSelectedProfileId(current => {
      if (preferredProfileId && next.some(profile => profile.id === preferredProfileId)) {
        return preferredProfileId;
      }
      if (current && next.some(profile => profile.id === current)) {
        return current;
      }
      return next[0]?.id ?? '';
    });
  }

  async function refreshRuntime(profileId?: string | null) {
    setRuntimeSnapshot(await profileRuntimeSnapshot((profileId ?? selectedProfileId) || null));
  }

  async function bootstrap() {
    setBusy('bootstrapping workspace');
    setError(null);
    try {
      const [nextPaths, nextSettings, nextProfiles] = await Promise.all([
        appPaths(),
        getSettings(),
        listProfiles(),
      ]);
      setPaths(nextPaths);
      setSettings(nextSettings);
      setProfiles(nextProfiles);
      const firstProfileId = nextProfiles[0]?.id ?? '';
      setSelectedProfileId(firstProfileId);
      setRuntimeSnapshot(await profileRuntimeSnapshot(firstProfileId || null));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedProfileId) {
      return;
    }
    void refreshRuntime(selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void (async () => {
      unlisteners.push(
        await listen<AppSettingsEvent>(EVENT_APP_SETTINGS, event => {
          setSettings(event.payload.settings);
        }),
      );
      unlisteners.push(
        await listen<SignerStatusEvent>(EVENT_SIGNER_STATUS, () => {
          if (selectedProfileId) {
            void refreshRuntime(selectedProfileId);
          }
        }),
      );
      unlisteners.push(
        await listen<SignerPoliciesEvent>(EVENT_SIGNER_POLICIES, () => {
          if (selectedProfileId) {
            void refreshRuntime(selectedProfileId);
          }
        }),
      );
      unlisteners.push(
        await listen<SignerLogEvent>(EVENT_SIGNER_LOG, () => {
          if (selectedProfileId) {
            void refreshRuntime(selectedProfileId);
          }
        }),
      );
      unlisteners.push(
        await listen<SignerLifecycleEvent>(EVENT_SIGNER_LIFECYCLE, event => {
          const targetProfileId = event.payload.share_id ?? selectedProfileId;
          if (targetProfileId) {
            void refreshRuntime(targetProfileId);
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
    })();

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [selectedProfileId]);

  useEffect(() => {
    if (generatedKeyset) {
      setRecoverForm(current => ({
        ...current,
        groupPackageJson: generatedKeyset.group_package_json,
      }));
    }
  }, [generatedKeyset]);

  async function handleGenerate(mode: 'generated' | 'imported') {
    const threshold = Number(createForm.threshold);
    const count = Number(createForm.count);
    const result = await run(
      mode === 'generated' ? 'generating keyset' : 'splitting imported nsec',
      () =>
        mode === 'generated'
          ? createGeneratedKeyset(threshold, count)
          : createImportedKeyset(threshold, count, createForm.nsec.trim()),
    );
    setGeneratedKeyset(result);
    setRecoveredKey(null);
    setSaveForms(
      Object.fromEntries(
        result.shares.map(share => [
          share.member_idx,
          {
            label: `${result.source === 'generated' ? 'Generated' : 'Imported'} Member ${share.member_idx}`,
            vaultPassphrase: '',
            relayUrls: '',
          },
        ]),
      ),
    );
    setActiveTab('create');
  }

  async function importProfileAndSelect(task: () => Promise<ProfileImportResult>) {
    const profile = unwrapImportedProfile(await task());
    await refreshProfiles(profile.id);
    setSelectedProfileId(profile.id);
    setActiveTab('shares');
  }

  async function handleSaveGeneratedProfile(share: GeneratedKeysetShare) {
    const form = saveForms[share.member_idx];
    if (!generatedKeyset || !form) return;
    await run(`importing profile ${share.member_idx}`, async () => {
      await importProfileAndSelect(() =>
        importProfileFromRaw({
          label: form.label,
          vaultPassphrase: form.vaultPassphrase,
          relayUrls: splitTextarea(form.relayUrls),
          groupPackageJson: generatedKeyset.group_package_json,
          sharePackageJson: share.share_package_json,
        }),
      );
    });
  }

  async function handleImportRawProfile() {
    await run('importing managed profile', async () => {
      await importProfileAndSelect(() =>
        importProfileFromRaw({
          label: importForm.label || undefined,
          vaultPassphrase: importForm.vaultPassphrase,
          relayUrls: splitTextarea(importForm.relayUrls),
          groupPackageJson: importForm.groupPackageJson,
          sharePackageJson: importForm.sharePackageJson,
        }),
      );
      setImportForm({
        label: '',
        vaultPassphrase: '',
        relayUrls: '',
        groupPackageJson: '',
        sharePackageJson: '',
      });
    });
  }

  async function handleImportOnboardingProfile() {
    await run('importing onboarding package', async () => {
      await importProfileAndSelect(() =>
        importProfileFromOnboarding({
          label: onboardingForm.label || undefined,
          vaultPassphrase: onboardingForm.vaultPassphrase,
          onboardingPassword: onboardingForm.password,
          package: onboardingForm.packageText.trim(),
        }),
      );
      setOnboardingForm({
        packageText: '',
        password: '',
        vaultPassphrase: '',
        label: '',
      });
    });
  }

  async function handleDeleteProfile(profileId: string) {
    const shouldDelete = await confirm(`Delete managed profile "${profileId}"?`, {
      title: 'Delete Profile',
      kind: 'warning',
    });
    if (!shouldDelete) return;
    await run(`deleting ${profileId}`, async () => {
      await removeProfile(profileId);
      await refreshProfiles(selectedProfileId === profileId ? null : selectedProfileId);
      if (selectedProfileId === profileId) {
        setRuntimeSnapshot(await profileRuntimeSnapshot(null));
      }
    });
  }

  async function handleExportProfile(profileId: string) {
    const destination = await open({ directory: true, multiple: false });
    if (!destination || Array.isArray(destination)) return;
    await run('exporting profile', async () => {
      await exportProfile({
        profileId,
        destinationDir: destination,
        vaultPassphrase,
      });
    });
  }

  async function handleStartProfileSession() {
    if (!selectedProfileId) return;
    const snapshot = await run('starting signer', () =>
      startProfileSession({
        profileId: selectedProfileId,
        vaultPassphrase,
      }),
    );
    setRuntimeSnapshot(snapshot);
    setActiveTab('signer');
  }

  async function handleStopSigner() {
    await run('stopping signer', async () => {
      await stopSigner();
      await refreshRuntime(selectedProfileId || null);
    });
  }

  async function handleRecover() {
    const sharesToRecover = recoverForm.sharePackageJsons.map(item => item.trim()).filter(Boolean);
    const result = await run('recovering nsec', () =>
      recoverNsec(recoverForm.groupPackageJson, sharesToRecover),
    );
    setRecoveredKey(result);
    setActiveTab('recover');
  }

  async function handleToggleSetting(field: keyof AppSettings, checked: boolean) {
    await run('updating settings', async () => {
      const next = {
        ...settings,
        [field]: checked,
      };
      setSettings(await updateSettings(next));
    });
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="brand-kicker">FROSTR V2</div>
          <h1>Igloo Home</h1>
          <p>Desktop profile manager and native co-signer built on the shared shell core.</p>
        </div>

        <nav className="nav">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? 'nav-item is-active' : 'nav-item'}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              <span>{tab.label}</span>
              <small>{tab.detail}</small>
            </button>
          ))}
        </nav>

        <section className="paths">
          <h2>Local Paths</h2>
          <dl>
            <dt>App data</dt>
            <dd>{paths?.app_data_dir ?? '...'}</dd>
            <dt>Profiles</dt>
            <dd>{paths?.shares_dir ?? '...'}</dd>
            <dt>Runtime</dt>
            <dd>{paths?.runtime_dir ?? '...'}</dd>
          </dl>
        </section>
      </aside>

      <main className="main">
        <header className="hero">
          <div>
            <div className="hero-kicker">Desktop co-signer</div>
            <h2>Managed profiles, vault-backed shares, and native signer hosting</h2>
            <p>
              Igloo Home now imports onboarding packages and raw group/share material through the
              same profile and vault architecture used by Igloo Shell.
            </p>
          </div>
          <div className="status-bar">
            <span className={runtimeSnapshot?.active ? 'pill is-live' : 'pill'}>
              {runtimeSnapshot?.active ? 'Signer running' : 'Signer stopped'}
            </span>
            <span className={busy ? 'pill is-busy' : 'pill'}>{busy ?? 'Idle'}</span>
          </div>
        </header>

        {error ? <div className="alert">{error}</div> : null}

        {activeTab === 'shares' ? (
          <SharesPage
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            selectedProfile={selectedProfile}
            vaultPassphrase={vaultPassphrase}
            onSelectProfile={setSelectedProfileId}
            onChangeVaultPassphrase={setVaultPassphrase}
            onDelete={profileId => void handleDeleteProfile(profileId)}
            onExport={profileId => void handleExportProfile(profileId)}
            onRefresh={() => void run('refreshing profiles', () => refreshProfiles(selectedProfileId))}
          />
        ) : null}

        {activeTab === 'create' ? (
          <CreatePage
            createForm={createForm}
            importForm={importForm}
            onboardingForm={onboardingForm}
            generatedKeyset={generatedKeyset}
            saveForms={saveForms}
            onChangeCreateForm={(field, value) => setCreateForm(current => ({ ...current, [field]: value }))}
            onGenerateFresh={() => void handleGenerate('generated')}
            onGenerateImported={() => void handleGenerate('imported')}
            onChangeImportForm={(field, value) => setImportForm(current => ({ ...current, [field]: value }))}
            onChangeOnboardingForm={(field, value) =>
              setOnboardingForm(current => ({ ...current, [field]: value }))
            }
            onImportOnboardingProfile={() => void handleImportOnboardingProfile()}
            onImportRawProfile={() => void handleImportRawProfile()}
            onChangeSaveForm={(memberIdx, field, value) =>
              setSaveForms(current => ({
                ...current,
                [memberIdx]: {
                  ...(current[memberIdx] ?? {
                    label: '',
                    vaultPassphrase: '',
                    relayUrls: '',
                  }),
                  [field]: value,
                },
              }))
            }
            onSaveGeneratedProfile={share => void handleSaveGeneratedProfile(share)}
          />
        ) : null}

        {activeTab === 'signer' ? (
          <SignerPage
            selectedProfile={selectedProfile}
            vaultPassphrase={vaultPassphrase}
            runtimeSnapshot={runtimeSnapshot}
            onChangeVaultPassphrase={setVaultPassphrase}
            onStartSigner={() => void handleStartProfileSession()}
            onStopSigner={() => void handleStopSigner()}
            onRefreshSigner={() => void run('refreshing signer status', () => refreshRuntime(selectedProfileId || null))}
          />
        ) : null}

        {activeTab === 'recover' ? (
          <RecoverPage
            recoverForm={recoverForm}
            recoveredKey={recoveredKey}
            onChangeGroup={value => setRecoverForm(current => ({ ...current, groupPackageJson: value }))}
            onChangeShare={(index, value) =>
              setRecoverForm(current => ({
                ...current,
                sharePackageJsons: current.sharePackageJsons.map((item, itemIndex) =>
                  itemIndex === index ? value : item,
                ),
              }))
            }
            onAddShareSlot={(value = '') =>
              setRecoverForm(current => ({
                ...current,
                sharePackageJsons: [...current.sharePackageJsons, value],
              }))
            }
            onRecover={() => void handleRecover()}
          />
        ) : null}

        {activeTab === 'settings' ? (
          <SettingsPage
            settings={settings}
            onToggle={(field, checked) => void handleToggleSetting(field, checked)}
          />
        ) : null}
      </main>
    </div>
  );
}
