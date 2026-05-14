import { ipcMain } from "electron";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

type FileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: FileEntry[];
};

type SearchResult = {
  path: string;
  line: number;
  content: string;
};

type ReplaceSummary = {
  files_changed: number;
  replacements: number;
};

const SKIP_NAMES = new Set([".git", "node_modules", "target", "__pycache__", ".next", "dist", "dist-ssr"]);
const SKIP_EXTENSIONS = new Set([
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
  ".pdf",
]);

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function shouldSkipName(name: string): boolean {
  return SKIP_NAMES.has(name);
}

function shouldSkipPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized.split("/").some((part) => SKIP_NAMES.has(part))) return true;
  const lower = normalized.toLowerCase();
  return [...SKIP_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

async function readTree(root: string): Promise<FileEntry[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs: FileEntry[] = [];
  const files: FileEntry[] = [];

  for (const entry of entries) {
    if (shouldSkipName(entry.name)) continue;
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      dirs.push({
        name: entry.name,
        path: entryPath,
        kind: "directory",
        children: await readTree(entryPath).catch(() => []),
      });
    } else {
      files.push({ name: entry.name, path: entryPath, kind: "file" });
    }
  }

  const byName = (a: FileEntry, b: FileEntry) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files];
}

async function listFiles(root: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipName(entry.name)) continue;
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await listFiles(entryPath, out).catch(() => undefined);
    } else if (!shouldSkipPath(entryPath)) {
      out.push(entryPath);
    }
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeRegex(query: string, caseSensitive = false, wholeWord = false, useRegex = false): RegExp {
  if (!query) throw new Error("Search pattern cannot be empty");
  const source = useRegex ? query : escapeRegExp(query);
  const bounded = wholeWord ? `\\b(?:${source})\\b` : source;
  return new RegExp(bounded, caseSensitive ? "g" : "gi");
}

function regexHasMatch(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  return regex.test(value);
}

async function searchFile(path: string, regex: RegExp, results: SearchResult[]): Promise<boolean> {
  const input = createReadStream(path, { encoding: "utf8" });
  input.on("error", () => undefined);
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

export function registerFsHandlers(): void {
  ipcMain.handle("get_dir_tree", async (_event, args: { path: string }) => readTree(args.path));

  ipcMain.handle("read_file", async (_event, args: { path: string }) => readFile(args.path, "utf8"));

  ipcMain.handle("save_file", async (_event, args: { path: string; content: string }) => {
    await mkdir(dirname(args.path), { recursive: true });
    await writeFile(args.path, args.content, "utf8");
  });

  ipcMain.handle("create_file", async (_event, args: { path: string }) => {
    await mkdir(dirname(args.path), { recursive: true });
    await writeFile(args.path, "", "utf8");
  });

  ipcMain.handle("create_directory", async (_event, args: { path: string }) => {
    await mkdir(args.path, { recursive: true });
  });

  ipcMain.handle("delete_file", async (_event, args: { path: string }) => {
    const info = await stat(args.path);
    await rm(args.path, { recursive: info.isDirectory(), force: false });
  });

  ipcMain.handle("rename_file", async (_event, args: { path?: string; oldPath?: string; old_path?: string; newPath?: string; new_path?: string }) => {
    const oldPath = args.oldPath ?? args.old_path ?? args.path;
    const newPath = args.newPath ?? args.new_path;
    if (!oldPath || !newPath) throw new Error("Both old and new paths are required");
    await mkdir(dirname(newPath), { recursive: true });
    await rename(oldPath, newPath);
  });

  ipcMain.handle("search_in_files", async (_event, args: {
    path?: string;
    root?: string;
    pattern?: string;
    query?: string;
    case_sensitive?: boolean;
    whole_word?: boolean;
    use_regex?: boolean;
  }): Promise<SearchResult[]> => {
    const root = args.root ?? args.path ?? ".";
    const query = args.query ?? args.pattern ?? "";
    const regex = makeRegex(query, args.case_sensitive, args.whole_word, args.use_regex);
    const results: SearchResult[] = [];

    for (const file of await listFiles(root)) {
      const keepGoing = await searchFile(file, regex, results);
      if (!keepGoing) break;
    }

    return results;
  });

  ipcMain.handle("replace_in_files", async (_event, args: {
    path?: string;
    root?: string;
    pattern?: string;
    query?: string;
    replacement: string;
    case_sensitive?: boolean;
    whole_word?: boolean;
    use_regex?: boolean;
  }): Promise<ReplaceSummary> => {
    const root = args.root ?? args.path ?? ".";
    const query = args.query ?? args.pattern ?? "";
    const regex = makeRegex(query, args.case_sensitive, args.whole_word, args.use_regex);
    let files_changed = 0;
    let replacements = 0;

    for (const file of await listFiles(root)) {
      let content: string;
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
