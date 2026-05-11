use serde::{Deserialize, Serialize};
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

pub struct LspState {
    pub child: Arc<Mutex<Option<std::process::Child>>>,
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LspCommandCandidate {
    pub cmd: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedLspCommand {
    pub cmd: String,
    pub args: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LspServerProbe {
    pub id: String,
    pub label: String,
    pub languages: Vec<String>,
    pub candidates: Vec<LspCommandCandidate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LspServerStatus {
    pub id: String,
    pub label: String,
    pub languages: Vec<String>,
    pub available: bool,
    pub command: Option<String>,
    pub source: Option<String>,
}

#[tauri::command]
pub fn start_lsp<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, LspState>,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    if let Some(mut old_child) = state.child.lock().unwrap().take() {
        let _ = old_child.kill();
    }
    *state.stdin.lock().unwrap() = None;

    let display_command = std::iter::once(cmd.clone())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    let (spawn_cmd, spawn_args) = normalize_spawn_command(cmd, args);
    let mut command = Command::new(&spawn_cmd);
    command
        .args(&spawn_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(cwd) = cwd.as_ref() {
        command.current_dir(cwd);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start LSP '{}': {}", display_command, e))?;

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
pub fn resolve_lsp_command(
    candidates: Vec<LspCommandCandidate>,
    cwd: Option<String>,
) -> Result<Option<ResolvedLspCommand>, String> {
    Ok(resolve_lsp_command_inner(&candidates, cwd.as_deref()))
}

#[tauri::command]
pub fn check_lsp_servers(
    servers: Vec<LspServerProbe>,
    cwd: Option<String>,
) -> Result<Vec<LspServerStatus>, String> {
    Ok(servers
        .into_iter()
        .map(|server| {
            let resolved = resolve_lsp_command_inner(&server.candidates, cwd.as_deref());
            LspServerStatus {
                id: server.id,
                label: server.label,
                languages: server.languages,
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

#[tauri::command]
pub fn send_lsp_message(state: tauri::State<'_, LspState>, message: String) -> Result<(), String> {
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

fn resolve_lsp_command_inner(
    candidates: &[LspCommandCandidate],
    cwd: Option<&str>,
) -> Option<ResolvedLspCommand> {
    for candidate in candidates {
        if let Some(path) = resolve_command_path(&candidate.cmd, cwd) {
            let Some(args) = expand_command_args(&candidate.args, cwd) else {
                continue;
            };
            if !args_are_available(&args) {
                continue;
            }
            return Some(ResolvedLspCommand {
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

fn normalize_spawn_command(cmd: String, args: Vec<String>) -> (String, Vec<String>) {
    let ext = Path::new(&cmd)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if matches!(ext.as_str(), "js" | "mjs" | "cjs") {
        let mut next_args = vec![cmd];
        next_args.extend(args);
        return ("node".to_string(), next_args);
    }

    if cfg!(windows) && matches!(ext.as_str(), "cmd" | "bat") {
        let shell = env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let mut next_args = vec!["/C".to_string(), cmd];
        next_args.extend(args);
        return (shell, next_args);
    }

    (cmd, args)
}
