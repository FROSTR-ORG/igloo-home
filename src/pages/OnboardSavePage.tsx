import { Button, HostFlowShell, ProfileConfirmationCard, StepProgress } from 'igloo-ui';

import type { ConnectedOnboardingPreview } from '@/lib/types';

type OnboardSaveDraft = {
  label: string;
  passphrase: string;
  confirmPassphrase: string;
};

export default function OnboardSavePage({
  connection,
  form,
  onChange,
  onCancel,
  onSave,
}: {
  connection: ConnectedOnboardingPreview;
  form: OnboardSaveDraft;
  onChange: (field: keyof OnboardSaveDraft, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <HostFlowShell
      title="Save Onboarded Device"
      description="Review the resolved profile details and choose the passphrase used to store this desktop device locally."
      onBack={onCancel}
      backTooltip="Back to connect"
    >
      <div className="igloo-flow-root igloo-stack">
        <StepProgress steps={['Connect with package', 'Save device']} active={1} />
        <ProfileConfirmationCard
          title="Review Onboarded Profile"
          profileName={connection.preview.label}
          sharePublicKey={connection.preview.share_public_key}
          groupPublicKey={connection.preview.group_public_key}
          relays={connection.preview.relays}
        />
        <section className="igloo-task-banner">
          <span className="igloo-task-kicker">Handshake complete</span>
          <p>The onboarding package has been resolved. Confirm the device label and passphrase before saving this managed desktop profile.</p>
        </section>
        <label>
          Device label
          <input
            value={form.label}
            onChange={event => onChange('label', event.target.value)}
          />
        </label>
        <label>
          Passphrase
          <input
            type="password"
            value={form.passphrase}
            onChange={event => onChange('passphrase', event.target.value)}
          />
        </label>
        <label>
          Confirm passphrase
          <input
            type="password"
            value={form.confirmPassphrase}
            onChange={event => onChange('confirmPassphrase', event.target.value)}
          />
        </label>
        <div className="igloo-button-row">
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave}>
            Save Device
          </Button>
        </div>
      </div>
    </HostFlowShell>
  );
}
