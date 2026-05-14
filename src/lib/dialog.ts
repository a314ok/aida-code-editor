type OpenDialogOptions = {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
  if (!window.electronAPI) throw new Error("Electron IPC bridge is not available");
  return window.electronAPI.openDialog(options);
}
