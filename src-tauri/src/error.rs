//! Typed IPC error type for every `#[tauri::command]` in this crate.
//!
//! Replaces the legacy `Result<T, String>` return type on Tauri commands
//! with a discriminated union that the renderer consumes as a
//! `HomeErrorPayload` in `src/lib/api.ts`. The shape is stable:
//! `{ "kind": "<snake_case_variant>", "detail": <payload_or_null> }`.
//!
//! Error messages that cross the IPC boundary go through
//! [`scrub_for_display`] first to strip hex runs that may encode key
//! material and to bound the output length.

use crate::path_scope::PathScopeError;

/// Maximum length of a scrubbed error message crossing the IPC boundary.
const SCRUB_MAX_LEN: usize = 512;

/// Minimum hex-run length treated as "probably key material" and redacted
/// from operator-visible error messages. 32 chars of hex = 128 bits; below
/// that we treat it as ordinary identifier/path text.
const SCRUB_HEX_REDACT_MIN: usize = 32;

/// Typed error surfaced by every Tauri command.
///
/// Serializes as `{"kind": "<variant>", "detail": <payload>}` via serde's
/// internally-tagged enum representation. The frontend consumes the
/// corresponding `HomeErrorPayload` discriminated union and renders a
/// human-friendly message without regex-matching on strings.
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum HomeError {
    /// A profile with the given id is already managed by this host.
    #[error("profile already exists")]
    ProfileAlreadyExists { id: String },

    /// Passphrase could not decrypt the profile.
    #[error("invalid passphrase")]
    InvalidPassphrase,

    /// Encrypted profile package could not be decoded.
    #[error("invalid package")]
    InvalidPackage { reason: String },

    /// An onboarding operation is already in progress for this profile.
    #[error("onboarding already pending")]
    OnboardingPending { profile_id: String },

    /// Path canonicalized to a location outside the allowed roots.
    #[error("path outside allowed roots")]
    PathOutsideAllowedRoots { path: String },

    /// Session is not active for the requested profile.
    #[error("session not active")]
    SessionNotActive,

    /// Tauri runtime or plugin error (opaque internal error).
    #[error("runtime error")]
    Runtime { message: String },

    /// Bifrost-rs returned an error. `message` has been scrubbed of any
    /// hex runs that might contain key material.
    #[error("bifrost error")]
    Bifrost { message: String },

    /// Unexpected internal error. Should not happen in normal operation.
    #[error("internal error")]
    Internal { message: String },
}

/// Catch-all conversion from `anyhow::Error`. Inspects the root-cause
/// string for a small set of well-known patterns emitted by
/// `bifrost-profile` / `bifrost-app` so we surface them as explicit typed
/// variants; anything unrecognized falls through to [`HomeError::Bifrost`].
///
/// The upstream `bifrost_profile` and `bifrost_app::host` modules return
/// `anyhow::Result` today rather than typed enums (verified 2026-04-20),
/// so we lift known patterns here. When those crates grow typed errors,
/// this conversion should be replaced with explicit `From<...>` impls per
/// crate.
impl From<anyhow::Error> for HomeError {
    fn from(error: anyhow::Error) -> Self {
        let raw = error.to_string();
        if let Some(id) = parse_profile_already_exists(&raw) {
            return HomeError::ProfileAlreadyExists { id };
        }
        if raw.contains("no active signer session") || raw.contains("no active session") {
            return HomeError::SessionNotActive;
        }
        HomeError::Bifrost {
            message: scrub_for_display(&raw),
        }
    }
}

impl From<PathScopeError> for HomeError {
    fn from(error: PathScopeError) -> Self {
        match error {
            PathScopeError::OutsideAllowedRoots { path, .. } => {
                HomeError::PathOutsideAllowedRoots {
                    path: path.display().to_string(),
                }
            }
            other => HomeError::Runtime {
                message: scrub_for_display(&other.to_string()),
            },
        }
    }
}

impl From<std::io::Error> for HomeError {
    fn from(error: std::io::Error) -> Self {
        HomeError::Runtime {
            message: scrub_for_display(&error.to_string()),
        }
    }
}

impl From<serde_json::Error> for HomeError {
    fn from(error: serde_json::Error) -> Self {
        HomeError::Internal {
            message: scrub_for_display(&error.to_string()),
        }
    }
}

impl From<tauri::Error> for HomeError {
    fn from(error: tauri::Error) -> Self {
        HomeError::Runtime {
            message: scrub_for_display(&error.to_string()),
        }
    }
}

/// Scrub a free-form error string before it crosses the IPC boundary:
///
/// - Replace any run of `[0-9a-fA-F]` characters of length >=
///   [`SCRUB_HEX_REDACT_MIN`] with a `<redacted-hex:LEN>` placeholder.
/// - Cap the output length at [`SCRUB_MAX_LEN`] characters.
///
/// Rationale: raw bifrost error paths can include hex key identifiers,
/// peer pubkeys, or group public keys. Stripping long hex runs reduces
/// the chance that transient error text carries anything secret-shaped
/// out to the renderer. The length cap bounds log-bloat and UI overflow.
pub fn scrub_for_display(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut buf = String::new();

    let flush = |buf: &mut String, out: &mut String| {
        if buf.len() >= SCRUB_HEX_REDACT_MIN {
            out.push_str(&format!("<redacted-hex:{}>", buf.len()));
        } else {
            out.push_str(buf);
        }
        buf.clear();
    };

    for ch in raw.chars() {
        if ch.is_ascii_hexdigit() {
            buf.push(ch);
        } else {
            if !buf.is_empty() {
                flush(&mut buf, &mut out);
            }
            out.push(ch);
        }
    }
    if !buf.is_empty() {
        flush(&mut buf, &mut out);
    }

    if out.chars().count() > SCRUB_MAX_LEN {
        let truncated: String = out.chars().take(SCRUB_MAX_LEN).collect();
        format!("{truncated}…")
    } else {
        out
    }
}

/// Parse `"profile <id> already exists"` (emitted by
/// `bifrost_profile::native::create_managed_profile`) into the id token.
fn parse_profile_already_exists(message: &str) -> Option<String> {
    // Match "profile <id> already exists", tolerating extra whitespace or
    // punctuation around the id. The bail! site uses the exact phrase;
    // we want to keep the check tight enough not to false-positive.
    let needle = " already exists";
    let idx = message.find(needle)?;
    let prefix = &message[..idx];
    let id = prefix.strip_prefix("profile ")?.trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_redacts_long_hex_runs() {
        let raw = "decrypt failed: key=1111222233334444555566667777888899990000aaaa";
        let scrubbed = scrub_for_display(raw);
        assert!(scrubbed.contains("<redacted-hex:"), "got: {scrubbed}");
        assert!(!scrubbed.contains("1111222233334444"));
    }

    #[test]
    fn scrub_preserves_short_hex_runs() {
        // Short hex runs (like a 4-char id) should survive.
        let raw = "profile abc1 already exists";
        let scrubbed = scrub_for_display(raw);
        assert_eq!(scrubbed, raw);
    }

    #[test]
    fn scrub_caps_length() {
        let raw = "x".repeat(SCRUB_MAX_LEN * 2);
        let scrubbed = scrub_for_display(&raw);
        // chars().count() not bytes, since we truncate on char boundary.
        assert!(scrubbed.chars().count() <= SCRUB_MAX_LEN + 1);
    }

    #[test]
    fn from_anyhow_maps_already_exists_to_typed_variant() {
        let err: HomeError = anyhow::anyhow!("profile abc123 already exists").into();
        match err {
            HomeError::ProfileAlreadyExists { id } => assert_eq!(id, "abc123"),
            other => panic!("expected ProfileAlreadyExists, got {other:?}"),
        }
    }

    #[test]
    fn from_anyhow_maps_no_active_session_to_typed_variant() {
        let err: HomeError = anyhow::anyhow!("no active signer session").into();
        assert!(matches!(err, HomeError::SessionNotActive));
    }

    #[test]
    fn from_anyhow_falls_back_to_bifrost() {
        let err: HomeError = anyhow::anyhow!("some random failure").into();
        match err {
            HomeError::Bifrost { message } => assert_eq!(message, "some random failure"),
            other => panic!("expected Bifrost, got {other:?}"),
        }
    }

    #[test]
    fn from_path_scope_error_maps_outside_roots() {
        let err: HomeError = PathScopeError::OutsideAllowedRoots {
            path: std::path::PathBuf::from("/tmp/evil"),
            roots: vec![],
        }
        .into();
        match err {
            HomeError::PathOutsideAllowedRoots { path } => assert_eq!(path, "/tmp/evil"),
            other => panic!("expected PathOutsideAllowedRoots, got {other:?}"),
        }
    }

    #[test]
    fn home_error_serializes_with_kind_and_detail() {
        let err = HomeError::InvalidPackage {
            reason: "bad json".to_string(),
        };
        let value = serde_json::to_value(&err).expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "invalid_package",
                "detail": { "reason": "bad json" }
            })
        );
    }

    #[test]
    fn home_error_serializes_unit_variant_with_null_detail() {
        let err = HomeError::InvalidPassphrase;
        let value = serde_json::to_value(&err).expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "invalid_passphrase",
                "detail": null
            })
        );
    }
}
