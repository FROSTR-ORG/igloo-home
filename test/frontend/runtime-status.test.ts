import { describe, expect, it } from 'vitest';

import {
  extractPeerPermissionStates,
  extractPendingApprovals,
  extractPendingOperations,
  extractRuntimePeers,
  parseRuntimeStatus,
} from '@/lib/runtime-status';
import type { ProfileRuntimeSnapshot } from '@/lib/types';
import type { RuntimeStatusSummary } from 'igloo-shared';

const peerA = 'aa'.repeat(32);
const peerB = 'bb'.repeat(32);

function snapshot(runtimeStatus: unknown): ProfileRuntimeSnapshot {
  return {
    active: true,
    profile: null,
    runtime_status: runtimeStatus,
    readiness: null,
    runtime_diagnostics: null,
    daemon_log_path: null,
    daemon_log_lines: [],
    daemon_metadata: null,
  };
}

function runtimeStatus(overrides: Partial<RuntimeStatusSummary> = {}): RuntimeStatusSummary {
  return {
    status: {
      device_id: 'device-1',
      pending_ops: 1,
      last_active: 1,
      known_peers: 2,
      request_seq: 1,
    },
    metadata: {
      device_id: 'device-1',
      member_idx: 1,
      share_public_key: '11'.repeat(32),
      group_public_key: '22'.repeat(32),
      peers: [peerA, peerB],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 2,
      signing_peer_count: 2,
      ecdh_peer_count: 2,
      last_refresh_at: 1,
      degraded_reasons: [],
    },
    peers: [
      {
        idx: 1,
        pubkey: peerA.toUpperCase(),
        known: true,
        last_seen: 1,
        online: true,
        incoming_available: 2,
        outgoing_available: 3,
        outgoing_spent: 4,
        can_sign: true,
        can_ecdh: true,
        can_ping: true,
        should_send_nonces: false,
        last_response_latency_ms: 12,
        avg_latency_ms: 15,
        nonce_history: [{ ts: 1, held: 2 }],
      },
    ],
    peer_permission_states: [
      {
        pubkey: peerB,
        manual_override: {
          request: { ping: 'allow', onboard: 'unset', sign: 'ask', ecdh: 'deny' },
          respond: { ping: 'unset', onboard: 'allow', sign: 'deny', ecdh: 'ask' },
        },
        remote_observation: {
          request: { ping: true, onboard: false, sign: true, ecdh: false },
          respond: { ping: false, onboard: true, sign: false, ecdh: true },
          updated: 10,
          revision: 2,
        },
        effective_policy: {
          request: { ping: true, onboard: false, sign: true, ecdh: false },
          respond: { ping: false, onboard: true, sign: false, ecdh: true },
        },
      },
    ],
    pending_operations: [
      {
        op_type: 'Sign',
        request_id: 'op-1',
        started_at: 1000,
        timeout_at: 2000,
        target_peers: [peerA, 5 as unknown as string],
        threshold: 2,
        collected_responses: ['ok'],
        context: {},
      },
    ],
    pending_approvals: [
      {
        request_id: 'approval-1',
        peer: peerA,
        method: 'sign',
        queued_at: 1000,
        expires_at: 2000,
      },
    ],
    ...overrides,
  };
}

describe('parseRuntimeStatus', () => {
  it('accepts runtime status objects with a peers array and rejects non-status values', () => {
    const status = runtimeStatus();
    expect(parseRuntimeStatus(status)).toBe(status);
    expect(parseRuntimeStatus(null)).toBeNull();
    expect(parseRuntimeStatus({ peers: 'not-array' })).toBeNull();
  });
});

describe('runtime status extractors', () => {
  it('extracts peer permission states with defaults for missing nested policy fields', () => {
    const [state] = extractPeerPermissionStates(snapshot(runtimeStatus()));
    expect(state).toEqual({
      pubkey: peerB,
      manualOverride: {
        request: { ping: 'allow', onboard: 'unset', sign: 'ask', ecdh: 'deny' },
        respond: { ping: 'unset', onboard: 'allow', sign: 'deny', ecdh: 'ask' },
      },
      remoteObservation: {
        request: { ping: true, onboard: false, sign: true, ecdh: false },
        respond: { ping: false, onboard: true, sign: false, ecdh: true },
        updated: 10,
        revision: 2,
      },
      effectivePolicy: {
        request: { ping: true, onboard: false, sign: true, ecdh: false },
        respond: { ping: false, onboard: true, sign: false, ecdh: true },
      },
    });

    const [defaulted] = extractPeerPermissionStates(snapshot(runtimeStatus({
      peer_permission_states: [
        {
          pubkey: peerA,
          manual_override: {},
          remote_observation: null,
          effective_policy: {},
        },
      ],
    } as Partial<RuntimeStatusSummary>)));
    expect(defaulted.manualOverride.request).toEqual({
      ping: 'unset',
      onboard: 'unset',
      sign: 'unset',
      ecdh: 'unset',
    });
    expect(defaulted.effectivePolicy.respond).toEqual({
      ping: false,
      onboard: false,
      sign: false,
      ecdh: false,
    });
  });

  it('extracts runtime peer rows from live peers, roster peers, and policy-only peers', () => {
    const rows = extractRuntimePeers(snapshot(runtimeStatus()));
    expect(rows.map((row) => row.pubkey)).toEqual([peerA, peerB]);
    expect(rows.find((row) => row.pubkey === peerA)).toEqual(expect.objectContaining({
      state: 'online',
      canSign: true,
      canEcdh: true,
      canPing: true,
    }));
    expect(rows.find((row) => row.pubkey === peerB)).toEqual(expect.objectContaining({
      state: 'idle',
    }));
  });

  it('extracts pending operations with normalized response counts and string target peers', () => {
    expect(extractPendingOperations(snapshot(runtimeStatus()))).toEqual([
      {
        request_id: 'op-1',
        op_type: 'Sign',
        threshold: 2,
        started_at: 1000,
        timeout_at: 2000,
        collected_responses: 1,
        target_peers: [peerA],
      },
    ]);
  });

  it('extracts pending approvals using the aliases from peer rows', () => {
    const status = runtimeStatus();
    const peers = extractRuntimePeers(snapshot(status));
    expect(extractPendingApprovals(snapshot(status), peers)).toEqual([
      expect.objectContaining({
        id: 'approval-1',
        method: 'sign',
        methodLabel: 'SIGN',
        peerLabel: 'Peer #2',
        pubkey: peerA,
      }),
    ]);
  });

  it('returns empty collections for missing or malformed runtime status', () => {
    const invalid = snapshot({ peers: 'not-array' });
    expect(extractPeerPermissionStates(invalid)).toEqual([]);
    expect(extractRuntimePeers(invalid)).toEqual([]);
    expect(extractPendingOperations(invalid)).toEqual([]);
    expect(extractPendingApprovals(invalid, [])).toEqual([]);
  });
});
