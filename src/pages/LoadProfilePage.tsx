import { Button, HostFlowShell, StepProgress, Textarea } from 'igloo-ui';

type LoadForm = {
  label: string;
  passphrase: string;
  packagePassword: string;
  packageText: string;
};

export default function LoadProfilePage({
  loadForm,
  onChange,
  onImport,
  onBack,
}: {
  loadForm: LoadForm;
  onChange: (field: keyof LoadForm, value: string) => void;
  onImport: () => void;
  onBack: () => void;
}) {
  return (
    <HostFlowShell
      title="Load Profile"
      description="Import a full device profile from its self-contained `bfprofile` package."
      onBack={onBack}
      backTooltip="Back"
    >
      <div className="igloo-flow-root igloo-stack">
        <StepProgress steps={['Import bfprofile', 'Load device']} active={0} />
        <section className="igloo-task-banner">
          <span className="igloo-task-kicker">Load a desktop device</span>
          <p>Import a protected `bfprofile`, then save the resulting desktop profile into the local encrypted profile store. To rebuild a lost device you need its `bfprofile` — a bare `bfshare` no longer carries the group package.</p>
        </section>
        <label>
          Profile label
          <input
            value={loadForm.label}
            onChange={event => onChange('label', event.target.value)}
            placeholder="Optional desktop label"
          />
        </label>
        <label>
          Passphrase
          <input
            type="password"
            value={loadForm.passphrase}
            onChange={event => onChange('passphrase', event.target.value)}
            placeholder="Used for local managed storage"
          />
        </label>
        <label>
          Package password
          <input
            type="password"
            value={loadForm.packagePassword}
            onChange={event => onChange('packagePassword', event.target.value)}
          />
        </label>
        <label>
          bfprofile
          <Textarea
            className="min-h-[140px]"
            value={loadForm.packageText}
            onChange={event => onChange('packageText', event.target.value)}
            placeholder="Paste bfprofile1..."
          />
        </label>
        <div className="igloo-button-row">
          <Button type="button" size="sm" onClick={onImport}>
            Import Profile
          </Button>
        </div>
      </div>
    </HostFlowShell>
  );
}
