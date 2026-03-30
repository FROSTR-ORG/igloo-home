import {
  CreateFlowDistributionSection,
  CreateFlowGenerateCard,
  CreateFlowLocalSaveCard,
  CreateFlowTaskBanner,
} from 'igloo-ui';

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
  distributionResults: Record<number, DistributionResult>;
  onChangeCreateForm: (field: 'mode' | 'groupName' | 'threshold' | 'count' | 'sourceProfileId', value: string) => void;
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
      <CreateFlowTaskBanner
        kicker="Create Flow"
        description="Generate a fresh keyset or rotate an existing one, choose the desktop share you want to keep locally, and save it into the shell-managed vault."
        points={[
          'Configure threshold and member count.',
          'Rotation uses threshold bfshare recovery material.',
          'Save one local profile for this desktop.',
          'Distribute the remaining shares from your operator workflow.',
        ]}
      />

      <CreateFlowGenerateCard
        form={createForm}
        availableProfiles={availableProfiles}
        rotationSources={rotationSources}
        onChangeForm={onChangeCreateForm}
        onChangeRotationSource={onChangeRotationSource}
        onAddRotationSource={onAddRotationSource}
        onRemoveRotationSource={onRemoveRotationSource}
        onGenerate={onGenerateFresh}
      />

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
              <CreateFlowLocalSaveCard
                key={share.member_idx}
                share={share}
                draft={{
                  label: draft.label,
                  relayUrls: draft.relayUrls,
                  primarySecret: draft.vaultPassphrase,
                }}
                labelInputLabel="Device label"
                primarySecretLabel="Vault passphrase"
                actionLabel={selectedMemberIdx === share.member_idx ? 'Local Profile Saved' : 'Save Local Profile'}
                actionVariant={selectedMemberIdx === share.member_idx ? 'secondary' : 'default'}
                onLabelChange={(value) => onChangeSaveForm(share.member_idx, 'label', value)}
                onPrimarySecretChange={(value) => onChangeSaveForm(share.member_idx, 'vaultPassphrase', value)}
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
            />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
