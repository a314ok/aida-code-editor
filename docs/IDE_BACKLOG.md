# Aida Studio IDE Backlog

This backlog tracks the work needed to make Aida Studio reliable as a daily editor and IDE.

## P0: Stabilize Core

- Keep `npm run build` green after every major change.
- Make LSP startup reliable, including diagnostics, hover, completion, definition, references, rename, code actions, and format.
- Make DAP setup clear: adapter selection, launch/attach, breakpoints, variables, call stack, output, restart, and stop.
- Keep unsaved-file prompts, session restore, file watcher, settings persistence, and keyboard shortcuts stable.

## P1: Git IDE Workflow

- Keep separate `Staged`, `Changes`, and `Untracked` groups, including files that have both staged and unstaged diffs.
- Support stage, unstage, discard for files, hunks, and selected lines.
- Support commit, amend, push, pull, stash, branch checkout, branch create, and branch publish.
- Support history, show commit, compare refs, file history, blame, and conflict resolution.
- Next: selected ranges with line numbers, set upstream, rebase, cherry-pick, tags, and incoming/outgoing changes.

## P1: Floating Workspace

- Keep the infinite canvas responsive with virtualized floating windows and predictable GPU use.
- Support keyboard-first navigation between floating windows, tabs, and panels.
- Support maximize-to-viewport for each floating window.
- Support multiple workspaces with clear Git, LSP, task, and debug ownership.

## P2: Browser Windows

- Floating browser window with URL bar, tabs, back, forward, reload, and local HTML preview from the editor.
- Inspector for same-origin and local preview: DOM tree, selected element, computed styles, and console.
- For external sites, use an Electron BrowserView/WebView strategy because many sites block iframe embedding.

## P2: Backend/API Tools

- Floating API client: method, URL, headers, body, auth presets, history, and saved requests.
- Response viewer: status, time, size, headers, JSON tree, and raw body.
- Workspace collections next to the active project.

## P2: Markdown/Docs

- Markdown preview beside the editor or in a floating preview.
- Obsidian-style modes: preview, editor, split, and link navigation.
- Next: Mermaid, frontmatter, and local asset resolution.

## P3: Visual Builder

- Keep UI builder experiments isolated until the editor core is stable.
