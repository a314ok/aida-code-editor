import { app, BrowserWindow, Menu } from "electron";
import { is } from "@electron-toolkit/utils";
import { join } from "node:path";
import { registerDapHandlers } from "./ipc/dap";
import { registerFsHandlers } from "./ipc/fs";
import { registerGitHandlers } from "./ipc/git";
import { registerLspHandlers } from "./ipc/lsp";
import { registerPtyHandlers } from "./ipc/pty";
import { registerTaskHandlers } from "./ipc/tasks";
import { registerWindowHandlers } from "./ipc/window";

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Aida Studio",
    backgroundColor: "#0b0b0d",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
  }
}

function registerIpc(): void {
  registerFsHandlers();
  registerGitHandlers();
  registerPtyHandlers(getMainWindow);
  registerLspHandlers(getMainWindow);
  registerDapHandlers(getMainWindow);
  registerTaskHandlers(getMainWindow);
  registerWindowHandlers();
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.aida.studio");
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
