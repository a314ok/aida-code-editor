export type ElectronBridge = {
  invoke<T = unknown>(channel: string, args?: Record<string, unknown>): Promise<T>;
  on<T = unknown>(channel: string, callback: (payload: T) => void): () => void;
  openDialog<T = string | string[] | null>(options?: Record<string, unknown>): Promise<T>;
};

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

export const getElectronBridge = () => {
  if (!window.electronAPI) {
    throw new Error('Electron bridge is not available');
  }
  return window.electronAPI;
};
