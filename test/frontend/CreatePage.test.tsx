import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreatePage from '@/pages/CreatePage';

describe('CreatePage', () => {
  it('switches into rotate mode and captures threshold bfshare inputs', () => {
    const onChangeCreateForm = vi.fn();
    const onAddRotationSource = vi.fn();
    render(
      <CreatePage
        createForm={{ mode: 'rotate', threshold: '2', count: '3', sourceProfileId: '' }}
        availableProfiles={[{ id: 'alice', label: 'Alice Laptop' }]}
        rotationSources={[{ packageText: '', packagePassword: '' }]}
        generatedKeyset={null}
        saveForms={{}}
        selectedMemberIdx={null}
        distributionForms={{}}
        distributionResults={{}}
        onChangeCreateForm={onChangeCreateForm}
        onChangeRotationSource={vi.fn()}
        onAddRotationSource={onAddRotationSource}
        onRemoveRotationSource={vi.fn()}
        onGenerateFresh={vi.fn()}
        onChangeSaveForm={vi.fn()}
        onSaveGeneratedProfile={vi.fn()}
        onChangeDistributionForm={vi.fn()}
        onDistributeShare={vi.fn()}
        onFinishDistribution={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create New Keyset' }));
    expect(onChangeCreateForm).toHaveBeenCalledWith('mode', 'new');
    expect(screen.getByRole('button', { name: 'Add bfshare Source' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add bfshare Source' }));
    expect(onAddRotationSource).toHaveBeenCalledTimes(1);
  });
});
