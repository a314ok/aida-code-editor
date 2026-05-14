export {};

type ElectronOpenDialogOptions = {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type AidaWebviewElement = HTMLElement & {
  loadURL(url: string): Promise<void>;
  reload(): void;
  openDevTools(): void;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
};

declare global {
  interface Window {
    electronAPI: {
      invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
      on<T = unknown>(channel: string, callback: (payload: T) => void): () => void;
      openDialog<T = string | string[] | null>(options?: ElectronOpenDialogOptions): Promise<T>;
    };
  }

  interface HTMLElementTagNameMap {
    webview: AidaWebviewElement;
  }
}
