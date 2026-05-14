import { contextBridge, ipcRenderer } from "electron";

const api = {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T> {
    return ipcRenderer.invoke(channel, args) as Promise<T>;
  },

  on<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  openDialog<T = string | string[] | null>(options?: unknown): Promise<T> {
    return ipcRenderer.invoke("dialog_open", options) as Promise<T>;
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
