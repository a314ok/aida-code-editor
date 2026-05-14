import { ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import simpleGit, { type SimpleGit } from "simple-git";

type GitFileStatus = {
  path: string;
  status: string;
  staged: boolean;
  worktree: boolean;
  index_status: string | null;
  worktree_status: string | null;
};

type GitBranchInfo = {
  name: string;
  ahead: number;
  behind: number;
};

type GitBranchItem = {
  name: string;
  is_head: boolean;
  is_remote: boolean;
};

type GitStashItem = {
  id: string;
  message: string;
};

type GitLogItem = {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  summary: string;
};

type GitCommitFile = {
  status: string;
  path: string;
  old_path: string | null;
};

type GitGraphCommit = {
  hash: string;
  short_hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  summary: string;
  files: GitCommitFile[];
};

type GitBlameLine = {
  line: number;
  hash: string;
  short_hash: string;
  author: string;
  summary: string;
  content: string;
};

function git(path: string): SimpleGit {
  return simpleGit({ baseDir: path, binary: "git" });
}

function normalizeStatus(value: string): string | null {
  const code = value.trim();
  if (!code) return null;
  if (code === "?") return "U";
  if (code === "U" || code.includes("U")) return "C";
  return code[0] ?? null;
}

function runGit(path: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", path, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve(out.trim().length ? out : err);
      else reject(new Error(err || `git exited with code ${code ?? "unknown"}`));
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function repoRoot(path: string): Promise<string> {
  return (await runGit(path, ["rev-parse", "--show-toplevel"])).trim();
}

function isSafeRepoRelativePath(path: string): boolean {
  return Boolean(path) && !/^[a-zA-Z]:[\\/]|^\//.test(path) && !path.split(/[\\/]+/).some((part) => part === ".." || part === "");
}

async function isUntrackedFile(path: string, file: string): Promise<boolean> {
  const output = await runGit(path, ["ls-files", "--others", "--exclude-standard", "--", file]);
  return output.split(/\r?\n/).some((line) => line === file);
}

async function buildUntrackedFileDiff(path: string, file: string): Promise<string> {
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
    "",
  ].join("\n");
}

function parseNameStatusLine(line: string): GitCommitFile | null {
  if (!line.trim()) return null;
  const [status, firstPath, secondPath] = line.split("\t");
  if (!status || !firstPath) return null;
  if ((status.startsWith("R") || status.startsWith("C")) && secondPath) {
    return { status, path: secondPath, old_path: firstPath };
  }
  return { status, path: firstPath, old_path: null };
}

function resolveConflictMarkers(content: string, choice: string): string {
  let section: "normal" | "ours" | "theirs" = "normal";
  const output: string[] = [];
  let ours: string[] = [];
  let theirs: string[] = [];
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

export function registerGitHandlers(): void {
  ipcMain.handle("get_git_status", async (_event, args: { path: string }): Promise<GitFileStatus[]> => {
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
        worktree_status,
      };
    });
  });

  ipcMain.handle("get_git_branch", async (_event, args: { path: string }): Promise<GitBranchInfo> => {
    const status = await git(args.path).status();
    return { name: status.current || "HEAD", ahead: status.ahead, behind: status.behind };
  });

  ipcMain.handle("git_stage_all", async (_event, args: { path: string }) => {
    await git(args.path).add(".");
    await runGit(args.path, ["add", "-u"]);
  });

  ipcMain.handle("git_stage_file", async (_event, args: { path: string; file: string }) => {
    await git(args.path).add([args.file]);
  });

  ipcMain.handle("git_unstage_all", async (_event, args: { path: string }) => {
    await runGit(args.path, ["reset"]);
  });

  ipcMain.handle("git_unstage_file", async (_event, args: { path: string; file: string }) => {
    await runGit(args.path, ["reset", "--", args.file]);
  });

  ipcMain.handle("get_git_diff", async (_event, args: { path: string; file?: string | null; staged?: boolean }) => {
    const diffArgs = ["diff"];
    if (args.staged) diffArgs.push("--cached");
    if (args.file) diffArgs.push("--", args.file);
    const diff = await runGit(args.path, diffArgs);
    if (!args.staged && args.file && !diff.trim() && await isUntrackedFile(args.path, args.file)) {
      return buildUntrackedFileDiff(args.path, args.file);
    }
    return diff;
  });

  ipcMain.handle("git_discard_file", async (_event, args: { path: string; file: string }) => {
    await runGit(args.path, ["reset", "--", args.file]);
    try {
      await runGit(args.path, ["checkout", "--", args.file]);
    } catch {
      await runGit(args.path, ["clean", "-f", "--", args.file]);
    }
  });

  ipcMain.handle("git_apply_patch", async (_event, args: { path: string; patch: string; cached?: boolean; reverse?: boolean }) => {
    const applyArgs = ["apply", "--whitespace=nowarn"];
    if (args.cached) applyArgs.push("--cached");
    if (args.reverse) applyArgs.push("--reverse");
    applyArgs.push("-");
    return runGit(args.path, applyArgs, args.patch);
  });

  ipcMain.handle("git_list_branches", async (_event, args: { path: string }): Promise<GitBranchItem[]> => {
    const output = await runGit(args.path, ["branch", "--all", "--format=%(refname:short)%09%(HEAD)"]);
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [rawName, head] = line.split("\t");
        const isRemote = rawName.startsWith("remotes/");
        const name = isRemote ? rawName.replace(/^remotes\//, "") : rawName;
        return { name, is_head: head === "*", is_remote: isRemote };
      })
      .sort((a, b) => Number(a.is_remote) - Number(b.is_remote) || a.name.localeCompare(b.name));
  });

  ipcMain.handle("git_checkout_branch", async (_event, args: { path: string; branch: string; create?: boolean }) => {
    const checkoutArgs = ["checkout"];
    if (args.create) checkoutArgs.push("-b");
    checkoutArgs.push(args.branch);
    return runGit(args.path, checkoutArgs);
  });

  ipcMain.handle("git_conflict_files", async (_event, args: { path: string }) => {
    const output = await runGit(args.path, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "");
    return output.split(/\r?\n/).filter(Boolean);
  });

  ipcMain.handle("git_list_stashes", async (_event, args: { path: string }): Promise<GitStashItem[]> => {
    const output = await runGit(args.path, ["stash", "list", "--format=%gd%x09%s"]).catch(() => "");
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [id, ...rest] = line.split("\t");
        return { id, message: rest.join("\t") };
      });
  });

  ipcMain.handle("git_stash_push", async (_event, args: { path: string; message?: string }) => {
    const message = args.message?.trim() || "WIP from Aida Studio";
    return runGit(args.path, ["stash", "push", "-u", "-m", message]);
  });

  ipcMain.handle("git_stash_apply", async (_event, args: { path: string; stash?: string; index?: number | string; pop?: boolean }) => {
    const stash = args.stash ?? (args.index !== undefined ? `stash@{${args.index}}` : "stash@{0}");
    return runGit(args.path, ["stash", args.pop ? "pop" : "apply", stash]);
  });

  ipcMain.handle("git_stash_drop", async (_event, args: { path: string; stash?: string; index?: number | string }) => {
    const stash = args.stash ?? (args.index !== undefined ? `stash@{${args.index}}` : "stash@{0}");
    return runGit(args.path, ["stash", "drop", stash]);
  });

  ipcMain.handle("git_commit", async (_event, args: { path: string; message: string }) => {
    await git(args.path).commit(args.message);
  });

  ipcMain.handle("git_amend_commit", async (_event, args: { path: string; message?: string | null }) => {
    const amendArgs = ["commit", "--amend"];
    if (args.message?.trim()) amendArgs.push("-m", args.message.trim());
    else amendArgs.push("--no-edit");
    await runGit(args.path, amendArgs);
  });

  ipcMain.handle("git_push", async (_event, args: { path: string; remote?: string; branch?: string }) => {
    const gitArgs = ["push"];
    if (args.remote) gitArgs.push(args.remote);
    if (args.branch) gitArgs.push(args.branch);
    return runGit(args.path, gitArgs);
  });

  ipcMain.handle("git_pull", async (_event, args: { path: string; remote?: string; branch?: string }) => {
    const gitArgs = ["pull"];
    if (args.remote) gitArgs.push(args.remote);
    if (args.branch) gitArgs.push(args.branch);
    return runGit(args.path, gitArgs);
  });

  ipcMain.handle("git_log", async (_event, args: { path: string; file?: string | null; limit?: number; max_count?: number }): Promise<GitLogItem[]> => {
    const limit = String(Math.min(Math.max(args.max_count ?? args.limit ?? 80, 1), 300));
    const gitArgs = ["log", `-n${limit}`, "--date=short", "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s"];
    if (args.file) gitArgs.push("--", args.file);
    const output = await runGit(args.path, gitArgs);
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash, short_hash, author, date, ...summary] = line.split("\x1f");
      return { hash, short_hash, author, date, summary: summary.join("\x1f") };
    });
  });

  ipcMain.handle("git_graph_log", async (_event, args: { path: string; limit?: number }): Promise<GitGraphCommit[]> => {
    const limit = String(Math.min(Math.max(args.limit ?? 120, 1), 500));
    const output = await runGit(args.path, [
      "log",
      "--all",
      "--decorate=short",
      "--date=short",
      "--name-status",
      `-n${limit}`,
      "--pretty=format:%x1e%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ad%x1f%s",
    ]);

    return output.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
      const [header, ...fileLines] = record.split(/\r?\n/);
      const [hash, short_hash, parentText, refsText, author, date, ...summary] = header.split("\x1f");
      return {
        hash,
        short_hash,
        parents: parentText ? parentText.split(/\s+/).filter(Boolean) : [],
        refs: refsText ? refsText.split(", ").filter(Boolean) : [],
        author,
        date,
        summary: summary.join("\x1f"),
        files: fileLines.map(parseNameStatusLine).filter((item): item is GitCommitFile => Boolean(item)),
      };
    });
  });

  ipcMain.handle("git_show", async (_event, args: { path: string; rev?: string; ref?: string; file?: string | null }) => {
    const rev = args.rev ?? args.ref ?? "HEAD";
    const gitArgs = ["show", "--stat", "--patch", rev];
    if (args.file) gitArgs.push("--", args.file);
    return runGit(args.path, gitArgs);
  });

  ipcMain.handle("git_diff_refs", async (_event, args: { path: string; base?: string; head?: string; from?: string; to?: string; file?: string | null }) => {
    const from = args.base ?? args.from;
    const to = args.head ?? args.to;
    if (!from || !to) throw new Error("Both refs are required");
    const gitArgs = ["diff", from, to];
    if (args.file) gitArgs.push("--", args.file);
    return runGit(args.path, gitArgs);
  });

  ipcMain.handle("git_blame", async (_event, args: { path: string; file: string }): Promise<GitBlameLine[]> => {
    const output = await runGit(args.path, ["blame", "--line-porcelain", "--", args.file]);
    const result: GitBlameLine[] = [];
    let hash = "";
    let line = 0;
    let author = "";
    let summary = "";

    for (const raw of output.split(/\r?\n/)) {
      if (raw.startsWith("\t")) {
        result.push({
          line,
          hash,
          short_hash: hash.slice(0, 8),
          author,
          summary,
          content: raw.slice(1),
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

  ipcMain.handle("git_fetch", async (_event, args: { path: string }) => runGit(args.path, ["fetch", "--all", "--prune"]));

  ipcMain.handle("git_publish_branch", async (_event, args: { path: string; branch?: string }) => {
    const branch = args.branch?.trim() || (await runGit(args.path, ["branch", "--show-current"])).trim();
    if (!branch) throw new Error("Cannot publish detached HEAD");
    return runGit(args.path, ["push", "--set-upstream", "origin", branch]);
  });

  ipcMain.handle("git_resolve_conflict", async (_event, args: { path: string; file: string; strategy?: string; choice?: string; stage?: boolean }) => {
    if (!isSafeRepoRelativePath(args.file)) throw new Error("Unsafe file path");
    const root = await repoRoot(args.path);
    const filePath = join(root, args.file);
    const choice = args.strategy ?? args.choice ?? "ours";
    const content = await readFile(filePath, "utf8");
    await writeFile(filePath, resolveConflictMarkers(content, choice), "utf8");
    if (args.stage ?? true) await git(args.path).add([args.file]);
  });
}
