/**
 * Single boundary between the untyped Tauri IPC `runtime_status` JSON snapshot
 * and the typed `RuntimeStatusSummary` shared wire shape.
 *
 * The signer runtime lives in Rust; the desktop frontend reads a JSON
 * projection over IPC and previously parsed it with dozens of inline
 * `as Record<string, unknown>` casts. This module is the ONE place where the
 * IPC `unknown` becomes a typed value: light structural validation (it is an
 * object that carries the runtime status' top-level keys), then a cast to the
 * shared type. Anything that does not look like a status summary returns
 * `null` so callers fall back to empty/known-peer-only views.
 *
 * The import is TYPE-ONLY (erased at compile time): no igloo-shared runtime is
 * pulled into the desktop bundle.
 */
import {
  buildPeerReadinessRows,
  buildPendingApprovalRows,
  type PeerReadinessRowModel,
  type PendingApprovalRowModel,
} from 'igloo-ui';
import type {
  RuntimePeerPermissionState,
  RuntimePeerStatus,
  RuntimePendingOperation,
  RuntimeStatusSummary,
} from 'igloo-shared';
import type { HomePeerPermissionState, HomePendingOperation } from './dashboard-view';
import type { ProfileRuntimeSnapshot } from './types';

/**
 * Validate and type the raw IPC `runtime_status` value.
 *
 * Returns the value typed as `RuntimeStatusSummary` when it is a plain object
 * carrying the expected top-level keys (`peers` array, plus the status/metadata
 * envelope the runtime always emits), otherwise `null`. Fields are not deeply
 * validated here — downstream readers already guard individual field types — so
 * this stays a cheap boundary check, not a schema validator.
 */
export function parseRuntimeStatus(raw: unknown): RuntimeStatusSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  // `peers` is the load-bearing array the desktop UI reads; the runtime always
  // emits it (possibly empty) alongside the status/metadata envelope. Treat its
  // absence as "not a status summary".
  if (!Array.isArray(candidate.peers)) return null;
  return candidate as unknown as RuntimeStatusSummary;
}

export function extractPeerPermissionStates(runtimeSnapshot: ProfileRuntimeSnapshot | null): HomePeerPermissionState[] {
  const runtimeStatus = parseRuntimeStatus(runtimeSnapshot?.runtime_status ?? null);
  const fromRuntime = runtimeStatus?.peer_permission_states;
  if (!Array.isArray(fromRuntime)) return [];
  return fromRuntime
    .map((policy: RuntimePeerPermissionState): HomePeerPermissionState | null => {
      if (typeof policy !== 'object' || policy === null) return null;
      if (typeof policy.pubkey !== 'string') return null;
      const manualOverride = policy.manual_override;
      const remoteObservation = policy.remote_observation;
      const effectivePolicy = policy.effective_policy;
      return {
        pubkey: policy.pubkey,
        manualOverride: {
          request: {
            ping: manualOverride?.request?.ping ?? 'unset',
            onboard: manualOverride?.request?.onboard ?? 'unset',
            sign: manualOverride?.request?.sign ?? 'unset',
            ecdh: manualOverride?.request?.ecdh ?? 'unset',
          },
          respond: {
            ping: manualOverride?.respond?.ping ?? 'unset',
            onboard: manualOverride?.respond?.onboard ?? 'unset',
            sign: manualOverride?.respond?.sign ?? 'unset',
            ecdh: manualOverride?.respond?.ecdh ?? 'unset',
          },
        },
        remoteObservation:
          remoteObservation && typeof remoteObservation === 'object'
            ? {
                request: {
                  ping: Boolean(remoteObservation.request?.ping),
                  onboard: Boolean(remoteObservation.request?.onboard),
                  sign: Boolean(remoteObservation.request?.sign),
                  ecdh: Boolean(remoteObservation.request?.ecdh),
                },
                respond: {
                  ping: Boolean(remoteObservation.respond?.ping),
                  onboard: Boolean(remoteObservation.respond?.onboard),
                  sign: Boolean(remoteObservation.respond?.sign),
                  ecdh: Boolean(remoteObservation.respond?.ecdh),
                },
                updated: Number(remoteObservation.updated ?? 0),
                revision: Number(remoteObservation.revision ?? 0),
              }
            : null,
        effectivePolicy: {
          request: {
            ping: Boolean(effectivePolicy?.request?.ping),
            onboard: Boolean(effectivePolicy?.request?.onboard),
            sign: Boolean(effectivePolicy?.request?.sign),
            ecdh: Boolean(effectivePolicy?.request?.ecdh),
          },
          respond: {
            ping: Boolean(effectivePolicy?.respond?.ping),
            onboard: Boolean(effectivePolicy?.respond?.onboard),
            sign: Boolean(effectivePolicy?.respond?.sign),
            ecdh: Boolean(effectivePolicy?.respond?.ecdh),
          },
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function extractRuntimePeers(runtimeSnapshot: ProfileRuntimeSnapshot | null): PeerReadinessRowModel[] {
  const runtimeStatus = parseRuntimeStatus(runtimeSnapshot?.runtime_status ?? null);
  const peers: RuntimePeerStatus[] = Array.isArray(runtimeStatus?.peers) ? runtimeStatus.peers : [];
  const rosterPubkeys: string[] = Array.isArray(runtimeStatus?.metadata?.peers)
    ? runtimeStatus.metadata.peers
    : [];
  return buildPeerReadinessRows({
    peers,
    rosterPubkeys,
    policyPubkeys: extractPeerPermissionStates(runtimeSnapshot).map((entry) => entry.pubkey),
  });
}

export function extractPendingOperations(runtimeSnapshot: ProfileRuntimeSnapshot | null): HomePendingOperation[] {
  const runtimeStatus = parseRuntimeStatus(runtimeSnapshot?.runtime_status ?? null);
  const fromRuntime = runtimeStatus?.pending_operations;
  if (!Array.isArray(fromRuntime)) return [];
  return fromRuntime
    .map((operation: RuntimePendingOperation): HomePendingOperation | null => {
      if (!operation || typeof operation !== 'object') return null;
      if (typeof operation.request_id !== 'string' || typeof operation.op_type !== 'string') return null;
      return {
        request_id: operation.request_id,
        op_type: operation.op_type,
        threshold: typeof operation.threshold === 'number' ? operation.threshold : 0,
        started_at: typeof operation.started_at === 'number' ? operation.started_at : null,
        timeout_at: typeof operation.timeout_at === 'number' ? operation.timeout_at : null,
        collected_responses: Array.isArray(operation.collected_responses) ? operation.collected_responses.length : 0,
        target_peers: Array.isArray(operation.target_peers)
          ? operation.target_peers.filter((peer): peer is string => typeof peer === 'string')
          : [],
      };
    })
    .filter((entry): entry is HomePendingOperation => entry !== null);
}

export function extractPendingApprovals(
  runtimeSnapshot: ProfileRuntimeSnapshot | null,
  peers: PeerReadinessRowModel[],
): PendingApprovalRowModel[] {
  const runtimeStatus = parseRuntimeStatus(runtimeSnapshot?.runtime_status ?? null);
  const approvals = Array.isArray(runtimeStatus?.pending_approvals) ? runtimeStatus.pending_approvals : [];
  return buildPendingApprovalRows({
    approvals,
    peerAliases: Object.fromEntries(peers.map((row) => [row.pubkey, row.alias])),
  });
}
