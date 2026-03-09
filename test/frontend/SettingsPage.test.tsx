import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/pages/SettingsPage';

describe('SettingsPage', () => {
  it('emits toggle changes', () => {
    const onToggle = vi.fn();
    render(
      <SettingsPage
        settings={{
          close_to_tray: false,
          launch_on_login: true,
          reopen_last_session: false,
        }}
        onToggle={onToggle}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /close to tray/i });
    fireEvent.click(checkbox);

    expect(onToggle).toHaveBeenCalledWith('close_to_tray', true);
  });
});
