import { describe, expect, it, vi, beforeEach } from 'vitest';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}));

// The Rust signer owns the real decrypt; these tests cover the thin TS boundary
// that maps the typed HomeError discriminated union ({ kind, detail }) the Tauri
// commands reject with into the user-facing message. Real adversarial crypto
// (wrong passphrase / corrupted package) is exercised in src-tauri (audit R6.4
// `recover_rotate_tests`); here we only prove the failure surfaces correctly.
describe('igloo-home decrypt failure normalization', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('maps invalid_passphrase to the unlock message', async () => {
    const { homeErrorMessageForUser } = await import('@/lib/api');
    expect(homeErrorMessageForUser({ kind: 'invalid_passphrase', detail: null })).toBe(
      'Incorrect passphrase.',
    );
  });

  it('maps invalid_package to a message carrying the reason', async () => {
    const { homeErrorMessageForUser } = await import('@/lib/api');
    expect(
      homeErrorMessageForUser({ kind: 'invalid_package', detail: { reason: 'bad checksum' } }),
    ).toBe('Invalid package: bad checksum');
  });

  it('surfaces "Incorrect passphrase." when a bfprofile import unlock fails', async () => {
    invoke.mockRejectedValueOnce({ kind: 'invalid_passphrase', detail: null });
    const { importProfileFromBfprofile } = await import('@/lib/api');

    await expect(
      importProfileFromBfprofile({
        passphrase: 'encrypted-profile-pass',
        packagePassword: 'wrong-pkg-pass',
        packageText: 'bfprofile1demo',
      }),
    ).rejects.toThrow('Incorrect passphrase.');
  });

  it('surfaces the package reason when an onboarding connect rejects an invalid package', async () => {
    invoke.mockRejectedValueOnce({ kind: 'invalid_package', detail: { reason: 'corrupted' } });
    const { connectOnboardingPackage } = await import('@/lib/api');

    await expect(
      connectOnboardingPackage({
        onboardingPassword: 'pkg-pass',
        package: 'bfonboard1corrupt',
      }),
    ).rejects.toThrow(/Invalid package: corrupted/);
  });
});
