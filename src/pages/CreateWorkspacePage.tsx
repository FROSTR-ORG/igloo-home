import type { ReactNode } from 'react';

import {
  HostFlowShell,
  QrPayloadModal,
  StepProgress,
  type SharedDistributionAction,
  type SharedDistributionResult,
} from 'igloo-ui';

import type { GeneratedKeyset, GeneratedKeysetShare } from '@/lib/types';
import CreatePage from './CreatePage';

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

type CreateForm = {
  mode: 'new' | 'rotate';
  groupName: string;
  threshold: string;
  count: string;
  sourceProfileId: string;
};

export default function CreateWorkspacePage({
  createForm,
  availableProfiles,
  rotationSources,
  generatedKeyset,
  saveForms,
  selectedMemberIdx,
  distributionForms,
  distributionResults,
  distributionBeforeCards,
  distributionQr,
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
  onCloseDistributionQr,
  onBack,
}: {
  createForm: CreateForm;
  availableProfiles: Array<{ id: string; label: string }>;
  rotationSources: RotationSourceDraft[];
  generatedKeyset: GeneratedKeyset | null;
  saveForms: Record<number, SaveDraft>;
  selectedMemberIdx: number | null;
  distributionForms: Record<number, DistributionDraft>;
  distributionResults: Record<number, SharedDistributionResult>;
  distributionBeforeCards?: ReactNode;
  distributionQr: { label: string; packageText: string } | null;
  onChangeCreateForm: (field: keyof CreateForm, value: string) => void;
  onChangeRotationSource: (index: number, field: keyof RotationSourceDraft, value: string) => void;
  onAddRotationSource: () => void;
  onRemoveRotationSource: (index: number) => void;
  onGenerateFresh: () => void;
  onChangeSaveForm: (memberIdx: number, field: keyof SaveDraft, value: string) => void;
  onSaveGeneratedProfile: (share: GeneratedKeysetShare) => void;
  onChangeDistributionForm: (memberIdx: number, field: keyof DistributionDraft, value: string) => void;
  onDistributeShare: (memberIdx: number, kind: SharedDistributionAction) => void;
  onFinishDistribution: () => void;
  onCloseDistributionQr: () => void;
  onBack: () => void;
}) {
  return (
    <HostFlowShell
      title="Create / Rotate Keyset"
      description="Step through the same host workflow as the PWA, then save one managed desktop profile into the encrypted profile store."
      onBack={onBack}
      backTooltip="Back"
    >
      <div className="igloo-stack">
        <StepProgress steps={['Generate', 'Create profile', 'Review', 'Distribute']} active={generatedKeyset ? 1 : 0} />
        <section className="igloo-task-banner">
          <span className="igloo-task-kicker">Create or Rotate</span>
          <p>Provide the group name and threshold geometry, then create or rebuild the keyset before saving one local desktop device.</p>
          <div className="igloo-task-points">
            <span>The group name identifies the shared group and the shares issued from it.</span>
            <span>Rotation preserves the same group public key and issues fresh device shares.</span>
          </div>
        </section>
      </div>
      <CreatePage
        createForm={createForm}
        availableProfiles={availableProfiles}
        rotationSources={rotationSources}
        generatedKeyset={generatedKeyset}
        saveForms={saveForms}
        selectedMemberIdx={selectedMemberIdx}
        distributionForms={distributionForms}
        distributionResults={distributionResults}
        onChangeCreateForm={onChangeCreateForm}
        onChangeRotationSource={onChangeRotationSource}
        onAddRotationSource={onAddRotationSource}
        onRemoveRotationSource={onRemoveRotationSource}
        onGenerateFresh={onGenerateFresh}
        onChangeSaveForm={onChangeSaveForm}
        onSaveGeneratedProfile={onSaveGeneratedProfile}
        onChangeDistributionForm={onChangeDistributionForm}
        onDistributeShare={onDistributeShare}
        onFinishDistribution={onFinishDistribution}
        distributionBeforeCards={distributionBeforeCards}
      />
      <QrPayloadModal
        open={Boolean(distributionQr)}
        onClose={onCloseDistributionQr}
        title="Onboarding Package QR"
        label={distributionQr?.label}
        payload={distributionQr?.packageText ?? ''}
      />
    </HostFlowShell>
  );
}
