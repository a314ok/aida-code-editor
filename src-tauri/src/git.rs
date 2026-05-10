use git2::{IndexAddOption, Repository, StatusOptions};
use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Serialize)]
pub struct GitStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
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

#[tauri::command]
pub fn get_git_status(path: String) -> Result<Vec<GitStatus>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in statuses.iter() {
        let s = entry.status();

        let staged = s.is_index_new()
            || s.is_index_modified()
            || s.is_index_deleted()
            || s.is_index_renamed();

        let status_str = if s.is_index_new() || s.is_wt_new() {
            "U"
        } else if s.is_index_modified() || s.is_wt_modified() {
            "M"
        } else if s.is_index_deleted() || s.is_wt_deleted() {
            "D"
        } else if s.is_index_renamed() || s.is_wt_renamed() {
            "R"
        } else {
            "?"
        };

        if let Some(p) = entry.path() {
            result.push(GitStatus {
                path: p.to_string(),
                status: status_str.to_string(),
                staged,
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
    opts.include_untracked(true).recurse_untracked_dirs(true);
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
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_stage_file(path: String, file: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_path(std::path::Path::new(&file))
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
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
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
    let mut args = vec![
        "-C".to_string(),
        path,
        "diff".to_string(),
        base,
        head,
    ];

    if let Some(file) = file.filter(|file| !file.trim().is_empty()) {
        args.push("--".to_string());
        args.push(file);
    }

    run_git_owned(args)
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
