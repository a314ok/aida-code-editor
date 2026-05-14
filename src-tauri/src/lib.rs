mod dap;
mod fs;
mod git;
mod lsp;
mod pty;
mod tasks;
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
        .manage(dap::DapState {
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
            fs::replace_in_files,
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            git::get_git_status,
            git::get_git_branch,
            git::git_stage_all,
            git::git_stage_file,
            git::git_unstage_all,
            git::git_unstage_file,
            git::get_git_diff,
            git::git_discard_file,
            git::git_apply_patch,
            git::git_list_branches,
            git::git_checkout_branch,
            git::git_conflict_files,
            git::git_list_stashes,
            git::git_stash_push,
            git::git_stash_apply,
            git::git_stash_drop,
            git::git_commit,
            git::git_amend_commit,
            git::git_push,
            git::git_pull,
            git::git_log,
            git::git_graph_log,
            git::git_show,
            git::git_diff_refs,
            git::git_blame,
            git::git_fetch,
            git::git_publish_branch,
            git::git_resolve_conflict,
            lsp::start_lsp,
            lsp::resolve_lsp_command,
            lsp::check_lsp_servers,
            lsp::send_lsp_message,
            dap::start_dap,
            dap::stop_dap,
            dap::send_dap_message,
            dap::resolve_dap_command,
            dap::check_dap_adapters,
            tasks::get_project_tasks,
            tasks::run_project_task,
            window::open_floating_window,
            window::open_embedded_browser_view,
            window::set_embedded_browser_view_bounds,
            window::hide_embedded_browser_view,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
