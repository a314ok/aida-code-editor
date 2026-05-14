import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export type CommandCandidate = {
  cmd: string;
  args: string[];
};

export type ResolvedCommand = {
  cmd: string;
  args: string[];
  source: string;
};

export function appRoot(): string {
  const packagedRoots = "resourcesPath" in process
    ? [join(process.resourcesPath, "app.asar.unpacked"), join(process.resourcesPath, "app.asar"), join(process.resourcesPath, "app")]
    : [];
  for (const root of [process.cwd(), ...packagedRoots]) {
    if (existsSync(join(root, "scripts", "aida-node-dap-adapter.mjs"))) return root;
  }

  let current = process.cwd();
  for (;;) {
    if (existsSync(join(current, "scripts", "aida-node-dap-adapter.mjs"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return process.cwd();
    current = parent;
  }
}

export function commandVariants(command: string): string[] {
  if (/[\\/]/.test(command) || /\.[a-z0-9]+$/i.test(command)) return [command];
  if (process.platform === "win32") return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command];
  return [command];
}

export function resolveFromNodeBin(base: string, command: string): string | null {
  const bin = join(base, "node_modules", ".bin");
  for (const variant of commandVariants(command)) {
    const candidate = join(bin, variant);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveCommandPath(command: string, cwd?: string | null): string | null {
  if (!command.trim()) return null;

  if (existsSync(command)) return resolve(command);

  if (cwd) {
    const fromCwd = resolveFromNodeBin(cwd, command);
    if (fromCwd) return fromCwd;
  }

  const fromApp = resolveFromNodeBin(appRoot(), command);
  if (fromApp) return fromApp;

  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const variant of commandVariants(command)) {
      const candidate = join(dir, variant);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

export function expandCommandArgs(args: string[], cwd?: string | null): string[] | null {
  const root = appRoot();
  const expanded: string[] = [];
  for (const arg of args) {
    let next = arg.replaceAll("{AIDA_APP_ROOT}", root.split(sep).join("/"));
    if (next.includes("{WORKSPACE}")) {
      if (!cwd) return null;
      next = next.replaceAll("{WORKSPACE}", cwd);
    }
    expanded.push(next);
  }
  return expanded;
}

export function absoluteScriptArgsExist(args: string[]): boolean {
  return args.every((arg) => {
    if (!/^[a-zA-Z]:[\\/]|^\//.test(arg)) return true;
    if (!/\.(?:c?m?js)$/i.test(arg)) return true;
    return existsSync(arg);
  });
}

export function resolveCommand(candidates: CommandCandidate[], cwd?: string | null): ResolvedCommand | null {
  for (const candidate of candidates) {
    const commandPath = resolveCommandPath(candidate.cmd, cwd);
    if (!commandPath) continue;
    const args = expandCommandArgs(candidate.args, cwd);
    if (!args || !absoluteScriptArgsExist(args)) continue;
    return { cmd: commandPath, args, source: candidate.cmd };
  }
  return null;
}

export function normalizeSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (/\.(?:c?m?js)$/i.test(command)) {
    return { command: process.execPath, args: [command, ...args] };
  }

  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    return { command: process.env.ComSpec ?? "cmd.exe", args: ["/C", command, ...args] };
  }

  return { command, args };
}

export function readProtocolMessages(stream: Readable, onMessage: (message: string) => void): void {
  let buffer = Buffer.alloc(0);

  stream.on("data", (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      const altHeaderEnd = headerEnd === -1 ? buffer.indexOf("\n\n") : -1;
      const separatorIndex = headerEnd !== -1 ? headerEnd : altHeaderEnd;
      if (separatorIndex === -1) return;

      const separatorLength = headerEnd !== -1 ? 4 : 2;
      const header = buffer.slice(0, separatorIndex).toString("utf8");
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(separatorIndex + separatorLength);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = separatorIndex + separatorLength;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;

      onMessage(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
      buffer = buffer.slice(bodyEnd);
    }
  });
}

export async function commandExists(command: string, cwd?: string | null): Promise<boolean> {
  const resolved = resolveCommandPath(command, cwd);
  if (!resolved) return false;
  try {
    await access(resolved);
    return true;
  } catch {
    return false;
  }
}
