import { describe, expect, it } from 'vitest';

import { buildSignerDashboardView } from '@/lib/dashboard-view';

describe('home dashboard view model', () => {
  it('maps structured daemon log domains onto Paper event badge tones', () => {
    const view = buildSignerDashboardView({
      profileName: 'Alice Laptop',
      running: true,
      peers: [],
      pendingOperations: [],
      logLines: [
        '[info] sync.pool_refresh',
        '[info] sign.request_received',
        '[info] ecdh.request_processed',
        '[warn] signer policy.policy_required',
        '[info] ping.sweep',
        '[info] echo.published',
        '[warn] plain warning',
        '  [ERROR] padded error',
        '[WARN] uppercase warning',
      ],
    });

    expect(view?.eventRows.map((row) => [row.badgeLabel, row.badgeTone])).toEqual([
      ['sync', 'sync'],
      ['sign', 'success'],
      ['ecdh', 'ecdh'],
      ['signer policy', 'policy'],
      ['ping', 'ping'],
      ['echo', 'echo'],
      ['WARN', 'warning'],
      ['ERROR', 'danger'],
      ['WARN', 'warning'],
    ]);
  });
});
