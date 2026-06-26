// Maps igloo-home's runtime/permission data onto the Paper-redesigned igloo-ui
// dashboard view-models (`SignerDashboardViewModel` / `PolicyDashboardViewModel`).
// The reconciled igloo-ui panels (`OperatorSignerPanel` / `OperatorPermissionsPanel`)
// take a single `view` model instead of the previous loose props; this module is
// the desktop-host equivalent of igloo-pwa's dashboard view derivation.
import type {
  PeerPolicy,
  PeerReadinessRowModel,
  PendingOperationRowModel,
  PeerPolicyRowModel,
  PolicyMethodOverrideState,
  PolicyMethodState,
  PolicyDashboardViewModel,
  SignerDashboardViewModel,
  EventLogRowModel,
} from 'igloo-ui';

// Internal shapes produced by App.tsx's `extract*` helpers. These used to be the
// igloo-ui `Operator*` exports, which the Paper redesign moved into view-models;
// the desktop host keeps its own narrow copies for its runtime parsing.
export type HomePeerPermissionState = {
  pubkey: string;
  manualOverride: { request: PolicyMethodOverrideState; respond: PolicyMethodOverrideState };
  remoteObservation: {
    request: PolicyMethodState;
    respond: PolicyMethodState;
    updated: number;
    revision: number;
  } | null;
  effectivePolicy: { request: PolicyMethodState; respond: PolicyMethodState };
};

export type HomePendingOperation = {
  request_id: string;
  op_type: string;
  threshold: number;
  started_at: number | null;
  timeout_at: number | null;
  collected_responses: number;
  target_peers: string[];
};

function formatTimestamp(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return undefined;
  }
}

function toReadinessRow(peer: PeerPolicy): PeerReadinessRowModel {
  return {
    id: peer.pubkey,
    alias: peer.alias,
    pubkey: peer.pubkey,
    state: peer.state,
    statusLabel: peer.statusLabel ?? peer.state,
    lastSeenLabel: peer.lastSeen ? `last seen ${formatTimestamp(peer.lastSeen)}` : undefined,
    incomingAvailable: peer.incomingAvailable,
    outgoingAvailable: peer.outgoingAvailable,
    outgoingSpent: peer.outgoingSpent,
  };
}

function toPendingRow(op: HomePendingOperation): PendingOperationRowModel {
  return {
    id: op.request_id,
    operationLabel: op.op_type,
    thresholdLabel: op.threshold > 0 ? `threshold ${op.threshold}` : 'threshold n/a',
    startedLabel: formatTimestamp(op.started_at) ? `started ${formatTimestamp(op.started_at)}` : 'started n/a',
    timeoutLabel: formatTimestamp(op.timeout_at) ? `times out ${formatTimestamp(op.timeout_at)}` : 'no timeout',
    responseLabel:
      op.threshold > 0 ? `${op.collected_responses}/${op.threshold} responses` : `${op.collected_responses} responses`,
  };
}

function toPolicyRow(state: HomePeerPermissionState): PeerPolicyRowModel {
  return {
    pubkey: state.pubkey,
    request: state.effectivePolicy.request,
    respond: state.effectivePolicy.respond,
    manualOverride: {
      request: state.manualOverride.request,
      respond: state.manualOverride.respond,
    },
  };
}

function toEventRows(lines: string[] = []): EventLogRowModel[] {
  return lines.map((line, index) => {
    return {
      id: `home-log-${index}`,
      badgeLabel: deriveLogBadgeLabel(line),
      badgeTone: deriveLogBadgeTone(line),
      message: line.replace(/^\[[^\]]+\]\s*/, ''),
    };
  });
}

const LOG_LEVELS = new Set(['info', 'warn', 'error']);

function deriveLogDomain(line: string): string | null {
  let rest = line.trim();

  for (;;) {
    const bracketMatch = rest.match(/^\[([^\]]+)\]\s*/);
    if (!bracketMatch) break;

    const token = normalizeLogDomain(bracketMatch[1]);
    rest = rest.slice(bracketMatch[0].length);
    if (!LOG_LEVELS.has(token)) return token;
  }

  const structuredMatch = rest.match(/^(.+?)\.[A-Za-z0-9_-]+(?:\s|$)/);
  return structuredMatch ? normalizeLogDomain(structuredMatch[1]) : null;
}

function normalizeLogDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'policy') return 'signer policy';
  return normalized;
}

function deriveLogBadgeLabel(line: string): string {
  const domain = deriveLogDomain(line);
  if (domain) return domain;
  if (line.startsWith('[error]')) return 'ERROR';
  if (line.startsWith('[warn]')) return 'WARN';
  return 'INFO';
}

function deriveLogBadgeTone(line: string): EventLogRowModel['badgeTone'] {
  if (line.startsWith('[error]')) return 'danger';
  const domain = deriveLogDomain(line);
  if (domain === 'sync') return 'sync';
  if (domain === 'sign') return 'success';
  if (domain === 'ecdh') return 'ecdh';
  if (domain === 'ping') return 'ping';
  if (domain === 'echo') return 'echo';
  if (domain === 'signer policy') return 'policy';
  if (line.startsWith('[warn]')) return 'warning';
  return 'info';
}

export function buildSignerDashboardView(input: {
  profileName: string | null;
  groupPublicKey?: string;
  sharePublicKey?: string;
  memberIdx?: number;
  running: boolean;
  peers: PeerPolicy[];
  pendingOperations: HomePendingOperation[];
  logLines?: string[];
}): SignerDashboardViewModel | null {
  if (!input.profileName) return null;
  return {
    profileName: input.profileName,
    thresholdLabel: 'threshold n/a',
    memberLabel: typeof input.memberIdx === 'number' ? `Share #${input.memberIdx}` : undefined,
    publicKeyLabel: input.groupPublicKey ?? '',
    shareLabel: input.sharePublicKey ?? '',
    running: input.running,
    readinessLabel: input.running ? 'Signer online' : 'Signer stopped',
    relaySummary: input.running ? 'Desktop runtime connected' : 'Runtime stopped',
    peerRows: input.peers.map(toReadinessRow),
    pendingApprovalRows: [],
    pendingOperationRows: input.pendingOperations.map(toPendingRow),
    eventRows: toEventRows(input.logLines),
  };
}

export function buildPolicyDashboardView(
  states: HomePeerPermissionState[],
  active: boolean,
): PolicyDashboardViewModel {
  return {
    peerRows: active ? states.map(toPolicyRow) : [],
  };
}
