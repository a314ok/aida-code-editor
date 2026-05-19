# Aida Code Studio 🚀

Aida Code Studio is a blazingly fast, beautiful, and minimalistic code editor built with Tauri 2, Vue 3, and CodeMirror 6.

## 🛠 Tech Stack
- **Backend:** Rust + Tauri 2
- **Frontend:** Vue 3 (Composition API) + Vite
- **Editor:** CodeMirror 6 + Vim Mode (`@replit/codemirror-vim`)
- **Terminal:** xterm.js + Rust `portable-pty`
- **Styling:** Tailwind CSS + Lucide Icons
- **State Management:** Pinia

## ✨ Features
- **Modern UI:** Frameless window, custom titlebar, dark aesthetic.
- **Vim Support:** Built-in Vim mode for efficiency.
- **Integrated Terminal:** Full PTY support (PowerShell on Windows, Bash on Unix).
- **Workspace Explorer:** Browse and open project files.
- **Git Integration:** View file statuses (M, U, D) directly in the explorer.
- **LSP Ready:** Architecture designed for Language Server Protocol support.

## 🚀 Getting Started

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (v18+)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Installation
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Development
Run the app in development mode:
```bash
npm run tauri dev
```

### Build
Build the production-ready application:
```bash
npm run tauri build
```

## 📂 Project Structure
- `src/`: Vue frontend source code.
- `src-tauri/`: Rust backend source code.
  - `src/fs.rs`: File system operations.
  - `src/pty.rs`: Terminal PTY logic.
  - `src/git.rs`: Git status integration.
  - `src/lib.rs`: Tauri command registration.
- `src/components/`: Modular UI components (Editor, Terminal, Sidebar, etc.).
- `src/stores/`: Pinia state management for the editor.
