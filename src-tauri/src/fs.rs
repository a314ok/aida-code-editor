use std::fs;
use std::path::Path;
use serde::{Serialize, Deserialize};
use walkdir::WalkDir;
use std::io::{BufRead, BufReader};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: String, // "file" or "directory"
    pub children: Option<Vec<FileEntry>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub content: String,
}

#[tauri::command]
pub fn get_dir_tree(path: String) -> Result<Vec<FileEntry>, String> {
    let mut dirs: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();

        // Skip hidden files and common noise dirs
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
            continue;
        }

        let kind = if p.is_dir() { "directory" } else { "file" }.to_string();
        let fe = FileEntry {
            name: name.clone(),
            path: p.to_string_lossy().to_string(),
            kind: kind.clone(),
            children: None,
        };

        if kind == "directory" {
            dirs.push(fe);
        } else {
            files.push(fe);
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);

    Ok(dirs)
}

#[tauri::command]
pub fn search_in_files(path: String, pattern: String) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    let pattern_lower = pattern.to_lowercase();

    for entry in WalkDir::new(&path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let file_path = entry.path();
        let path_str = file_path.to_string_lossy();

        if path_str.contains("node_modules")
            || path_str.contains(".git")
            || path_str.contains("target")
            || path_str.contains("__pycache__")
            || path_str.contains(".next")
            || path_str.contains("dist")
        {
            continue;
        }

        // Skip binary files by extension
        if let Some(ext) = file_path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "ico" | "svg" | "woff" | "woff2" | "ttf" | "eot" | "exe" | "dll" | "so" | "bin" | "zip" | "tar" | "gz" | "pdf") {
                continue;
            }
        }

        if let Ok(file) = fs::File::open(file_path) {
            let reader = BufReader::new(file);
            for (index, line) in reader.lines().enumerate() {
                if let Ok(line_content) = line {
                    if line_content.to_lowercase().contains(&pattern_lower) {
                        results.push(SearchResult {
                            path: file_path.to_string_lossy().to_string(),
                            line: index + 1,
                            content: line_content,
                        });

                        if results.len() >= 500 {
                            return Ok(results);
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::File::create(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_file(path: String, new_path: String) -> Result<(), String> {
    fs::rename(path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}
