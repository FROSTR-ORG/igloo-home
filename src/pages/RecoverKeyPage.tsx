import {
  HostFlowShell,
  RecoverCollectSharesPanel,
  SensitiveTextarea,
  StepProgress,
  type SharedRecoverSource,
} from 'igloo-ui';

import { shortProfileId } from '@/lib/profileIdentity';
import type { ProfileManifest, RecoveredGroupKey } from '@/lib/types';

export default function RecoverKeyPage({
  profiles,
  recoverProfileId,
  recoverDevicePassphrase,
  recoverSources,
  recoverThreshold,
  recoveredKey,
  onChangeProfileId,
  onChangeDevicePassphrase,
  onChangeSource,
  onAddSource,
  onRemoveSource,
  onRecover,
  onBack,
}: {
  profiles: ProfileManifest[];
  recoverProfileId: string;
  recoverDevicePassphrase: string;
  recoverSources: SharedRecoverSource[];
  recoverThreshold: number | null;
  recoveredKey: RecoveredGroupKey | null;
  onChangeProfileId: (profileId: string) => void;
  onChangeDevicePassphrase: (value: string) => void;
  onChangeSource: (index: number, field: keyof SharedRecoverSource, value: string) => void;
  onAddSource: () => void;
  onRemoveSource: (index: number) => void;
  onRecover: () => void;
  onBack: () => void;
}) {
  const pastedCount = recoverSources.filter(source => source.packageText.trim().length > 0).length;
  return (
    <HostFlowShell
      title="Recover Group Key"
      description="Reconstruct the group secret key (nsec) locally from a threshold of shares. Nothing is published to a relay."
      onBack={onBack}
      backTooltip="Back"
    >
      <div className="igloo-flow-root igloo-stack">
        <StepProgress steps={['Collect shares', 'Recovered key']} active={recoveredKey ? 1 : 0} />
        <section className="igloo-task-banner">
          <span className="igloo-task-kicker">Local key recovery</span>
          <p>Pick a local profile to supply the group package and this device's own share, then paste the other members' `bfshare`s to meet the threshold.</p>
        </section>
        <label>
          Recovering profile
          <select
            value={recoverProfileId}
            onChange={event => onChangeProfileId(event.target.value)}
          >
            <option value="">Select a local profile…</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.label} ({shortProfileId(profile.id)})
              </option>
            ))}
          </select>
        </label>
        <RecoverCollectSharesPanel
          devicePassphrase={recoverDevicePassphrase}
          onChangeDevicePassphrase={onChangeDevicePassphrase}
          sources={recoverSources}
          threshold={recoverThreshold ?? 1 + pastedCount}
          collectedCount={1 + pastedCount}
          onChangeSource={onChangeSource}
          onAddSource={onAddSource}
          onRemoveSource={onRemoveSource}
          onNext={onRecover}
          actionLabel="Recover Key"
        />
        {recoveredKey ? (
          <div className="igloo-stack">
            <SensitiveTextarea label="Recovered nsec" value={recoveredKey.nsec} placeholderLines={3} rows={3} />
            <SensitiveTextarea
              label="Signing key hex"
              value={recoveredKey.signing_key_hex}
              placeholderLines={3}
              rows={3}
            />
            <p className="igloo-recover-helper">Group public key: {recoveredKey.group_public_key}</p>
            <section className="igloo-task-banner">
              <span className="igloo-task-kicker">Handle the key with care</span>
              <p>
                This group secret key was reconstructed on this device and is shown
                here in plaintext — displaying it means it left the secure core and
                crossed into the app window, so treat it as exposed to this machine.
                Move it into an encrypted store now, then leave this screen to clear
                it from the app. Nothing is written to disk for you.
              </p>
            </section>
          </div>
        ) : null}
      </div>
    </HostFlowShell>
  );
}
