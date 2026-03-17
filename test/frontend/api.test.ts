import { describe, expect, it, vi, beforeEach } from 'vitest';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}));

describe('igloo-home api import error normalization', async () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('normalizes duplicate-profile failures for onboarding imports', async () => {
    invoke.mockRejectedValueOnce(new Error('profile abc123 already exists'));
    const { importProfileFromOnboarding } = await import('@/lib/api');

    await expect(
      importProfileFromOnboarding({
        vaultPassphrase: 'vault-pass',
        onboardingPassword: 'pkg-pass',
        package: 'bfonboard1demo',
      }),
    ).rejects.toThrow(/device profile already exists/i);
  });

  it('normalizes duplicate-profile failures for bfprofile recovery imports', async () => {
    invoke.mockRejectedValueOnce(new Error('profile abc123 already exists'));
    const { importProfileFromBfprofile } = await import('@/lib/api');

    await expect(
      importProfileFromBfprofile({
        vaultPassphrase: 'vault-pass',
        packagePassword: 'pkg-pass',
        packageText: 'bfprofile1demo',
      }),
    ).rejects.toThrow(/device profile already exists/i);
  });
});
