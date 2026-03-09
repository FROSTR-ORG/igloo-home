import { CreateImportPanel, type GeneratedShareDraft } from 'igloo-ui';

import type { GeneratedKeyset, GeneratedKeysetShare } from '@/lib/types';

type SaveDraft = GeneratedShareDraft;

type Props = {
  createForm: {
    threshold: string;
    count: string;
    nsec: string;
  };
  importForm: {
    label: string;
    vaultPassphrase: string;
    relayUrls: string;
    groupPackageJson: string;
    sharePackageJson: string;
  };
  onboardingForm: {
    packageText: string;
    password: string;
    vaultPassphrase: string;
    label: string;
  };
  generatedKeyset: GeneratedKeyset | null;
  saveForms: Record<number, SaveDraft>;
  onChangeCreateForm: (field: 'threshold' | 'count' | 'nsec', value: string) => void;
  onGenerateFresh: () => void;
  onGenerateImported: () => void;
  onChangeImportForm: (field: keyof Props['importForm'], value: string) => void;
  onChangeOnboardingForm: (field: keyof Props['onboardingForm'], value: string) => void;
  onImportOnboardingProfile: () => void;
  onImportRawProfile: () => void;
  onChangeSaveForm: (memberIdx: number, field: keyof SaveDraft, value: string) => void;
  onSaveGeneratedProfile: (share: GeneratedKeysetShare) => void;
};

export default function CreatePage({
  createForm,
  importForm,
  onboardingForm,
  generatedKeyset,
  saveForms,
  onChangeCreateForm,
  onGenerateFresh,
  onGenerateImported,
  onChangeImportForm,
  onChangeOnboardingForm,
  onImportOnboardingProfile,
  onImportRawProfile,
  onChangeSaveForm,
  onSaveGeneratedProfile,
}: Props) {
  return (
    <CreateImportPanel
      createForm={createForm}
      importForm={importForm}
      onboardingForm={onboardingForm}
      generatedKeyset={generatedKeyset}
      saveForms={saveForms}
      onChangeCreateForm={onChangeCreateForm}
      onGenerateFresh={onGenerateFresh}
      onGenerateImported={onGenerateImported}
      onChangeImportForm={onChangeImportForm}
      onChangeOnboardingForm={onChangeOnboardingForm}
      onImportOnboardingProfile={onImportOnboardingProfile}
      onImportRawProfile={onImportRawProfile}
      onChangeSaveForm={onChangeSaveForm}
      onSaveGeneratedProfile={onSaveGeneratedProfile}
    />
  );
}
