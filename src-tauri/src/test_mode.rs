#![cfg(feature = "test-server")]

use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;

use serde::Deserialize;
use subtle::ConstantTimeEq;
use tauri::AppHandle;

use crate::app::test_api::{TestRequest, execute_request};

const TOKEN_ENV_VAR: &str = "IGLOO_HOME_TEST_TOKEN";
const EXPECTED_TOKEN_LEN: usize = 64;

#[derive(Debug, Deserialize)]
struct TokenHandshake {
    token: String,
}

pub fn start_server(app: &AppHandle) -> anyhow::Result<()> {
    let port = match env::var("IGLOO_HOME_TEST_PORT") {
        Ok(value) => value
            .parse::<u16>()
            .map_err(|error| anyhow::anyhow!("invalid IGLOO_HOME_TEST_PORT: {error}"))?,
        Err(_) => return Ok(()),
    };

    let token = match env::var(TOKEN_ENV_VAR) {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.len() != EXPECTED_TOKEN_LEN {
                eprintln!(
                    "error: {TOKEN_ENV_VAR} must be exactly {EXPECTED_TOKEN_LEN} characters; refusing to start test server"
                );
                return Ok(());
            }
            Arc::new(trimmed.as_bytes().to_vec())
        }
        Err(_) => {
            eprintln!(
                "error: {TOKEN_ENV_VAR} not set; refusing to start loopback test server"
            );
            return Ok(());
        }
    };

    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let app = app.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                continue;
            };
            let app = app.clone();
            let token = Arc::clone(&token);
            thread::spawn(move || {
                let _ = handle_client(app, stream, token.as_slice());
            });
        }
    });
    Ok(())
}

fn handle_client(app: AppHandle, mut stream: TcpStream, expected_token: &[u8]) -> anyhow::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);

    // First line of every connection must be a token handshake.
    let mut handshake_line = String::new();
    if reader.read_line(&mut handshake_line)? == 0 {
        return Ok(());
    }
    let handshake_line = handshake_line.trim();
    if handshake_line.is_empty() {
        return Ok(());
    }
    let handshake: TokenHandshake = match serde_json::from_str(handshake_line) {
        Ok(value) => value,
        Err(_) => return Ok(()), // malformed handshake: close silently
    };
    let provided = handshake.token.trim();
    // Constant-time compare; always compare against a fixed-length buffer so
    // a length mismatch does not change the shape of the comparison.
    let mut padded = vec![0u8; expected_token.len()];
    let provided_bytes = provided.as_bytes();
    let copy_len = provided_bytes.len().min(padded.len());
    padded[..copy_len].copy_from_slice(&provided_bytes[..copy_len]);
    let same_length = provided_bytes.len() == expected_token.len();
    let bytes_equal: bool = padded.as_slice().ct_eq(expected_token).into();
    if !(same_length && bytes_equal) {
        // Silent close — no response, no log of the failed token.
        return Ok(());
    }

    // Token accepted; proceed with the existing TestRequest protocol.
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(());
    }
    if line.trim().is_empty() {
        return Ok(());
    }
    let request: TestRequest = serde_json::from_str(&line)?;
    let response = execute_request(Some(&app), request);
    writeln!(stream, "{}", serde_json::to_string(&response)?)?;
    Ok(())
}
