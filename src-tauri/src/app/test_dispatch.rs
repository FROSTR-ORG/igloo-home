use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{
    ApplyRotationUpdateInput, ConnectOnboardingPackageInput, CreateGeneratedOnboardingPackageInput,
    CreateKeysetRequest, ExportProfileInput, ExportProfilePackageInput,
    FinalizeConnectedOnboardingInput, ImportProfileFromBfprofileInput,
    ImportProfileFromOnboardingInput, ImportProfileFromRawInput, ListSessionLogsInput,
    RecoverGroupKeyInput, RemoveProfileInput, ResolveApprovalInput, ResolveCloseRequestInput,
    RotateKeysetRequest, SettingsUpdateInput, StartProfileSessionRequest, UpdatePeerPolicyInput,
    UpdateProfileOperatorSettingsInput,
};
use crate::{app, session};

#[derive(Debug, Deserialize, Serialize)]
struct NavigateViewInput {
    view: String,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    signer_tab: Option<String>,
}

pub fn dispatch_request(
    app: Option<&AppHandle>,
    command: &str,
    input: Value,
) -> anyhow::Result<Value> {
    if let Some(result) = dispatch_app_free_command(command, input.clone())? {
        return Ok(result);
    }
    if let Some(result) = dispatch_profile_command(app, command, input.clone())? {
        return Ok(result);
    }
    if let Some(result) = dispatch_session_command(app, command, input.clone())? {
        return Ok(result);
    }
    if let Some(result) = dispatch_runtime_command(app, command, input)? {
        return Ok(result);
    }
    Err(anyhow::anyhow!("unknown test command '{}'", command))
}

fn dispatch_app_free_command(command: &str, input: Value) -> anyhow::Result<Option<Value>> {
    let result = match command {
        "health" => Some(Ok(serde_json::json!({ "ready": true }))),
        "create_generated_keyset" => {
            let input: CreateKeysetRequest = serde_json::from_value(input)?;
            Some(
                app::commands::create_generated_keyset(
                    input.group_name,
                    input.threshold,
                    input.count,
                )
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "create_generated_onboarding_package" => {
            let input: CreateGeneratedOnboardingPackageInput = serde_json::from_value(input)?;
            Some(
                app::commands::create_generated_onboarding_package(input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        _ => None,
    };
    result.transpose()
}

fn dispatch_profile_command(
    app: Option<&AppHandle>,
    command: &str,
    input: Value,
) -> anyhow::Result<Option<Value>> {
    let app = match app {
        Some(app) => app,
        None => {
            return match command {
                "app_paths"
                | "list_profiles"
                | "import_profile_from_raw"
                | "import_profile_from_onboarding"
                | "import_profile_from_bfprofile"
                | "recover_group_key"
                | "get_profile_threshold"
                | "connect_onboarding_package"
                | "finalize_connected_onboarding"
                | "discard_connected_onboarding"
                | "remove_profile"
                | "export_profile"
                | "export_profile_package"
                | "create_rotated_keyset"
                | "apply_rotation_update"
                | "list_session_logs"
                | "navigate_view"
                | "start_profile_session"
                | "profile_runtime_snapshot"
                | "refresh_runtime_peers"
                | "list_relay_profiles"
                | "resolve_approval"
                | "resolve_close_request"
                | "update_peer_policy"
                | "update_profile_operator_settings"
                | "update_settings"
                | "get_settings"
                | "stop_signer" => Err(anyhow::anyhow!(
                    "app handle required for test command '{}'",
                    command
                )),
                _ => Ok(None),
            };
        }
    };

    let state = app.state::<session::AppState>();
    let result = match command {
        "app_paths" => {
            Some(serde_json::to_value(app::commands::app_paths(state.inner())).map_err(Into::into))
        }
        "list_profiles" => Some(
            app::commands::list_profiles(state.inner())
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
        ),
        "import_profile_from_raw" => {
            let input: ImportProfileFromRawInput = serde_json::from_value(input)?;
            Some(
                app::commands::import_profile_from_raw(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "import_profile_from_onboarding" => {
            let input: ImportProfileFromOnboardingInput = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::import_profile_from_onboarding(
                    state.inner(),
                    input,
                ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "import_profile_from_bfprofile" => {
            let input: ImportProfileFromBfprofileInput = serde_json::from_value(input)?;
            Some(
                app::commands::import_profile_from_bfprofile(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "recover_group_key" => {
            let input: RecoverGroupKeyInput = serde_json::from_value(input)?;
            Some(
                app::commands::recover_group_key(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "get_profile_threshold" => {
            let profile_id: String = serde_json::from_value(input)?;
            Some(
                app::commands::get_profile_threshold(state.inner(), &profile_id)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "create_rotated_keyset" => {
            let input: RotateKeysetRequest = serde_json::from_value(input)?;
            Some(
                app::commands::create_rotated_keyset(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "connect_onboarding_package" => {
            let input: ConnectOnboardingPackageInput = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::connect_onboarding_package(
                    state.inner(),
                    input,
                ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "finalize_connected_onboarding" => {
            let input: FinalizeConnectedOnboardingInput = serde_json::from_value(input)?;
            Some(
                app::commands::finalize_connected_onboarding(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "discard_connected_onboarding" => Some(
            serde_json::to_value(app::commands::discard_connected_onboarding(state.inner()))
                .map_err(Into::into),
        ),
        "remove_profile" => {
            let input: RemoveProfileInput = serde_json::from_value(input)?;
            Some(
                app::commands::remove_profile(state.inner(), input)
                    .map(|_| serde_json::json!({ "removed": true })),
            )
        }
        "export_profile" => {
            let input: ExportProfileInput = serde_json::from_value(input)?;
            Some(
                app::commands::export_profile(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "export_profile_package" => {
            let input: ExportProfilePackageInput = serde_json::from_value(input)?;
            Some(
                app::commands::export_profile_package(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "apply_rotation_update" => {
            let input: ApplyRotationUpdateInput = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::apply_rotation_update(
                    state.inner(),
                    input,
                ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "list_session_logs" => {
            let input: ListSessionLogsInput = serde_json::from_value(input)?;
            Some(
                app::commands::list_session_logs(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "navigate_view" => {
            let input: NavigateViewInput = serde_json::from_value(input)?;
            Some(
                app.emit(crate::events::EVENT_APP_TEST_NAVIGATE, &input)
                    .map(|_| serde_json::json!({ "navigated": true }))
                    .map_err(Into::into),
            )
        }
        "list_relay_profiles" => Some(
            app::commands::list_relay_profiles(state.inner())
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
        ),
        "resolve_approval" => {
            let input: ResolveApprovalInput = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::resolve_approval(state.inner(), input))
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "update_peer_policy" => {
            let input: UpdatePeerPolicyInput = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::update_peer_policy(
                    state.inner(),
                    input,
                ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "update_profile_operator_settings" => {
            let input: UpdateProfileOperatorSettingsInput = serde_json::from_value(input)?;
            Some(
                app::commands::update_profile_operator_settings(state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "get_settings" => Some(
            serde_json::to_value(app::settings::get_settings(state.inner())).map_err(Into::into),
        ),
        "update_settings" => {
            let input: SettingsUpdateInput = serde_json::from_value(input)?;
            Some(
                app::settings::update_settings(app, state.inner(), input)
                    .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "resolve_close_request" => {
            let input: ResolveCloseRequestInput = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::resolve_close_request(
                    app,
                    state.inner(),
                    input,
                ))
                .map(|()| serde_json::json!({ "resolved": true })),
            )
        }
        _ => None,
    };
    result.transpose()
}

fn dispatch_session_command(
    app: Option<&AppHandle>,
    command: &str,
    input: Value,
) -> anyhow::Result<Option<Value>> {
    let app = match app {
        Some(app) => app,
        None => return Ok(None),
    };
    let state = app.state::<session::AppState>();
    let result = match command {
        "start_profile_session" => {
            let input: StartProfileSessionRequest = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::start_profile_session(
                    app,
                    state.inner(),
                    input,
                ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "stop_signer" => Some(
            tauri::async_runtime::block_on(app::commands::stop_signer(
                app,
                state.inner(),
                "test_stop",
            ))
            .map(|_| serde_json::json!({ "stopped": true })),
        ),
        _ => None,
    };
    result.transpose()
}

fn dispatch_runtime_command(
    app: Option<&AppHandle>,
    command: &str,
    input: Value,
) -> anyhow::Result<Option<Value>> {
    let app = match app {
        Some(app) => app,
        None => return Ok(None),
    };
    let state = app.state::<session::AppState>();
    let result = match command {
        "profile_runtime_snapshot" => {
            let profile_id = input
                .get("profile_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            Some(
                tauri::async_runtime::block_on(app::commands::profile_runtime_snapshot(
                    app,
                    state.inner(),
                    profile_id,
                ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
            )
        }
        "refresh_runtime_peers" => Some(
            tauri::async_runtime::block_on(app::commands::refresh_runtime_peers(state.inner()))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
        ),
        _ => None,
    };
    result.transpose()
}

#[cfg(test)]
const EXPECTED_DISPATCH_COMMANDS: &[&str] = &[
    // Keep sorted alphabetically. Maintained manually in lockstep with the
    // match arms in `dispatch_app_free_command`, `dispatch_profile_command`,
    // `dispatch_session_command`, and `dispatch_runtime_command`. Drift against
    // the real `generate_handler!` list is caught by
    // `expected_dispatch_commands_match_registered_handlers` below; `health` and
    // `navigate_view` are test-only and intentionally never registered there.
    "app_paths",
    "apply_rotation_update",
    "connect_onboarding_package",
    "create_generated_keyset",
    "create_generated_onboarding_package",
    "create_rotated_keyset",
    "discard_connected_onboarding",
    "export_profile",
    "export_profile_package",
    "finalize_connected_onboarding",
    "get_profile_threshold",
    "get_settings",
    "health",
    "import_profile_from_bfprofile",
    "import_profile_from_onboarding",
    "import_profile_from_raw",
    "list_profiles",
    "list_relay_profiles",
    "list_session_logs",
    "navigate_view",
    "profile_runtime_snapshot",
    "recover_group_key",
    "refresh_runtime_peers",
    "remove_profile",
    "resolve_approval",
    "resolve_close_request",
    "start_profile_session",
    "stop_signer",
    "update_peer_policy",
    "update_profile_operator_settings",
    "update_settings",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_command_returns_current_payload_without_app() {
        let result = dispatch_request(None, "health", serde_json::json!({})).unwrap();
        assert_eq!(result, serde_json::json!({ "ready": true }));
    }

    #[test]
    fn app_required_command_preserves_current_missing_app_error() {
        let error = dispatch_request(
            None,
            "navigate_view",
            serde_json::json!({ "view": "landing" }),
        )
        .expect_err("navigate_view should require an app handle");
        assert_eq!(
            error.to_string(),
            "app handle required for test command 'navigate_view'"
        );
    }

    #[test]
    fn unknown_command_returns_current_dispatch_error() {
        let error = dispatch_request(None, "nope", serde_json::json!({}))
            .expect_err("unknown command should fail");
        assert_eq!(error.to_string(), "unknown test command 'nope'");
    }

    #[test]
    fn expected_dispatch_commands_list_is_sorted_and_unique() {
        let mut sorted = EXPECTED_DISPATCH_COMMANDS.to_vec();
        sorted.sort();
        assert_eq!(
            sorted.as_slice(),
            EXPECTED_DISPATCH_COMMANDS,
            "EXPECTED_DISPATCH_COMMANDS must stay sorted"
        );
        let mut deduped = sorted.clone();
        deduped.dedup();
        assert_eq!(
            deduped.len(),
            EXPECTED_DISPATCH_COMMANDS.len(),
            "EXPECTED_DISPATCH_COMMANDS must not contain duplicates"
        );
    }

    #[test]
    fn every_expected_command_is_recognized_by_dispatcher() {
        for command in EXPECTED_DISPATCH_COMMANDS {
            let result = dispatch_request(None, command, serde_json::json!({}));
            match result {
                Ok(_) => {
                    // app-free command returned a value — ok.
                }
                Err(error) => {
                    let message = error.to_string();
                    assert!(
                        !message.starts_with("unknown test command"),
                        "command {command} was reported as unknown by dispatcher: {message}"
                    );
                }
            }
        }
    }

    #[test]
    fn expected_dispatch_commands_match_registered_handlers() {
        // Best-effort but loud: parse the real `generate_handler!` list out of
        // bootstrap.rs and assert every registered Tauri command is mirrored in
        // EXPECTED_DISPATCH_COMMANDS (and vice versa). This is what keeps a newly
        // registered command from silently bypassing the test dispatcher. The two
        // test-only commands (`health`, `navigate_view`) are never registered, so
        // exclude them from the comparison.
        const BOOTSTRAP_SRC: &str = include_str!("bootstrap.rs");
        let list_start = BOOTSTRAP_SRC
            .find("generate_handler![")
            .expect("bootstrap.rs should register a generate_handler! list");
        let after_open = &BOOTSTRAP_SRC[list_start + "generate_handler![".len()..];
        let list_end = after_open
            .find(']')
            .expect("generate_handler! list should be closed with ]");
        let body = &after_open[..list_end];

        let mut registered: Vec<String> = body
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(|entry| {
                entry
                    .rsplit("::")
                    .next()
                    .unwrap_or(entry)
                    .trim()
                    .trim_end_matches("_command")
                    .to_string()
            })
            .collect();
        registered.sort();
        registered.dedup();

        let test_only = ["health", "navigate_view"];
        let mut expected_registered: Vec<String> = EXPECTED_DISPATCH_COMMANDS
            .iter()
            .filter(|name| !test_only.contains(*name))
            .map(|name| (*name).to_string())
            .collect();
        expected_registered.sort();

        assert_eq!(
            registered, expected_registered,
            "test dispatcher drifted from the real generate_handler! list in \
             bootstrap.rs — reconcile EXPECTED_DISPATCH_COMMANDS and the dispatch \
             arms with the registered commands"
        );
    }

    #[test]
    fn removed_dispatch_aliases_are_unknown() {
        // `refresh_all_peers` was a legacy alias; it must no longer dispatch.
        let error = dispatch_request(None, "refresh_all_peers", serde_json::json!({}))
            .expect_err("refresh_all_peers should be unknown after alias removal");
        assert_eq!(
            error.to_string(),
            "unknown test command 'refresh_all_peers'"
        );
    }
}
