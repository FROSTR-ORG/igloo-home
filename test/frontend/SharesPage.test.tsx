import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SharesPage from '@/pages/SharesPage';

describe('SharesPage', () => {
  it('renders managed profiles and dispatches selection', () => {
    const onSelectProfile = vi.fn();
    render(
      <SharesPage
        profiles={[
          {
            id: 'desk-share',
            label: 'Desk Share',
            group_ref: '/tmp/group.json',
            share_ref: 'vault-1',
            relay_profile: 'local',
            runtime_options: null,
            policy_overrides: null,
            state_path: '/tmp/state.bin',
            daemon_socket_path: '/tmp/daemon.sock',
            created_at: 1,
            last_used_at: null,
          },
        ]}
        selectedProfileId=""
        selectedProfile={null}
        vaultPassphrase=""
        onSelectProfile={onSelectProfile}
        onChangeVaultPassphrase={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /desk share/i }));
    expect(onSelectProfile).toHaveBeenCalledWith('desk-share');
  });
});
