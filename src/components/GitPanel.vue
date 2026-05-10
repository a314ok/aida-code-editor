<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../stores/editor';
import { Archive, Clock3, Download, Eye, GitBranch, GitCommit, GitCompare, Loader2, Plus, RotateCcw, Upload } from 'lucide-vue-next';

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

const emit = defineEmits(['refresh']);

const changeEntries = computed(() => Object.entries(store.gitStatuses));
const changeCount = computed(() => changeEntries.value.length);
const selectedFileName = computed(() => selectedFile.value.split(/[/\\]/).pop() || selectedFile.value);
const canUseFileHistory = computed(() => Boolean(selectedFile.value));

const flash = (msg: string, isErr = false) => {
  if (isErr) errMsg.value = msg;
  else statusMsg.value = msg;
  setTimeout(() => { statusMsg.value = ''; errMsg.value = ''; }, 3000);
};

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
  await loadHistory();
};

const stageAll = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_stage_all', { path: store.currentProject });
    flash('Всі зміни додано до індексу');
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
    flash(String(e), true);
  } finally {
    historyLoading.value = false;
  }
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
  if (!commitMessage.value.trim() || !store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_commit', { path: store.currentProject, message: commitMessage.value.trim() });
    flash('Коміт створено успішно');
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
    flash(r || 'Push виконано');
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const pull = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    const r = await invoke<string>('git_pull', { path: store.currentProject });
    flash(r || 'Pull виконано');
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
  await loadHistory();
});

const statusLabel: Record<string, string> = { M: 'M', U: 'U', A: 'A', D: 'D', R: 'R' };
const statusClass: Record<string, string> = {
  M: 'text-amber-400 bg-amber-500/10',
  U: 'text-emerald-400 bg-emerald-500/10',
  A: 'text-emerald-400 bg-emerald-500/10',
  D: 'text-rose-400 bg-rose-500/10',
  R: 'text-blue-400 bg-blue-500/10',
};
</script>

<template>
  <div class="flex flex-col h-full bg-[#0d0d11] overflow-hidden">

    <!-- Header with push/pull -->
    <div class="h-9 flex items-center justify-between px-4 border-b border-white/5 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Source Control</span>
        <span class="text-[10px] text-white/20">{{ changeCount }}</span>
      </div>
      <div class="flex gap-2">
        <button @click="pull" :disabled="loading" title="Pull"
          class="text-white/30 hover:text-white/65 transition-colors disabled:opacity-30">
          <Download :size="14" />
        </button>
        <button @click="push" :disabled="loading" title="Push"
          class="text-white/30 hover:text-white/65 transition-colors disabled:opacity-30">
          <Upload :size="14" />
        </button>
      </div>
    </div>

    <div class="p-3 grid grid-cols-[330px_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 flex-1 overflow-hidden min-h-0">

      <!-- Branches, stash, conflicts -->
      <div class="col-start-1 row-start-4 grid grid-cols-1 gap-2 min-h-0 overflow-y-auto pr-1" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
        <div class="rounded-lg border border-white/6 bg-white/3 p-2 min-w-0">
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
              class="min-w-0 flex-1 bg-black/25 border border-white/7 rounded px-2 py-1 text-[11px] text-white/65 placeholder:text-white/20 outline-none focus:border-white/18"
            />
            <button
              @click="createBranch"
              :disabled="loading || !newBranchName.trim()"
              class="px-2 rounded bg-white/6 hover:bg-white/10 text-white/50 disabled:opacity-30 transition-colors"
              title="Create and checkout branch"
            >
              <Plus :size="12" />
            </button>
          </div>
          <div class="max-h-20 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <button
              v-for="branch in branches"
              :key="`${branch.is_remote ? 'r' : 'l'}:${branch.name}`"
              @click="checkoutBranch(branch.name)"
              :disabled="loading || branch.is_head"
              class="w-full flex items-center justify-between gap-2 px-1.5 py-1 rounded text-left hover:bg-white/5 disabled:hover:bg-transparent transition-colors"
            >
              <span class="text-[11px] truncate" :class="branch.is_head ? 'text-emerald-300/75' : 'text-white/45'">{{ branch.name }}</span>
              <span v-if="branch.is_remote" class="text-[9px] text-white/20 shrink-0">remote</span>
            </button>
            <p v-if="!branches.length" class="text-[11px] text-white/20 italic px-1.5 py-2">No branches loaded</p>
          </div>
        </div>

        <div class="rounded-lg border border-white/6 bg-white/3 p-2 min-w-0">
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
              class="min-w-0 flex-1 bg-black/25 border border-white/7 rounded px-2 py-1 text-[11px] text-white/65 placeholder:text-white/20 outline-none focus:border-white/18"
            />
            <button
              @click="stashPush"
              :disabled="loading"
              class="px-2 rounded bg-white/6 hover:bg-white/10 text-white/50 disabled:opacity-30 transition-colors"
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
      </div>

      <div v-if="conflicts.length" class="col-start-1 row-start-2 rounded-lg border border-rose-500/20 bg-rose-500/8 px-3 py-2 shrink-0">
        <div class="text-[10px] font-bold uppercase tracking-wide text-rose-300/80 mb-1">
          Conflicts ({{ conflicts.length }})
        </div>
        <button
          v-for="file in conflicts"
          :key="file"
          @click="loadDiff(file)"
          class="block w-full text-left text-[11px] text-rose-100/70 truncate py-0.5 hover:text-rose-100"
        >
          {{ file }}
        </button>
      </div>

      <!-- Commit input -->
      <div class="col-start-1 row-start-1 flex flex-col gap-2">
        <textarea
          v-model="commitMessage"
          @keydown.ctrl.enter.prevent="commitChanges"
          placeholder="Повідомлення коміту (Ctrl+Enter)"
          class="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-[12px] text-white/75 placeholder:text-white/25 focus:outline-none focus:border-white/20 resize-none h-20 font-mono transition-colors"
        ></textarea>

        <div class="flex gap-2">
          <button
            @click="stageAll"
            :disabled="loading || !Object.keys(store.gitStatuses).length"
            class="flex-1 bg-white/5 hover:bg-white/8 border border-white/8 text-white/60 py-1.5 px-3 rounded-lg text-[11px] flex items-center justify-center gap-1.5 transition-all disabled:opacity-30"
          >
            <Plus :size="12" />
            Stage All
          </button>
          <button
            @click="commitChanges"
            :disabled="!commitMessage.trim() || loading"
            class="flex-1 bg-white text-black font-bold py-1.5 px-3 rounded-lg text-[11px] flex items-center justify-center gap-1.5 hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Loader2 v-if="loading" :size="11" class="animate-spin" />
            <GitCommit v-else :size="11" />
            Commit
          </button>
        </div>
      </div>

      <!-- Flash messages -->
      <div v-if="statusMsg" class="col-start-1 row-start-2 text-[11px] text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-1.5">
        {{ statusMsg }}
      </div>
      <div v-if="errMsg" class="col-start-1 row-start-2 text-[11px] text-rose-400 bg-rose-500/8 border border-rose-500/20 rounded-lg px-3 py-1.5 break-all">
        {{ errMsg }}
      </div>

      <!-- Changes list -->
      <div class="col-start-1 row-start-3 flex flex-col gap-2 overflow-hidden min-h-0">
        <span class="text-[10px] font-bold text-white/25 uppercase tracking-wide">
          Зміни ({{ Object.keys(store.gitStatuses).length }})
        </span>

        <div
          class="flex flex-col overflow-y-auto flex-1 gap-px"
          style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent"
        >
          <div
            v-for="(status, filePath) in store.gitStatuses"
            :key="filePath"
            class="flex items-center justify-between gap-1 py-1 px-2 hover:bg-white/4 rounded cursor-pointer group transition-colors"
            :class="selectedFile === filePath ? 'bg-white/6' : ''"
            @click="loadDiff(String(filePath))"
          >
            <span class="text-[11px] text-white/55 truncate flex-1 font-mono group-hover:text-white/75 transition-colors">
              {{ String(filePath).split(/[/\\]/).pop() }}
            </span>
            <button
              @click.stop="loadDiff(String(filePath))"
              class="p-1 rounded text-white/25 hover:text-white/65 hover:bg-white/7 transition-colors"
              title="View diff"
            >
              <Eye :size="11" />
            </button>
            <button
              @click.stop="stageFile(String(filePath))"
              :disabled="loading"
              class="p-1 rounded text-white/25 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30 transition-colors"
              title="Stage file"
            >
              <Plus :size="11" />
            </button>
            <button
              @click.stop="discardFile(String(filePath))"
              :disabled="loading"
              class="p-1 rounded text-white/25 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-30 transition-colors"
              title="Discard changes"
            >
              <RotateCcw :size="11" />
            </button>
            <span
              class="text-[9px] font-bold px-1.5 py-0.5 rounded ml-2 shrink-0"
              :class="statusClass[status] ?? 'text-white/30 bg-white/5'"
            >{{ statusLabel[status] ?? status }}</span>
          </div>

          <div v-if="!Object.keys(store.gitStatuses).length" class="px-2 py-6 text-center">
            <p class="text-[11px] text-white/20 italic">Немає змін</p>
          </div>
        </div>
      </div>

      <div v-if="selectedFile" class="col-start-2 row-start-1 row-span-4 min-w-0 min-h-0 border border-white/6 rounded-xl bg-black/18 flex flex-col gap-2 overflow-hidden">
        <div class="flex items-center justify-between gap-2 px-3 pt-3">
          <span class="text-[10px] font-bold text-white/25 uppercase tracking-wide truncate">
            Diff: {{ selectedFileName }}
          </span>
          <div class="flex items-center gap-1 shrink-0">
            <button
              @click="loadDiff(selectedFile, false)"
              class="text-[10px] px-1.5 py-0.5 rounded transition-colors"
              :class="diffMode === 'unstaged' ? 'bg-white/10 text-white/70' : 'text-white/25 hover:text-white/55 hover:bg-white/5'"
            >
              unstaged
            </button>
            <button
              @click="loadDiff(selectedFile, true)"
              class="text-[10px] px-1.5 py-0.5 rounded transition-colors"
              :class="diffMode === 'staged' ? 'bg-white/10 text-white/70' : 'text-white/25 hover:text-white/55 hover:bg-white/5'"
            >
              staged
            </button>
            <Loader2 v-if="diffLoading" :size="12" class="animate-spin text-white/30 shrink-0" />
          </div>
        </div>
        <div v-if="diffHunks.length" class="flex flex-col gap-1 max-h-24 overflow-y-auto px-3 pr-4" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
          <div
            v-for="hunk in diffHunks"
            :key="hunk.index"
            class="flex items-center justify-between gap-2 rounded border border-white/5 bg-black/20 px-2 py-1"
          >
            <span class="text-[10px] text-white/35 font-mono truncate">{{ hunk.title }}</span>
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
        <div v-if="parsedDiff.hunks.length" class="flex items-center justify-between gap-2 px-3">
          <span class="text-[10px] text-white/25">{{ selectedLineCount }} selected lines</span>
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
          class="flex-1 overflow-auto rounded-lg bg-black/30 border border-white/5 mx-3 mb-3 p-3 text-[11px] leading-5 font-mono"
          style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent"
        >
          <div v-for="hunk in parsedDiff.hunks" :key="hunk.index" class="min-w-max">
            <div class="text-sky-300/55 whitespace-pre py-0.5">{{ hunk.title }}</div>
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
        <pre v-else class="flex-1 overflow-auto rounded-lg bg-black/30 border border-white/5 mx-3 mb-3 p-3 text-[11px] leading-5 text-white/55 font-mono whitespace-pre-wrap">{{ diffContent }}</pre>
      </div>
      <div
        v-else
        class="col-start-2 row-start-1 row-span-4 min-w-0 min-h-0 border border-white/6 rounded-xl bg-black/18 flex items-center justify-center"
      >
        <div class="text-center">
          <div class="text-[12px] font-bold uppercase tracking-wide text-white/30">No file selected</div>
        </div>
      </div>
    </div>
  </div>
</template>
