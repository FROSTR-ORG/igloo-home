// Maps igloo-home's runtime/permission data onto the Paper-redesigned igloo-ui
// dashboard view-models (`SignerDashboardViewModel` / `PolicyDashboardViewModel`).
// The reconciled igloo-ui panels (`OperatorSignerPanel` / `OperatorPermissionsPanel`)
// take a single `view` model instead of the previous loose props; this module is
// the desktop-host equivalent of igloo-pwa's dashboard view derivation.
import type {
  PeerReadinessRowModel,
  PendingApprovalRowModel,
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
    const isError = line.startsWith('[error]');
    const isWarn = line.startsWith('[warn]');
    return {
      id: `home-log-${index}`,
      badgeLabel: isError ? 'ERROR' : isWarn ? 'WARN' : 'INFO',
      badgeTone: isError ? 'danger' : isWarn ? 'warning' : 'info',
      message: line.replace(/^\[[^\]]+\]\s*/, ''),
    };
  });
}

export function buildSignerDashboardView(input: {
  profileName: string | null;
  groupPublicKey?: string;
  sharePublicKey?: string;
  memberIdx?: number;
  running: boolean;
  peers: PeerReadinessRowModel[];
  pendingApprovals?: PendingApprovalRowModel[];
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
    peerRows: input.peers,
    pendingApprovalRows: input.pendingApprovals ?? [],
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
