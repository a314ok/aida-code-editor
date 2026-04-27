use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

pub struct PtyState {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
}

#[tauri::command]
pub fn spawn_pty<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e: anyhow::Error| e.to_string())?;

    let cmd = if cfg!(windows) {
        CommandBuilder::new("powershell.exe")
    } else {
        CommandBuilder::new("bash")
    };

    let mut _child = pair.slave.spawn_command(cmd).map_err(|e: anyhow::Error| e.to_string())?;
    
    let reader = pair.master.try_clone_reader().map_err(|e: anyhow::Error| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e: anyhow::Error| e.to_string())?;
    
    *state.writer.lock().unwrap() = writer;
    *state.master.lock().unwrap() = Some(pair.master);

    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit("pty-data", data);
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_pty(state: tauri::State<'_, PtyState>, data: String) -> Result<(), String> {
    let mut writer = state.writer.lock().unwrap();
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(state: tauri::State<'_, PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(master) = state.master.lock().unwrap().as_ref() {
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}
