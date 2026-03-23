import { Button } from 'igloo-ui';

import type { GeneratedKeyset, GeneratedKeysetShare } from '@/lib/types';

type SaveDraft = {
  label: string;
  vaultPassphrase: string;
  relayUrls: string;
};

type DistributionDraft = {
  label: string;
  packagePassword: string;
  confirmPassword: string;
};

type DistributionResult = {
  kind: 'copied' | 'qr' | 'saved';
  label: string;
};

type Props = {
  createForm: {
    mode: 'new' | 'rotate';
    threshold: string;
    count: string;
    sourceProfileId: string;
  };
  availableProfiles: Array<{
    id: string;
    label: string;
  }>;
  rotationSources: Array<{
    packageText: string;
    packagePassword: string;
  }>;
  generatedKeyset: GeneratedKeyset | null;
  saveForms: Record<number, SaveDraft>;
  selectedMemberIdx: number | null;
  distributionForms: Record<number, DistributionDraft>;
  distributionResults: Record<number, DistributionResult>;
  onChangeCreateForm: (field: 'mode' | 'threshold' | 'count' | 'sourceProfileId', value: string) => void;
  onChangeRotationSource: (index: number, field: 'packageText' | 'packagePassword', value: string) => void;
  onAddRotationSource: () => void;
  onRemoveRotationSource: (index: number) => void;
  onGenerateFresh: () => void;
  onChangeSaveForm: (memberIdx: number, field: keyof SaveDraft, value: string) => void;
  onSaveGeneratedProfile: (share: GeneratedKeysetShare) => void;
  onChangeDistributionForm: (memberIdx: number, field: keyof DistributionDraft, value: string) => void;
  onDistributeShare: (memberIdx: number, kind: 'copy' | 'qr' | 'save') => void;
  onFinishDistribution: () => void;
};

export default function CreatePage({
  createForm,
  availableProfiles,
  rotationSources,
  generatedKeyset,
  saveForms,
  selectedMemberIdx,
  distributionForms,
  distributionResults,
  onChangeCreateForm,
  onChangeRotationSource,
  onAddRotationSource,
  onRemoveRotationSource,
  onGenerateFresh,
  onChangeSaveForm,
  onSaveGeneratedProfile,
  onChangeDistributionForm,
  onDistributeShare,
  onFinishDistribution,
}: Props) {
  return (
    <section className="igloo-flow-root igloo-stack">
      <div className="igloo-task-banner">
        <span className="igloo-task-kicker">Create Flow</span>
        <p>
          Generate a fresh keyset or rotate an existing one, choose the desktop share you want to keep locally, and
          save it into the shell-managed vault.
        </p>
        <div className="igloo-task-points">
          <span>Configure threshold and member count.</span>
          <span>Rotation uses threshold bfshare recovery material.</span>
          <span>Save one local profile for this desktop.</span>
          <span>Distribute the remaining shares from your operator workflow.</span>
        </div>
      </div>

      <div className="igloo-button-row">
        <Button
          type="button"
          size="sm"
          variant={createForm.mode === 'new' ? 'default' : 'secondary'}
          onClick={() => onChangeCreateForm('mode', 'new')}
        >
          Create New Keyset
        </Button>
        <Button
          type="button"
          size="sm"
          variant={createForm.mode === 'rotate' ? 'default' : 'secondary'}
          onClick={() => onChangeCreateForm('mode', 'rotate')}
        >
          Rotate Existing Keyset
        </Button>
      </div>

      <div className="igloo-two-up">
        <label>
          Threshold
          <input
            type="number"
            min={2}
            value={createForm.threshold}
            onChange={(event) => onChangeCreateForm('threshold', event.target.value)}
          />
        </label>
        <label>
          Member count
          <input
            type="number"
            min={2}
            value={createForm.count}
            onChange={(event) => onChangeCreateForm('count', event.target.value)}
          />
        </label>
      </div>

      {createForm.mode === 'rotate' ? (
        <section className="igloo-stack">
          <label>
            Source profile
            <select
              value={createForm.sourceProfileId}
              onChange={(event) => onChangeCreateForm('sourceProfileId', event.target.value)}
            >
              <option value="">Select a profile</option>
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>

          {rotationSources.map((source, index) => (
            <section key={index} className="igloo-panel igloo-stack">
              <div className="flex items-center justify-between gap-3">
                <strong>bfshare Source {index + 1}</strong>
                {rotationSources.length > 1 ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => onRemoveRotationSource(index)}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <label>
                Package password
                <input
                  type="password"
                  value={source.packagePassword}
                  onChange={(event) => onChangeRotationSource(index, 'packagePassword', event.target.value)}
                />
              </label>
              <label>
                bfshare
                <textarea
                  className="min-h-[120px]"
                  placeholder="Paste bfshare1..."
                  value={source.packageText}
                  onChange={(event) => onChangeRotationSource(index, 'packageText', event.target.value)}
                />
              </label>
            </section>
          ))}

          <div className="igloo-button-row">
            <Button type="button" size="sm" variant="secondary" onClick={onAddRotationSource}>
              Add bfshare Source
            </Button>
          </div>
        </section>
      ) : null}

      <div className="igloo-button-row">
        <Button type="button" size="sm" onClick={onGenerateFresh}>
          {createForm.mode === 'rotate' ? 'Rotate Keyset' : 'Generate Keyset'}
        </Button>
      </div>

      {generatedKeyset ? (
        <section className="igloo-stack">
          <div className="igloo-panel">
            <strong>Generated Group Public Key</strong>
            <p className="igloo-message-muted break-all">{generatedKeyset.group_public_key}</p>
          </div>

          {generatedKeyset.shares.map((share) => {
            const draft = saveForms[share.member_idx] ?? {
              label: share.name,
              vaultPassphrase: '',
              relayUrls: '',
            };

            return (
              <section key={share.member_idx} className="igloo-panel igloo-stack">
                <div>
                  <strong>{share.name}</strong>
                  <p className="igloo-message-muted">Member {share.member_idx}</p>
                </div>
                <div className="igloo-two-up">
                  <label>
                    Device label
                    <input
                      value={draft.label}
                      onChange={(event) => onChangeSaveForm(share.member_idx, 'label', event.target.value)}
                    />
                  </label>
                  <label>
                    Vault passphrase
                    <input
                      type="password"
                      value={draft.vaultPassphrase}
                      onChange={(event) =>
                        onChangeSaveForm(share.member_idx, 'vaultPassphrase', event.target.value)
                      }
                    />
                  </label>
                </div>
                <label>
                  Relay URLs
                  <textarea
                    className="min-h-[96px]"
                    placeholder="One relay URL per line"
                    value={draft.relayUrls}
                    onChange={(event) => onChangeSaveForm(share.member_idx, 'relayUrls', event.target.value)}
                  />
                </label>
                <div className="igloo-button-row">
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedMemberIdx === share.member_idx ? 'secondary' : 'default'}
                    onClick={() => onSaveGeneratedProfile(share)}
                  >
                    {selectedMemberIdx === share.member_idx ? 'Local Profile Saved' : 'Save Local Profile'}
                  </Button>
                </div>
              </section>
            );
          })}

          {selectedMemberIdx != null ? (
            <section className="igloo-stack">
              <div className="igloo-task-banner">
                <span className="igloo-task-kicker">Distribute Shares</span>
                <p>Generate `bfonboard` packages for the remaining shares now that the local desktop profile is saved.</p>
                <div className="igloo-task-points">
                  <span>`Copy`, `QR`, and `Save` all produce `bfonboard` packages.</span>
                  <span>The local share is excluded from distribution automatically.</span>
                </div>
              </div>

              {generatedKeyset.shares
                .filter((share) => share.member_idx !== selectedMemberIdx)
                .map((share) => {
                  const form = distributionForms[share.member_idx] ?? {
                    label: share.name,
                    packagePassword: '',
                    confirmPassword: '',
                  };
                  const result = distributionResults[share.member_idx];
                  return (
                    <section key={`distribution-${share.member_idx}`} className="igloo-panel igloo-stack">
                      <div>
                        <strong>{share.name}</strong>
                        <p className="igloo-message-muted">Member {share.member_idx}</p>
                      </div>
                      <label>
                        Share label
                        <input
                          value={form.label}
                          onChange={(event) => onChangeDistributionForm(share.member_idx, 'label', event.target.value)}
                        />
                      </label>
                      <div className="igloo-two-up">
                        <label>
                          Package password
                          <input
                            type="password"
                            value={form.packagePassword}
                            onChange={(event) =>
                              onChangeDistributionForm(share.member_idx, 'packagePassword', event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Confirm password
                          <input
                            type="password"
                            value={form.confirmPassword}
                            onChange={(event) =>
                              onChangeDistributionForm(share.member_idx, 'confirmPassword', event.target.value)
                            }
                          />
                        </label>
                      </div>
                      <div className="igloo-button-row">
                        <Button type="button" size="sm" variant="secondary" onClick={() => onDistributeShare(share.member_idx, 'copy')}>
                          Copy
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => onDistributeShare(share.member_idx, 'qr')}>
                          QR
                        </Button>
                        <Button type="button" size="sm" onClick={() => onDistributeShare(share.member_idx, 'save')}>
                          Save
                        </Button>
                      </div>
                      {result ? <div className="igloo-message-muted">{`${result.kind === 'copied' ? 'Copied' : result.kind === 'qr' ? 'Prepared QR for' : 'Saved file for'} ${result.label}.`}</div> : null}
                    </section>
                  );
                })}

              <div className="igloo-button-row">
                <Button type="button" size="sm" onClick={onFinishDistribution}>
                  Finish
                </Button>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
