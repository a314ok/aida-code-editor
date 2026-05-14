import type { BrowserWindow } from "electron";

export type WindowProvider = () => BrowserWindow | null;

export function sendToRenderer(getWindow: WindowProvider, channel: string, payload: unknown): void {
  const window = getWindow();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, payload);
}
