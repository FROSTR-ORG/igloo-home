import { ManagedProfilesPanel } from 'igloo-ui';
import { shortProfileId } from '@/lib/profileIdentity';

import type { ProfileManifest } from '@/lib/types';

type Props = {
  profiles: ProfileManifest[];
  selectedProfileId: string;
  activeProfileId?: string | null;
  selectedProfile: ProfileManifest | null;
  vaultPassphrase: string;
  onSelectProfile: (profileId: string) => void;
  onOpenSigner?: (profileId: string) => void;
  onActivateProfile?: (profileId: string) => void;
  onStopActiveProfile?: () => void;
  onChangeVaultPassphrase: (value: string) => void;
  onDelete: (profileId: string) => void;
  onExport: (profileId: string) => void;
  onRefresh: () => void;
};

export default function SharesPage({
  profiles,
  selectedProfileId,
  activeProfileId,
  selectedProfile,
  vaultPassphrase,
  onSelectProfile,
  onOpenSigner,
  onActivateProfile,
  onStopActiveProfile,
  onChangeVaultPassphrase,
  onDelete,
  onExport,
  onRefresh,
}: Props) {
  return (
    <ManagedProfilesPanel
      profiles={profiles.map((profile) => ({
        ...profile,
        display_id: shortProfileId(profile.id),
      }))}
      selectedProfileId={selectedProfileId}
      activeProfileId={activeProfileId}
      selectedProfile={
        selectedProfile
          ? {
              ...selectedProfile,
              display_id: shortProfileId(selectedProfile.id),
            }
          : null
      }
      vaultPassphrase={vaultPassphrase}
      onSelectProfile={onSelectProfile}
      onOpenSigner={onOpenSigner}
      onActivateProfile={onActivateProfile}
      onStopActiveProfile={onStopActiveProfile}
      onChangeVaultPassphrase={onChangeVaultPassphrase}
      onDelete={onDelete}
      onExport={onExport}
      onRefresh={onRefresh}
    />
  );
}
