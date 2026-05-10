import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type ServerConfig = {
  id: string;
  label: string;
  languages: string[];
  candidates: LspCommandCandidate[];
  languageId: string;
};

export type LspCommandCandidate = { cmd: string; args: string[] };
export type ResolvedLspCommand = { cmd: string; args: string[]; source: string };
export type LspServerProbe = {
  id: string;
  label: string;
  languages: string[];
  candidates: LspCommandCandidate[];
};
export type LspServerStatus = {
  id: string;
  label: string;
  languages: string[];
  available: boolean;
  command?: string | null;
  source?: string | null;
};
export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspTextEdit = { range: LspRange; newText: string };
export type LspLocation = { uri: string; range: LspRange };
export type LspLocationLink = {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
};
export type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<{
    textDocument?: { uri: string; version?: number | null };
    edits?: LspTextEdit[];
  }>;
};
export type LspCodeAction = {
  title: string;
  kind?: string;
  edit?: LspWorkspaceEdit;
  command?: {
    title?: string;
    command: string;
    arguments?: any[];
  };
};

const pathToUri = (path: string) => encodeURI(`file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`);
const uriToPath = (uri: string) => decodeURI(uri)
  .replace(/^file:\/\/\//, '')
  .replace(/^file:\/\//, '')
  .replace(/\\/g, '/');

const severityLabel = (severity?: number) => {
  switch (severity) {
    case 1: return 'error';
    case 2: return 'warning';
    case 3: return 'info';
    case 4: return 'hint';
    default: return 'info';
  }
};

const safeListen = <T>(event: string, handler: (event: { payload: T }) => void) => {
  try {
    return listen<T>(event, handler as any).catch(() => () => {});
  } catch {
    return Promise.resolve(() => {});
  }
};

const server = (
  id: string,
  label: string,
  languages: string[],
  candidates: LspCommandCandidate[],
  languageId: string,
): ServerConfig => ({ id, label, languages, candidates, languageId });

const LSP_SERVERS = {
  go: server('go', 'Go', ['go'], [{ cmd: 'gopls', args: [] }], 'go'),
  rust: server('rust', 'Rust', ['rs'], [{ cmd: 'rust-analyzer', args: [] }], 'rust'),
  python: server('python', 'Python', ['py'], [
    { cmd: 'pyright-langserver', args: ['--stdio'] },
    { cmd: 'basedpyright-langserver', args: ['--stdio'] },
  ], 'python'),
  typescript: server('typescript', 'TypeScript / JavaScript', ['ts', 'tsx', 'js', 'jsx'], [
    { cmd: 'typescript-language-server', args: ['--stdio'] },
  ], 'typescript'),
  vue: server('vue', 'Vue', ['vue'], [
    { cmd: 'vue-language-server', args: ['--stdio'] },
    { cmd: 'vls', args: ['--stdio'] },
  ], 'vue'),
  html: server('html', 'HTML', ['html', 'htm'], [
    { cmd: 'vscode-html-language-server', args: ['--stdio'] },
    { cmd: 'html-languageserver', args: ['--stdio'] },
  ], 'html'),
  css: server('css', 'CSS / SCSS / Sass', ['css', 'scss', 'sass'], [
    { cmd: 'vscode-css-language-server', args: ['--stdio'] },
    { cmd: 'css-languageserver', args: ['--stdio'] },
  ], 'css'),
  json: server('json', 'JSON', ['json', 'jsonc'], [
    { cmd: 'vscode-json-language-server', args: ['--stdio'] },
    { cmd: 'json-languageserver', args: ['--stdio'] },
  ], 'json'),
  markdown: server('markdown', 'Markdown', ['md', 'mdx'], [
    { cmd: 'marksman', args: ['server'] },
    { cmd: 'vscode-markdown-language-server', args: ['--stdio'] },
  ], 'markdown'),
  xml: server('xml', 'XML / SVG', ['xml', 'svg'], [
    { cmd: 'lemminx', args: [] },
    { cmd: 'node', args: ['{AIDA_APP_ROOT}/scripts/aida-xml-language-server.cjs'] },
    { cmd: 'xml-languageserver', args: ['--stdio'] },
  ], 'xml'),
  yaml: server('yaml', 'YAML', ['yaml', 'yml'], [
    { cmd: 'yaml-language-server', args: ['--stdio'] },
  ], 'yaml'),
  bash: server('bash', 'Shell Script', ['sh', 'bash', 'zsh'], [
    { cmd: 'bash-language-server', args: ['start'] },
  ], 'shellscript'),
  docker: server('docker', 'Dockerfile', ['dockerfile'], [
    { cmd: 'docker-langserver', args: ['--stdio'] },
  ], 'dockerfile'),
  toml: server('toml', 'TOML', ['toml'], [
    { cmd: 'taplo', args: ['lsp', 'stdio'] },
  ], 'toml'),
} satisfies Record<string, ServerConfig>;

const getExt = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

const withLanguageId = (config: ServerConfig, languageId: string): ServerConfig => ({
  ...config,
  languageId,
});

const getServerConfig = (name: string): ServerConfig | null => {
  const ext = getExt(name);
  if (ext === 'go') return LSP_SERVERS.go;
  if (ext === 'rs') return LSP_SERVERS.rust;
  if (ext === 'py') return LSP_SERVERS.python;
  if (ext === 'vue') return LSP_SERVERS.vue;
  if (ext === 'html' || ext === 'htm') return LSP_SERVERS.html;
  if (ext === 'css') return withLanguageId(LSP_SERVERS.css, 'css');
  if (ext === 'scss') return withLanguageId(LSP_SERVERS.css, 'scss');
  if (ext === 'sass') return withLanguageId(LSP_SERVERS.css, 'sass');
  if (ext === 'json') return withLanguageId(LSP_SERVERS.json, 'json');
  if (ext === 'jsonc') return withLanguageId(LSP_SERVERS.json, 'jsonc');
  if (ext === 'md' || ext === 'mdx') return LSP_SERVERS.markdown;
  if (ext === 'xml' || ext === 'svg') return LSP_SERVERS.xml;
  if (ext === 'yaml' || ext === 'yml') return LSP_SERVERS.yaml;
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return LSP_SERVERS.bash;
  if (ext === 'toml') return LSP_SERVERS.toml;
  if (name.toLowerCase().endsWith('dockerfile') || ext === 'dockerfile') return LSP_SERVERS.docker;
  if (/\.[jt]sx?$/.test(name)) {
    const languageId = name.endsWith('.tsx')
      ? 'typescriptreact'
      : name.endsWith('.jsx')
        ? 'javascriptreact'
        : name.endsWith('.ts')
          ? 'typescript'
          : 'javascript';
    return withLanguageId(LSP_SERVERS.typescript, languageId);
  }
  return null;
};

export const getLspServerProbes = (): LspServerProbe[] =>
  Object.values(LSP_SERVERS).map(({ id, label, languages, candidates }) => ({ id, label, languages, candidates }));

export class LspClient {
  private id = 0;
  private callbacks = new Map<number, (res: any) => void>();
  private activeServer = '';
  private opened = new Set<string>();
  private versions = new Map<string, number>();
  private ready: Promise<() => void>;

  constructor() {
    this.ready = safeListen<string>('lsp-message', (event) => {
      try {
        const data = JSON.parse(event.payload);
        if (data.id !== undefined && this.callbacks.has(data.id)) {
          this.callbacks.get(data.id)!(data.error ? null : data.result);
          this.callbacks.delete(data.id);
        } else if (data.method === 'textDocument/publishDiagnostics') {
          const path = uriToPath(data.params.uri);
          const diagnostics = (data.params.diagnostics ?? []).map((d: any) => ({
            path,
            line: (d.range?.start?.line ?? 0) + 1,
            column: d.range?.start?.character ?? 0,
            severity: severityLabel(d.severity),
            message: d.message ?? 'Diagnostic',
            source: d.source,
          }));
          window.dispatchEvent(new CustomEvent('aida:lsp-diagnostics', {
            detail: { path, diagnostics },
          }));
        }
      } catch (e) {
        console.error('LSP Parse Error:', e);
      }
    });
  }

  async start(command: ResolvedLspCommand, rootPath?: string | null) {
    await invoke('start_lsp', { cmd: command.cmd, args: command.args, cwd: rootPath ?? null });

    const result = await this.request('initialize', {
      processId: null,
      capabilities: {
        workspace: {
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
          },
        },
        textDocument: {
          synchronization: {
            didSave: true,
            dynamicRegistration: false,
          },
          hover: {
            contentFormat: ['markdown', 'plaintext'],
          },
          definition: {
            linkSupport: true,
          },
          references: {
            dynamicRegistration: false,
          },
          rename: {
            prepareSupport: false,
          },
          codeAction: {
            dynamicRegistration: false,
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  '',
                  'quickfix',
                  'refactor',
                  'refactor.extract',
                  'refactor.inline',
                  'refactor.rewrite',
                  'source',
                  'source.organizeImports',
                ],
              },
            },
          },
          formatting: {
            dynamicRegistration: false,
          },
          completion: {
            completionItem: {
              snippetSupport: false,
            },
          },
        },
      },
      rootUri: rootPath ? pathToUri(rootPath) : null,
      workspaceFolders: rootPath
        ? [{ uri: pathToUri(rootPath), name: rootPath.split(/[\\/]/).pop() ?? 'workspace' }]
        : null,
    });
    this.notify('initialized', {});
    return result;
  }

  async ensureForFile(path: string, name: string, content: string, rootPath?: string | null) {
    const config = getServerConfig(name);
    if (!config) {
      window.dispatchEvent(new CustomEvent('aida:lsp-active', {
        detail: { path, available: false, label: 'No LSP configured', languageId: 'text' },
      }));
      return false;
    }

    const command = await invoke<ResolvedLspCommand | null>('resolve_lsp_command', {
      candidates: config.candidates,
      cwd: rootPath ?? null,
    });
    if (!command) {
      window.dispatchEvent(new CustomEvent('aida:lsp-active', {
        detail: { path, available: false, label: config.label, languageId: config.languageId },
      }));
      return false;
    }

    const key = `${config.id}:${command.cmd}:${command.args.join(' ')}:${rootPath ?? ''}`;
    if (this.activeServer !== key) {
      await this.start(command, rootPath);
      this.activeServer = key;
      this.opened.clear();
      this.versions.clear();
    }

    const uri = pathToUri(path);
    if (!this.opened.has(uri)) {
      this.versions.set(uri, 1);
      this.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: config.languageId,
          version: 1,
          text: content,
        },
      });
      this.opened.add(uri);
    }

    window.dispatchEvent(new CustomEvent('aida:lsp-active', {
      detail: {
        path,
        available: true,
        label: config.label,
        languageId: config.languageId,
        command: [command.cmd, ...command.args].join(' '),
      },
    }));

    return true;
  }

  async checkServers(rootPath?: string | null) {
    const servers = getLspServerProbes();
    try {
      return await invoke<LspServerStatus[]>('check_lsp_servers', {
        servers,
        cwd: rootPath ?? null,
      });
    } catch {
      return servers.map(server => ({
        id: server.id,
        label: server.label,
        languages: server.languages,
        available: false,
        command: null,
        source: 'Tauri command unavailable',
      }));
    }
  }

  didChange(path: string, content: string) {
    const uri = pathToUri(path);
    if (!this.opened.has(uri)) return;
    const version = (this.versions.get(uri) ?? 1) + 1;
    this.versions.set(uri, version);
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
  }

  didSave(path: string, content: string) {
    const uri = pathToUri(path);
    if (!this.opened.has(uri)) return;
    this.notify('textDocument/didSave', {
      textDocument: { uri },
      text: content,
    });
  }

  async completion(path: string, line: number, character: number) {
    return this.request('textDocument/completion', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
    });
  }

  async hover(path: string, line: number, character: number) {
    return this.request('textDocument/hover', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
    });
  }

  async definition(path: string, line: number, character: number) {
    return this.request('textDocument/definition', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
    });
  }

  async references(path: string, line: number, character: number) {
    return this.request('textDocument/references', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  async rename(path: string, line: number, character: number, newName: string) {
    return this.request('textDocument/rename', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
      newName,
    });
  }

  async codeActions(path: string, range: LspRange, diagnostics: any[] = []) {
    return this.request('textDocument/codeAction', {
      textDocument: { uri: pathToUri(path) },
      range,
      context: { diagnostics },
    });
  }

  async formatDocument(path: string, tabSize = 2) {
    return this.request('textDocument/formatting', {
      textDocument: { uri: pathToUri(path) },
      options: {
        tabSize,
        insertSpaces: true,
        trimTrailingWhitespace: true,
        insertFinalNewline: true,
        trimFinalNewlines: true,
      },
    });
  }

  async executeCommand(command: string, args: any[] = []) {
    return this.request('workspace/executeCommand', {
      command,
      arguments: args,
    });
  }

  async request(method: string, params: any): Promise<any> {
    await this.ready;
    const id = this.id++;
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.callbacks.delete(id);
        resolve(null);
      }, 2000);
      this.callbacks.set(id, (res) => {
        window.clearTimeout(timer);
        resolve(res);
      });
      invoke('send_lsp_message', { message }).catch(() => {
        window.clearTimeout(timer);
        this.callbacks.delete(id);
        resolve(null);
      });
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
export { pathToUri, uriToPath };
