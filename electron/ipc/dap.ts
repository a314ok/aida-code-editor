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

type DapAdapterProbe = {
  id: string;
  label: string;
  languages: string[];
  candidates: CommandCandidate[];
};

type DapAdapterStatus = {
  id: string;
  label: string;
  languages: string[];
  available: boolean;
  command: string | null;
  source: string | null;
};

let child: ChildProcessWithoutNullStreams | null = null;

function frameMessage(message: string): string {
  return `Content-Length: ${Buffer.byteLength(message, "utf8")}\r\n\r\n${message}`;
}

function stopCurrent(): void {
  if (!child) return;
  child.kill();
  child = null;
}

export function registerDapHandlers(getWindow: WindowProvider): void {
  ipcMain.handle("start_dap", async (_event, args: {
    cmd?: string;
    command?: string;
    args?: string[];
    cwd?: string | null;
  }) => {
    stopCurrent();

    const requestedCommand = args.cmd ?? args.command;
    if (!requestedCommand) throw new Error("DAP command is required");

    const normalized = normalizeSpawnCommand(requestedCommand, args.args ?? []);
    child = spawn(normalized.command, normalized.args, {
      cwd: args.cwd ?? undefined,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.on("exit", () => {
      child = null;
    });
    readProtocolMessages(child.stdout, (message) => sendToRenderer(getWindow, "dap:message", message));
    child.stderr.on("data", (chunk: Buffer) => {
      sendToRenderer(getWindow, "dap:output", chunk.toString("utf8"));
    });
  });

  ipcMain.handle("stop_dap", async () => {
    stopCurrent();
  });

  ipcMain.handle("send_dap_message", async (_event, args: { message: string }) => {
    if (!child?.stdin.writable) return;
    child.stdin.write(frameMessage(args.message));
  });

  ipcMain.handle("resolve_dap_command", async (_event, args: {
    candidates?: CommandCandidate[];
    cwd?: string | null;
    adapter_type?: string;
  }): Promise<ResolvedCommand | null> => {
    return resolveCommand(args.candidates ?? candidatesForAdapter(args.adapter_type), args.cwd);
  });

  ipcMain.handle("check_dap_adapters", async (_event, args: {
    adapters?: DapAdapterProbe[];
    cwd?: string | null;
  }): Promise<DapAdapterStatus[]> => {
    return (args.adapters ?? defaultAdapterProbes()).map((adapter) => {
      const resolved = resolveCommand(adapter.candidates, args.cwd);
      return {
        id: adapter.id,
        label: adapter.label,
        languages: adapter.languages,
        available: Boolean(resolved),
        command: resolved ? [resolved.cmd, ...resolved.args].join(" ") : null,
        source: resolved?.source ?? null,
      };
    });
  });
}

function candidatesForAdapter(adapterType?: string): CommandCandidate[] {
  switch (adapterType) {
    case "aida-node": return [{ cmd: "node", args: ["{AIDA_APP_ROOT}/scripts/aida-node-dap-adapter.mjs"] }];
    case "python": return [{ cmd: "debugpy-adapter", args: [] }, { cmd: "python", args: ["-m", "debugpy.adapter"] }];
    case "go": return [{ cmd: "dlv", args: ["dap"] }];
    default: return [];
  }
}

function defaultAdapterProbes(): DapAdapterProbe[] {
  return [
    { id: "aida-node", label: "Aida Node / JavaScript", languages: ["js", "mjs", "cjs", "ts"], candidates: candidatesForAdapter("aida-node") },
    { id: "python", label: "Python / debugpy", languages: ["py"], candidates: candidatesForAdapter("python") },
    { id: "go", label: "Go / Delve", languages: ["go"], candidates: candidatesForAdapter("go") },
  ];
}
