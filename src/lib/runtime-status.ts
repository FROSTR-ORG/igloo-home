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
import type { RuntimeStatusSummary } from 'igloo-shared';

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
