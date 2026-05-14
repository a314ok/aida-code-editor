import { invoke, listen } from './ipc';

export type DapCommandCandidate = { cmd: string; args: string[] };
export type ResolvedDapCommand = { cmd: string; args: string[]; source: string };
export type DapAdapterProbe = {
  id: string;
  label: string;
  languages: string[];
  candidates: DapCommandCandidate[];
};
export type DapAdapterStatus = {
  id: string;
  label: string;
  languages: string[];
  available: boolean;
  command?: string | null;
  source?: string | null;
};
export type DapMessage = Record<string, any> & {
  seq?: number;
  type?: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  body?: any;
  request_seq?: number;
  success?: boolean;
  message?: string;
};

const adapter = (
  id: string,
  label: string,
  languages: string[],
  candidates: DapCommandCandidate[],
): DapAdapterProbe => ({ id, label, languages, candidates });

const DAP_ADAPTERS = [
  adapter('aida-node', 'Aida Node / JavaScript (built-in)', ['js', 'mjs', 'cjs', 'ts'], [
    { cmd: 'node', args: ['{AIDA_APP_ROOT}/scripts/aida-node-dap-adapter.mjs'] },
  ]),
  adapter('python', 'Python / debugpy', ['py'], [
    { cmd: 'debugpy-adapter', args: [] },
    { cmd: 'python', args: ['-m', 'debugpy.adapter'] },
    { cmd: 'py', args: ['-m', 'debugpy.adapter'] },
  ]),
  adapter('go', 'Go / Delve', ['go'], [
    { cmd: 'dlv', args: ['dap'] },
  ]),
  adapter('codelldb', 'CodeLLDB / Native', ['rs', 'c', 'cpp'], [
    { cmd: 'codelldb', args: [] },
  ]),
  adapter('coreclr', '.NET CoreCLR', ['cs', 'fs'], [
    { cmd: 'netcoredbg', args: ['--interpreter=vscode'] },
  ]),
  adapter('js-debug', 'JavaScript / VS Code JS Debug', ['js', 'jsx', 'ts', 'tsx'], [
    { cmd: 'js-debug-adapter', args: [] },
    { cmd: 'vscode-js-debug', args: [] },
  ]),
];

export const getDapAdapterProbes = () => DAP_ADAPTERS;

export const splitCommandLine = (value: string) => {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of value.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) result.push(current);
  return result;
};

export const joinCommandLine = (parts: string[]) => parts.map(part => {
  if (!part) return '""';
  if (!/[\s"]/.test(part)) return part;
  return `"${part.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}).join(' ');

const safeListen = <T>(event: string, handler: (event: { payload: T }) => void) => {
  try {
    return listen<T>(event, handler as any).catch(() => () => {});
  } catch {
    return Promise.resolve(() => {});
  }
};

type Callback = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: number;
};

export class DapClient {
  private seq = 1;
  private callbacks = new Map<number, Callback>();
  private ready: Promise<unknown>;

  constructor() {
    this.ready = Promise.all([
      safeListen<string>('dap-message', (event) => this.handleMessage(event.payload)),
      safeListen<string>('dap-output', (event) => {
        window.dispatchEvent(new CustomEvent('aida:dap-event', {
          detail: {
            type: 'event',
            event: 'output',
            body: { category: 'stderr', output: event.payload },
          },
        }));
      }),
    ]);
  }

  async start(command: ResolvedDapCommand, cwd?: string | null) {
    await invoke('start_dap', { cmd: command.cmd, args: command.args, cwd: cwd ?? null });
    this.seq = 1;
    this.callbacks.clear();
    return this.request('initialize', {
      clientID: 'aida-code-studio',
      clientName: 'Aida Code Studio',
      adapterID: command.source,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false,
      supportsProgressReporting: true,
      supportsInvalidatedEvent: true,
    }, 8000);
  }

  async stop() {
    try {
      await this.request('disconnect', {
        restart: false,
        terminateDebuggee: true,
        suspendDebuggee: false,
      }, 1200);
    } catch {}
    await invoke('stop_dap').catch(() => null);
    this.callbacks.clear();
  }

  async checkAdapters(rootPath?: string | null): Promise<DapAdapterStatus[]> {
    try {
      return await invoke<DapAdapterStatus[]>('check_dap_adapters', {
        adapters: DAP_ADAPTERS,
        cwd: rootPath ?? null,
      });
    } catch {
      return DAP_ADAPTERS.map(adapter => ({
        id: adapter.id,
        label: adapter.label,
        languages: adapter.languages,
        available: false,
        command: null,
        source: 'IPC command unavailable',
      }));
    }
  }

  async resolveCommand(candidates: DapCommandCandidate[], rootPath?: string | null) {
    return invoke<ResolvedDapCommand | null>('resolve_dap_command', {
      candidates,
      cwd: rootPath ?? null,
    });
  }

  launch(args: any) {
    return this.request('launch', args, 10000);
  }

  attach(args: any) {
    return this.request('attach', args, 10000);
  }

  setBreakpoints(path: string, lines: number[]) {
    return this.request('setBreakpoints', {
      source: { path },
      breakpoints: lines.map(line => ({ line })),
      lines,
      sourceModified: false,
    });
  }

  configurationDone() {
    return this.request('configurationDone', {});
  }

  threads() {
    return this.request('threads', {});
  }

  stackTrace(threadId: number) {
    return this.request('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 40,
    });
  }

  scopes(frameId: number) {
    return this.request('scopes', { frameId });
  }

  variables(variablesReference: number) {
    return this.request('variables', { variablesReference });
  }

  evaluate(expression: string, frameId?: number) {
    return this.request('evaluate', { expression, frameId, context: 'watch' });
  }

  continue(threadId: number) {
    return this.request('continue', { threadId });
  }

  pause(threadId: number) {
    return this.request('pause', { threadId });
  }

  next(threadId: number) {
    return this.request('next', { threadId });
  }

  stepIn(threadId: number) {
    return this.request('stepIn', { threadId });
  }

  stepOut(threadId: number) {
    return this.request('stepOut', { threadId });
  }

  restart() {
    return this.request('restart', {});
  }

  async request(command: string, args: any = {}, timeout = 5000): Promise<any> {
    await this.ready;
    const seq = this.seq++;
    const message = JSON.stringify({
      seq,
      type: 'request',
      command,
      arguments: args,
    });

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.callbacks.delete(seq);
        reject(new Error(`${command} timed out`));
      }, timeout);
      this.callbacks.set(seq, { resolve, reject, timer });
      invoke('send_dap_message', { message }).catch((error) => {
        window.clearTimeout(timer);
        this.callbacks.delete(seq);
        reject(error);
      });
    });
  }

  private handleMessage(payload: string) {
    try {
      const data = JSON.parse(payload) as DapMessage;
      if (data.type === 'response' && data.request_seq !== undefined) {
        const callback = this.callbacks.get(data.request_seq);
        if (callback) {
          window.clearTimeout(callback.timer);
          this.callbacks.delete(data.request_seq);
          if (data.success === false) callback.reject(new Error(data.message ?? data.command ?? 'DAP request failed'));
          else callback.resolve(data.body ?? {});
        }
      }
      window.dispatchEvent(new CustomEvent('aida:dap-event', { detail: data }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('aida:dap-event', {
        detail: {
          type: 'event',
          event: 'output',
          body: { category: 'stderr', output: String(error) },
        },
      }));
    }
  }
}

export const dapClient = new DapClient();
