type IpcEvent<T> = {
  event: string;
  payload: T;
};

const eventMap: Record<string, string> = {
  "pty-data": "pty:data",
  "lsp-message": "lsp:message",
  "dap-message": "dap:message",
  "dap-output": "dap:output",
};

export async function invoke<T = unknown>(command: string, args?: unknown): Promise<T> {
  if (!window.electronAPI) throw new Error("Electron IPC bridge is not available");
  return window.electronAPI.invoke<T>(command, args);
}

export async function listen<T = unknown>(
  event: string,
  handler: (event: IpcEvent<T>) => void,
): Promise<() => void> {
  if (!window.electronAPI) return () => undefined;
  const channel = eventMap[event] ?? event;
  return window.electronAPI.on<T>(channel, (payload) => handler({ event, payload }));
}
