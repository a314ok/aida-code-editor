<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '../lib/electron/ipc';
import { useEditorStore, type GitFileStatus } from '../stores/editor';
import { Archive, Clock3, Download, Eye, GitBranch, GitCommit, GitCompare, Loader2, Minus, Plus, RefreshCw, RotateCcw, Upload } from 'lucide-vue-next';

const store = useEditorStore();
const commitMessage = ref('');
const loading = ref(false);
const statusMsg = ref('');
const errMsg = ref('');
const selectedFile = ref('');
const diffContent = ref('');
const diffLoading = ref(false);
const diffMode = ref<'unstaged' | 'staged'>('unstaged');
const selectedDiffLines = ref<Set<string>>(new Set());
const branches = ref<Array<{ name: string; is_head: boolean; is_remote: boolean }>>([]);
const stashes = ref<Array<{ id: string; message: string }>>([]);
const conflicts = ref<string[]>([]);
const newBranchName = ref('');
const stashMessage = ref('');
const historyLoading = ref(false);
const historyScope = ref<'repo' | 'file'>('repo');
const historyItems = ref<Array<{ hash: string; short_hash: string; author: string; date: string; summary: string }>>([]);
const historyOutput = ref('');
const historyTitle = ref('History');
const compareBase = ref('HEAD~1');
const compareHead = ref('HEAD');
const blameLoading = ref(false);
const graphLoading = ref(false);
const graphItems = ref<GitGraphCommit[]>([]);
const selectedGraphHash = ref('');
const graphDiffContent = ref('');
const graphDiffLoading = ref(false);

const emit = defineEmits(['refresh']);

type GitListEntry = GitFileStatus & { mode: 'staged' | 'unstaged' | 'untracked'; displayStatus: string };
type GitCommitFile = {
  status: string;
  path: string;
  old_path?: string | null;
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

const statusEntries = computed<GitFileStatus[]>(() => {
  if (store.gitStatusEntries.length) return store.gitStatusEntries;
  return Object.entries(store.gitStatuses).map(([path, status]) => ({
    path,
    status,
    staged: false,
    worktree: true,
    index_status: null,
    worktree_status: status,
  }));
});
const stagedEntries = computed<GitListEntry[]>(() => statusEntries.value
  .filter(entry => Boolean(entry.index_status ?? (entry.staged ? entry.status : null)))
  .map(entry => ({
    ...entry,
    mode: 'staged',
    displayStatus: entry.index_status ?? entry.status,
  })));
const unstagedEntries = computed<GitListEntry[]>(() => statusEntries.value
  .filter(entry => entry.worktree_status && entry.worktree_status !== 'U')
  .map(entry => ({
    ...entry,
    mode: 'unstaged',
    displayStatus: entry.worktree_status ?? entry.status,
  })));
const untrackedEntries = computed<GitListEntry[]>(() => statusEntries.value
  .filter(entry => entry.worktree_status === 'U' || (!entry.staged && entry.status === 'U'))
  .map(entry => ({
    ...entry,
    mode: 'untracked',
    displayStatus: entry.worktree_status ?? entry.status,
  })));
const changeCount = computed(() => statusEntries.value.length);
const selectedFileName = computed(() => selectedFile.value.split(/[/\\]/).pop() || selectedFile.value);
const canUseFileHistory = computed(() => Boolean(selectedFile.value));
const canStageAll = computed(() => unstagedEntries.value.length > 0 || untrackedEntries.value.length > 0);
const canUnstageAll = computed(() => stagedEntries.value.length > 0);
const canCommit = computed(() => Boolean(commitMessage.value.trim()) && stagedEntries.value.length > 0 && !loading.value);
const selectedGraphCommit = computed(() => graphItems.value.find(item => item.hash === selectedGraphHash.value) ?? graphItems.value[0] ?? null);
const changeGroups = computed(() => [
  {
    key: 'staged',
    title: 'Staged changes',
    entries: stagedEntries.value,
    empty: 'No staged files',
    stagedDiff: true,
  },
  {
    key: 'unstaged',
    title: 'Changes',
    entries: unstagedEntries.value,
    empty: 'No tracked changes',
    stagedDiff: false,
  },
  {
    key: 'untracked',
    title: 'Untracked',
    entries: untrackedEntries.value,
    empty: 'No untracked files',
    stagedDiff: false,
  },
]);

const flash = (msg: string, isErr = false) => {
  if (isErr) errMsg.value = msg;
  else statusMsg.value = msg;
  setTimeout(() => { statusMsg.value = ''; errMsg.value = ''; }, 3000);
};

const isBridgeUnavailable = (error: unknown) => String(error).includes('Electron bridge is not available');

const refreshGitTools = async () => {
  if (!store.currentProject) return;
  try {
    const [branchList, stashList, conflictList] = await Promise.all([
      invoke<Array<{ name: string; is_head: boolean; is_remote: boolean }>>('git_list_branches', { path: store.currentProject }),
      invoke<Array<{ id: string; message: string }>>('git_list_stashes', { path: store.currentProject }),
      invoke<string[]>('git_conflict_files', { path: store.currentProject }),
    ]);
    branches.value = branchList;
    stashes.value = stashList;
    conflicts.value = conflictList;
  } catch {}
};

const refreshAll = async () => {
  emit('refresh');
  await refreshGitTools();
  void loadHistory();
  void loadGraph();
};

const stageAll = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_stage_all', { path: store.currentProject });
    flash('Staged all changes');
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const stageFile = async (filePath: string) => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_stage_file', { path: store.currentProject, file: filePath });
    flash(`Staged ${filePath}`);
    await refreshAll();
    if (selectedFile.value === filePath) await loadDiff(filePath, true);
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const unstageAll = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_unstage_all', { path: store.currentProject });
    flash('Unstaged all files');
    await refreshAll();
    if (selectedFile.value) await loadDiff(selectedFile.value, false);
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const unstageFile = async (filePath: string) => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_unstage_file', { path: store.currentProject, file: filePath });
    flash(`Unstaged ${filePath}`);
    await refreshAll();
    if (selectedFile.value === filePath) await loadDiff(filePath, false);
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const discardFile = async (filePath: string) => {
  if (!store.currentProject) return;
  if (!confirm(`Discard all changes in "${filePath}"?`)) return;
  loading.value = true;
  try {
    await invoke('git_discard_file', { path: store.currentProject, file: filePath });
    flash(`Discarded ${filePath}`);
    if (selectedFile.value === filePath) {
      selectedFile.value = '';
      diffContent.value = '';
    }
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const loadDiff = async (filePath: string, staged = false) => {
  if (!store.currentProject) return;
  selectedFile.value = filePath;
  diffMode.value = staged ? 'staged' : 'unstaged';
  selectedDiffLines.value = new Set();
  diffLoading.value = true;
  diffContent.value = '';
  historyOutput.value = '';
  try {
    const diff = await invoke<string>('get_git_diff', {
      path: store.currentProject,
      file: filePath,
      staged,
    });
    diffContent.value = diff || (staged ? 'No staged diff.' : 'No unstaged diff. File may already be staged.');
  } catch (e: any) {
    diffContent.value = String(e);
  } finally {
    diffLoading.value = false;
  }
  if (historyScope.value === 'file') await loadHistory();
};

const loadHistory = async () => {
  if (!store.currentProject) return;
  historyLoading.value = true;
  try {
    const file = historyScope.value === 'file' ? selectedFile.value || null : null;
    historyItems.value = await invoke<Array<{ hash: string; short_hash: string; author: string; date: string; summary: string }>>('git_log', {
      path: store.currentProject,
      file,
      limit: 80,
    });
  } catch (e: any) {
    if (isBridgeUnavailable(e)) return;
    flash(String(e), true);
  } finally {
    historyLoading.value = false;
  }
};

const loadGraph = async () => {
  if (!store.currentProject) return;
  graphLoading.value = true;
  try {
    graphItems.value = await invoke<GitGraphCommit[]>('git_graph_log', {
      path: store.currentProject,
      limit: 120,
    });
    if (!selectedGraphHash.value || !graphItems.value.some(item => item.hash === selectedGraphHash.value)) {
      selectedGraphHash.value = graphItems.value[0]?.hash ?? '';
    }
  } catch (e: any) {
    if (isBridgeUnavailable(e)) return;
    flash(String(e), true);
  } finally {
    graphLoading.value = false;
  }
};

const openGraph = async () => {
  selectedFile.value = '';
  diffContent.value = '';
  historyOutput.value = '';
  graphDiffContent.value = '';
  await loadGraph();
};

const setHistoryScope = async (scope: 'repo' | 'file') => {
  if (scope === 'file' && !selectedFile.value) return;
  historyScope.value = scope;
  await loadHistory();
};

const clearHistoryOutput = () => {
  historyOutput.value = '';
};

const showCommit = async (commit: { hash: string; short_hash: string; summary: string }) => {
  if (!store.currentProject) return;
  historyLoading.value = true;
  historyTitle.value = `${commit.short_hash} ${commit.summary}`;
  const file = historyScope.value === 'file' ? selectedFile.value || null : null;
  selectedFile.value = '';
  diffContent.value = '';
  try {
    historyOutput.value = await invoke<string>('git_show', {
      path: store.currentProject,
      rev: commit.hash,
      file,
    });
  } catch (e: any) {
    historyOutput.value = String(e);
  } finally {
    historyLoading.value = false;
  }
};

const selectGraphCommit = (commit: GitGraphCommit) => {
  selectedGraphHash.value = commit.hash;
  graphDiffContent.value = '';
};

const showGraphCommit = async (commit: GitGraphCommit) => {
  if (!store.currentProject) return;
  selectedGraphHash.value = commit.hash;
  historyLoading.value = true;
  historyTitle.value = `${commit.short_hash} ${commit.summary}`;
  selectedFile.value = '';
  diffContent.value = '';
  graphDiffContent.value = '';
  try {
    historyOutput.value = await invoke<string>('git_show', {
      path: store.currentProject,
      rev: commit.hash,
      file: null,
    });
  } catch (e: any) {
    historyOutput.value = String(e);
  } finally {
    historyLoading.value = false;
  }
};

const showGraphFile = async (file: GitCommitFile) => {
  const commit = selectedGraphCommit.value;
  if (!store.currentProject || !commit) return;
  graphDiffLoading.value = true;
  graphDiffContent.value = '';
  try {
    graphDiffContent.value = await invoke<string>('git_show', {
      path: store.currentProject,
      rev: commit.hash,
      file: file.path,
    });
  } catch (e: any) {
    graphDiffContent.value = String(e);
  } finally {
    graphDiffLoading.value = false;
  }
};

const compareRefs = async () => {
  if (!store.currentProject || !compareBase.value.trim() || !compareHead.value.trim()) return;
  historyLoading.value = true;
  historyTitle.value = `${compareBase.value.trim()}..${compareHead.value.trim()}`;
  const file = historyScope.value === 'file' ? selectedFile.value || null : null;
  selectedFile.value = '';
  diffContent.value = '';
  try {
    historyOutput.value = await invoke<string>('git_diff_refs', {
      path: store.currentProject,
      base: compareBase.value.trim(),
      head: compareHead.value.trim(),
      file,
    });
    if (!historyOutput.value.trim()) historyOutput.value = 'No diff.';
  } catch (e: any) {
    historyOutput.value = String(e);
  } finally {
    historyLoading.value = false;
  }
};

const showBlame = async () => {
  if (!store.currentProject || !selectedFile.value) return;
  blameLoading.value = true;
  historyTitle.value = `Blame: ${selectedFileName.value}`;
  const file = selectedFile.value;
  diffContent.value = '';
  try {
    const lines = await invoke<GitBlameLine[]>('git_blame', {
      path: store.currentProject,
      file,
    });
    historyOutput.value = lines.length
      ? lines.map(item => {
          const line = String(item.line).padStart(4, ' ');
          const author = item.author.padEnd(18, ' ').slice(0, 18);
          return `${line} ${item.short_hash} ${author} | ${item.content}  # ${item.summary}`;
        }).join('\n')
      : 'No blame data.';
  } catch (e: any) {
    historyOutput.value = String(e);
  } finally {
    blameLoading.value = false;
  }
};

type DiffLineKind = 'context' | 'add' | 'remove' | 'meta';
type ParsedDiffLine = {
  key: string;
  text: string;
  kind: DiffLineKind;
  selectable: boolean;
};
type ParsedDiffHunk = {
  index: number;
  title: string;
  rawLines: string[];
  lines: ParsedDiffLine[];
};

const classifyDiffLine = (line: string): DiffLineKind => {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'remove';
  if (line.startsWith(' ')) return 'context';
  return 'meta';
};

const parsedDiff = computed(() => {
  if (!diffContent.value.startsWith('diff --git')) return { header: [] as string[], hunks: [] as ParsedDiffHunk[] };

  const lines = diffContent.value.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const firstHunk = lines.findIndex(line => line.startsWith('@@'));
  if (firstHunk === -1) return { header: lines, hunks: [] as ParsedDiffHunk[] };

  const header = lines.slice(0, firstHunk);
  const hunks: ParsedDiffHunk[] = [];
  let start = firstHunk;

  for (let i = firstHunk + 1; i <= lines.length; i++) {
    if (i === lines.length || lines[i].startsWith('@@')) {
      const rawLines = lines.slice(start, i);
      const title = rawLines[0] ?? `Hunk ${hunks.length + 1}`;
      const index = hunks.length;
      hunks.push({
        index,
        title,
        rawLines,
        lines: rawLines.slice(1).map((text, lineIndex) => {
          const kind = classifyDiffLine(text);
          return {
            key: `${index}:${lineIndex}`,
            text,
            kind,
            selectable: kind === 'add' || kind === 'remove',
          };
        }),
      });
      start = i;
    }
  }

  return { header, hunks };
});

const rangeText = (start: number, count: number) => count === 1 ? String(start) : `${start},${count}`;

const rebuildHunkHeader = (header: string, body: string[]) => {
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  if (!match) return header;

  let oldCount = 0;
  let newCount = 0;
  for (const line of body) {
    if (line.startsWith(' ')) {
      oldCount++;
      newCount++;
    } else if (line.startsWith('-')) {
      oldCount++;
    } else if (line.startsWith('+')) {
      newCount++;
    }
  }

  const oldStart = Number(match[1]);
  const newStart = Number(match[3]);
  const tail = match[5] ?? '';
  return `@@ -${rangeText(oldStart, oldCount)} +${rangeText(newStart, newCount)} @@${tail}`;
};

const buildHunkPatchLines = (hunk: ParsedDiffHunk, selectedKeys?: Set<string>) => {
  if (!selectedKeys) return hunk.rawLines;
  if (!hunk.lines.some(line => line.selectable && selectedKeys.has(line.key))) return null;

  const body: string[] = [];
  for (const line of hunk.lines) {
    if (line.kind === 'context' || line.kind === 'meta') {
      body.push(line.text);
    } else if (line.kind === 'remove') {
      body.push(selectedKeys.has(line.key) ? line.text : ` ${line.text.slice(1)}`);
    } else if (line.kind === 'add' && selectedKeys.has(line.key)) {
      body.push(line.text);
    }
  }

  if (!body.some(line => line.startsWith('+') || line.startsWith('-'))) return null;
  return [rebuildHunkHeader(hunk.title, body), ...body];
};

const buildPatchForHunks = (hunks: ParsedDiffHunk[], selectedKeys?: Set<string>) => {
  const patchHunks = hunks
    .map(hunk => buildHunkPatchLines(hunk, selectedKeys))
    .filter((hunk): hunk is string[] => Boolean(hunk));

  if (!patchHunks.length) return '';
  return `${parsedDiff.value.header.join('\n')}\n${patchHunks.map(hunk => hunk.join('\n')).join('\n')}\n`;
};

const diffHunks = computed(() => parsedDiff.value.hunks.map(hunk => ({
  index: hunk.index,
  title: hunk.title,
  patch: buildPatchForHunks([hunk]),
  preview: hunk.rawLines.slice(0, 8).join('\n'),
})));

const selectedLineCount = computed(() => selectedDiffLines.value.size);
const selectedLinePatch = computed(() => buildPatchForHunks(parsedDiff.value.hunks, selectedDiffLines.value));

const isDiffLineSelected = (key: string) => selectedDiffLines.value.has(key);

const toggleDiffLine = (line: ParsedDiffLine) => {
  if (!line.selectable) return;
  const next = new Set(selectedDiffLines.value);
  if (next.has(line.key)) next.delete(line.key);
  else next.add(line.key);
  selectedDiffLines.value = next;
};

const applyPatchToGit = async (patch: string, cached: boolean, reverse: boolean, message: string) => {
  if (!store.currentProject || !selectedFile.value) return;
  if (!patch) {
    flash('No patch selected', true);
    return;
  }
  loading.value = true;
  try {
    await invoke<string>('git_apply_patch', {
      path: store.currentProject,
      patch,
      cached,
      reverse,
    });
    flash(message);
    await refreshAll();
    await loadDiff(selectedFile.value, diffMode.value === 'staged');
  } catch (e: any) {
    flash(String(e), true);
  } finally {
    loading.value = false;
  }
};

const applyHunk = async (hunk: { patch: string; title: string }) => {
  const unstaging = diffMode.value === 'staged';
  await applyPatchToGit(
    hunk.patch,
    true,
    unstaging,
    `${unstaging ? 'Unstaged' : 'Staged'} hunk ${hunk.title}`,
  );
};

const applySelectedLines = async (action: 'stage' | 'unstage' | 'discard') => {
  if (action === 'discard' && !confirm('Discard selected lines?')) return;
  await applyPatchToGit(
    selectedLinePatch.value,
    action !== 'discard',
    action !== 'stage',
    action === 'stage'
      ? `Staged ${selectedLineCount.value} selected lines`
      : action === 'unstage'
        ? `Unstaged ${selectedLineCount.value} selected lines`
        : `Discarded ${selectedLineCount.value} selected lines`,
  );
};

const commitChanges = async () => {
  if (!canCommit.value || !store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_commit', { path: store.currentProject, message: commitMessage.value.trim() });
    flash('Commit created');
    commitMessage.value = '';
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const push = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_push', { path: store.currentProject });
    flash(r || 'Push complete');
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const pull = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_pull', { path: store.currentProject });
    flash(r || 'Pull complete');
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const fetchAll = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_fetch', { path: store.currentProject });
    flash(r || 'Fetch complete');
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const publishBranch = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_publish_branch', { path: store.currentProject });
    flash(r || `Published ${store.gitBranch}`);
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const resolveConflict = async (filePath: string, choice: 'ours' | 'theirs' | 'both') => {
  if (!store.currentProject) return;
  const label = choice === 'ours' ? 'current changes' : choice === 'theirs' ? 'incoming changes' : 'both sides';
  if (!confirm(`Resolve "${filePath}" using ${label} and stage it?`)) return;
  loading.value = true;
  try {
    await invoke('git_resolve_conflict', {
      path: store.currentProject,
      file: filePath,
      choice,
      stage: true,
    });
    flash(`Resolved ${filePath}`);
    if (selectedFile.value === filePath) {
      selectedFile.value = '';
      diffContent.value = '';
    }
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const checkoutBranch = async (branch: string, create = false) => {
  if (!store.currentProject || !branch.trim()) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_checkout_branch', {
      path: store.currentProject,
      branch: branch.trim(),
      create,
    });
    flash(r || `Checked out ${branch.trim()}`);
    newBranchName.value = '';
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const createBranch = async () => {
  await checkoutBranch(newBranchName.value, true);
};

const stashPush = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_stash_push', {
      path: store.currentProject,
      message: stashMessage.value,
    });
    flash(r || 'Changes stashed');
    stashMessage.value = '';
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const applyStash = async (stash: string, pop = false) => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_stash_apply', {
      path: store.currentProject,
      stash,
      pop,
    });
    flash(r || (pop ? `Popped ${stash}` : `Applied ${stash}`));
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const dropStash = async (stash: string) => {
  if (!store.currentProject || !confirm(`Drop ${stash}?`)) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_stash_drop', { path: store.currentProject, stash });
    flash(r || `Dropped ${stash}`);
    await refreshAll();
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

onMounted(async () => {
  await refreshGitTools();
  await Promise.all([loadHistory(), loadGraph()]);
});

const graphLaneClass = (commit: GitGraphCommit) => {
  if (commit.refs.some(ref => ref.includes('HEAD') || ref.includes(store.gitBranch))) return 'bg-emerald-300 shadow-[0_0_0_5px_rgba(94,224,181,0.16)] ring-1 ring-emerald-100/50';
  if (commit.parents.length > 1) return 'bg-fuchsia-300 shadow-[0_0_0_5px_rgba(217,70,239,0.14)] ring-1 ring-fuchsia-100/45';
  if (commit.refs.length) return 'bg-sky-300 shadow-[0_0_0_5px_rgba(125,211,252,0.13)] ring-1 ring-sky-100/40';
  return 'bg-white/45 ring-1 ring-white/20';
};

const graphRefClass = (ref: string) => {
  if (ref.includes('HEAD') || ref.includes(store.gitBranch)) return 'border-emerald-300/35 bg-emerald-400/16 text-emerald-100';
  if (ref.startsWith('tag:')) return 'border-amber-300/32 bg-amber-400/14 text-amber-100';
  if (ref.includes('/')) return 'border-sky-300/25 bg-sky-400/12 text-sky-100/85';
  return 'border-white/12 bg-white/7 text-white/62';
};

const statusLabel: Record<string, string> = { M: 'M', U: 'U', A: 'A', D: 'D', R: 'R', T: 'T', C: 'C' };
const statusClass: Record<string, string> = {
  M: 'text-amber-200 bg-amber-500/13 border border-amber-300/18',
  U: 'text-emerald-200 bg-emerald-500/13 border border-emerald-300/18',
  A: 'text-emerald-200 bg-emerald-500/13 border border-emerald-300/18',
  D: 'text-rose-200 bg-rose-500/13 border border-rose-300/18',
  R: 'text-blue-200 bg-blue-500/13 border border-blue-300/18',
  T: 'text-violet-200 bg-violet-500/13 border border-violet-300/18',
  C: 'text-rose-100 bg-rose-500/22 border border-rose-300/20',
};
</script>

<template>
  <div class="flex flex-col h-full bg-[#08090d] overflow-hidden">

    <!-- Header with push/pull -->
    <div class="h-12 flex items-center justify-between px-5 border-b border-white/8 bg-[#101116] shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <GitBranch :size="14" class="text-emerald-300/75 shrink-0" />
        <span class="text-[11px] font-bold uppercase tracking-widest text-white/68">Source Control</span>
        <span class="rounded-full border border-emerald-300/18 bg-emerald-400/9 px-2 py-0.5 text-[10px] text-emerald-100/80 truncate max-w-[180px]">
          {{ store.gitBranch || 'no branch' }}
        </span>
        <span class="rounded-full border border-white/9 bg-white/5 px-2 py-0.5 text-[10px] text-white/42">
          {{ changeCount }} files
        </span>
        <span class="rounded-full border border-emerald-300/14 bg-emerald-400/7 px-2 py-0.5 text-[10px] text-emerald-100/65">
          {{ stagedEntries.length }} staged
        </span>
      </div>
      <div class="flex gap-1.5">
        <button @click="fetchAll" :disabled="loading" title="Fetch all remotes"
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/50 hover:text-white/78 hover:bg-white/8 transition-colors disabled:opacity-30">
          <RefreshCw :size="14" />
          Fetch
        </button>
        <button @click="pull" :disabled="loading" title="Pull"
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/50 hover:text-white/78 hover:bg-white/8 transition-colors disabled:opacity-30">
          <Download :size="14" />
          Pull
        </button>
        <button @click="push" :disabled="loading" title="Push"
          class="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/13 bg-emerald-400/8 px-2.5 py-1.5 text-[10px] text-emerald-100/70 hover:text-emerald-50 hover:bg-emerald-400/12 transition-colors disabled:opacity-30">
          <Upload :size="14" />
          Push
        </button>
      </div>
    </div>

    <div class="p-3 grid grid-cols-[minmax(220px,250px)_minmax(280px,340px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(230px,250px)_minmax(300px,340px)_minmax(0,1fr)_minmax(230px,250px)] grid-rows-[auto_minmax(0,1fr)_auto] 2xl:grid-rows-[auto_minmax(0,1fr)] gap-3 flex-1 overflow-hidden min-h-0">

      <!-- Branches, stash, conflicts -->
      <div class="col-start-1 col-span-3 row-start-3 2xl:col-start-4 2xl:col-span-1 2xl:row-start-1 2xl:row-span-2 grid grid-cols-3 2xl:grid-cols-1 gap-3 min-h-0 max-h-48 2xl:max-h-none overflow-y-auto pr-1" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent">
        <div class="rounded-xl border border-white/8 bg-[#12131a] p-3 min-w-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/30">
              <GitBranch :size="11" />
              Branches
            </div>
            <span class="text-[10px] text-emerald-300/70 truncate">{{ store.gitBranch }}</span>
          </div>
          <div class="flex gap-1 mb-2">
            <input
              v-model="newBranchName"
              @keydown.enter.prevent="createBranch"
              placeholder="new branch"
              class="min-w-0 flex-1 bg-black/28 border border-white/9 rounded-lg px-2.5 py-1.5 text-[11px] text-white/72 placeholder:text-white/25 outline-none focus:border-emerald-300/35"
            />
            <button
              @click="createBranch"
              :disabled="loading || !newBranchName.trim()"
              class="px-2 rounded-lg bg-white/7 hover:bg-white/12 text-white/58 disabled:opacity-30 transition-colors"
              title="Create and checkout branch"
            >
              <Plus :size="12" />
            </button>
          </div>
          <div class="grid grid-cols-2 gap-1 mb-2">
            <button
              @click="fetchAll"
              :disabled="loading"
              class="rounded-lg border border-white/6 bg-black/18 px-2 py-1.5 text-[10px] text-white/42 hover:text-white/70 hover:bg-white/7 disabled:opacity-30 transition-colors"
            >
              fetch
            </button>
            <button
              @click="publishBranch"
              :disabled="loading || !store.gitBranch"
              class="rounded-lg border border-emerald-300/12 bg-emerald-400/7 px-2 py-1.5 text-[10px] text-emerald-200/70 hover:text-emerald-100 hover:bg-emerald-500/12 disabled:opacity-30 transition-colors"
            >
              publish
            </button>
          </div>
          <div class="max-h-20 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <button
              v-for="branch in branches"
              :key="`${branch.is_remote ? 'r' : 'l'}:${branch.name}`"
              @click="checkoutBranch(branch.name)"
              :disabled="loading || branch.is_head"
              class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/7 disabled:hover:bg-transparent transition-colors"
            >
              <span class="text-[11px] truncate" :class="branch.is_head ? 'text-emerald-300/75' : 'text-white/45'">{{ branch.name }}</span>
              <span v-if="branch.is_remote" class="text-[9px] text-white/20 shrink-0">remote</span>
            </button>
            <p v-if="!branches.length" class="text-[11px] text-white/20 italic px-1.5 py-2">No branches loaded</p>
          </div>
        </div>

        <div class="rounded-xl border border-white/8 bg-[#12131a] p-3 min-w-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/30">
              <Archive :size="11" />
              Stash
            </div>
            <span class="text-[10px] text-white/25">{{ stashes.length }}</span>
          </div>
          <div class="flex gap-1 mb-2">
            <input
              v-model="stashMessage"
              @keydown.enter.prevent="stashPush"
              placeholder="stash message"
              class="min-w-0 flex-1 bg-black/28 border border-white/9 rounded-lg px-2.5 py-1.5 text-[11px] text-white/72 placeholder:text-white/25 outline-none focus:border-emerald-300/35"
            />
            <button
              @click="stashPush"
              :disabled="loading"
              class="px-2 rounded-lg bg-white/7 hover:bg-white/12 text-white/58 disabled:opacity-30 transition-colors"
              title="Stash changes"
            >
              <Archive :size="12" />
            </button>
          </div>
          <div class="max-h-20 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <div v-for="stash in stashes" :key="stash.id" class="flex items-center gap-1 py-0.5">
              <span class="text-[10px] text-white/25 font-mono w-16 shrink-0">{{ stash.id }}</span>
              <span class="text-[11px] text-white/45 truncate flex-1">{{ stash.message }}</span>
              <button @click="applyStash(stash.id)" class="text-[10px] text-white/30 hover:text-white/65 px-1" title="Apply">apply</button>
              <button @click="applyStash(stash.id, true)" class="text-[10px] text-white/30 hover:text-white/65 px-1" title="Pop">pop</button>
              <button @click="dropStash(stash.id)" class="text-[10px] text-rose-300/35 hover:text-rose-300 px-1" title="Drop">drop</button>
            </div>
            <p v-if="!stashes.length" class="text-[11px] text-white/20 italic px-1.5 py-2">No stashes</p>
          </div>
        </div>

        <div class="rounded-xl border border-white/8 bg-[#12131a] p-3 min-w-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/30">
              <Clock3 :size="11" />
              History
            </div>
            <div class="flex items-center gap-1">
              <button
                @click="openGraph"
                :disabled="graphLoading"
                class="text-[10px] text-white/25 hover:text-white/60 disabled:opacity-30 transition-colors"
                title="Open commit graph"
              >
                graph
              </button>
              <button
                @click="loadHistory"
                :disabled="historyLoading"
                class="text-white/25 hover:text-white/60 disabled:opacity-30 transition-colors"
                title="Refresh history"
              >
                <Loader2 v-if="historyLoading" :size="11" class="animate-spin" />
                <Clock3 v-else :size="11" />
              </button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-1 mb-2">
            <button
              @click="setHistoryScope('repo')"
              class="rounded px-2 py-1 text-[10px] transition-colors"
              :class="historyScope === 'repo' ? 'bg-white/12 text-white/78' : 'bg-black/20 text-white/35 hover:text-white/62'"
            >
              repo
            </button>
            <button
              @click="setHistoryScope('file')"
              :disabled="!canUseFileHistory"
              class="rounded px-2 py-1 text-[10px] transition-colors disabled:opacity-30"
              :class="historyScope === 'file' ? 'bg-white/12 text-white/78' : 'bg-black/20 text-white/35 hover:text-white/62'"
            >
              file
            </button>
          </div>
          <button
            @click="showBlame"
            :disabled="!selectedFile || blameLoading"
            class="mb-2 w-full rounded-lg border border-white/6 bg-black/20 px-2 py-1.5 text-[10px] transition-colors disabled:opacity-30"
            :class="selectedFile ? 'text-white/40 hover:text-white/65 hover:bg-white/6' : 'text-white/22'"
          >
            {{ blameLoading ? 'loading blame...' : 'blame selected file' }}
          </button>
          <div class="grid grid-cols-[1fr_1fr_auto] gap-1 mb-2">
            <input
              v-model="compareBase"
              class="min-w-0 bg-black/28 border border-white/9 rounded-lg px-2 py-1.5 text-[10px] text-white/65 placeholder:text-white/20 outline-none focus:border-white/22"
            />
            <input
              v-model="compareHead"
              class="min-w-0 bg-black/28 border border-white/9 rounded-lg px-2 py-1.5 text-[10px] text-white/65 placeholder:text-white/20 outline-none focus:border-white/22"
            />
            <button
              @click="compareRefs"
              :disabled="historyLoading || !compareBase.trim() || !compareHead.trim()"
              class="px-2 rounded-lg bg-white/7 hover:bg-white/12 text-white/50 disabled:opacity-30 transition-colors"
              title="Compare refs"
            >
              <GitCompare :size="12" />
            </button>
          </div>
          <div class="max-h-36 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <button
              v-for="commit in historyItems"
              :key="commit.hash"
              @click="showCommit(commit)"
              class="w-full grid grid-cols-[58px_minmax(0,1fr)] gap-2 px-1.5 py-1 rounded text-left hover:bg-white/5 transition-colors"
            >
              <span class="text-[10px] text-emerald-300/55 font-mono">{{ commit.short_hash }}</span>
              <span class="min-w-0">
                <span class="block text-[11px] text-white/55 truncate">{{ commit.summary }}</span>
                <span class="block text-[9px] text-white/22 truncate">{{ commit.date }} · {{ commit.author }}</span>
              </span>
            </button>
            <p v-if="!historyItems.length" class="text-[11px] text-white/20 italic px-1.5 py-2">No history loaded</p>
          </div>
        </div>
      </div>

      <div v-if="conflicts.length" class="col-start-1 row-start-2 self-start max-h-56 overflow-y-auto rounded-xl border border-rose-500/24 bg-rose-500/10 px-3 py-2 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" style="scrollbar-width:thin; scrollbar-color: rgba(244,63,94,0.22) transparent">
        <div class="text-[10px] font-bold uppercase tracking-wide text-rose-300/80 mb-1">
          Conflicts ({{ conflicts.length }})
        </div>
        <div
          v-for="file in conflicts"
          :key="file"
          class="rounded border border-rose-400/10 bg-black/12 px-2 py-1.5 mb-1"
        >
          <button
            @click="loadDiff(file)"
            class="block w-full text-left text-[11px] text-rose-100/72 truncate hover:text-rose-100"
          >
            {{ file }}
          </button>
          <div class="mt-1 flex items-center gap-1">
            <button
              @click="resolveConflict(file, 'ours')"
              :disabled="loading"
              class="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/38 hover:text-white/70 hover:bg-white/9 disabled:opacity-30"
              title="Keep current side and stage"
            >
              ours
            </button>
            <button
              @click="resolveConflict(file, 'theirs')"
              :disabled="loading"
              class="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/38 hover:text-white/70 hover:bg-white/9 disabled:opacity-30"
              title="Keep incoming side and stage"
            >
              theirs
            </button>
            <button
              @click="resolveConflict(file, 'both')"
              :disabled="loading"
              class="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-emerald-300/55 hover:text-emerald-200 hover:bg-emerald-500/8 disabled:opacity-30"
              title="Keep both sides and stage"
            >
              both
            </button>
          </div>
        </div>
      </div>

      <!-- Commit input -->
      <div class="col-start-1 row-start-1 flex flex-col gap-3 rounded-xl border border-white/8 bg-[#12131a] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <GitCommit :size="13" class="text-emerald-300/65 shrink-0" />
            <span class="text-[10px] font-bold uppercase tracking-widest text-white/46">Commit</span>
          </div>
          <div class="flex items-center gap-1.5 text-[10px]">
            <span class="rounded-full bg-emerald-400/9 px-2 py-0.5 text-emerald-100/62">{{ stagedEntries.length }} staged</span>
            <span class="rounded-full bg-white/6 px-2 py-0.5 text-white/38">{{ unstagedEntries.length + untrackedEntries.length }} waiting</span>
          </div>
        </div>
        <textarea
          v-model="commitMessage"
          @keydown.ctrl.enter.prevent="commitChanges"
          placeholder="Повідомлення коміту (Ctrl+Enter)"
          class="w-full bg-black/24 border border-white/9 rounded-xl px-3 py-2.5 text-[12px] text-white/78 placeholder:text-white/28 focus:outline-none focus:border-emerald-300/35 resize-none h-24 font-mono transition-colors"
        ></textarea>

        <div class="flex gap-2">
          <button
            @click="stageAll"
            :disabled="loading || !canStageAll"
            class="flex-1 min-w-0 bg-white/5 hover:bg-white/9 border border-white/9 text-white/64 py-2 px-2 rounded-lg text-[11px] flex items-center justify-center gap-1.5 whitespace-nowrap transition-all disabled:opacity-30"
          >
            <Plus :size="12" />
            Stage
          </button>
          <button
            @click="unstageAll"
            :disabled="loading || !canUnstageAll"
            class="flex-1 min-w-0 bg-white/5 hover:bg-white/9 border border-white/9 text-white/64 py-2 px-2 rounded-lg text-[11px] flex items-center justify-center gap-1.5 whitespace-nowrap transition-all disabled:opacity-30"
          >
            <Minus :size="12" />
            Unstage
          </button>
          <button
            @click="commitChanges"
            :disabled="!canCommit"
            :title="stagedEntries.length ? 'Commit staged files' : 'Stage at least one file first'"
            class="flex-1 min-w-0 bg-emerald-300 text-black font-bold py-2 px-2 rounded-lg text-[11px] flex items-center justify-center gap-1.5 whitespace-nowrap hover:bg-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Loader2 v-if="loading" :size="11" class="animate-spin" />
            <GitCommit v-else :size="11" />
            Commit {{ stagedEntries.length ? `(${stagedEntries.length})` : '' }}
          </button>
        </div>
      </div>

      <!-- Flash messages -->
      <div v-if="statusMsg" class="col-start-1 row-start-2 self-start text-[11px] text-emerald-200 bg-emerald-500/10 border border-emerald-500/24 rounded-xl px-3 py-2">
        {{ statusMsg }}
      </div>
      <div v-if="errMsg" class="col-start-1 row-start-2 self-start text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/24 rounded-xl px-3 py-2 break-all">
        {{ errMsg }}
      </div>

      <!-- Changes list -->
      <div class="col-start-2 row-start-1 row-span-2 flex flex-col gap-3 overflow-hidden min-h-0 rounded-xl border border-white/8 bg-[#12131a] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[10px] font-bold text-white/50 uppercase tracking-widest">
            Changes
          </span>
          <div class="flex items-center gap-1.5 text-[10px]">
            <span class="rounded-full bg-white/6 px-2 py-0.5 text-white/42">{{ changeCount }} total</span>
            <span class="rounded-full bg-emerald-400/9 px-2 py-0.5 text-emerald-100/62">{{ stagedEntries.length }} staged</span>
          </div>
        </div>

        <div
          class="flex flex-col overflow-y-auto flex-1 gap-2.5 pr-1"
          style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent"
        >
          <div v-for="group in changeGroups" :key="group.key" class="rounded-xl border border-white/7 bg-black/18 overflow-hidden">
            <div class="h-8 flex items-center justify-between px-3 border-b border-white/6 bg-white/[0.025]">
              <span class="text-[10px] font-bold uppercase tracking-wide text-white/45">{{ group.title }}</span>
              <span class="rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-white/42">{{ group.entries.length }}</span>
            </div>
            <div v-if="group.entries.length" class="py-1">
              <div
                v-for="entry in group.entries"
                :key="`${entry.mode}:${entry.path}`"
                class="flex items-center justify-between gap-1.5 py-1.5 px-2.5 hover:bg-white/6 cursor-pointer group transition-colors"
                :class="selectedFile === entry.path && diffMode === (group.stagedDiff ? 'staged' : 'unstaged') ? 'bg-emerald-400/9 ring-1 ring-emerald-300/14' : ''"
                @click="loadDiff(entry.path, group.stagedDiff)"
              >
                <div class="min-w-0 flex-1">
                  <div class="text-[11px] text-white/72 truncate font-mono group-hover:text-white/90 transition-colors">
                    {{ entry.path.split(/[/\\]/).pop() }}
                  </div>
                  <div class="text-[9px] text-white/30 truncate font-mono">{{ entry.path }}</div>
                </div>
                <button
                  @click.stop="loadDiff(entry.path, group.stagedDiff)"
                  class="p-1 rounded text-white/32 hover:text-white/72 hover:bg-white/8 transition-colors"
                  title="View diff"
                >
                  <Eye :size="11" />
                </button>
                <button
                  v-if="group.key === 'staged'"
                  @click.stop="unstageFile(entry.path)"
                  :disabled="loading"
                  class="p-1 rounded text-white/32 hover:text-amber-200 hover:bg-amber-500/12 disabled:opacity-30 transition-colors"
                  title="Unstage file"
                >
                  <Minus :size="11" />
                </button>
                <button
                  v-else
                  @click.stop="stageFile(entry.path)"
                  :disabled="loading"
                  class="p-1 rounded text-white/32 hover:text-emerald-200 hover:bg-emerald-500/12 disabled:opacity-30 transition-colors"
                  title="Stage file"
                >
                  <Plus :size="11" />
                </button>
                <button
                  @click.stop="discardFile(entry.path)"
                  :disabled="loading"
                  class="p-1 rounded text-white/32 hover:text-rose-200 hover:bg-rose-500/12 disabled:opacity-30 transition-colors"
                  title="Discard changes"
                >
                  <RotateCcw :size="11" />
                </button>
                <span
                  class="text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-1 shrink-0"
                  :class="statusClass[entry.displayStatus] ?? 'text-white/35 bg-white/6 border border-white/8'"
                >{{ statusLabel[entry.displayStatus] ?? entry.displayStatus }}</span>
              </div>
            </div>
            <div v-else class="px-3 py-2.5 text-[11px] text-white/24 italic">{{ group.empty }}</div>
          </div>

          <div v-if="!changeCount" class="px-2 py-6 text-center">
            <p class="text-[11px] text-white/26 italic">Working tree clean</p>
          </div>
        </div>
      </div>

      <div v-if="historyOutput" class="col-start-3 row-start-1 row-span-2 min-w-0 min-h-0 border border-white/8 rounded-2xl bg-[#101116] flex flex-col overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div class="h-12 flex items-center justify-between gap-2 px-4 border-b border-white/7 bg-white/[0.025] shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <GitCompare :size="14" class="text-sky-300/62 shrink-0" />
            <span class="text-[11px] font-bold text-white/62 uppercase tracking-wide truncate">{{ historyTitle }}</span>
          </div>
          <button
            @click="clearHistoryOutput"
            class="rounded-lg border border-white/8 bg-white/5 px-2.5 py-1 text-[10px] text-white/42 hover:text-white/75 hover:bg-white/8 transition-colors"
          >
            close
          </button>
        </div>
        <pre class="flex-1 overflow-auto p-4 text-[11px] leading-5 text-white/66 font-mono whitespace-pre-wrap" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent">{{ historyOutput }}</pre>
      </div>

      <div v-else-if="selectedFile" class="col-start-3 row-start-1 row-span-2 min-w-0 min-h-0 border border-white/8 rounded-2xl bg-[#101116] flex flex-col gap-3 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div class="h-12 flex items-center justify-between gap-2 px-4 border-b border-white/7 bg-white/[0.025] shrink-0">
          <span class="text-[11px] font-bold text-white/62 uppercase tracking-wide truncate">
            Diff: {{ selectedFileName }}
          </span>
          <div class="flex items-center gap-1 shrink-0">
            <button
              @click="loadDiff(selectedFile, false)"
              class="text-[10px] px-2.5 py-1 rounded-lg transition-colors"
              :class="diffMode === 'unstaged' ? 'bg-emerald-400/13 text-emerald-100/78 border border-emerald-300/14' : 'text-white/35 hover:text-white/65 hover:bg-white/6 border border-transparent'"
            >
              unstaged
            </button>
            <button
              @click="loadDiff(selectedFile, true)"
              class="text-[10px] px-2.5 py-1 rounded-lg transition-colors"
              :class="diffMode === 'staged' ? 'bg-emerald-400/13 text-emerald-100/78 border border-emerald-300/14' : 'text-white/35 hover:text-white/65 hover:bg-white/6 border border-transparent'"
            >
              staged
            </button>
            <Loader2 v-if="diffLoading" :size="12" class="animate-spin text-white/30 shrink-0" />
          </div>
        </div>
        <div v-if="diffHunks.length" class="flex flex-col gap-1.5 max-h-28 overflow-y-auto px-4 pr-5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent">
          <div
            v-for="hunk in diffHunks"
            :key="hunk.index"
            class="flex items-center justify-between gap-2 rounded-lg border border-white/7 bg-black/24 px-2.5 py-1.5"
          >
            <span class="text-[10px] text-white/45 font-mono truncate">{{ hunk.title }}</span>
            <button
              @click="applyHunk(hunk)"
              :disabled="loading"
              class="text-[10px] text-emerald-300/55 hover:text-emerald-200 disabled:opacity-30 transition-colors shrink-0"
              :title="diffMode === 'staged' ? 'Unstage this hunk' : 'Stage this hunk'"
            >
              {{ diffMode === 'staged' ? 'unstage hunk' : 'stage hunk' }}
            </button>
          </div>
        </div>
        <div v-if="parsedDiff.hunks.length" class="flex items-center justify-between gap-2 px-4">
          <span class="text-[10px] text-white/35">{{ selectedLineCount }} selected lines</span>
          <div class="flex items-center gap-2">
            <button
              v-if="diffMode === 'unstaged'"
              @click="applySelectedLines('stage')"
              :disabled="loading || !selectedLineCount"
              class="text-[10px] text-emerald-300/55 hover:text-emerald-200 disabled:opacity-30 transition-colors"
            >
              stage selected
            </button>
            <button
              v-if="diffMode === 'unstaged'"
              @click="applySelectedLines('discard')"
              :disabled="loading || !selectedLineCount"
              class="text-[10px] text-rose-300/55 hover:text-rose-200 disabled:opacity-30 transition-colors"
            >
              discard selected
            </button>
            <button
              v-if="diffMode === 'staged'"
              @click="applySelectedLines('unstage')"
              :disabled="loading || !selectedLineCount"
              class="text-[10px] text-amber-300/60 hover:text-amber-200 disabled:opacity-30 transition-colors"
            >
              unstage selected
            </button>
          </div>
        </div>
        <div
          v-if="parsedDiff.hunks.length"
          class="flex-1 overflow-auto rounded-xl bg-black/34 border border-white/7 mx-4 mb-4 p-4 text-[11px] leading-5 font-mono"
          style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent"
        >
          <div v-for="hunk in parsedDiff.hunks" :key="hunk.index" class="min-w-max">
            <div class="text-sky-200/70 whitespace-pre py-0.5">{{ hunk.title }}</div>
            <button
              v-for="line in hunk.lines"
              :key="line.key"
              @click="toggleDiffLine(line)"
              class="w-full grid grid-cols-[18px_minmax(0,1fr)] gap-2 text-left rounded px-1 transition-colors"
              :class="[
                line.selectable ? 'cursor-pointer hover:bg-white/7' : 'cursor-default',
                line.kind === 'add' ? 'text-emerald-300/75' : line.kind === 'remove' ? 'text-rose-300/75' : line.kind === 'context' ? 'text-white/45' : 'text-white/28',
                isDiffLineSelected(line.key) ? 'bg-emerald-500/12 ring-1 ring-emerald-400/20' : '',
              ]"
            >
              <span class="text-white/22 text-center">{{ line.selectable ? (isDiffLineSelected(line.key) ? 'x' : '+') : '' }}</span>
              <span class="whitespace-pre">{{ line.text }}</span>
            </button>
          </div>
        </div>
        <pre v-else class="flex-1 overflow-auto rounded-xl bg-black/34 border border-white/7 mx-4 mb-4 p-4 text-[11px] leading-5 text-white/64 font-mono whitespace-pre-wrap">{{ diffContent }}</pre>
      </div>
      <div
        v-else
        class="col-start-3 row-start-1 row-span-2 min-w-0 min-h-0 border border-white/8 rounded-2xl bg-[#101116] flex flex-col overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      >
        <div class="h-12 flex items-center justify-between gap-2 px-4 border-b border-white/7 bg-white/[0.025] shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <GitBranch :size="14" class="text-emerald-300/70 shrink-0" />
            <span class="text-[11px] font-bold text-white/64 uppercase tracking-wide truncate">Commit Graph</span>
            <span class="rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-white/42">{{ graphItems.length }} commits</span>
          </div>
          <button
            @click="loadGraph"
            :disabled="graphLoading"
            class="rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-white/40 hover:text-white/72 hover:bg-white/8 disabled:opacity-30 transition-colors"
            title="Refresh commit graph"
          >
            <Loader2 v-if="graphLoading" :size="12" class="animate-spin" />
            <RefreshCw v-else :size="12" />
          </button>
        </div>

        <div class="flex-1 grid grid-cols-[minmax(340px,42%)_minmax(0,1fr)] min-h-0">
          <div class="min-h-0 border-r border-white/7 overflow-y-auto p-3 bg-black/10" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent">
            <button
              v-for="commit in graphItems"
              :key="commit.hash"
              class="relative w-full grid grid-cols-[30px_minmax(0,1fr)] gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors"
              :class="selectedGraphCommit?.hash === commit.hash ? 'bg-emerald-400/10 ring-1 ring-emerald-300/16' : 'hover:bg-white/5'"
              @click="selectGraphCommit(commit)"
              @dblclick="showGraphCommit(commit)"
            >
              <div class="relative flex justify-center">
                <span class="absolute top-0 bottom-[-22px] w-px bg-white/10"></span>
                <span class="relative mt-1 h-3 w-3 rounded-full" :class="graphLaneClass(commit)"></span>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-mono text-[10px] text-emerald-200/78 shrink-0">{{ commit.short_hash }}</span>
                  <span class="truncate text-[12px] font-medium text-white/78">{{ commit.summary }}</span>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-1">
                  <span
                    v-for="refName in commit.refs.slice(0, 4)"
                    :key="refName"
                    class="rounded-md border px-1.5 py-0.5 text-[9px] font-medium"
                    :class="graphRefClass(refName)"
                  >
                    {{ refName.replace('HEAD -> ', '') }}
                  </span>
                </div>
                <div class="mt-1.5 flex items-center gap-2 text-[10px] text-white/33 min-w-0">
                  <span class="truncate">{{ commit.author }}</span>
                  <span>{{ commit.date }}</span>
                  <span>{{ commit.files.length }} files</span>
                  <span v-if="commit.parents.length > 1" class="text-fuchsia-100/68">merge</span>
                </div>
              </div>
            </button>
            <div v-if="!graphItems.length && !graphLoading" class="px-3 py-8 text-center text-[12px] text-white/28 italic">
              No commits loaded
            </div>
          </div>

          <div class="min-w-0 min-h-0 flex flex-col">
            <div class="border-b border-white/7 p-4 shrink-0 bg-black/8">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[13px] font-bold text-white/82 truncate">{{ selectedGraphCommit?.summary ?? 'Select a commit' }}</div>
                  <div class="mt-1 text-[10px] text-white/38 font-mono truncate">{{ selectedGraphCommit?.hash }}</div>
                  <div v-if="selectedGraphCommit" class="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/38">
                    <span>{{ selectedGraphCommit.author }}</span>
                    <span>{{ selectedGraphCommit.date }}</span>
                    <span>{{ selectedGraphCommit.files.length }} changed files</span>
                  </div>
                </div>
                <button
                  v-if="selectedGraphCommit"
                  @click="showGraphCommit(selectedGraphCommit)"
                  class="rounded-lg border border-white/8 bg-white/6 px-2.5 py-1.5 text-[10px] text-white/55 hover:text-white/82 hover:bg-white/10 transition-colors"
                >
                  full patch
                </button>
              </div>
              <div v-if="selectedGraphCommit" class="mt-3 max-h-36 overflow-y-auto rounded-xl border border-white/7 bg-black/24 p-1.5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent">
                <button
                  v-for="file in selectedGraphCommit.files"
                  :key="`${file.status}:${file.path}:${file.old_path ?? ''}`"
                  class="w-full grid grid-cols-[38px_minmax(0,1fr)] gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/6 transition-colors"
                  @click="showGraphFile(file)"
                >
                  <span class="text-[10px] font-bold rounded-md px-1.5 py-0.5 text-center self-start" :class="statusClass[file.status[0]] ?? 'text-white/35 bg-white/6 border border-white/8'">{{ file.status }}</span>
                  <span class="min-w-0">
                    <span class="block truncate text-[11px] text-white/68 font-mono">{{ file.path }}</span>
                    <span v-if="file.old_path" class="block truncate text-[9px] text-white/30 font-mono">from {{ file.old_path }}</span>
                  </span>
                </button>
                <div v-if="!selectedGraphCommit.files.length" class="px-2 py-2 text-[11px] text-white/26 italic">No file list for this commit</div>
              </div>
            </div>

            <div class="min-h-0 flex-1">
              <div v-if="graphDiffLoading" class="h-full flex items-center justify-center text-[12px] text-white/35">
                Loading file diff...
              </div>
              <pre
                v-else-if="graphDiffContent"
                class="h-full overflow-auto p-4 text-[11px] leading-5 text-white/66 font-mono whitespace-pre-wrap bg-black/18"
                style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.09) transparent"
              >{{ graphDiffContent }}</pre>
              <div v-else class="h-full flex items-center justify-center px-6 text-center text-[12px] text-white/30">
                Select a commit file to inspect its patch, or double click a commit for the full patch.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
