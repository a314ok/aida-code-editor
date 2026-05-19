import { ipcMain, dialog, BrowserWindow, BrowserView, app, Menu, nativeImage } from "electron";
import { is } from "@electron-toolkit/utils";
import { existsSync, createReadStream } from "node:fs";
import { resolve, delimiter, join, sep, dirname } from "node:path";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, stat, rm, rename, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import simpleGit from "simple-git";
import * as pty from "node-pty";
function sendToRenderer(getWindow, channel, payload) {
  const window = getWindow();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, payload);
}
function appRoot() {
  const packagedRoots = "resourcesPath" in process ? [join(process.resourcesPath, "app.asar.unpacked"), join(process.resourcesPath, "app.asar"), join(process.resourcesPath, "app")] : [];
  for (const root of [process.cwd(), ...packagedRoots]) {
    if (existsSync(join(root, "scripts", "aida-node-dap-adapter.mjs"))) return root;
  }
  let current = process.cwd();
  for (; ; ) {
    if (existsSync(join(current, "scripts", "aida-node-dap-adapter.mjs"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return process.cwd();
    current = parent;
  }
}
function commandVariants(command) {
  if (/[\\/]/.test(command) || /\.[a-z0-9]+$/i.test(command)) return [command];
  if (process.platform === "win32") return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command];
  return [command];
}
function resolveFromNodeBin(base, command) {
  const bin = join(base, "node_modules", ".bin");
  for (const variant of commandVariants(command)) {
    const candidate = join(bin, variant);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
function resolveCommandPath(command, cwd) {
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
function expandCommandArgs(args, cwd) {
  const root = appRoot();
  const expanded = [];
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
function absoluteScriptArgsExist(args) {
  return args.every((arg) => {
    if (!/^[a-zA-Z]:[\\/]|^\//.test(arg)) return true;
    if (!/\.(?:c?m?js)$/i.test(arg)) return true;
    return existsSync(arg);
  });
}
function resolveCommand(candidates, cwd) {
  for (const candidate of candidates) {
    const commandPath = resolveCommandPath(candidate.cmd, cwd);
    if (!commandPath) continue;
    const args = expandCommandArgs(candidate.args, cwd);
    if (!args || !absoluteScriptArgsExist(args)) continue;
    return { cmd: commandPath, args, source: candidate.cmd };
  }
  return null;
}
function normalizeSpawnCommand(command, args) {
  if (/\.(?:c?m?js)$/i.test(command)) {
    return { command: process.execPath, args: [command, ...args] };
  }
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    return { command: process.env.ComSpec ?? "cmd.exe", args: ["/C", command, ...args] };
  }
  return { command, args };
}
function readProtocolMessages(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    for (; ; ) {
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
let child$1 = null;
function frameMessage$1(message) {
  return `Content-Length: ${Buffer.byteLength(message, "utf8")}\r
\r
${message}`;
}
function stopCurrent() {
  if (!child$1) return;
  child$1.kill();
  child$1 = null;
}
function registerDapHandlers(getWindow) {
  ipcMain.handle("start_dap", async (_event, args) => {
    stopCurrent();
    const requestedCommand = args.cmd ?? args.command;
    if (!requestedCommand) throw new Error("DAP command is required");
    const normalized = normalizeSpawnCommand(requestedCommand, args.args ?? []);
    child$1 = spawn(normalized.command, normalized.args, {
      cwd: args.cwd ?? void 0,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    child$1.on("exit", () => {
      child$1 = null;
    });
    readProtocolMessages(child$1.stdout, (message) => sendToRenderer(getWindow, "dap-message", message));
    child$1.stderr.on("data", (chunk) => {
      sendToRenderer(getWindow, "dap-output", chunk.toString("utf8"));
    });
  });
  ipcMain.handle("stop_dap", async () => {
    stopCurrent();
  });
  ipcMain.handle("send_dap_message", async (_event, args) => {
    if (!child$1?.stdin.writable) return;
    child$1.stdin.write(frameMessage$1(args.message));
  });
  ipcMain.handle("resolve_dap_command", async (_event, args) => {
    return resolveCommand(args.candidates ?? candidatesForAdapter(args.adapter_type), args.cwd);
  });
  ipcMain.handle("check_dap_adapters", async (_event, args) => {
    return (args.adapters ?? defaultAdapterProbes()).map((adapter) => {
      const resolved = resolveCommand(adapter.candidates, args.cwd);
      return {
        id: adapter.id,
        label: adapter.label,
        languages: adapter.languages,
        available: Boolean(resolved),
        command: resolved ? [resolved.cmd, ...resolved.args].join(" ") : null,
        source: resolved?.source ?? null
      };
    });
  });
}
function candidatesForAdapter(adapterType) {
  switch (adapterType) {
    case "aida-node":
      return [{ cmd: "node", args: ["{AIDA_APP_ROOT}/scripts/aida-node-dap-adapter.mjs"] }];
    case "python":
      return [{ cmd: "debugpy-adapter", args: [] }, { cmd: "python", args: ["-m", "debugpy.adapter"] }];
    case "go":
      return [{ cmd: "dlv", args: ["dap"] }];
    default:
      return [];
  }
}
function defaultAdapterProbes() {
  return [
    { id: "aida-node", label: "Aida Node / JavaScript", languages: ["js", "mjs", "cjs", "ts"], candidates: candidatesForAdapter("aida-node") },
    { id: "python", label: "Python / debugpy", languages: ["py"], candidates: candidatesForAdapter("python") },
    { id: "go", label: "Go / Delve", languages: ["go"], candidates: candidatesForAdapter("go") }
  ];
}
const SKIP_NAMES = /* @__PURE__ */ new Set([".git", "node_modules", "target", "__pycache__", ".next", "dist", "dist-ssr"]);
const SKIP_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".exe",
  ".dll",
  ".so",
  ".bin",
  ".zip",
  ".tar",
  ".gz",
  ".pdf"
]);
function normalizePath(value) {
  return value.replace(/\\/g, "/");
}
function shouldSkipName(name) {
  return SKIP_NAMES.has(name);
}
function shouldSkipPath(path) {
  const normalized = normalizePath(path);
  if (normalized.split("/").some((part) => SKIP_NAMES.has(part))) return true;
  const lower = normalized.toLowerCase();
  return [...SKIP_EXTENSIONS].some((extension) => lower.endsWith(extension));
}
async function readTree(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    if (shouldSkipName(entry.name)) continue;
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      dirs.push({
        name: entry.name,
        path: entryPath,
        kind: "directory",
        children: await readTree(entryPath).catch(() => [])
      });
    } else {
      files.push({ name: entry.name, path: entryPath, kind: "file" });
    }
  }
  const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files];
}
async function listFiles(root, out = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipName(entry.name)) continue;
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await listFiles(entryPath, out).catch(() => void 0);
    } else if (!shouldSkipPath(entryPath)) {
      out.push(entryPath);
    }
  }
  return out;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function makeRegex(query, caseSensitive = false, wholeWord = false, useRegex = false) {
  if (!query) throw new Error("Search pattern cannot be empty");
  const source = useRegex ? query : escapeRegExp(query);
  const bounded = wholeWord ? `\\b(?:${source})\\b` : source;
  return new RegExp(bounded, caseSensitive ? "g" : "gi");
}
function regexHasMatch(regex, value) {
  regex.lastIndex = 0;
  return regex.test(value);
}
async function searchFile(path, regex, results) {
  const input = createReadStream(path, { encoding: "utf8" });
  input.on("error", () => void 0);
  const reader = createInterface({ input, crlfDelay: Infinity });
  let line = 0;
  try {
    for await (const content of reader) {
      line += 1;
      if (regexHasMatch(regex, content)) {
        results.push({ path, line, content });
        if (results.length >= 500) return false;
      }
    }
  } catch {
    return true;
  }
  return true;
}
function registerFsHandlers() {
  ipcMain.handle("get_dir_tree", async (_event, args) => readTree(args.path));
  ipcMain.handle("read_file", async (_event, args) => readFile(args.path, "utf8"));
  ipcMain.handle("save_file", async (_event, args) => {
    await mkdir(dirname(args.path), { recursive: true });
    await writeFile(args.path, args.content, "utf8");
  });
  ipcMain.handle("create_file", async (_event, args) => {
    await mkdir(dirname(args.path), { recursive: true });
    await writeFile(args.path, "", "utf8");
  });
  ipcMain.handle("create_directory", async (_event, args) => {
    await mkdir(args.path, { recursive: true });
  });
  ipcMain.handle("delete_file", async (_event, args) => {
    const info = await stat(args.path);
    await rm(args.path, { recursive: info.isDirectory(), force: false });
  });
  ipcMain.handle("rename_file", async (_event, args) => {
    const oldPath = args.oldPath ?? args.old_path ?? args.path;
    const newPath = args.newPath ?? args.new_path;
    if (!oldPath || !newPath) throw new Error("Both old and new paths are required");
    await mkdir(dirname(newPath), { recursive: true });
    await rename(oldPath, newPath);
  });
  ipcMain.handle("search_in_files", async (_event, args) => {
    const root = args.root ?? args.path ?? ".";
    const query = args.query ?? args.pattern ?? "";
    const regex = makeRegex(query, args.case_sensitive, args.whole_word, args.use_regex);
    const results = [];
    for (const file of await listFiles(root)) {
      const keepGoing = await searchFile(file, regex, results);
      if (!keepGoing) break;
    }
    return results;
  });
  ipcMain.handle("replace_in_files", async (_event, args) => {
    const root = args.root ?? args.path ?? ".";
    const query = args.query ?? args.pattern ?? "";
    const regex = makeRegex(query, args.case_sensitive, args.whole_word, args.use_regex);
    let files_changed = 0;
    let replacements = 0;
    for (const file of await listFiles(root)) {
      let content;
      try {
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      regex.lastIndex = 0;
      const matches = content.match(regex);
      if (!matches?.length) continue;
      const updated = content.replace(regex, args.replacement);
      await writeFile(file, updated, "utf8");
      files_changed += 1;
      replacements += matches.length;
    }
    return { files_changed, replacements };
  });
}
function git(path) {
  return simpleGit({ baseDir: path, binary: "git" });
}
function normalizeStatus(value) {
  const code = value.trim();
  if (!code) return null;
  if (code === "?") return "U";
  if (code === "U" || code.includes("U")) return "C";
  return code[0] ?? null;
}
function runGit(path: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve2, reject) => {
    const child2 = spawn("git", ["-C", path, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child2.stdout.on("data", (chunk) => stdout.push(chunk));
    child2.stderr.on("data", (chunk) => stderr.push(chunk));
    child2.on("error", reject);
    child2.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve2(out.trim().length ? out : err);
      else reject(new Error(err || `git exited with code ${code ?? "unknown"}`));
    });
    if (input !== void 0) child2.stdin.end(input);
    else child2.stdin.end();
  });
}
async function repoRoot(path) {
  return (await runGit(path, ["rev-parse", "--show-toplevel"])).trim();
}
function isSafeRepoRelativePath(path) {
  return Boolean(path) && !/^[a-zA-Z]:[\\/]|^\//.test(path) && !path.split(/[\\/]+/).some((part) => part === ".." || part === "");
}
async function isUntrackedFile(path, file) {
  const output = await runGit(path, ["ls-files", "--others", "--exclude-standard", "--", file]);
  return output.split(/\r?\n/).some((line) => line === file);
}
async function buildUntrackedFileDiff(path, file) {
  if (!isSafeRepoRelativePath(file)) throw new Error("Unsafe file path");
  const root = await repoRoot(path);
  const content = await readFile(join(root, file), "utf8").catch(() => {
    throw new Error("Cannot preview binary or non-UTF-8 untracked file");
  });
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  const escaped = file.replace(/\\/g, "/");
  return [
    `diff --git a/${escaped} b/${escaped}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${escaped}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    ""
  ].join("\n");
}
function parseNameStatusLine(line) {
  if (!line.trim()) return null;
  const [status, firstPath, secondPath] = line.split("	");
  if (!status || !firstPath) return null;
  if ((status.startsWith("R") || status.startsWith("C")) && secondPath) {
    return { status, path: secondPath, old_path: firstPath };
  }
  return { status, path: firstPath, old_path: null };
}
function resolveConflictMarkers(content, choice) {
  let section = "normal";
  const output = [];
  let ours = [];
  let theirs = [];
  let found = false;
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("<<<<<<< ")) {
      found = true;
      section = "ours";
      ours = [];
      theirs = [];
      continue;
    }
    if (line.startsWith("=======") && section === "ours") {
      section = "theirs";
      continue;
    }
    if (line.startsWith(">>>>>>> ") && section === "theirs") {
      if (choice === "ours") output.push(...ours);
      else if (choice === "theirs") output.push(...theirs);
      else if (choice === "both") output.push(...ours, ...theirs);
      else throw new Error("Unknown conflict resolution choice");
      section = "normal";
      continue;
    }
    if (section === "normal") output.push(line);
    else if (section === "ours") ours.push(line);
    else theirs.push(line);
  }
  if (section !== "normal") throw new Error("Unclosed conflict marker block");
  if (!found) throw new Error("No conflict markers found");
  return output.join("\n");
}
function registerGitHandlers() {
  ipcMain.handle("get_git_status", async (_event, args) => {
    const status = await git(args.path).status();
    return status.files.map((file) => {
      const index_status = normalizeStatus(file.index);
      const worktree_status = normalizeStatus(file.working_dir);
      return {
        path: file.path,
        status: index_status ?? worktree_status ?? "?",
        staged: Boolean(index_status && index_status !== "U"),
        worktree: Boolean(worktree_status),
        index_status: index_status === "U" ? null : index_status,
        worktree_status
      };
    });
  });
  ipcMain.handle("get_git_branch", async (_event, args) => {
    const status = await git(args.path).status();
    return { name: status.current || "HEAD", ahead: status.ahead, behind: status.behind };
  });
  ipcMain.handle("git_stage_all", async (_event, args) => {
    await git(args.path).add(".");
    await runGit(args.path, ["add", "-u"]);
  });
  ipcMain.handle("git_stage_file", async (_event, args) => {
    await git(args.path).add([args.file]);
  });
  ipcMain.handle("git_unstage_all", async (_event, args) => {
    await runGit(args.path, ["reset"]);
  });
  ipcMain.handle("git_unstage_file", async (_event, args) => {
    await runGit(args.path, ["reset", "--", args.file]);
  });
  ipcMain.handle("get_git_diff", async (_event, args) => {
    const diffArgs = ["diff"];
    if (args.staged) diffArgs.push("--cached");
    if (args.file) diffArgs.push("--", args.file);
    const diff = await runGit(args.path, diffArgs);
    if (!args.staged && args.file && !diff.trim() && await isUntrackedFile(args.path, args.file)) {
      return buildUntrackedFileDiff(args.path, args.file);
    }
    return diff;
  });
  ipcMain.handle("git_discard_file", async (_event, args) => {
    await runGit(args.path, ["reset", "--", args.file]);
    try {
      await runGit(args.path, ["checkout", "--", args.file]);
    } catch {
      await runGit(args.path, ["clean", "-f", "--", args.file]);
    }
  });
  ipcMain.handle("git_apply_patch", async (_event, args) => {
    const applyArgs = ["apply", "--whitespace=nowarn"];
    if (args.cached) applyArgs.push("--cached");
    if (args.reverse) applyArgs.push("--reverse");
    applyArgs.push("-");
    return runGit(args.path, applyArgs, args.patch);
  });
  ipcMain.handle("git_list_branches", async (_event, args) => {
    const output = await runGit(args.path, ["branch", "--all", "--format=%(refname:short)%09%(HEAD)"]);
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const [rawName, head] = line.split("	");
      const isRemote = rawName.startsWith("remotes/");
      const name = isRemote ? rawName.replace(/^remotes\//, "") : rawName;
      return { name, is_head: head === "*", is_remote: isRemote };
    }).sort((a, b) => Number(a.is_remote) - Number(b.is_remote) || a.name.localeCompare(b.name));
  });
  ipcMain.handle("git_checkout_branch", async (_event, args) => {
    const checkoutArgs = ["checkout"];
    if (args.create) checkoutArgs.push("-b");
    checkoutArgs.push(args.branch);
    return runGit(args.path, checkoutArgs);
  });
  ipcMain.handle("git_conflict_files", async (_event, args) => {
    const output = await runGit(args.path, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "");
    return output.split(/\r?\n/).filter(Boolean);
  });
  ipcMain.handle("git_list_stashes", async (_event, args) => {
    const output = await runGit(args.path, ["stash", "list", "--format=%gd%x09%s"]).catch(() => "");
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const [id, ...rest] = line.split("	");
      return { id, message: rest.join("	") };
    });
  });
  ipcMain.handle("git_stash_push", async (_event, args) => {
    const message = args.message?.trim() || "WIP from Aida Studio";
    return runGit(args.path, ["stash", "push", "-u", "-m", message]);
  });
  ipcMain.handle("git_stash_apply", async (_event, args) => {
    const stash = args.stash ?? (args.index !== void 0 ? `stash@{${args.index}}` : "stash@{0}");
    return runGit(args.path, ["stash", args.pop ? "pop" : "apply", stash]);
  });
  ipcMain.handle("git_stash_drop", async (_event, args) => {
    const stash = args.stash ?? (args.index !== void 0 ? `stash@{${args.index}}` : "stash@{0}");
    return runGit(args.path, ["stash", "drop", stash]);
  });
  ipcMain.handle("git_commit", async (_event, args) => {
    await git(args.path).commit(args.message);
  });
  ipcMain.handle("git_amend_commit", async (_event, args) => {
    const amendArgs = ["commit", "--amend"];
    if (args.message?.trim()) amendArgs.push("-m", args.message.trim());
    else amendArgs.push("--no-edit");
    await runGit(args.path, amendArgs);
  });
  ipcMain.handle("git_push", async (_event, args) => {
    const gitArgs = ["push"];
    if (args.remote) gitArgs.push(args.remote);
    if (args.branch) gitArgs.push(args.branch);
    return runGit(args.path, gitArgs);
  });
  ipcMain.handle("git_pull", async (_event, args) => {
    const gitArgs = ["pull"];
    if (args.remote) gitArgs.push(args.remote);
    if (args.branch) gitArgs.push(args.branch);
    return runGit(args.path, gitArgs);
  });
  ipcMain.handle("git_log", async (_event, args) => {
    const limit = String(Math.min(Math.max(args.max_count ?? args.limit ?? 80, 1), 300));
    const gitArgs = ["log", `-n${limit}`, "--date=short", "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s"];
    if (args.file) gitArgs.push("--", args.file);
    const output = await runGit(args.path, gitArgs);
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash, short_hash, author, date, ...summary] = line.split("");
      return { hash, short_hash, author, date, summary: summary.join("") };
    });
  });
  ipcMain.handle("git_graph_log", async (_event, args) => {
    const limit = String(Math.min(Math.max(args.limit ?? 120, 1), 500));
    const output = await runGit(args.path, [
      "log",
      "--all",
      "--decorate=short",
      "--date=short",
      "--name-status",
      `-n${limit}`,
      "--pretty=format:%x1e%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ad%x1f%s"
    ]);
    return output.split("").map((record) => record.trim()).filter(Boolean).map((record) => {
      const [header, ...fileLines] = record.split(/\r?\n/);
      const [hash, short_hash, parentText, refsText, author, date, ...summary] = header.split("");
      return {
        hash,
        short_hash,
        parents: parentText ? parentText.split(/\s+/).filter(Boolean) : [],
        refs: refsText ? refsText.split(", ").filter(Boolean) : [],
        author,
        date,
        summary: summary.join(""),
        files: fileLines.map(parseNameStatusLine).filter((item) => Boolean(item))
      };
    });
  });
  ipcMain.handle("git_show", async (_event, args) => {
    const rev = args.rev ?? args.ref ?? "HEAD";
    const gitArgs = ["show", "--stat", "--patch", rev];
    if (args.file) gitArgs.push("--", args.file);
    return runGit(args.path, gitArgs);
  });
  ipcMain.handle("git_diff_refs", async (_event, args) => {
    const from = args.base ?? args.from;
    const to = args.head ?? args.to;
    if (!from || !to) throw new Error("Both refs are required");
    const gitArgs = ["diff", from, to];
    if (args.file) gitArgs.push("--", args.file);
    return runGit(args.path, gitArgs);
  });
  ipcMain.handle("git_blame", async (_event, args) => {
    const output = await runGit(args.path, ["blame", "--line-porcelain", "--", args.file]);
    const result = [];
    let hash = "";
    let line = 0;
    let author = "";
    let summary = "";
    for (const raw of output.split(/\r?\n/)) {
      if (raw.startsWith("	")) {
        result.push({
          line,
          hash,
          short_hash: hash.slice(0, 8),
          author,
          summary,
          content: raw.slice(1)
        });
        author = "";
        summary = "";
      } else if (/^[0-9a-f]{40}\s/.test(raw)) {
        const parts = raw.split(/\s+/);
        hash = parts[0];
        line = Number(parts[2] ?? 0);
      } else if (raw.startsWith("author ")) {
        author = raw.slice("author ".length);
      } else if (raw.startsWith("summary ")) {
        summary = raw.slice("summary ".length);
      }
    }
    return result;
  });
  ipcMain.handle("git_fetch", async (_event, args) => runGit(args.path, ["fetch", "--all", "--prune"]));
  ipcMain.handle("git_publish_branch", async (_event, args) => {
    const branch = args.branch?.trim() || (await runGit(args.path, ["branch", "--show-current"])).trim();
    if (!branch) throw new Error("Cannot publish detached HEAD");
    return runGit(args.path, ["push", "--set-upstream", "origin", branch]);
  });
  ipcMain.handle("git_resolve_conflict", async (_event, args) => {
    if (!isSafeRepoRelativePath(args.file)) throw new Error("Unsafe file path");
    const root = await repoRoot(args.path);
    const filePath = join(root, args.file);
    const choice = args.strategy ?? args.choice ?? "ours";
    const content = await readFile(filePath, "utf8");
    await writeFile(filePath, resolveConflictMarkers(content, choice), "utf8");
    if (args.stage ?? true) await git(args.path).add([args.file]);
  });
}
let child = null;
function killExisting() {
  if (!child) return;
  child.kill();
  child = null;
}
function frameMessage(message) {
  return `Content-Length: ${Buffer.byteLength(message, "utf8")}\r
\r
${message}`;
}
function registerLspHandlers(getWindow) {
  ipcMain.handle("start_lsp", async (_event, args) => {
    killExisting();
    const requestedCommand = args.cmd ?? args.command;
    if (!requestedCommand) throw new Error("LSP command is required");
    const normalized = normalizeSpawnCommand(requestedCommand, args.args ?? []);
    child = spawn(normalized.command, normalized.args, {
      cwd: args.cwd ?? void 0,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    child.on("exit", () => {
      child = null;
    });
    readProtocolMessages(child.stdout, (message) => sendToRenderer(getWindow, "lsp-message", message));
    child.stderr.on("data", () => void 0);
  });
  ipcMain.handle("send_lsp_message", async (_event, args) => {
    if (!child?.stdin.writable) return;
    child.stdin.write(frameMessage(args.message));
  });
  ipcMain.handle("resolve_lsp_command", async (_event, args) => {
    return resolveCommand(args.candidates ?? candidatesForLanguage(args.language_id), args.cwd);
  });
  ipcMain.handle("check_lsp_servers", async (_event, args) => {
    return (args.servers ?? defaultServerProbes()).map((server) => {
      const resolved = resolveCommand(server.candidates, args.cwd);
      return {
        id: server.id,
        label: server.label,
        languages: server.languages,
        available: Boolean(resolved),
        command: resolved ? [resolved.cmd, ...resolved.args].join(" ") : null,
        source: resolved?.source ?? null
      };
    });
  });
}
function candidatesForLanguage(languageId) {
  switch (languageId) {
    case "go":
      return [{ cmd: "gopls", args: [] }];
    case "rust":
      return [{ cmd: "rust-analyzer", args: [] }];
    case "python":
      return [{ cmd: "pyright-langserver", args: ["--stdio"] }];
    case "typescript":
    case "javascript":
      return [{ cmd: "typescript-language-server", args: ["--stdio"] }];
    case "vue":
      return [{ cmd: "vue-language-server", args: ["--stdio"] }];
    default:
      return [];
  }
}
function defaultServerProbes() {
  return [
    { id: "go", label: "Go", languages: ["go"], candidates: candidatesForLanguage("go") },
    { id: "rust", label: "Rust", languages: ["rs"], candidates: candidatesForLanguage("rust") },
    { id: "python", label: "Python", languages: ["py"], candidates: candidatesForLanguage("python") },
    { id: "typescript", label: "TypeScript / JavaScript", languages: ["ts", "tsx", "js", "jsx"], candidates: candidatesForLanguage("typescript") },
    { id: "vue", label: "Vue", languages: ["vue"], candidates: candidatesForLanguage("vue") }
  ];
}
let currentPty = null;
function registerPtyHandlers(getWindow) {
  ipcMain.handle("spawn_pty", async (_event, args) => {
    currentPty?.kill();
    const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.env.SHELL ?? "bash";
    currentPty = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: args?.cols ?? 80,
      rows: args?.rows ?? 24,
      cwd: args?.cwd ?? process.cwd(),
      env: process.env
    });
    currentPty.onData((data) => sendToRenderer(getWindow, "pty-data", data));
    currentPty.onExit(() => {
      currentPty = null;
    });
  });
  ipcMain.handle("write_pty", async (_event, args) => {
    currentPty?.write(args.data);
  });
  ipcMain.handle("resize_pty", async (_event, args) => {
    currentPty?.resize(args.cols, args.rows);
  });
}
function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
function pythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}
function commandTask(id, label, group, command, args, description) {
  return {
    id,
    label,
    group,
    command,
    args,
    command_line: [command, ...args].join(" "),
    description,
    timeout_secs: 120
  };
}
async function discoverNpmTasks(base) {
  const raw = await readFile(join(base, "package.json"), "utf8");
  const parsed = JSON.parse(raw);
  return Object.entries(parsed.scripts ?? {}).filter(([, value]) => typeof value === "string").map(([name]) => commandTask(`npm:${name}`, `npm run ${name}`, "npm", npmCommand(), ["run", name], "package.json script"));
}
async function discoverMakeTasks(base) {
  const makefile = ["Makefile", "makefile"].map((name) => join(base, name)).find((path) => existsSync(path));
  if (!makefile) return [];
  const raw = await readFile(makefile, "utf8");
  const targets = /* @__PURE__ */ new Set();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
    if (match && !match[1].startsWith(".")) targets.add(match[1]);
  }
  return [...targets].slice(0, 40).map((target) => commandTask(`make:${target}`, `make ${target}`, "make", "make", [target], "Makefile target"));
}
function hasPythonProject(base) {
  return ["pyproject.toml", "setup.py", "requirements.txt", "pytest.ini", "tox.ini"].some((name) => existsSync(join(base, name)));
}
async function discoverTasks(base) {
  const tasks = [];
  if (existsSync(join(base, "package.json"))) tasks.push(...await discoverNpmTasks(base));
  if (existsSync(join(base, "Cargo.toml"))) {
    tasks.push(
      commandTask("cargo:check", "cargo check", "cargo", "cargo", ["check"], "Rust type-check and diagnostics"),
      commandTask("cargo:test", "cargo test", "cargo", "cargo", ["test"], "Rust test suite"),
      commandTask("cargo:build", "cargo build", "cargo", "cargo", ["build"], "Rust debug build")
    );
  }
  if (hasPythonProject(base)) {
    tasks.push(
      commandTask("python:pytest", "pytest", "python", pythonCommand(), ["-m", "pytest"], "Run pytest test suite"),
      commandTask("python:unittest", "unittest discover", "python", pythonCommand(), ["-m", "unittest", "discover"], "Run standard library unittest discovery")
    );
  }
  tasks.push(...await discoverMakeTasks(base));
  return tasks;
}
function joinOutput(commandLine, stdout, stderr, timedOut) {
  let output = `$ ${commandLine}
`;
  if (stdout.trim()) output += `${stdout.trimEnd()}
`;
  if (stderr.trim()) output += `${stdout.trim() ? "\n" : ""}${stderr.trimEnd()}
`;
  if (timedOut) output += "\nTask timed out after 120 seconds.\n";
  return output;
}
function resolveProblemFile(base, file) {
  const cleaned = file.trim().replace(/^["']|["']$/g, "");
  return (cleaned.match(/^[a-zA-Z]:[\\/]|^\//) ? cleaned : resolve(base, cleaned)).replace(/\\/g, "/");
}
function severityFromMessage(message) {
  const lower = message.toLowerCase();
  if (lower.includes("warning")) return "warning";
  if (lower.includes("hint") || lower.includes("note")) return "info";
  return "error";
}
function cleanProblemMessage(message) {
  return message.trim().replace(/^-+/, "").trim();
}
function looksLikeProblem(message) {
  const lower = message.toLowerCase();
  return ["error", "warning", "failed", "panic", "exception"].some((word) => lower.includes(word));
}
function parseProblem(line, base) {
  const parenthesized = line.match(/^(.+)\((\d+),(\d+)\):\s*(.+)$/);
  if (parenthesized) {
    return {
      file: resolveProblemFile(base, parenthesized[1]),
      line: Number(parenthesized[2]),
      column: Number(parenthesized[3]),
      severity: severityFromMessage(parenthesized[4]),
      message: cleanProblemMessage(parenthesized[4]),
      raw: line
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
      raw: line
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
      raw: line
    };
  }
  return null;
}
function parseProblems(output, base) {
  const seen = /* @__PURE__ */ new Set();
  const problems = [];
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
function runTask(base, task, getWindow) {
  const started = Date.now();
  return new Promise((resolveResult, reject) => {
    const child2 = spawn(task.command, task.args, {
      cwd: base,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    let timed_out = false;
    const timer = setTimeout(() => {
      timed_out = true;
      child2.kill();
    }, task.timeout_secs * 1e3);
    child2.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      sendToRenderer(getWindow, "task-output", chunk.toString("utf8"));
    });
    child2.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      sendToRenderer(getWindow, "task-output", chunk.toString("utf8"));
    });
    child2.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child2.on("close", (code) => {
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
        problems: parseProblems(output, base)
      });
    });
  });
}
function registerTaskHandlers(getWindow) {
  ipcMain.handle("get_project_tasks", async (_event, args) => {
    return (await discoverTasks(args.path)).map(({ command, args: taskArgs, timeout_secs, ...task }) => {
      return task;
    });
  });
  ipcMain.handle("run_project_task", async (_event, args) => {
    const taskId = args.taskId ?? args.task_id ?? args.task;
    if (!taskId) throw new Error("Task id is required");
    const task = (await discoverTasks(args.path)).find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    return runTask(args.path, task, getWindow);
  });
}
function preloadPath() {
  return join(__dirname, "../preload/preload.mjs");
}
const embeddedBrowserViews = new Map<string, { view: BrowserView; owner: BrowserWindow | null; url: string }>();

function normalizeViewBounds(bounds) {
  return {
    x: Math.max(0, Math.round(bounds?.x ?? 0)),
    y: Math.max(0, Math.round(bounds?.y ?? 0)),
    width: Math.max(1, Math.round(bounds?.width ?? 1)),
    height: Math.max(1, Math.round(bounds?.height ?? 1)),
  };
}

function attachEmbeddedView(owner: BrowserWindow, entry) {
  if (entry.owner === owner) return;
  if (entry.owner && !entry.owner.isDestroyed()) {
    entry.owner.removeBrowserView(entry.view);
  }
  owner.addBrowserView(entry.view);
  entry.owner = owner;
}

function hideEmbeddedView(label: string) {
  const entry = embeddedBrowserViews.get(label);
  if (!entry) return;
  if (entry.owner && !entry.owner.isDestroyed()) {
    entry.owner.removeBrowserView(entry.view);
  }
  entry.owner = null;
}

function destroyEmbeddedViews() {
  for (const [label, entry] of embeddedBrowserViews) {
    hideEmbeddedView(label);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }
  embeddedBrowserViews.clear();
}

function registerWindowHandlers() {
  ipcMain.handle("dialog_open", async (_event, args) => {
    const properties = [];
    properties.push(args?.directory ? "openDirectory" : "openFile");
    if (args?.multiple) properties.push("multiSelections");
    const result = await dialog.showOpenDialog({
      title: args?.title,
      defaultPath: args?.defaultPath,
      filters: args?.filters,
      properties
    });
    if (result.canceled) return null;
    return args?.multiple ? result.filePaths : result.filePaths[0] ?? null;
  });
  ipcMain.handle("open_floating_window", async (_event, args) => {
    const window = new BrowserWindow({
      width: 640,
      height: 420,
      title: args.title,
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: true,
        sandbox: false
      }
    });
    await window.loadURL(args.url);
  });
  ipcMain.handle("open_embedded_browser_view", async (_event, args) => {
    const owner = getMainWindow();
    if (!owner || owner.isDestroyed()) throw new Error("Main window is not available");
    const label = String(args.label ?? "");
    const url = String(args.url ?? "about:blank");
    if (!label) throw new Error("Embedded browser label is required");

    let entry = embeddedBrowserViews.get(label);
    if (!entry || entry.view.webContents.isDestroyed()) {
      entry = {
        view: new BrowserView({
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        }),
        owner: null,
        url: "",
      };
      entry.view.setAutoResize({ width: false, height: false });
      embeddedBrowserViews.set(label, entry);
    }

    attachEmbeddedView(owner, entry);
    entry.view.setBounds(normalizeViewBounds(args.bounds));
    if (entry.url !== url) {
      entry.url = url;
      await entry.view.webContents.loadURL(url);
    }
  });
  ipcMain.handle("set_embedded_browser_view_bounds", async (_event, args) => {
    const label = String(args.label ?? "");
    if (!label) return;
    const entry = embeddedBrowserViews.get(label);
    if (!entry) return;
    const owner = getMainWindow();
    if (args.visible === false || !owner || owner.isDestroyed()) {
      hideEmbeddedView(label);
      return;
    }
    attachEmbeddedView(owner, entry);
    entry.view.setBounds(normalizeViewBounds(args.bounds));
  });
  ipcMain.handle("hide_embedded_browser_view", async (_event, args) => {
    hideEmbeddedView(String(args.label ?? ""));
  });
}
let mainWindow = null;
function getMainWindow() {
  return mainWindow;
}
function createAppIcon() {
  const fileNames = process.platform === "win32" ? ["icon.ico", "icon.png"] : ["icon.png"];
  const roots = [
    process.cwd(),
    app.getAppPath(),
    join(__dirname, "../.."),
    process.resourcesPath
  ];
  for (const root of roots) {
    for (const fileName of fileNames) {
      const iconPath = join(root, "resources", fileName);
      if (!existsSync(iconPath)) continue;
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) return icon;
    }
  }
  return void 0;
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Aida Studio",
    icon: createAppIcon(),
    backgroundColor: "#0b0b0d",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: false
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    destroyEmbeddedViews();
    mainWindow = null;
  });
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
function registerIpc() {
  registerFsHandlers();
  registerGitHandlers();
  registerPtyHandlers(getMainWindow);
  registerLspHandlers(getMainWindow);
  registerDapHandlers(getMainWindow);
  registerTaskHandlers(getMainWindow);
  registerWindowHandlers();
}
app.whenReady().then(() => {
  app.setAppUserModelId("com.aida.studio");
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
