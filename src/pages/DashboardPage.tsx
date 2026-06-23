import {
  Button,
  Checkbox,
  ContentCard,
  DashboardConditionBanner,
  DashboardLoadFailedScreen,
  DashboardLoadingScreen,
  HostFlowShell,
  OperatorDashboardTabs,
  OperatorPermissionsPanel,
  OperatorSettingsPanel,
  OperatorSignerPanel,
  Textarea,
  type DashboardState,
  type OperatorSignerSettings,
  type PeerReadinessRowModel,
  type PendingApprovalRowModel,
} from 'igloo-ui';

import { shortProfileId } from '@/lib/profileIdentity';
import {
  buildPolicyDashboardView,
  buildSignerDashboardView,
  type HomePeerPermissionState,
  type HomePendingOperation,
} from '@/lib/dashboard-view';
import type { AppSettings, ProfileManifest, RelayProfile } from '@/lib/types';

type DashboardTab = 'signer' | 'permissions' | 'settings';

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

type RotationDraft = {
  onboardingPackage: string;
  onboardingPassword: string;
};

type PackageExportDraft = {
  packagePassword: string;
};

type PeerRefreshSummary = {
  tone: 'success' | 'warning' | 'error';
  message: string;
  details: string[];
};

export default function DashboardPage({
  selectedProfile,
  selectedProfileId,
  selectedRelayProfile,
  activeDashboardTab,
  runtimeActive,
  runtimeMetadata,
  runtimeLogLines,
  dashboardState,
  runtimePeers,
  peerPermissionStates,
  pendingApprovals,
  pendingOperations,
  peerRefreshSummary,
  settings,
  settingsDraft,
  relayDraft,
  packageDraft,
  rotationForm,
  onBack,
  onChangeTab,
  onDismissSignFailure,
  onRetryLoad,
  onApproveOnce,
  onDenyApproval,
  onAlwaysAllow,
  onRuntimePrimaryAction,
  onRefreshPeers,
  onRefreshPermissions,
  onPeerPolicyChange,
  onSignerNameChange,
  onNewRelayUrlChange,
  onAddRelay,
  onRemoveRelay,
  onSignerSettingNumberChange,
  onPeerSelectionStrategyChange,
  onSaveSettings,
  onCopyProfilePackage,
  onLogout,
  onPackagePasswordChange,
  onRotationFormChange,
  onRotateKey,
  onToggleSetting,
}: {
  selectedProfile: ProfileManifest | null;
  selectedProfileId: string;
  selectedRelayProfile: RelayProfile | null;
  activeDashboardTab: DashboardTab;
  runtimeActive: boolean;
  runtimeMetadata: { group_public_key: string; share_public_key: string; member_idx: number } | null;
  runtimeLogLines?: string[];
  dashboardState: DashboardState;
  runtimePeers: PeerReadinessRowModel[];
  peerPermissionStates: HomePeerPermissionState[];
  pendingApprovals: PendingApprovalRowModel[];
  pendingOperations: HomePendingOperation[];
  peerRefreshSummary: PeerRefreshSummary | null;
  settings: AppSettings;
  settingsDraft: RuntimeOptionsDraft;
  relayDraft: string;
  packageDraft: PackageExportDraft;
  rotationForm: RotationDraft;
  onBack: () => void;
  onChangeTab: (tab: DashboardTab) => void;
  onDismissSignFailure: (requestId: string) => void;
  onRetryLoad: () => void;
  onApproveOnce: (id: string) => void;
  onDenyApproval: (id: string) => void;
  onAlwaysAllow: (id: string) => void;
  onRuntimePrimaryAction: () => void;
  onRefreshPeers: () => void;
  onRefreshPermissions: () => void;
  onPeerPolicyChange: (pubkey: string, direction: 'request' | 'respond', method: 'ping' | 'onboard' | 'sign' | 'ecdh', value: 'unset' | 'allow' | 'deny' | 'ask') => void;
  onSignerNameChange: (value: string) => void;
  onNewRelayUrlChange: (value: string) => void;
  onAddRelay: () => void;
  onRemoveRelay: (relay: string) => void;
  onSignerSettingNumberChange: (field: keyof RuntimeOptionsDraft, value: string) => void;
  onPeerSelectionStrategyChange: (value: 'deterministic_sorted' | 'random') => void;
  onSaveSettings: () => void;
  onCopyProfilePackage: (format: 'bfprofile' | 'bfshare') => void;
  onLogout: () => void;
  onPackagePasswordChange: (value: string) => void;
  onRotationFormChange: (field: keyof RotationDraft, value: string) => void;
  onRotateKey: () => void;
  onToggleSetting: (field: keyof AppSettings, checked: boolean) => void;
}) {
  return (
    <HostFlowShell
      title={
        selectedProfile
          ? `Device Dashboard · ${selectedProfile.label} (${shortProfileId(selectedProfile.id)})`
          : 'Device Dashboard'
      }
      description="Desktop operator console for the selected managed signer profile."
      onBack={onBack}
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
          onChangeTab={value => onChangeTab(value as DashboardTab)}
        />

        {activeDashboardTab === 'signer' ? (
          dashboardState.kind === 'loading' ? (
            <DashboardLoadingScreen detail={dashboardState.detail} />
          ) : dashboardState.kind === 'load-failed' ? (
            <DashboardLoadFailedScreen
              message={dashboardState.message}
              timestampLabel={
                dashboardState.at ? new Date(dashboardState.at * 1000).toLocaleString() : undefined
              }
              onRetry={onRetryLoad}
            />
          ) : (
            <>
              {dashboardState.banners.map((banner) => (
                <DashboardConditionBanner
                  key={banner.kind}
                  banner={banner}
                  timestampLabel={
                    banner.kind === 'signing-failed'
                      ? new Date(banner.at * 1000).toLocaleString()
                      : undefined
                  }
                  onDismiss={
                    banner.kind === 'signing-failed'
                      ? () => onDismissSignFailure(banner.requestId)
                      : undefined
                  }
                />
              ))}
              <OperatorSignerPanel
                view={buildSignerDashboardView({
                  profileName: selectedProfile?.label ?? null,
                  groupPublicKey: runtimeMetadata?.group_public_key,
                  sharePublicKey: runtimeMetadata?.share_public_key,
                  memberIdx: runtimeMetadata?.member_idx,
                  running: runtimeActive,
                  peers: runtimePeers,
                  pendingApprovals,
                  pendingOperations,
                  logLines: runtimeLogLines,
                })}
                onApproveOnce={onApproveOnce}
                onDenyApproval={onDenyApproval}
                onAlwaysAllow={onAlwaysAllow}
                runtimeControlLabel={runtimeActive ? 'Stop Signer' : 'Start Signer'}
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
                onPrimaryAction={onRuntimePrimaryAction}
                primaryActionVariant={runtimeActive ? 'destructive' : 'success'}
                onRefreshPeers={onRefreshPeers}
                refreshPeersDisabled={!selectedProfileId || !runtimeActive}
              />
            </>
          )
        ) : null}

        {activeDashboardTab === 'permissions' ? (
          <OperatorPermissionsPanel
            view={buildPolicyDashboardView(peerPermissionStates, runtimeActive)}
            peerDescription="Live outbound and inbound peer policy state for the active desktop signer."
            onRefresh={onRefreshPermissions}
            onPeerPolicyOverrideChange={onPeerPolicyChange}
          />
        ) : null}

        {activeDashboardTab === 'settings' ? (
          <OperatorSettingsPanel
            hasProfile={Boolean(selectedProfile)}
            signerName={selectedProfile?.label ?? ''}
            onSignerNameChange={onSignerNameChange}
            relays={selectedRelayProfile?.relays ?? []}
            newRelayUrl={relayDraft}
            onNewRelayUrlChange={onNewRelayUrlChange}
            onAddRelay={onAddRelay}
            onRemoveRelay={onRemoveRelay}
            signerSettings={settingsDraft}
            onSignerSettingNumberChange={onSignerSettingNumberChange}
            onPeerSelectionStrategyChange={onPeerSelectionStrategyChange}
            onSave={onSaveSettings}
            maintenanceDescription="Desktop package export, share rotation, and session controls."
            maintenanceActions={[
              {
                label: 'copy profile',
                onClick: () => onCopyProfilePackage('bfprofile'),
                variant: 'secondary',
                disabled: !selectedProfileId,
              },
              {
                label: 'copy share',
                onClick: () => onCopyProfilePackage('bfshare'),
                variant: 'secondary',
                disabled: !selectedProfileId,
              },
              {
                label: 'logout',
                onClick: onLogout,
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
                      onChange={event => onPackagePasswordChange(event.target.value)}
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
                        onChange={event => onRotationFormChange('onboardingPassword', event.target.value)}
                      />
                    </label>
                    <label>
                      bfonboard
                      <Textarea
                        className="min-h-[140px]"
                        placeholder="Paste bfonboard1..."
                        value={rotationForm.onboardingPackage}
                        onChange={event => onRotationFormChange('onboardingPackage', event.target.value)}
                      />
                    </label>
                    <div className="igloo-button-row">
                      <Button type="button" size="sm" variant="secondary" onClick={onRotateKey} disabled={!selectedProfileId}>
                        rotate share
                      </Button>
                    </div>
                  </div>
                </ContentCard>
                <ContentCard title="Desktop Settings" description="Native app behavior for this machine.">
                  <div className="igloo-settings-grid">
                    <Checkbox
                      checked={settings.close_to_tray}
                      onCheckedChange={(checked) => onToggleSetting('close_to_tray', checked)}
                      label="Close to tray"
                      description="Keep the signer available in the background when the window closes."
                    />
                    <Checkbox
                      checked={settings.launch_on_login}
                      onCheckedChange={(checked) => onToggleSetting('launch_on_login', checked)}
                      label="Launch on login"
                      description="Start Igloo Home automatically when this desktop signs in."
                    />
                  </div>
                </ContentCard>
              </>
            }
          />
        ) : null}
      </section>
    </HostFlowShell>
  );
}
