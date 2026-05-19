import { contextBridge, ipcRenderer } from 'electron';

const api = {
  invoke<T = unknown>(channel: string, args?: Record<string, unknown>) {
    return ipcRenderer.invoke(channel, args) as Promise<T>;
  },
  on<T = unknown>(channel: string, callback: (payload: T) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  openDialog<T = string | string[] | null>(options?: Record<string, unknown>) {
    return ipcRenderer.invoke('dialog_open', options) as Promise<T>;
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
