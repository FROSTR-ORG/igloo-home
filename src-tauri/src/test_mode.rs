use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{
    ApplyRotationUpdateInput, CreateGeneratedOnboardingPackageInput, CreateKeysetRequest,
    ExportProfileInput, ExportProfilePackageInput, ImportProfileFromOnboardingInput,
    ImportProfileFromRawInput, ListSessionLogsInput, PublishProfileBackupInput, RemoveProfileInput,
    RotateKeysetRequest, StartProfileSessionRequest,
};
use crate::{profiles, session, session_log};

#[derive(Debug, Deserialize)]
struct TestRequest {
    request_id: String,
    command: String,
    #[serde(default)]
    input: Value,
}

#[derive(Debug, Serialize)]
struct TestResponse {
    request_id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct NavigateViewInput {
    view: String,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    signer_tab: Option<String>,
}

pub fn start_server(app: &AppHandle) -> anyhow::Result<()> {
    let port = match env::var("IGLOO_HOME_TEST_PORT") {
        Ok(value) => value
            .parse::<u16>()
            .map_err(|error| anyhow::anyhow!("invalid IGLOO_HOME_TEST_PORT: {error}"))?,
        Err(_) => return Ok(()),
    };

    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let app = app.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                continue;
            };
            let app = app.clone();
            thread::spawn(move || {
                let _ = handle_client(app, stream);
            });
        }
    });
    Ok(())
}

fn handle_client(app: AppHandle, mut stream: TcpStream) -> anyhow::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    if line.trim().is_empty() {
        return Ok(());
    }
    let request: TestRequest = serde_json::from_str(&line)?;
    let response = execute_request(&app, request);
    writeln!(stream, "{}", serde_json::to_string(&response)?)?;
    Ok(())
}

fn execute_request(app: &AppHandle, request: TestRequest) -> TestResponse {
    let result = match request.command.as_str() {
        "health" => Ok(serde_json::json!({ "ready": true })),
        "app_paths" => {
            let state = app.state::<session::AppState>();
            serde_json::to_value(profiles::shell_paths_response(&state.shell_paths)).map_err(Into::into)
        }
        "list_profiles" => {
            let state = app.state::<session::AppState>();
            profiles::list_managed_profiles(&state.shell_paths)
                .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        }
        "import_profile_from_raw" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: ImportProfileFromRawInput = serde_json::from_value(request.input)?;
            let result = profiles::import_profile_from_raw_json(
                &state.shell_paths,
                input.label,
                input.relay_profile,
                &input.relay_urls,
                Some(input.vault_passphrase),
                &input.group_package_json,
                &input.share_package_json,
            )?;
            Ok(serde_json::to_value(result)?)
        })(),
        "import_profile_from_onboarding" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: ImportProfileFromOnboardingInput = serde_json::from_value(request.input)?;
            let result = tauri::async_runtime::block_on(profiles::import_profile_from_onboarding(
                &state.shell_paths,
                input.label,
                input.relay_profile,
                Some(input.vault_passphrase),
                Some(input.onboarding_password),
                &input.package,
            ))?;
            Ok(serde_json::to_value(result)?)
        })(),
        "create_generated_keyset" => (|| -> anyhow::Result<Value> {
            let input: CreateKeysetRequest = serde_json::from_value(request.input)?;
            let result = session::make_generated_keyset(input.threshold, input.count)?;
            Ok(serde_json::to_value(result)?)
        })(),
        "create_rotated_keyset" => (|| -> anyhow::Result<Value> {
            let input: RotateKeysetRequest = serde_json::from_value(request.input)?;
            let result = tauri::async_runtime::block_on(session::make_rotated_keyset(
                input.threshold,
                input.count,
                input.sources,
            ))?;
            Ok(serde_json::to_value(result)?)
        })(),
        "create_generated_onboarding_package" => (|| -> anyhow::Result<Value> {
            let input: CreateGeneratedOnboardingPackageInput = serde_json::from_value(request.input)?;
            let result = session::make_generated_onboarding_package(
                &input.share_package_json,
                input.relay_urls,
                input.peer_pubkey,
                input.package_password,
            )?;
            Ok(serde_json::to_value(result)?)
        })(),
        "remove_profile" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: RemoveProfileInput = serde_json::from_value(request.input)?;
            profiles::remove_managed_profile(&state.shell_paths, &input.profile_id)?;
            Ok(serde_json::json!({ "removed": true }))
        })(),
        "export_profile" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: ExportProfileInput = serde_json::from_value(request.input)?;
            profiles::export_managed_profile(
                &state.shell_paths,
                &input.profile_id,
                std::path::PathBuf::from(input.destination_dir).as_path(),
                Some(input.vault_passphrase),
            )
                .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        })(),
        "export_profile_package" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: ExportProfilePackageInput = serde_json::from_value(request.input)?;
            profiles::export_managed_profile_package(
                &state.shell_paths,
                &input.profile_id,
                &input.format,
                input.package_password,
                Some(input.vault_passphrase),
            )
            .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        })(),
        "publish_profile_backup" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: PublishProfileBackupInput = serde_json::from_value(request.input)?;
            tauri::async_runtime::block_on(profiles::publish_managed_profile_backup(
                &state.shell_paths,
                &input.profile_id,
                Some(input.vault_passphrase),
            ))
            .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        })(),
        "start_profile_session" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: StartProfileSessionRequest = serde_json::from_value(request.input)?;
            tauri::async_runtime::block_on(session::start_profile_session(
                app,
                state.inner(),
                input,
            ))
                .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        })(),
        "profile_runtime_snapshot" => {
            let state = app.state::<session::AppState>();
            let profile_id = request
                .input
                .get("profile_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            tauri::async_runtime::block_on(session::profile_session_snapshot(
                app,
                state.inner(),
                profile_id,
            ))
            .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        }
        "stop_signer" => {
            let state = app.state::<session::AppState>();
            tauri::async_runtime::block_on(session::stop_signer(app, state.inner(), "test_stop"))
                .and_then(|_| Ok(serde_json::json!({ "stopped": true })))
        }
        "apply_rotation_update" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: ApplyRotationUpdateInput = serde_json::from_value(request.input)?;
            tauri::async_runtime::block_on(
                igloo_shell_core::shell::apply_rotation_update_from_bfonboard_value(
                    &state.shell_paths,
                    &input.target_profile_id,
                    &input.onboarding_package,
                    input.onboarding_password,
                    Some(input.vault_passphrase),
                ),
            )
            .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        })(),
        "list_session_logs" => (|| -> anyhow::Result<Value> {
            let state = app.state::<session::AppState>();
            let input: ListSessionLogsInput = serde_json::from_value(request.input)?;
            let runtime_dir = if let Some(value) = input.runtime_dir {
                std::path::PathBuf::from(value)
            } else {
                let guard = state.signer.lock().unwrap();
                guard
                    .last_session
                    .as_ref()
                    .map(|session| std::path::PathBuf::from(&session.runtime_dir))
                    .ok_or_else(|| anyhow::anyhow!("no session logs available"))?
            };
            session_log::read_session_log(&runtime_dir, &state.paths)
                .and_then(|value| serde_json::to_value(value).map_err(Into::into))
        })(),
        "navigate_view" => (|| -> anyhow::Result<Value> {
            let input: NavigateViewInput = serde_json::from_value(request.input)?;
            app.emit(crate::events::EVENT_APP_TEST_NAVIGATE, &input)?;
            Ok(serde_json::json!({ "navigated": true }))
        })(),
        _ => Err(anyhow::anyhow!(
            "unknown test command '{}'",
            request.command
        )),
    };

    match result {
        Ok(result) => TestResponse {
            request_id: request.request_id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => TestResponse {
            request_id: request.request_id,
            ok: false,
            result: None,
            error: Some(error.to_string()),
        },
    }
}
