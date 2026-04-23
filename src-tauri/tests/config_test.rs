//! Regression test for the Tauri security configuration.
//!
//! Pins the production Content-Security-Policy string so a silent edit to
//! `tauri.conf.json` (including accidental `null`) fails the suite.

use serde_json::Value;

const EXPECTED_CSP: &str = "default-src 'none'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'; manifest-src 'self';";

const EXPECTED_DEV_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: http: ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none';";

const EXPECTED_PERMISSIONS: &[&str] = &[
    "core:event:default",
    "core:path:default",
    "core:window:default",
    "core:webview:default",
    "core:app:default",
    "core:menu:default",
    "dialog:allow-confirm",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled",
];

fn load_tauri_config() -> Value {
    let raw = include_str!("../tauri.conf.json");
    serde_json::from_str(raw).expect("tauri.conf.json must be valid JSON")
}

fn load_default_capability() -> Value {
    let raw = include_str!("../capabilities/default.json");
    serde_json::from_str(raw).expect("capabilities/default.json must be valid JSON")
}

#[test]
fn production_csp_matches_expected_constant() {
    let config = load_tauri_config();
    let csp = config
        .get("app")
        .and_then(|app| app.get("security"))
        .and_then(|security| security.get("csp"))
        .and_then(Value::as_str)
        .expect("app.security.csp must be a string");
    assert_eq!(
        csp, EXPECTED_CSP,
        "Production CSP drifted from the pinned regression value.\nExpected:\n  {}\nGot:\n  {}",
        EXPECTED_CSP, csp
    );
}

#[test]
fn dev_csp_matches_expected_constant() {
    let config = load_tauri_config();
    let dev_csp = config
        .get("app")
        .and_then(|app| app.get("security"))
        .and_then(|security| security.get("devCsp"))
        .and_then(Value::as_str)
        .expect("app.security.devCsp must be a string");
    assert_eq!(
        dev_csp, EXPECTED_DEV_CSP,
        "Dev CSP drifted from the pinned regression value.\nExpected:\n  {}\nGot:\n  {}",
        EXPECTED_DEV_CSP, dev_csp
    );
}

#[test]
fn freeze_prototype_is_enabled() {
    let config = load_tauri_config();
    let freeze = config
        .get("app")
        .and_then(|app| app.get("security"))
        .and_then(|security| security.get("freezePrototype"))
        .and_then(Value::as_bool)
        .expect("app.security.freezePrototype must be a bool");
    assert!(freeze, "freezePrototype must remain true");
}

#[test]
fn default_capability_permissions_match_expected_set() {
    let capability = load_default_capability();
    let permissions = capability
        .get("permissions")
        .and_then(Value::as_array)
        .expect("capabilities/default.json must declare a permissions array");
    let actual: Vec<&str> = permissions
        .iter()
        .map(|v| v.as_str().expect("permission entries must be strings"))
        .collect();
    assert_eq!(
        actual, EXPECTED_PERMISSIONS,
        "capability permissions drifted from the pinned set"
    );
}
