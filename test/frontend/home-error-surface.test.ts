import { describe, expect, it, vi } from 'vitest';

// Importing @/lib/api pulls in @tauri-apps/api/core at module load; mock it so
// the import resolves without a Tauri host. The functions under test are pure
// and never call invoke().
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const { homeErrorMessageForUser, isHomeError } = await import('@/lib/api');
type HomeErrorPayload = Parameters<typeof homeErrorMessageForUser>[0];

// R3 / Bucket I (home-error-surface): drive every HomeError variant (Bucket E
// PR23) through the frontend typed-error surface. The full HomeError round-trip
// is also exercised end-to-end via importProfile* in api.test.ts; this pins the
// per-variant user-message mapping and the discriminator type guard directly,
// with no Tauri/relay infra (the @live desktop e2e lane can't run here).

describe('homeErrorMessageForUser', () => {
  const cases: Array<{ err: HomeErrorPayload; expected: string }> = [
    {
      err: { kind: 'profile_already_exists', detail: { id: 'abc' } },
      expected:
        'Device profile already exists. Delete the existing device profile before importing this share.',
    },
    { err: { kind: 'invalid_passphrase', detail: null }, expected: 'Incorrect passphrase.' },
    {
      err: { kind: 'invalid_package', detail: { reason: 'bad bech32m' } },
      expected: 'Invalid package: bad bech32m',
    },
    {
      err: { kind: 'onboarding_pending', detail: { profile_id: 'p-1' } },
      expected: 'An onboarding operation is already in progress for profile p-1.',
    },
    {
      err: { kind: 'path_outside_allowed_roots', detail: { path: '/etc/x' } },
      expected: 'Path /etc/x is outside the allowed scope.',
    },
    { err: { kind: 'session_not_active', detail: null }, expected: 'No active signer session.' },
    { err: { kind: 'runtime', detail: { message: 'pump stalled' } }, expected: 'pump stalled' },
    { err: { kind: 'bifrost', detail: { message: 'threshold not met' } }, expected: 'threshold not met' },
    {
      err: { kind: 'internal', detail: { message: 'boom' } },
      expected: 'Internal error: boom',
    },
  ];

  it.each(cases)('maps the $err.kind variant to its user message', ({ err, expected }) => {
    expect(homeErrorMessageForUser(err)).toBe(expected);
  });

  it('covers every declared HomeError variant', () => {
    const covered = new Set(cases.map((c) => c.err.kind));
    expect(covered.size).toBe(9);
  });
});

describe('isHomeError', () => {
  it('accepts every known kind', () => {
    for (const kind of [
      'profile_already_exists',
      'invalid_passphrase',
      'invalid_package',
      'onboarding_pending',
      'path_outside_allowed_roots',
      'session_not_active',
      'runtime',
      'bifrost',
      'internal',
    ]) {
      expect(isHomeError({ kind, detail: null })).toBe(true);
    }
  });

  it('rejects non-objects, missing/unknown kinds, and plain Errors', () => {
    expect(isHomeError(null)).toBe(false);
    expect(isHomeError('profile_already_exists')).toBe(false);
    expect(isHomeError({ detail: null })).toBe(false);
    expect(isHomeError({ kind: 'not_a_real_kind' })).toBe(false);
    expect(isHomeError(new Error('profile abc already exists'))).toBe(false);
  });
});
