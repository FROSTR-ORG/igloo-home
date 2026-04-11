use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{
    ApplyRotationUpdateInput, ConnectOnboardingPackageInput, CreateGeneratedOnboardingPackageInput,
    CreateKeysetRequest, ExportProfileInput, ExportProfilePackageInput,
    FinalizeConnectedOnboardingInput, ImportProfileFromOnboardingInput, ImportProfileFromRawInput,
    ListSessionLogsInput, PublishProfileBackupInput, RemoveProfileInput, RotateKeysetRequest,
    StartProfileSessionRequest,
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
        "create_rotated_keyset" => {
            let input: RotateKeysetRequest = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::create_rotated_keyset(input))
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
                | "connect_onboarding_package"
                | "finalize_connected_onboarding"
                | "discard_connected_onboarding"
                | "remove_profile"
                | "export_profile"
                | "export_profile_package"
                | "publish_profile_backup"
                | "apply_rotation_update"
                | "list_session_logs"
                | "navigate_view"
                | "start_profile_session"
                | "profile_runtime_snapshot"
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
        "publish_profile_backup" => {
            let input: PublishProfileBackupInput = serde_json::from_value(input)?;
            Some(
                tauri::async_runtime::block_on(app::commands::publish_profile_backup(
                    state.inner(),
                    input,
                ))
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
        "refresh_all_peers" => Some(
            tauri::async_runtime::block_on(app::commands::refresh_runtime_peers(
                state.inner(),
            ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
        ),
        "refresh_runtime_peers" => Some(
            tauri::async_runtime::block_on(app::commands::refresh_runtime_peers(
                state.inner(),
            ))
            .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
        ),
        _ => None,
    };
    result.transpose()
}

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
}
