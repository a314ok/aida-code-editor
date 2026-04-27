use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write, Read};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

pub struct LspState {
    pub child: Arc<Mutex<Option<std::process::Child>>>,
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
}

#[tauri::command]
pub fn start_lsp<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, LspState>,
    cmd: String,
    args: Vec<String>,
) -> Result<(), String> {
    let mut child = Command::new(&cmd)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start LSP '{}': {}", cmd, e))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stdin = child.stdin.take().ok_or("Failed to open stdin")?;

    *state.stdin.lock().unwrap() = Some(stdin);
    *state.child.lock().unwrap() = Some(child);

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Err(_) => break,
                Ok(_) => {}
            }

            if line.starts_with("Content-Length: ") {
                if let Ok(len) = line["Content-Length: ".len()..].trim().parse::<usize>() {
                    let mut empty_line = String::new();
                    let _ = reader.read_line(&mut empty_line);

                    let mut body = vec![0u8; len];
                    if reader.read_exact(&mut body).is_ok() {
                        let msg = String::from_utf8_lossy(&body).to_string();
                        let _ = app.emit("lsp-message", msg);
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn send_lsp_message(state: tauri::State<'_, LspState>, message: String) -> Result<(), String> {
    if let Some(stdin) = state.stdin.lock().unwrap().as_mut() {
        let full_msg = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
        stdin.write_all(full_msg.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}
