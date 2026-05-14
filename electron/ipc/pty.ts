import { ipcMain } from "electron";
import * as pty from "node-pty";
import { sendToRenderer, type WindowProvider } from "./events";

let currentPty: pty.IPty | null = null;

export function registerPtyHandlers(getWindow: WindowProvider): void {
  ipcMain.handle("spawn_pty", async (_event, args?: { cols?: number; rows?: number; cwd?: string | null }) => {
    currentPty?.kill();

    const shell = process.platform === "win32"
      ? process.env.ComSpec ?? "cmd.exe"
      : process.env.SHELL ?? "bash";

    currentPty = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: args?.cols ?? 80,
      rows: args?.rows ?? 24,
      cwd: args?.cwd ?? process.cwd(),
      env: process.env,
    });

    currentPty.onData((data) => sendToRenderer(getWindow, "pty:data", data));
    currentPty.onExit(() => {
      currentPty = null;
    });
  });

  ipcMain.handle("write_pty", async (_event, args: { data: string }) => {
    currentPty?.write(args.data);
  });

  ipcMain.handle("resize_pty", async (_event, args: { cols: number; rows: number }) => {
    currentPty?.resize(args.cols, args.rows);
  });
}
