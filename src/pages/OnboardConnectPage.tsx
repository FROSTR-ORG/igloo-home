import { Button, HostFlowShell, StepProgress, Textarea } from 'igloo-ui';

type OnboardConnectDraft = {
  packageText: string;
  password: string;
};

export default function OnboardConnectPage({
  form,
  onChange,
  onConnect,
  onBack,
}: {
  form: OnboardConnectDraft;
  onChange: (field: keyof OnboardConnectDraft, value: string) => void;
  onConnect: () => void;
  onBack: () => void;
}) {
  return (
    <HostFlowShell
      title="Onboard Device"
      description="Connect with a protected onboarding package, resolve the handshake, then review the device before saving it locally."
      onBack={onBack}
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
            value={form.password}
            onChange={event => onChange('password', event.target.value)}
          />
        </label>
        <label>
          bfonboard
          <Textarea
            className="min-h-[160px]"
            value={form.packageText}
            onChange={event => onChange('packageText', event.target.value)}
            placeholder="Paste bfonboard1..."
          />
        </label>
        <div className="igloo-button-row">
          <Button type="button" size="sm" onClick={onConnect}>
            Connect
          </Button>
        </div>
      </div>
    </HostFlowShell>
  );
}
