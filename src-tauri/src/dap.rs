use serde::{Deserialize, Serialize};
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

pub struct DapState {
    pub child: Arc<Mutex<Option<std::process::Child>>>,
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DapCommandCandidate {
    pub cmd: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedDapCommand {
    pub cmd: String,
    pub args: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DapAdapterProbe {
    pub id: String,
    pub label: String,
    pub languages: Vec<String>,
    pub candidates: Vec<DapCommandCandidate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DapAdapterStatus {
    pub id: String,
    pub label: String,
    pub languages: Vec<String>,
    pub available: bool,
    pub command: Option<String>,
    pub source: Option<String>,
}

#[tauri::command]
pub fn start_dap<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, DapState>,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    if let Some(mut old_child) = state.child.lock().unwrap().take() {
        let _ = old_child.kill();
    }
    *state.stdin.lock().unwrap() = None;

    let mut command = Command::new(&cmd);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd.as_ref() {
        command.current_dir(cwd);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start DAP adapter '{}': {}", cmd, e))?;

    let stdout = child.stdout.take().ok_or("Failed to open DAP stdout")?;
    let stderr = child.stderr.take();
    let stdin = child.stdin.take().ok_or("Failed to open DAP stdin")?;

    *state.stdin.lock().unwrap() = Some(stdin);
    *state.child.lock().unwrap() = Some(child);

    let stdout_app = app.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let Some(len) = read_content_length(&mut reader) else {
                break;
            };

            let mut body = vec![0u8; len];
            if reader.read_exact(&mut body).is_err() {
                break;
            }

            let msg = String::from_utf8_lossy(&body).to_string();
            let _ = stdout_app.emit("dap-message", msg);
        }
    });

    if let Some(stderr) = stderr {
        let stderr_app = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = stderr_app.emit("dap-output", line);
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub fn stop_dap(state: tauri::State<'_, DapState>) -> Result<(), String> {
    *state.stdin.lock().unwrap() = None;
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
pub fn send_dap_message(state: tauri::State<'_, DapState>, message: String) -> Result<(), String> {
    if let Some(stdin) = state.stdin.lock().unwrap().as_mut() {
        let full_msg = format!(
            "Content-Length: {}\r\n\r\n{}",
            message.as_bytes().len(),
            message
        );
        stdin
            .write_all(full_msg.as_bytes())
            .map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn resolve_dap_command(
    candidates: Vec<DapCommandCandidate>,
    cwd: Option<String>,
) -> Result<Option<ResolvedDapCommand>, String> {
    Ok(resolve_dap_command_inner(&candidates, cwd.as_deref()))
}

#[tauri::command]
pub fn check_dap_adapters(
    adapters: Vec<DapAdapterProbe>,
    cwd: Option<String>,
) -> Result<Vec<DapAdapterStatus>, String> {
    Ok(adapters
        .into_iter()
        .map(|adapter| {
            let resolved = resolve_dap_command_inner(&adapter.candidates, cwd.as_deref());
            DapAdapterStatus {
                id: adapter.id,
                label: adapter.label,
                languages: adapter.languages,
                available: resolved.is_some(),
                command: resolved.as_ref().map(|cmd| {
                    std::iter::once(cmd.cmd.clone())
                        .chain(cmd.args.iter().cloned())
                        .collect::<Vec<_>>()
                        .join(" ")
                }),
                source: resolved.map(|cmd| cmd.source),
            }
        })
        .collect())
}

fn read_content_length<R: BufRead>(reader: &mut R) -> Option<usize> {
    let mut content_length = None;

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            return content_length;
        }

        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }
}

fn resolve_dap_command_inner(
    candidates: &[DapCommandCandidate],
    cwd: Option<&str>,
) -> Option<ResolvedDapCommand> {
    for candidate in candidates {
        if let Some(path) = resolve_command_path(&candidate.cmd, cwd) {
            let Some(args) = expand_command_args(&candidate.args, cwd) else {
                continue;
            };
            if !args_are_available(&args) {
                continue;
            }
            return Some(ResolvedDapCommand {
                cmd: path,
                args,
                source: candidate.cmd.clone(),
            });
        }
    }
    None
}

fn expand_command_args(args: &[String], cwd: Option<&str>) -> Option<Vec<String>> {
    let app_root = app_root().map(|path| path.to_string_lossy().to_string());
    args.iter()
        .map(|arg| {
            let mut next = arg.clone();
            if next.contains("{AIDA_APP_ROOT}") {
                let root = app_root.as_ref()?;
                next = next.replace("{AIDA_APP_ROOT}", root);
            }
            if next.contains("{WORKSPACE}") {
                let workspace = cwd?;
                next = next.replace("{WORKSPACE}", workspace);
            }
            Some(next)
        })
        .collect()
}

fn args_are_available(args: &[String]) -> bool {
    args.iter().all(|arg| {
        let path = Path::new(arg);
        if !path.is_absolute() {
            return true;
        }
        let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
            return true;
        };
        !matches!(ext, "js" | "mjs" | "cjs") || path.exists()
    })
}

fn app_root() -> Option<PathBuf> {
    let mut dir = env::current_dir().ok()?;
    loop {
        if dir
            .join("scripts")
            .join("aida-node-dap-adapter.mjs")
            .exists()
        {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

fn resolve_command_path(cmd: &str, cwd: Option<&str>) -> Option<String> {
    let direct = PathBuf::from(cmd);
    if direct.is_absolute() && direct.exists() {
        return Some(direct.to_string_lossy().to_string());
    }

    if let Some(cwd) = cwd {
        if let Some(path) = resolve_from_node_bin(Path::new(cwd), cmd) {
            return Some(path);
        }
    }

    if let Ok(current_dir) = env::current_dir() {
        if let Some(path) = resolve_from_node_bin(&current_dir, cmd) {
            return Some(path);
        }
    }

    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        for candidate in command_variants(cmd) {
            let path = dir.join(&candidate);
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn resolve_from_node_bin(base: &Path, cmd: &str) -> Option<String> {
    let bin_dir = base.join("node_modules").join(".bin");
    for candidate in command_variants(cmd) {
        let path = bin_dir.join(&candidate);
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

fn command_variants(cmd: &str) -> Vec<String> {
    let path = Path::new(cmd);
    if path.extension().is_some() {
        return vec![cmd.to_string()];
    }

    if cfg!(windows) {
        return [".cmd", ".exe", ".bat", ""]
            .iter()
            .map(|ext| format!("{cmd}{ext}"))
            .collect();
    }

    vec![cmd.to_string()]
}
