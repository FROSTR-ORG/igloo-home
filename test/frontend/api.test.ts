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
        passphrase: 'encrypted-profile-pass',
        onboardingPassword: 'pkg-pass',
        package: 'bfonboard1demo',
      }),
    ).rejects.toThrow(/device profile already exists/i);
  });

  it('invokes staged onboarding connect with the expected payload', async () => {
    invoke.mockResolvedValueOnce({ preview: { label: 'Demo Device' } });
    const { connectOnboardingPackage } = await import('@/lib/api');

    await connectOnboardingPackage({
      onboardingPassword: 'pkg-pass',
      package: 'bfonboard1demo',
    });

    expect(invoke).toHaveBeenCalledWith('connect_onboarding_package_command', {
      input: {
        onboarding_password: 'pkg-pass',
        package: 'bfonboard1demo',
      },
    });
  });

  it('invokes staged onboarding finalize with the expected payload', async () => {
    invoke.mockResolvedValueOnce({ status: 'profile_created', profile: { id: 'demo' } });
    const { finalizeConnectedOnboarding } = await import('@/lib/api');

    await finalizeConnectedOnboarding({
      label: 'Demo Device',
      passphrase: 'encrypted-profile-pass',
    });

    expect(invoke).toHaveBeenCalledWith('finalize_connected_onboarding_command', {
      input: {
        label: 'Demo Device',
        relay_profile: null,
        passphrase: 'encrypted-profile-pass',
      },
    });
  });

  it('invokes staged onboarding discard without input payload', async () => {
    invoke.mockResolvedValueOnce({ discarded: true });
    const { discardConnectedOnboarding } = await import('@/lib/api');

    await discardConnectedOnboarding();

    expect(invoke).toHaveBeenCalledWith('discard_connected_onboarding_command');
  });

  it('invokes runtime peer refresh without extra payload', async () => {
    invoke.mockResolvedValueOnce({ attempted: 1, refreshed: 1, failures: [] });
    const { refreshRuntimePeers } = await import('@/lib/api');

    await refreshRuntimePeers();

    expect(invoke).toHaveBeenCalledWith('refresh_runtime_peers_command');
  });

  it('normalizes duplicate-profile failures for bfprofile recovery imports', async () => {
    invoke.mockRejectedValueOnce(new Error('profile abc123 already exists'));
    const { importProfileFromBfprofile } = await import('@/lib/api');

    await expect(
      importProfileFromBfprofile({
        passphrase: 'encrypted-profile-pass',
        packagePassword: 'pkg-pass',
        packageText: 'bfprofile1demo',
      }),
    ).rejects.toThrow(/device profile already exists/i);
  });
});
