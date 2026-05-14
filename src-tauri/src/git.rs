use git2::{Repository, Status, StatusOptions};
use serde::Serialize;
use std::io::Write;
use std::path::{Component, Path};
use std::process::{Command, Stdio};

#[derive(Serialize)]
pub struct GitStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub worktree: bool,
    pub index_status: Option<String>,
    pub worktree_status: Option<String>,
}

#[derive(Serialize)]
pub struct GitBranchInfo {
    pub name: String,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Serialize)]
pub struct GitBranchItem {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
}

#[derive(Serialize)]
pub struct GitStashItem {
    pub id: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct GitLogItem {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub summary: String,
}

#[derive(Serialize)]
pub struct GitCommitFile {
    pub status: String,
    pub path: String,
    pub old_path: Option<String>,
}

#[derive(Serialize)]
pub struct GitGraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub author: String,
    pub date: String,
    pub summary: String,
    pub files: Vec<GitCommitFile>,
}

#[derive(Serialize)]
pub struct GitBlameLine {
    pub line: usize,
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub summary: String,
    pub content: String,
}

fn status_from_index(status: Status) -> Option<&'static str> {
    if status.is_conflicted() {
        Some("C")
    } else if status.is_index_new() {
        Some("A")
    } else if status.is_index_modified() {
        Some("M")
    } else if status.is_index_deleted() {
        Some("D")
    } else if status.is_index_renamed() {
        Some("R")
    } else if status.is_index_typechange() {
        Some("T")
    } else {
        None
    }
}

fn status_from_worktree(status: Status) -> Option<&'static str> {
    if status.is_conflicted() {
        Some("C")
    } else if status.is_wt_new() {
        Some("U")
    } else if status.is_wt_modified() {
        Some("M")
    } else if status.is_wt_deleted() {
        Some("D")
    } else if status.is_wt_renamed() {
        Some("R")
    } else if status.is_wt_typechange() {
        Some("T")
    } else {
        None
    }
}

#[tauri::command]
pub fn get_git_status(path: String) -> Result<Vec<GitStatus>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in statuses.iter() {
        let s = entry.status();

        let index_status = status_from_index(s);
        let worktree_status = status_from_worktree(s);
        let staged = index_status.is_some();
        let worktree = worktree_status.is_some();
        let status_str = index_status
            .as_deref()
            .or(worktree_status.as_deref())
            .unwrap_or("?");

        if let Some(p) = entry.path() {
            result.push(GitStatus {
                path: p.to_string(),
                status: status_str.to_string(),
                staged,
                worktree,
                index_status: index_status.map(str::to_string),
                worktree_status: worktree_status.map(str::to_string),
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn get_git_branch(path: String) -> Result<GitBranchInfo, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let name = head.shorthand().unwrap_or("HEAD").to_string();
    Ok(GitBranchInfo {
        name,
        ahead: 0,
        behind: 0,
    })
}

#[tauri::command]
pub fn git_list_branches(path: String) -> Result<Vec<GitBranchItem>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for branch in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, branch_type) = branch.map_err(|e| e.to_string())?;
        let Some(name) = branch.name().map_err(|e| e.to_string())? else {
            continue;
        };
        result.push(GitBranchItem {
            name: name.to_string(),
            is_head: branch.is_head(),
            is_remote: matches!(branch_type, git2::BranchType::Remote),
        });
    }

    result.sort_by(|a, b| a.is_remote.cmp(&b.is_remote).then(a.name.cmp(&b.name)));
    Ok(result)
}

#[tauri::command]
pub fn git_checkout_branch(path: String, branch: String, create: bool) -> Result<String, String> {
    let mut args = vec!["-C", path.as_str(), "checkout"];
    if create {
        args.push("-b");
    }
    args.push(branch.as_str());

    run_git(args)
}

#[tauri::command]
pub fn git_conflict_files(path: String) -> Result<Vec<String>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).recurse_untracked_dirs(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for entry in statuses.iter() {
        if entry.status().is_conflicted() {
            if let Some(path) = entry.path() {
                result.push(path.to_string());
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn git_list_stashes(path: String) -> Result<Vec<GitStashItem>, String> {
    let output = Command::new("git")
        .args(["-C", &path, "stash", "list", "--format=%gd%x09%s"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (id, message) = line.split_once('\t')?;
            Some(GitStashItem {
                id: id.to_string(),
                message: message.to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn git_stash_push(path: String, message: String) -> Result<String, String> {
    let label = if message.trim().is_empty() {
        "WIP from Aida Studio"
    } else {
        message.trim()
    };
    run_git(vec![
        "-C",
        path.as_str(),
        "stash",
        "push",
        "-u",
        "-m",
        label,
    ])
}

#[tauri::command]
pub fn git_stash_apply(path: String, stash: String, pop: bool) -> Result<String, String> {
    let action = if pop { "pop" } else { "apply" };
    run_git(vec!["-C", path.as_str(), "stash", action, stash.as_str()])
}

#[tauri::command]
pub fn git_stash_drop(path: String, stash: String) -> Result<String, String> {
    run_git(vec!["-C", path.as_str(), "stash", "drop", stash.as_str()])
}

#[tauri::command]
pub fn git_stage_all(path: String) -> Result<(), String> {
    run_git(vec!["-C", path.as_str(), "add", "-A"]).map(|_| ())
}

#[tauri::command]
pub fn git_stage_file(path: String, file: String) -> Result<(), String> {
    run_git(vec!["-C", path.as_str(), "add", "--", file.as_str()]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage_all(path: String) -> Result<(), String> {
    run_git(vec!["-C", path.as_str(), "reset"]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage_file(path: String, file: String) -> Result<(), String> {
    run_git(vec!["-C", path.as_str(), "reset", "--", file.as_str()]).map(|_| ())
}

#[tauri::command]
pub fn get_git_diff(path: String, file: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["-C", path.as_str(), "diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(file.as_str());

    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let diff = String::from_utf8_lossy(&output.stdout).to_string();
        if !staged && diff.trim().is_empty() && is_untracked_file(&path, &file)? {
            return build_untracked_file_diff(&path, &file);
        }
        Ok(diff)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub fn git_log(
    path: String,
    file: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<GitLogItem>, String> {
    let limit = limit.unwrap_or(80).clamp(1, 300).to_string();
    let mut args = vec![
        "-C".to_string(),
        path,
        "log".to_string(),
        format!("-n{}", limit),
        "--date=short".to_string(),
        "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s".to_string(),
    ];

    if let Some(file) = file.filter(|file| !file.trim().is_empty()) {
        args.push("--".to_string());
        args.push(file);
    }

    let output = Command::new("git")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            Some(GitLogItem {
                hash: parts.next()?.to_string(),
                short_hash: parts.next()?.to_string(),
                author: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
                summary: parts.collect::<Vec<_>>().join("\x1f"),
            })
        })
        .collect())
}

#[tauri::command]
pub fn git_graph_log(path: String, limit: Option<usize>) -> Result<Vec<GitGraphCommit>, String> {
    let limit = limit.unwrap_or(120).clamp(1, 500).to_string();
    let limit_arg = format!("-n{}", limit);
    let output = Command::new("git")
        .args([
            "-C",
            &path,
            "log",
            "--all",
            "--decorate=short",
            "--date=short",
            "--name-status",
            &limit_arg,
            "--pretty=format:%x1e%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ad%x1f%s",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();
    for record in text.split('\x1e') {
        let record = record.trim_matches('\n');
        if record.trim().is_empty() {
            continue;
        }
        let mut lines = record.lines();
        let Some(header) = lines.next() else {
            continue;
        };
        let mut parts = header.split('\x1f');
        let Some(hash) = parts.next() else {
            continue;
        };
        let short_hash = parts.next().unwrap_or_default().to_string();
        let parents = parts
            .next()
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let refs = parts
            .next()
            .unwrap_or_default()
            .split(", ")
            .filter(|item| !item.trim().is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        let author = parts.next().unwrap_or_default().to_string();
        let date = parts.next().unwrap_or_default().to_string();
        let summary = parts.collect::<Vec<_>>().join("\x1f");
        let files = lines.filter_map(parse_name_status_line).collect::<Vec<_>>();

        commits.push(GitGraphCommit {
            hash: hash.to_string(),
            short_hash,
            parents,
            refs,
            author,
            date,
            summary,
            files,
        });
    }

    Ok(commits)
}

#[tauri::command]
pub fn git_show(path: String, rev: String, file: Option<String>) -> Result<String, String> {
    let mut args = vec![
        "-C".to_string(),
        path,
        "show".to_string(),
        "--stat".to_string(),
        "--patch".to_string(),
        rev,
    ];

    if let Some(file) = file.filter(|file| !file.trim().is_empty()) {
        args.push("--".to_string());
        args.push(file);
    }

    run_git_owned(args)
}

#[tauri::command]
pub fn git_diff_refs(
    path: String,
    base: String,
    head: String,
    file: Option<String>,
) -> Result<String, String> {
    let mut args = vec!["-C".to_string(), path, "diff".to_string(), base, head];

    if let Some(file) = file.filter(|file| !file.trim().is_empty()) {
        args.push("--".to_string());
        args.push(file);
    }

    run_git_owned(args)
}

#[tauri::command]
pub fn git_blame(path: String, file: String) -> Result<Vec<GitBlameLine>, String> {
    let output = Command::new("git")
        .args(["-C", &path, "blame", "--line-porcelain", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let mut result = Vec::new();
    let mut hash = String::new();
    let mut line = 0usize;
    let mut author = String::new();
    let mut summary = String::new();

    for raw in String::from_utf8_lossy(&output.stdout).lines() {
        if raw.starts_with('\t') {
            result.push(GitBlameLine {
                line,
                short_hash: hash.chars().take(8).collect(),
                hash: hash.clone(),
                author: author.clone(),
                summary: summary.clone(),
                content: raw.trim_start_matches('\t').to_string(),
            });
            author.clear();
            summary.clear();
            continue;
        }

        if raw.len() >= 40 && raw.as_bytes().get(40) == Some(&b' ') {
            let mut parts = raw.split_whitespace();
            hash = parts.next().unwrap_or_default().to_string();
            let _original = parts.next();
            line = parts
                .next()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
        } else if let Some(value) = raw.strip_prefix("author ") {
            author = value.to_string();
        } else if let Some(value) = raw.strip_prefix("summary ") {
            summary = value.to_string();
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn git_fetch(path: String) -> Result<String, String> {
    run_git(vec!["-C", path.as_str(), "fetch", "--all", "--prune"])
}

#[tauri::command]
pub fn git_publish_branch(path: String) -> Result<String, String> {
    let branch_output = Command::new("git")
        .args(["-C", &path, "branch", "--show-current"])
        .output()
        .map_err(|e| e.to_string())?;

    if !branch_output.status.success() {
        return Err(String::from_utf8_lossy(&branch_output.stderr).to_string());
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    if branch.is_empty() {
        return Err("Cannot publish detached HEAD".into());
    }

    run_git(vec![
        "-C",
        path.as_str(),
        "push",
        "--set-upstream",
        "origin",
        branch.as_str(),
    ])
}

#[tauri::command]
pub fn git_resolve_conflict(
    path: String,
    file: String,
    choice: String,
    stage: bool,
) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let workdir = repo
        .workdir()
        .ok_or("Bare repositories are not supported")?;
    if !is_safe_repo_relative_path(&file) {
        return Err("Unsafe file path".into());
    }
    let file_path = workdir.join(&file);
    let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let resolved = resolve_conflict_markers(&content, &choice)?;
    std::fs::write(&file_path, resolved).map_err(|e| e.to_string())?;
    if stage {
        git_stage_file(path, file)?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_discard_file(path: String, file: String) -> Result<(), String> {
    let reset_output = Command::new("git")
        .args(["-C", &path, "reset", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;

    if !reset_output.status.success() {
        return Err(String::from_utf8_lossy(&reset_output.stderr).to_string());
    }

    let checkout_output = Command::new("git")
        .args(["-C", &path, "checkout", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;

    if checkout_output.status.success() {
        return Ok(());
    }

    let clean_output = Command::new("git")
        .args(["-C", &path, "clean", "-f", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;

    if clean_output.status.success() {
        Ok(())
    } else {
        let checkout_err = String::from_utf8_lossy(&checkout_output.stderr);
        let clean_err = String::from_utf8_lossy(&clean_output.stderr);
        Err(format!("{}\n{}", checkout_err, clean_err))
    }
}

#[tauri::command]
pub fn git_apply_patch(
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> Result<String, String> {
    let mut args = vec!["-C", path.as_str(), "apply", "--whitespace=nowarn"];
    if cached {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push("-");

    let mut child = Command::new("git")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(patch.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;

    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let parent = match repo.head() {
        Ok(head) => {
            let oid = head.target().ok_or("No HEAD target")?;
            Some(repo.find_commit(oid).map_err(|e| e.to_string())?)
        }
        Err(_) => None,
    };

    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn git_push(path: String) -> Result<String, String> {
    run_git(vec!["-C", path.as_str(), "push"])
}

#[tauri::command]
pub fn git_pull(path: String) -> Result<String, String> {
    run_git(vec!["-C", path.as_str(), "pull"])
}

#[tauri::command]
pub fn git_amend_commit(path: String, message: Option<String>) -> Result<(), String> {
    let mut args = vec!["-C", path.as_str(), "commit", "--amend"];
    if let Some(ref msg) = message {
        if !msg.trim().is_empty() {
            args.push("-m");
            args.push(msg.as_str());
            return run_git(args).map(|_| ());
        }
    }
    args.push("--no-edit");
    run_git(args).map(|_| ())
}

fn is_safe_repo_relative_path(file: &str) -> bool {
    let path = Path::new(file);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn resolve_conflict_markers(content: &str, choice: &str) -> Result<String, String> {
    enum Section {
        Normal,
        Ours,
        Theirs,
    }

    let mut section = Section::Normal;
    let mut output: Vec<String> = Vec::new();
    let mut ours: Vec<String> = Vec::new();
    let mut theirs: Vec<String> = Vec::new();
    let mut found = false;

    for line in content.replace("\r\n", "\n").split('\n') {
        if line.starts_with("<<<<<<< ") {
            found = true;
            section = Section::Ours;
            ours.clear();
            theirs.clear();
            continue;
        }
        if line.starts_with("=======") && matches!(section, Section::Ours) {
            section = Section::Theirs;
            continue;
        }
        if line.starts_with(">>>>>>> ") && matches!(section, Section::Theirs) {
            match choice {
                "ours" => output.extend(ours.iter().cloned()),
                "theirs" => output.extend(theirs.iter().cloned()),
                "both" => {
                    output.extend(ours.iter().cloned());
                    output.extend(theirs.iter().cloned());
                }
                _ => return Err("Unknown conflict resolution choice".into()),
            }
            section = Section::Normal;
            continue;
        }

        match section {
            Section::Normal => output.push(line.to_string()),
            Section::Ours => ours.push(line.to_string()),
            Section::Theirs => theirs.push(line.to_string()),
        }
    }

    if !matches!(section, Section::Normal) {
        return Err("Unclosed conflict marker block".into());
    }
    if !found {
        return Err("No conflict markers found".into());
    }

    Ok(output.join("\n"))
}

fn parse_name_status_line(line: &str) -> Option<GitCommitFile> {
    if line.trim().is_empty() {
        return None;
    }
    let mut parts = line.split('\t');
    let status = parts.next()?.to_string();
    let first_path = parts.next()?.to_string();
    let second_path = parts.next().map(str::to_string);
    if status.starts_with('R') || status.starts_with('C') {
        return Some(GitCommitFile {
            status,
            path: second_path.unwrap_or_else(|| first_path.clone()),
            old_path: Some(first_path),
        });
    }
    Some(GitCommitFile {
        status,
        path: first_path,
        old_path: None,
    })
}

fn is_untracked_file(path: &str, file: &str) -> Result<bool, String> {
    let output = Command::new("git")
        .args([
            "-C",
            path,
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            file,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line == file))
}

fn build_untracked_file_diff(path: &str, file: &str) -> Result<String, String> {
    let repo = Repository::discover(path).map_err(|e| e.to_string())?;
    let workdir = repo
        .workdir()
        .ok_or("Bare repositories are not supported")?;
    if !is_safe_repo_relative_path(file) {
        return Err("Unsafe file path".into());
    }

    let file_path = workdir.join(file);
    let content = std::fs::read_to_string(&file_path)
        .map_err(|_| "Cannot preview binary or non-UTF-8 untracked file".to_string())?;
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.split('\n').collect::<Vec<_>>();
    if lines.last() == Some(&"") {
        lines.pop();
    }

    let escaped = file.replace('\\', "/");
    let mut diff = String::new();
    diff.push_str(&format!("diff --git a/{0} b/{0}\n", escaped));
    diff.push_str("new file mode 100644\n");
    diff.push_str("index 0000000..0000000\n");
    diff.push_str("--- /dev/null\n");
    diff.push_str(&format!("+++ b/{}\n", escaped));
    diff.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
    for line in lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }

    Ok(diff)
}

fn run_git(args: Vec<&str>) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(if stdout.trim().is_empty() {
            stderr
        } else {
            stdout
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn run_git_owned(args: Vec<String>) -> Result<String, String> {
    let output = Command::new("git")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(if stdout.trim().is_empty() {
            stderr
        } else {
            stdout
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
