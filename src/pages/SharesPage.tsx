import { ManagedProfilesPanel } from 'igloo-ui';

import type { ProfileManifest } from '@/lib/types';

type Props = {
  profiles: ProfileManifest[];
  selectedProfileId: string;
  selectedProfile: ProfileManifest | null;
  vaultPassphrase: string;
  onSelectProfile: (profileId: string) => void;
  onChangeVaultPassphrase: (value: string) => void;
  onDelete: (profileId: string) => void;
  onExport: (profileId: string) => void;
  onRefresh: () => void;
};

export default function SharesPage({
  profiles,
  selectedProfileId,
  selectedProfile,
  vaultPassphrase,
  onSelectProfile,
  onChangeVaultPassphrase,
  onDelete,
  onExport,
  onRefresh,
}: Props) {
  return (
    <ManagedProfilesPanel
      profiles={profiles}
      selectedProfileId={selectedProfileId}
      selectedProfile={selectedProfile}
      vaultPassphrase={vaultPassphrase}
      onSelectProfile={onSelectProfile}
      onChangeVaultPassphrase={onChangeVaultPassphrase}
      onDelete={onDelete}
      onExport={onExport}
      onRefresh={onRefresh}
    />
  );
}
