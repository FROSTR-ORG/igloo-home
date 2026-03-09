import { RecoveryWorkspace } from 'igloo-ui';

import type { RecoveredKey } from '@/lib/types';

type Props = {
  recoverForm: {
    groupPackageJson: string;
    sharePackageJsons: string[];
  };
  recoveredKey: RecoveredKey | null;
  onChangeGroup: (value: string) => void;
  onChangeShare: (index: number, value: string) => void;
  onAddShareSlot: (value?: string) => void;
  onRecover: () => void;
};

export default function RecoverPage({
  recoverForm,
  recoveredKey,
  onChangeGroup,
  onChangeShare,
  onAddShareSlot,
  onRecover,
}: Props) {
  return (
    <RecoveryWorkspace
      recoverForm={recoverForm}
      recoveredKey={recoveredKey}
      onChangeGroup={onChangeGroup}
      onChangeShare={onChangeShare}
      onAddShareSlot={onAddShareSlot}
      onRecover={onRecover}
    />
  );
}
