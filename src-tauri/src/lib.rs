mod fs;
mod pty;
mod git;
mod lsp;
mod window;

use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyState {
            writer: Arc::new(Mutex::new(Box::new(std::io::sink()))),
            master: Arc::new(Mutex::new(None)),
        })
        .manage(lsp::LspState {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs::get_dir_tree,
            fs::read_file,
            fs::save_file,
            fs::create_file,
            fs::create_directory,
            fs::delete_file,
            fs::rename_file,
            fs::search_in_files,
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            git::get_git_status,
            git::get_git_branch,
            git::git_stage_all,
            git::git_stage_file,
            git::git_commit,
            git::git_push,
            git::git_pull,
            lsp::start_lsp,
            lsp::send_lsp_message,
            window::open_floating_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
