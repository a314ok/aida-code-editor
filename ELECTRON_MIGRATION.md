# Electron Migration Task

## Goal
Migrate this project from Tauri v2 to Electron while keeping the Vue 3 frontend intact.
Create a fully working Electron-based version of the Aida Studio code editor.

## Current Stack
- Frontend: Vue 3 + Pinia + Vite + TailwindCSS + CodeMirror 6 + lucide-vue-next
- Backend: Rust (Tauri v2) — src-tauri/
- Key IPC: `invoke()` from `@tauri-apps/api/core`
- Key plugins: tauri-plugin-dialog, tauri-plugin-shell

## Target Stack
- Frontend: same (Vue 3 + Pinia + Vite + TailwindCSS + CodeMirror 6) — NO CHANGES
- Backend: Node.js (Electron main process)
- IPC: Electron ipcMain / ipcRenderer (contextBridge)
- Browser: Electron <webview> tag in renderer (replaces Tauri child webview)

## What needs to change

### 1. Create Electron main process (electron/main.ts)
- BrowserWindow with nodeIntegration: false, contextIsolation: true
- Load Vite dev server in dev, load dist/index.html in prod
- Register all IPC handlers (see list below)
- Menu: minimal (no default menu)

### 2. Create preload script (electron/preload.ts)
- Expose all commands via contextBridge as `window.electronAPI`
- Map every `invoke('command_name', args)` to `ipcRenderer.invoke('command_name', args)`

### 3. Replace all `invoke()` calls in frontend
- In src/: replace `import { invoke } from '@tauri-apps/api/core'` with nothing
- Use `window.electronAPI.invoke('command_name', args)` OR keep same API shape via contextBridge

### 4. Implement all backend commands in Node.js (electron/ipc/)

#### Filesystem (src-tauri/src/fs.rs → electron/ipc/fs.ts)
Commands to implement:
- get_dir_tree(path) → return FileEntry[] tree (use fs.readdir recursive)
- read_file(path) → return string content
- save_file(path, content) → write file
- create_file(path) → create empty file
- create_directory(path) → mkdir
- delete_file(path) → unlink/rmdir
- rename_file(old_path, new_path) → rename
- search_in_files(root, query, case_sensitive, whole_word, use_regex) → matches
- replace_in_files(root, query, replacement, case_sensitive, whole_word, use_regex) → count

#### Git (src-tauri/src/git.rs → electron/ipc/git.ts)
Use `simple-git` npm package. Commands:
- get_git_status(path) → {statuses: Record<string, string>, entries: GitFileStatus[]}
- get_git_branch(path) → string
- git_stage_all(path)
- git_stage_file(path, file)
- git_unstage_all(path)
- git_unstage_file(path, file)
- get_git_diff(path, file?, staged?) → string
- git_discard_file(path, file)
- git_apply_patch(path, patch) → apply patch string
- git_list_branches(path) → {local: string[], remote: string[]}
- git_checkout_branch(path, branch, create?)
- git_conflict_files(path) → string[]
- git_list_stashes(path) → StashEntry[]
- git_stash_push(path, message?)
- git_stash_apply(path, index)
- git_stash_drop(path, index)
- git_commit(path, message) → commit
- git_amend_commit(path, message) → amend HEAD
- git_push(path, remote?, branch?)
- git_pull(path, remote?, branch?)
- git_log(path, max_count?) → LogEntry[]
- git_graph_log(path) → GraphEntry[]
- git_show(path, ref) → string
- git_diff_refs(path, from, to) → string
- git_blame(path, file) → BlameLine[]
- git_fetch(path)
- git_publish_branch(path, branch) → push and set upstream
- git_resolve_conflict(path, file, strategy: 'ours'|'theirs')

#### PTY / Terminal (src-tauri/src/pty.rs → electron/ipc/pty.ts)
Use `node-pty` npm package.
- spawn_pty(cols, rows, cwd?) → spawn shell (cmd.exe on Windows)
- write_pty(data) → write to pty
- resize_pty(cols, rows)
- PTY output → emit via webContents.send('pty:data', data)

#### LSP (src-tauri/src/lsp.rs → electron/ipc/lsp.ts)
- start_lsp(command, args, root_uri) → spawn LSP server process
- send_lsp_message(message) → write to LSP stdin
- resolve_lsp_command(language_id) → return {command, args} for known servers
- check_lsp_servers() → check which LSP servers are installed
- LSP stdout → emit via webContents.send('lsp:message', data)

#### DAP (src-tauri/src/dap.rs → electron/ipc/dap.ts)
- start_dap(command, args) → spawn DAP adapter process
- stop_dap() → kill DAP process
- send_dap_message(message) → write to DAP stdin
- resolve_dap_command(adapter_type) → return {command, args}
- check_dap_adapters() → check which DAP adapters are installed
- DAP stdout → emit via webContents.send('dap:message', data)

#### Tasks (src-tauri/src/tasks.rs → electron/ipc/tasks.ts)
- get_project_tasks(path) → parse package.json scripts, Makefile, etc.
- run_project_task(path, task) → spawn process, stream output via webContents.send

#### Window (electron/ipc/window.ts)
- open_floating_window(title, url) → open new BrowserWindow (not needed in Electron version, floating windows are CSS)
- NO embedded browser view commands needed — use <webview> tag in renderer instead

### 5. FloatingBrowser.vue — replace native webview with Electron <webview>
The key win of Electron: use `<webview>` HTML tag directly in Vue template.
- No z-index issues — it's a DOM element
- Works with any URL — bypasses X-Frame-Options
- Supports navigation, reload, devtools

```vue
<webview
  ref="webviewEl"
  :src="activeTab?.url"
  style="width:100%;height:100%;border:none;"
  allowpopups
  webpreferences="contextIsolation=yes"
/>
```

Use webviewEl.value?.loadURL(url) for navigation.
Use webviewEl.value?.reload() for refresh.
Use webviewEl.value?.openDevTools() for devtools.

Remove ALL native webview Tauri invoke calls (open_embedded_browser_view, etc.)
Remove the entire overlay/inactive logic — <webview> just works.

### 6. Update package.json
Add electron deps:
- electron
- electron-builder (devDep)
- @electron-toolkit/preload
- @electron-toolkit/utils
- simple-git
- node-pty
- typescript (for electron/main.ts)

Remove tauri deps:
- @tauri-apps/api
- @tauri-apps/cli

### 7. Update vite.config.ts
Add electron-vite or configure Vite to work with Electron.
Use `electron-vite` package for cleanest setup.

### 8. Remove Tauri-specific code
- Remove all `import { ... } from '@tauri-apps/api/*'`
- Remove tauri:// protocol references
- Replace `window.__TAURI__` checks with Electron checks
- Remove src-tauri/ directory reference from build configs (keep the dir, just don't build it)

## Event system migration
Tauri events (`listen`, `emit`) → Electron IPC events:
- `listen('event-name', handler)` → `window.electronAPI.on('event-name', handler)`
- Tauri file-drag events → Electron `webContents.send`

## Type definitions
Create src/types/electron.d.ts declaring `window.electronAPI` with all methods.

## Build configuration
- Dev: `electron-vite dev` starts both Vite dev server and Electron
- Build: `electron-vite build` + `electron-builder`
- electron-builder config in electron-builder.yml or package.json

## Important constraints
- Keep ALL existing Vue components unchanged except FloatingBrowser.vue
- Keep ALL existing Pinia store (src/stores/editor.ts) unchanged
- Keep ALL existing styles, TailwindCSS config unchanged
- The only frontend changes: FloatingBrowser.vue + IPC layer (invoke calls)
- TypeScript strict mode must pass

## Steps to execute
1. Install npm dependencies (electron, electron-vite, simple-git, node-pty, etc.)
2. Create electron/ directory with main.ts, preload.ts, ipc/ modules
3. Update vite.config.ts for electron-vite
4. Update package.json scripts
5. Create src/lib/ipc.ts as drop-in replacement for @tauri-apps/api/core invoke
6. Update all frontend files that import from @tauri-apps/api
7. Rewrite FloatingBrowser.vue with <webview> tag
8. Test that `npm run dev` starts Electron with the app
9. Commit everything to the electron-rewrite branch
