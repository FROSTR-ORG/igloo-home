import type { ReactNode } from 'react';

import {
  Button,
  CreateFlowDistributionSection,
  CreateFlowGenerateCard,
  CreateFlowLocalSaveCard,
  CreateFlowTaskBanner,
  RotateKeysetPanel,
  type SharedDistributionAction,
  type SharedDistributionResult,
} from 'igloo-ui';

import type { GeneratedKeyset, GeneratedKeysetShare } from '@/lib/types';

type SaveDraft = {
  label: string;
  passphrase: string;
  relayUrls: string;
};

type DistributionDraft = {
  label: string;
  packagePassword: string;
  confirmPassword: string;
};

type Props = {
  createForm: {
    mode: 'new' | 'rotate';
    groupName: string;
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
  distributionResults: Record<number, SharedDistributionResult>;
  onChangeCreateForm: (field: 'mode' | 'groupName' | 'threshold' | 'count' | 'sourceProfileId', value: string) => void;
  onChangeRotationSource: (index: number, field: 'packageText' | 'packagePassword', value: string) => void;
  onAddRotationSource: () => void;
  onRemoveRotationSource: (index: number) => void;
  onGenerateFresh: () => void;
  onChangeSaveForm: (memberIdx: number, field: keyof SaveDraft, value: string) => void;
  onSaveGeneratedProfile: (share: GeneratedKeysetShare) => void;
  onChangeDistributionForm: (memberIdx: number, field: keyof DistributionDraft, value: string) => void;
  onDistributeShare: (memberIdx: number, kind: SharedDistributionAction) => void;
  onFinishDistribution: () => void;
  distributionBeforeCards?: ReactNode;
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
  distributionBeforeCards,
}: Props) {
  return (
    <section className="igloo-flow-root igloo-stack">
      <CreateFlowTaskBanner
        kicker="Create Flow"
        description="Generate a fresh keyset or rotate an existing one, choose the desktop share you want to keep locally, and save it into the encrypted profile store."
        points={[
          'Configure threshold and member count.',
          'Rotation uses threshold bfshare recovery material.',
          'Save one local profile for this desktop.',
          'Distribute the remaining shares from your operator workflow.',
        ]}
      />

      {availableProfiles.length > 0 ? (
        <div className="igloo-button-row igloo-button-row-tight" role="group" aria-label="Keyset action mode">
          <Button
            type="button"
            size="sm"
            variant={createForm.mode === 'new' ? 'default' : 'secondary'}
            onClick={() => onChangeCreateForm('mode', 'new')}
          >
            New Keyset
          </Button>
          <Button
            type="button"
            size="sm"
            variant={createForm.mode === 'rotate' ? 'default' : 'secondary'}
            onClick={() => onChangeCreateForm('mode', 'rotate')}
          >
            Rotate Existing
          </Button>
        </div>
      ) : null}

      {createForm.mode === 'rotate' ? (
        // Paper split rotation out of the generate card into its own panel.
        <RotateKeysetPanel
          sourceProfileId={createForm.sourceProfileId}
          availableProfiles={availableProfiles}
          rotationSources={rotationSources}
          onChangeSourceProfile={(profileId) => onChangeCreateForm('sourceProfileId', profileId)}
          onChangeRotationSource={onChangeRotationSource}
          onAddRotationSource={onAddRotationSource}
          onRemoveRotationSource={onRemoveRotationSource}
          onRotate={onGenerateFresh}
        />
      ) : (
        <CreateFlowGenerateCard
          groupName={createForm.groupName}
          threshold={createForm.threshold}
          count={createForm.count}
          // igloo-home's create form has no `privateKey` (nsec-import) field;
          // ignore that input from the shared Paper card.
          onChangeForm={(field, value) => {
            if (field !== 'privateKey') onChangeCreateForm(field, value);
          }}
          onGenerate={onGenerateFresh}
        />
      )}

      {generatedKeyset ? (
        <section className="igloo-stack">
          <div className="igloo-panel">
            <strong>Generated Group Public Key</strong>
            <p className="igloo-message-muted break-all">{generatedKeyset.group_public_key}</p>
          </div>

          {generatedKeyset.shares.map((share) => {
            const draft = saveForms[share.member_idx] ?? {
              label: share.name,
              passphrase: '',
              relayUrls: '',
            };

            return (
              <CreateFlowLocalSaveCard
                key={share.member_idx}
                share={share}
                draft={{
                  label: draft.label,
                  relayUrls: draft.relayUrls,
                  primarySecret: draft.passphrase,
                }}
                labelInputLabel="Device label"
                primarySecretLabel="Passphrase"
                actionLabel={selectedMemberIdx === share.member_idx ? 'Local Profile Saved' : 'Save Local Profile'}
                actionVariant={selectedMemberIdx === share.member_idx ? 'secondary' : 'default'}
                onLabelChange={(value) => onChangeSaveForm(share.member_idx, 'label', value)}
                onPrimarySecretChange={(value) => onChangeSaveForm(share.member_idx, 'passphrase', value)}
                onRelayUrlsChange={(value) => onChangeSaveForm(share.member_idx, 'relayUrls', value)}
                onAction={() => onSaveGeneratedProfile(share)}
              />
            );
          })}

          {selectedMemberIdx != null ? (
            <CreateFlowDistributionSection
              bannerKicker="Distribute Shares"
              bannerDescription="Generate `bfonboard` packages for the remaining shares now that the local desktop profile is saved."
              bannerPoints={[
                '`Copy`, `QR`, and `Save` all produce `bfonboard` packages.',
                'The local share is excluded from distribution automatically.',
              ]}
              sectionTitle="Remaining Shares"
              sectionDescription="Each remaining member can be distributed as a password-protected onboarding package."
              shares={generatedKeyset.shares.filter((share) => share.member_idx !== selectedMemberIdx)}
              drafts={distributionForms}
              results={distributionResults}
              onChangeDraft={onChangeDistributionForm}
              onDistribute={onDistributeShare}
              onFinish={onFinishDistribution}
              beforeCards={distributionBeforeCards}
            />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
