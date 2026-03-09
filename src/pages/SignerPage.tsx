import { SignerSessionPanel } from 'igloo-ui';

import type { ProfileManifest, ProfileRuntimeSnapshot } from '@/lib/types';

type Props = {
  selectedProfile: ProfileManifest | null;
  vaultPassphrase: string;
  runtimeSnapshot: ProfileRuntimeSnapshot | null;
  onChangeVaultPassphrase: (value: string) => void;
  onStartSigner: () => void;
  onStopSigner: () => void;
  onRefreshSigner: () => void;
};

export default function SignerPage({
  selectedProfile,
  vaultPassphrase,
  runtimeSnapshot,
  onChangeVaultPassphrase,
  onStartSigner,
  onStopSigner,
  onRefreshSigner,
}: Props) {
  return (
    <SignerSessionPanel
      selectedProfile={selectedProfile}
      vaultPassphrase={vaultPassphrase}
      runtimeSnapshot={runtimeSnapshot}
      onChangeVaultPassphrase={onChangeVaultPassphrase}
      onStartSigner={onStartSigner}
      onStopSigner={onStopSigner}
      onRefreshSigner={onRefreshSigner}
    />
  );
}
