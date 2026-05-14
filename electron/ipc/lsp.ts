import { ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { sendToRenderer, type WindowProvider } from "./events";
import {
  normalizeSpawnCommand,
  readProtocolMessages,
  resolveCommand,
  type CommandCandidate,
  type ResolvedCommand,
} from "./process-utils";

type LspServerProbe = {
  id: string;
  label: string;
  languages: string[];
  candidates: CommandCandidate[];
};

type LspServerStatus = {
  id: string;
  label: string;
  languages: string[];
  available: boolean;
  command: string | null;
  source: string | null;
};

let child: ChildProcessWithoutNullStreams | null = null;

function killExisting(): void {
  if (!child) return;
  child.kill();
  child = null;
}

function frameMessage(message: string): string {
  return `Content-Length: ${Buffer.byteLength(message, "utf8")}\r\n\r\n${message}`;
}

export function registerLspHandlers(getWindow: WindowProvider): void {
  ipcMain.handle("start_lsp", async (_event, args: {
    cmd?: string;
    command?: string;
    args?: string[];
    cwd?: string | null;
    root_uri?: string | null;
  }) => {
    killExisting();

    const requestedCommand = args.cmd ?? args.command;
    if (!requestedCommand) throw new Error("LSP command is required");

    const normalized = normalizeSpawnCommand(requestedCommand, args.args ?? []);
    child = spawn(normalized.command, normalized.args, {
      cwd: args.cwd ?? undefined,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.on("exit", () => {
      child = null;
    });
    readProtocolMessages(child.stdout, (message) => sendToRenderer(getWindow, "lsp:message", message));
    child.stderr.on("data", () => undefined);
  });

  ipcMain.handle("send_lsp_message", async (_event, args: { message: string }) => {
    if (!child?.stdin.writable) return;
    child.stdin.write(frameMessage(args.message));
  });

  ipcMain.handle("resolve_lsp_command", async (_event, args: {
    candidates?: CommandCandidate[];
    cwd?: string | null;
    language_id?: string;
  }): Promise<ResolvedCommand | null> => {
    return resolveCommand(args.candidates ?? candidatesForLanguage(args.language_id), args.cwd);
  });

  ipcMain.handle("check_lsp_servers", async (_event, args: {
    servers?: LspServerProbe[];
    cwd?: string | null;
  }): Promise<LspServerStatus[]> => {
    return (args.servers ?? defaultServerProbes()).map((server) => {
      const resolved = resolveCommand(server.candidates, args.cwd);
      return {
        id: server.id,
        label: server.label,
        languages: server.languages,
        available: Boolean(resolved),
        command: resolved ? [resolved.cmd, ...resolved.args].join(" ") : null,
        source: resolved?.source ?? null,
      };
    });
  });
}

function candidatesForLanguage(languageId?: string): CommandCandidate[] {
  switch (languageId) {
    case "go": return [{ cmd: "gopls", args: [] }];
    case "rust": return [{ cmd: "rust-analyzer", args: [] }];
    case "python": return [{ cmd: "pyright-langserver", args: ["--stdio"] }];
    case "typescript":
    case "javascript": return [{ cmd: "typescript-language-server", args: ["--stdio"] }];
    case "vue": return [{ cmd: "vue-language-server", args: ["--stdio"] }];
    default: return [];
  }
}

function defaultServerProbes(): LspServerProbe[] {
  return [
    { id: "go", label: "Go", languages: ["go"], candidates: candidatesForLanguage("go") },
    { id: "rust", label: "Rust", languages: ["rs"], candidates: candidatesForLanguage("rust") },
    { id: "python", label: "Python", languages: ["py"], candidates: candidatesForLanguage("python") },
    { id: "typescript", label: "TypeScript / JavaScript", languages: ["ts", "tsx", "js", "jsx"], candidates: candidatesForLanguage("typescript") },
    { id: "vue", label: "Vue", languages: ["vue"], candidates: candidatesForLanguage("vue") },
  ];
}
