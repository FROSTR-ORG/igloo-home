use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
pub struct TestRequest {
    pub request_id: String,
    pub command: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Serialize)]
pub struct TestResponse {
    pub request_id: String,
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

pub fn execute_request(app: Option<&AppHandle>, request: TestRequest) -> TestResponse {
    let result = crate::app::test_dispatch::dispatch_request(app, &request.command, request.input);
    match result {
        Ok(result) => success_response(request.request_id, result),
        Err(error) => error_response(request.request_id, error),
    }
}

fn success_response(request_id: String, result: Value) -> TestResponse {
    TestResponse {
        request_id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn error_response(request_id: String, error: anyhow::Error) -> TestResponse {
    TestResponse {
        request_id,
        ok: false,
        result: None,
        error: Some(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_command_returns_current_success_envelope_without_app() {
        let response = execute_request(
            None,
            TestRequest {
                request_id: "req-1".to_string(),
                command: "health".to_string(),
                input: serde_json::json!({}),
            },
        );
        assert!(response.ok);
        assert_eq!(response.result, Some(serde_json::json!({ "ready": true })));
        assert_eq!(response.error, None);
    }

    #[test]
    fn unknown_command_returns_current_error_envelope() {
        let response = execute_request(
            None,
            TestRequest {
                request_id: "req-2".to_string(),
                command: "nope".to_string(),
                input: serde_json::json!({}),
            },
        );
        assert!(!response.ok);
        assert_eq!(response.result, None);
        assert_eq!(
            response.error,
            Some("unknown test command 'nope'".to_string())
        );
    }
}
