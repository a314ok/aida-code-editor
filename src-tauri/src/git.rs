use git2::{Repository, StatusOptions, IndexAddOption};
use serde::Serialize;
use std::process::Command;

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

#[tauri::command]
pub fn get_git_status(path: String) -> Result<Vec<GitStatus>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in statuses.iter() {
        let s = entry.status();

        let staged = s.is_index_new() || s.is_index_modified() || s.is_index_deleted() || s.is_index_renamed();

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
    Ok(GitBranchInfo { name, ahead: 0, behind: 0 })
}

#[tauri::command]
pub fn git_stage_all(path: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_stage_file(path: String, file: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(std::path::Path::new(&file)).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
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
    let output = Command::new("git")
        .args(["-C", &path, "push"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub fn git_pull(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", &path, "pull"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
