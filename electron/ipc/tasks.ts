import { ipcMain } from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { sendToRenderer, type WindowProvider } from "./events";

type ProjectTask = {
  id: string;
  label: string;
  group: string;
  command_line: string;
  description: string;
};

type ResolvedTask = ProjectTask & {
  command: string;
  args: string[];
  timeout_secs: number;
};

type TaskProblem = {
  file: string | null;
  line: number | null;
  column: number | null;
  severity: string;
  message: string;
  raw: string;
};

type TaskRunResult = {
  success: boolean;
  code: number | null;
  timed_out: boolean;
  duration_ms: number;
  output: string;
  problems: TaskProblem[];
};

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function pythonCommand(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function commandTask(id: string, label: string, group: string, command: string, args: string[], description: string): ResolvedTask {
  return {
    id,
    label,
    group,
    command,
    args,
    command_line: [command, ...args].join(" "),
    description,
    timeout_secs: 120,
  };
}

async function discoverNpmTasks(base: string): Promise<ResolvedTask[]> {
  const raw = await readFile(join(base, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  return Object.entries(parsed.scripts ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([name]) => commandTask(`npm:${name}`, `npm run ${name}`, "npm", npmCommand(), ["run", name], "package.json script"));
}

async function discoverMakeTasks(base: string): Promise<ResolvedTask[]> {
  const makefile = ["Makefile", "makefile"].map((name) => join(base, name)).find((path) => existsSync(path));
  if (!makefile) return [];
  const raw = await readFile(makefile, "utf8");
  const targets = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
    if (match && !match[1].startsWith(".")) targets.add(match[1]);
  }
  return [...targets].slice(0, 40).map((target) => commandTask(`make:${target}`, `make ${target}`, "make", "make", [target], "Makefile target"));
}

function hasPythonProject(base: string): boolean {
  return ["pyproject.toml", "setup.py", "requirements.txt", "pytest.ini", "tox.ini"].some((name) => existsSync(join(base, name)));
}

async function discoverTasks(base: string): Promise<ResolvedTask[]> {
  const tasks: ResolvedTask[] = [];

  if (existsSync(join(base, "package.json"))) tasks.push(...await discoverNpmTasks(base));
  if (existsSync(join(base, "Cargo.toml"))) {
    tasks.push(
      commandTask("cargo:check", "cargo check", "cargo", "cargo", ["check"], "Rust type-check and diagnostics"),
      commandTask("cargo:test", "cargo test", "cargo", "cargo", ["test"], "Rust test suite"),
      commandTask("cargo:build", "cargo build", "cargo", "cargo", ["build"], "Rust debug build"),
    );
  }
  if (hasPythonProject(base)) {
    tasks.push(
      commandTask("python:pytest", "pytest", "python", pythonCommand(), ["-m", "pytest"], "Run pytest test suite"),
      commandTask("python:unittest", "unittest discover", "python", pythonCommand(), ["-m", "unittest", "discover"], "Run standard library unittest discovery"),
    );
  }
  tasks.push(...await discoverMakeTasks(base));

  return tasks;
}

function joinOutput(commandLine: string, stdout: string, stderr: string, timedOut: boolean): string {
  let output = `$ ${commandLine}\n`;
  if (stdout.trim()) output += `${stdout.trimEnd()}\n`;
  if (stderr.trim()) output += `${stdout.trim() ? "\n" : ""}${stderr.trimEnd()}\n`;
  if (timedOut) output += "\nTask timed out after 120 seconds.\n";
  return output;
}

function resolveProblemFile(base: string, file: string): string {
  const cleaned = file.trim().replace(/^["']|["']$/g, "");
  return (cleaned.match(/^[a-zA-Z]:[\\/]|^\//) ? cleaned : resolve(base, cleaned)).replace(/\\/g, "/");
}

function severityFromMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("warning")) return "warning";
  if (lower.includes("hint") || lower.includes("note")) return "info";
  return "error";
}

function cleanProblemMessage(message: string): string {
  return message.trim().replace(/^-+/, "").trim();
}

function looksLikeProblem(message: string): boolean {
  const lower = message.toLowerCase();
  return ["error", "warning", "failed", "panic", "exception"].some((word) => lower.includes(word));
}

function parseProblem(line: string, base: string): TaskProblem | null {
  const parenthesized = line.match(/^(.+)\((\d+),(\d+)\):\s*(.+)$/);
  if (parenthesized) {
    return {
      file: resolveProblemFile(base, parenthesized[1]),
      line: Number(parenthesized[2]),
      column: Number(parenthesized[3]),
      severity: severityFromMessage(parenthesized[4]),
      message: cleanProblemMessage(parenthesized[4]),
      raw: line,
    };
  }

  const colon = line.match(/^(.+?):(\d+)(?::(\d+))?:\s*(.+)$/);
  if (colon && looksLikeProblem(colon[4]) && !/^https?:\/\//.test(colon[1])) {
    return {
      file: resolveProblemFile(base, colon[1]),
      line: Number(colon[2]),
      column: colon[3] ? Number(colon[3]) : null,
      severity: severityFromMessage(colon[4]),
      message: cleanProblemMessage(colon[4]),
      raw: line,
    };
  }

  const python = line.trim().match(/^File "(.+)", line (\d+)/);
  if (python) {
    return {
      file: resolveProblemFile(base, python[1]),
      line: Number(python[2]),
      column: null,
      severity: "error",
      message: "Python traceback frame",
      raw: line,
    };
  }

  return null;
}

function parseProblems(output: string, base: string): TaskProblem[] {
  const seen = new Set<string>();
  const problems: TaskProblem[] = [];
  for (const line of output.split(/\r?\n/)) {
    const problem = parseProblem(line, base);
    if (!problem) continue;
    const key = `${problem.file}:${problem.line}:${problem.column}:${problem.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(problem);
  }
  return problems;
}

function runTask(base: string, task: ResolvedTask, getWindow: WindowProvider): Promise<TaskRunResult> {
  const started = Date.now();
  return new Promise((resolveResult, reject) => {
    const child = spawn(task.command, task.args, {
      cwd: base,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timed_out = false;

    const timer = setTimeout(() => {
      timed_out = true;
      child.kill();
    }, task.timeout_secs * 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      sendToRenderer(getWindow, "task:output", chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      sendToRenderer(getWindow, "task:output", chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const output = joinOutput(task.command_line, stdoutText, stderrText, timed_out);
      resolveResult({
        success: code === 0 && !timed_out,
        code,
        timed_out,
        duration_ms: Date.now() - started,
        output,
        problems: parseProblems(output, base),
      });
    });
  });
}

export function registerTaskHandlers(getWindow: WindowProvider): void {
  ipcMain.handle("get_project_tasks", async (_event, args: { path: string }): Promise<ProjectTask[]> => {
    return (await discoverTasks(args.path)).map(({ command, args: taskArgs, timeout_secs, ...task }) => {
      void command;
      void taskArgs;
      void timeout_secs;
      return task;
    });
  });

  ipcMain.handle("run_project_task", async (_event, args: { path: string; task?: string; taskId?: string; task_id?: string }): Promise<TaskRunResult> => {
    const taskId = args.taskId ?? args.task_id ?? args.task;
    if (!taskId) throw new Error("Task id is required");
    const task = (await discoverTasks(args.path)).find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    return runTask(args.path, task, getWindow);
  });
}
