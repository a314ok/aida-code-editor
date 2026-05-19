use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize)]
pub struct ProjectTask {
    id: String,
    label: String,
    group: String,
    command_line: String,
    description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskProblem {
    file: Option<String>,
    line: Option<usize>,
    column: Option<usize>,
    severity: String,
    message: String,
    raw: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskRunResult {
    success: bool,
    code: Option<i32>,
    timed_out: bool,
    duration_ms: u128,
    output: String,
    problems: Vec<TaskProblem>,
}

#[derive(Debug, Clone, Deserialize)]
struct PackageJson {
    scripts: Option<std::collections::BTreeMap<String, Value>>,
}

#[derive(Debug, Clone)]
struct ResolvedTask {
    id: String,
    label: String,
    group: String,
    command: String,
    args: Vec<String>,
    command_line: String,
    description: String,
    timeout_secs: u64,
}

impl From<&ResolvedTask> for ProjectTask {
    fn from(task: &ResolvedTask) -> Self {
        Self {
            id: task.id.clone(),
            label: task.label.clone(),
            group: task.group.clone(),
            command_line: task.command_line.clone(),
            description: task.description.clone(),
        }
    }
}

#[tauri::command]
pub fn get_project_tasks(path: String) -> Result<Vec<ProjectTask>, String> {
    let base = PathBuf::from(path);
    let tasks = discover_tasks(&base)?;
    Ok(tasks.iter().map(ProjectTask::from).collect())
}

#[tauri::command]
pub async fn run_project_task(path: String, task_id: String) -> Result<TaskRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_project_task_sync(path, task_id))
        .await
        .map_err(|e| format!("Task runner failed: {e}"))?
}

fn run_project_task_sync(path: String, task_id: String) -> Result<TaskRunResult, String> {
    let base = PathBuf::from(path);
    let task = discover_tasks(&base)?
        .into_iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| format!("Unknown task: {task_id}"))?;

    let started = Instant::now();
    let output = run_with_timeout(&base, &task)?;
    let duration_ms = started.elapsed().as_millis();
    let combined_output = join_output(
        &task.command_line,
        &output.stdout,
        &output.stderr,
        output.timed_out,
    );
    let problems = parse_problems(&combined_output, &base);

    Ok(TaskRunResult {
        success: output.code == Some(0) && !output.timed_out,
        code: output.code,
        timed_out: output.timed_out,
        duration_ms,
        output: combined_output,
        problems,
    })
}

fn discover_tasks(base: &Path) -> Result<Vec<ResolvedTask>, String> {
    let mut tasks = Vec::new();

    if base.join("package.json").exists() {
        tasks.extend(discover_npm_tasks(base)?);
    }

    if base.join("Cargo.toml").exists() {
        tasks.extend([
            command_task(
                "cargo:check",
                "cargo check",
                "cargo",
                "cargo",
                &["check"],
                "Rust type-check and diagnostics",
            ),
            command_task(
                "cargo:test",
                "cargo test",
                "cargo",
                "cargo",
                &["test"],
                "Rust test suite",
            ),
            command_task(
                "cargo:build",
                "cargo build",
                "cargo",
                "cargo",
                &["build"],
                "Rust debug build",
            ),
        ]);
    }

    if has_python_project(base) {
        tasks.extend([
            command_task(
                "python:pytest",
                "pytest",
                "python",
                python_command(),
                &["-m", "pytest"],
                "Run pytest test suite",
            ),
            command_task(
                "python:unittest",
                "unittest discover",
                "python",
                python_command(),
                &["-m", "unittest", "discover"],
                "Run standard library unittest discovery",
            ),
        ]);
    }

    Ok(tasks)
}

fn discover_npm_tasks(base: &Path) -> Result<Vec<ResolvedTask>, String> {
    let package_json = fs::read_to_string(base.join("package.json"))
        .map_err(|e| format!("Could not read package.json: {e}"))?;
    let parsed: PackageJson = serde_json::from_str(&package_json)
        .map_err(|e| format!("Could not parse package.json: {e}"))?;
    let Some(scripts) = parsed.scripts else {
        return Ok(Vec::new());
    };

    let mut tasks = Vec::new();
    for (name, command_value) in scripts {
        if !matches!(command_value, Value::String(_)) {
            continue;
        }

        tasks.push(command_task(
            &format!("npm:{name}"),
            &format!("npm run {name}"),
            "npm",
            npm_command(),
            &["run", &name],
            "package.json script",
        ));
    }
    Ok(tasks)
}

fn command_task(
    id: &str,
    label: &str,
    group: &str,
    command: &str,
    args: &[&str],
    description: &str,
) -> ResolvedTask {
    let args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    let command_line = std::iter::once(command.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");

    ResolvedTask {
        id: id.to_string(),
        label: label.to_string(),
        group: group.to_string(),
        command: command.to_string(),
        args,
        command_line,
        description: description.to_string(),
        timeout_secs: 120,
    }
}

fn has_python_project(base: &Path) -> bool {
    [
        "pyproject.toml",
        "setup.py",
        "requirements.txt",
        "pytest.ini",
        "tox.ini",
    ]
    .iter()
    .any(|name| base.join(name).exists())
}

fn npm_command() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn python_command() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

struct ProcessOutput {
    code: Option<i32>,
    timed_out: bool,
    stdout: String,
    stderr: String,
}

fn run_with_timeout(base: &Path, task: &ResolvedTask) -> Result<ProcessOutput, String> {
    let mut child = Command::new(&task.command)
        .args(&task.args)
        .current_dir(base)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", task.command_line))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_reader = thread::spawn(move || read_pipe(stdout));
    let stderr_reader = thread::spawn(move || read_pipe(stderr));

    let deadline = Instant::now() + Duration::from_secs(task.timeout_secs);
    let mut timed_out = false;
    let code;

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Task wait failed: {e}"))?
        {
            code = status.code();
            break;
        }

        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            let status = child.wait().map_err(|e| format!("Task kill failed: {e}"))?;
            code = status.code();
            break;
        }

        thread::sleep(Duration::from_millis(80));
    }

    let stdout = stdout_reader
        .join()
        .unwrap_or_else(|_| Err("Could not read stdout".to_string()))?;
    let stderr = stderr_reader
        .join()
        .unwrap_or_else(|_| Err("Could not read stderr".to_string()))?;

    Ok(ProcessOutput {
        code,
        timed_out,
        stdout,
        stderr,
    })
}

fn read_pipe(pipe: Option<impl Read>) -> Result<String, String> {
    let Some(mut pipe) = pipe else {
        return Ok(String::new());
    };
    let mut buffer = Vec::new();
    pipe.read_to_end(&mut buffer)
        .map_err(|e| format!("Could not read task output: {e}"))?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

fn join_output(command_line: &str, stdout: &str, stderr: &str, timed_out: bool) -> String {
    let mut output = format!("$ {command_line}\n");
    if !stdout.trim().is_empty() {
        output.push_str(stdout.trim_end());
        output.push('\n');
    }
    if !stderr.trim().is_empty() {
        if !stdout.trim().is_empty() {
            output.push('\n');
        }
        output.push_str(stderr.trim_end());
        output.push('\n');
    }
    if timed_out {
        output.push_str("\nTask timed out after 120 seconds.\n");
    }
    output
}

fn parse_problems(output: &str, base: &Path) -> Vec<TaskProblem> {
    let mut problems = Vec::new();
    let mut seen = HashSet::new();

    for line in output.lines() {
        let parsed = parse_parenthesized_problem(line, base)
            .or_else(|| parse_colon_problem(line, base))
            .or_else(|| parse_python_traceback(line, base));

        if let Some(problem) = parsed {
            let key = format!(
                "{}:{}:{}:{}",
                problem.file.as_deref().unwrap_or_default(),
                problem.line.unwrap_or_default(),
                problem.column.unwrap_or_default(),
                problem.raw
            );
            if seen.insert(key) {
                problems.push(problem);
            }
        }
    }

    problems
}

fn parse_parenthesized_problem(line: &str, base: &Path) -> Option<TaskProblem> {
    let close = line.find("):")?;
    let left = &line[..close];
    let open = left.rfind('(')?;
    let file = left[..open].trim();
    let location = &left[open + 1..];
    let mut parts = location.split(',');
    let line_no = parts.next()?.trim().parse::<usize>().ok()?;
    let column = parts.next()?.trim().parse::<usize>().ok()?;
    let rest = line[close + 2..].trim();

    Some(TaskProblem {
        file: Some(resolve_problem_file(base, file)),
        line: Some(line_no),
        column: Some(column),
        severity: severity_from_message(rest),
        message: clean_problem_message(rest),
        raw: line.to_string(),
    })
}

fn parse_colon_problem(line: &str, base: &Path) -> Option<TaskProblem> {
    let parts = line.split(':').collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }

    for idx in 1..parts.len() {
        let Ok(line_no) = parts[idx].trim().parse::<usize>() else {
            continue;
        };

        let (column, rest_start) = if idx + 1 < parts.len() {
            match parts[idx + 1].trim().parse::<usize>() {
                Ok(column) => (Some(column), idx + 2),
                Err(_) => (None, idx + 1),
            }
        } else {
            (None, idx + 1)
        };

        if rest_start >= parts.len() {
            continue;
        }

        let file = parts[..idx].join(":");
        if file.trim().is_empty() || looks_like_url_or_drive_only(&file) {
            continue;
        }

        let rest = parts[rest_start..].join(":").trim().to_string();
        if rest.is_empty() || !looks_like_problem(&rest) {
            continue;
        }

        return Some(TaskProblem {
            file: Some(resolve_problem_file(base, &file)),
            line: Some(line_no),
            column,
            severity: severity_from_message(&rest),
            message: clean_problem_message(&rest),
            raw: line.to_string(),
        });
    }

    None
}

fn parse_python_traceback(line: &str, base: &Path) -> Option<TaskProblem> {
    let trimmed = line.trim();
    let file_start = trimmed.strip_prefix("File \"")?;
    let quote = file_start.find('"')?;
    let file = &file_start[..quote];
    let after_file = &file_start[quote + 1..];
    let marker = ", line ";
    let line_pos = after_file.find(marker)?;
    let after_line = &after_file[line_pos + marker.len()..];
    let line_no = after_line
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse::<usize>()
        .ok()?;

    Some(TaskProblem {
        file: Some(resolve_problem_file(base, file)),
        line: Some(line_no),
        column: None,
        severity: "error".to_string(),
        message: "Python traceback frame".to_string(),
        raw: line.to_string(),
    })
}

fn resolve_problem_file(base: &Path, file: &str) -> String {
    let cleaned = file.trim().trim_matches('"').trim_matches('\'');
    let path = PathBuf::from(cleaned);
    let resolved = if path.is_absolute() {
        path
    } else {
        base.join(path)
    };
    resolved.to_string_lossy().replace('\\', "/")
}

fn looks_like_url_or_drive_only(file: &str) -> bool {
    let trimmed = file.trim();
    trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || (trimmed.len() == 1 && trimmed.as_bytes()[0].is_ascii_alphabetic())
}

fn looks_like_problem(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("error")
        || lower.contains("warning")
        || lower.contains("failed")
        || lower.contains("panic")
        || lower.contains("exception")
}

fn severity_from_message(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("warning") {
        "warning"
    } else if lower.contains("hint") || lower.contains("note") {
        "info"
    } else {
        "error"
    }
    .to_string()
}

fn clean_problem_message(message: &str) -> String {
    message.trim().trim_start_matches('-').trim().to_string()
}
