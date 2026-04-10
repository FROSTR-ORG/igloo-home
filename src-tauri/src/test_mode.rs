use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use tauri::AppHandle;

use crate::app::test_api::{TestRequest, execute_request};

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
    let response = execute_request(Some(&app), request);
    writeln!(stream, "{}", serde_json::to_string(&response)?)?;
    Ok(())
}
