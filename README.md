# Aida Code Studio

Aida Code Studio is an Electron + Vue code workspace with a custom editor surface, Git tooling, terminal support, browser tools, and project utilities.

## Tech Stack

- **Shell:** Electron + electron-vite
- **Frontend:** Vue 3 + Vite
- **Editor:** CodeMirror 6 + Vim mode
- **Terminal:** xterm.js + node-pty
- **Git:** simple-git + native Electron IPC handlers
- **State:** Pinia

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Project Structure

- `electron/`: Electron main, preload, and IPC handlers.
- `src/`: Vue renderer source.
- `src/components/`: Editor, Git, terminal, browser, search, tasks, and tool panels.
- `src/lib/`: Renderer-side IPC and dialog bridge helpers.
- `src/stores/`: Pinia state management.
