import { BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";

type OpenDialogOptions = {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

function preloadPath(): string {
  return join(__dirname, "../preload/preload.mjs");
}

export function registerWindowHandlers(): void {
  ipcMain.handle("dialog_open", async (_event, args?: OpenDialogOptions) => {
    const properties: Array<"openFile" | "openDirectory" | "multiSelections"> = [];
    properties.push(args?.directory ? "openDirectory" : "openFile");
    if (args?.multiple) properties.push("multiSelections");

    const result = await dialog.showOpenDialog({
      title: args?.title,
      defaultPath: args?.defaultPath,
      filters: args?.filters,
      properties,
    });

    if (result.canceled) return null;
    return args?.multiple ? result.filePaths : result.filePaths[0] ?? null;
  });

  ipcMain.handle("open_floating_window", async (_event, args: { title: string; url: string }) => {
    const window = new BrowserWindow({
      width: 640,
      height: 420,
      title: args.title,
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: true,
        sandbox: false,
      },
    });
    await window.loadURL(args.url);
  });

  ipcMain.handle("open_embedded_browser_view", async () => undefined);
  ipcMain.handle("set_embedded_browser_view_bounds", async () => undefined);
  ipcMain.handle("hide_embedded_browser_view", async () => undefined);
}
