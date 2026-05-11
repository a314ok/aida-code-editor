# Aida Studio IDE Backlog

Цей backlog тримає фокус на тому, що треба довести до рівня повсякденного редактора/IDE. AI-функції поки свідомо винесені за рамки.

## P0: Stabilize Core

- Build має бути зеленим після кожного великого шматка.
- LSP має стартувати без `os error 193`, показувати діагностику, hover, completion, definition, references, rename, code actions і format.
- DAP має мати зрозумілий UX: вибір адаптера, launch/attach, breakpoints, variables, call stack, output, restart/stop.
- Unsaved-file prompts, session restore, file watcher, settings persistence і keyboard shortcuts мають працювати стабільно.

## P1: Git IDE Workflow

- Окремі категорії `Staged`, `Changes`, `Untracked`, включно з файлами, які одночасно мають staged і unstaged diff.
- Stage/unstage/discard для файлу, hunk і selected lines.
- Commit/push/pull/stash/branch checkout/create.
- History, show commit, compare refs, file history.
- Далі: selected ranges з line numbers, branch publish/set upstream, rebase/cherry-pick, tags, conflict resolver, blame, incoming/outgoing changes.

## P1: Floating Workspace

- Нескінченний canvas з virtualized floating windows і без зайвого GPU/відеопам'яті.
- Keyboard-first навігація між floating windows, tabs і panels.
- Maximize-to-viewport для кожного floating window.
- Multi-workspace модель: кілька проектів одночасно, чітка прив'язка Git/LSP/tasks/debug до активного workspace.

## P2: Browser Windows

- Floating browser window з URL bar, tabs, back/forward/reload і локальним HTML preview з редактора.
- Inspector для same-origin/local preview: DOM tree, selected element, computed styles, console.
- Для зовнішніх сайтів потрібна Tauri/WebView стратегія, бо багато сайтів блокують iframe.

## P2: Backend/API Tools

- Floating API client: method, URL, headers, body, auth presets, history, saved requests.
- Response viewer: status/time/size, headers, JSON tree, raw body.
- Workspace collections поруч із проектом.

## P2: Markdown/Docs

- Markdown preview поруч або в floating preview.
- Obsidian-style режим: preview, editor, split, link navigation.
- Далі: Mermaid, frontmatter, local asset resolution.

## P3: Visual Builder

- Frontend visual tab для Vue/React/HTML: mobile-first canvas, component tree, style inspector.
- Генерація/редагування layout без зламу коду.
- Далі: framework adapters і component metadata.

## P3: Product Polish

- Нове лого, app icon, splash/branding.
- Розширені Settings: theme tokens, editor visuals, keymap editor, Git/LSP/DAP paths.
- Micro-docs всередині Debug, Git, Browser і API tools.
