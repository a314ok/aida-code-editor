import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export class LspClient {
  private id = 0;
  private callbacks = new Map<number, (res: any) => void>();

  constructor() {
    listen<string>('lsp-message', (event) => {
      try {
        const data = JSON.parse(event.payload);
        if (data.id !== undefined && this.callbacks.has(data.id)) {
          this.callbacks.get(data.id)!(data.result);
          this.callbacks.delete(data.id);
        }
      } catch (e) {
        console.error('LSP Parse Error:', e);
      }
    });
  }

  async start(cmd: string, args: string[] = []) {
    await invoke('start_lsp', { cmd, args });
    
    // Initialize LSP
    return this.request('initialize', {
      processId: null,
      capabilities: {},
      rootUri: null,
    });
  }

  async request(method: string, params: any): Promise<any> {
    const id = this.id++;
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise((resolve) => {
      this.callbacks.set(id, resolve);
      invoke('send_lsp_message', { message });
    });
  }

  notify(method: string, params: any) {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });
    invoke('send_lsp_message', { message });
  }
}

export const lspClient = new LspClient();
