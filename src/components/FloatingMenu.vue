<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useEditorStore, type FileEntry } from '../stores/editor';
import {
  Search, X, FolderOpen, FilePlus, FolderPlus, RefreshCw,
  Files, GitBranch, ChevronRight
} from 'lucide-vue-next';
import FileTreeItem from './FileTreeItem.vue';
import GitPanel from './GitPanel.vue';

const store = useEditorStore();
const emit = defineEmits(['close']);

const activeTab = ref<'files' | 'git'>('files');
const loading = ref(false);
const expandedDirs = ref(new Set<string>());
const quickSearch = ref('');

/* ── flatten tree for quick search ──────────────── */
const flattenTree = (items: FileEntry[], out: FileEntry[] = []): FileEntry[] => {
  for (const item of items) {
    if (item.kind === 'file') out.push(item);
    if (item.children) flattenTree(item.children, out);
  }
  return out;
};

const getExt = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const extColor: Record<string, string> = {
  ts: 'text-blue-400', tsx: 'text-blue-400',
  js: 'text-yellow-400', jsx: 'text-yellow-400',
  rs: 'text-orange-400', go: 'text-cyan-400', py: 'text-yellow-300',
  vue: 'text-emerald-400', html: 'text-red-400',
  css: 'text-sky-300', scss: 'text-pink-400',
  json: 'text-yellow-200', md: 'text-white/50',
};

const quickResults = computed(() => {
  const q = quickSearch.value.trim().toLowerCase();
  if (!q) return [];
  return flattenTree(store.fileTree)
    .filter(f => f.name.toLowerCase().includes(q))
    .slice(0, 12);
});

const selectedIdx = ref(0);

/* ── git ─────────────────────────────────────────── */
const loadGitStatus = async () => {
  if (!store.currentProject) return;
  try {
    const statuses = await invoke<any[]>('get_git_status', { path: store.currentProject });
    const m: Record<string, string> = {};
    statuses.forEach(s => { m[s.path] = s.status; });
    store.gitStatuses = m;
    const branch = await invoke<any>('get_git_branch', { path: store.currentProject });
    store.gitBranch = branch.name;
  } catch {}
};

/* ── files ───────────────────────────────────────── */
const loadFiles = async (path: string) => {
  loading.value = true;
  try { return await invoke<FileEntry[]>('get_dir_tree', { path }); }
  catch { return []; }
  finally { loading.value = false; }
};

const init = async () => {
  const path = store.currentProject ?? './';
  if (!store.currentProject) store.currentProject = path;
  store.fileTree = await loadFiles(path);
  await loadGitStatus();
};

const openFolder = async () => {
  const selected = await open({ directory: true, multiple: false });
  if (selected && typeof selected === 'string') {
    store.currentProject = selected;
    expandedDirs.value.clear();
    await init();
  }
};

const openFile = async (file: FileEntry) => {
  try {
    const content = await invoke<string>('read_file', { path: file.path });
    store.openTab(file.path, file.name, content);
    emit('close');
  } catch {}
};

const handleFileClick = async (file: FileEntry) => {
  if (file.kind === 'directory') {
    if (expandedDirs.value.has(file.path)) {
      expandedDirs.value.delete(file.path);
    } else {
      expandedDirs.value.add(file.path);
      if (!file.children) file.children = await loadFiles(file.path);
    }
  } else {
    await openFile(file);
  }
};

const createFile = async () => {
  const name = prompt('Назва файлу:');
  if (name && store.currentProject) {
    try { await invoke('create_file', { path: `${store.currentProject}/${name}` }); await init(); }
    catch (e) { alert(e); }
  }
};

const createFolder = async () => {
  const name = prompt('Назва папки:');
  if (name && store.currentProject) {
    try { await invoke('create_directory', { path: `${store.currentProject}/${name}` }); await init(); }
    catch (e) { alert(e); }
  }
};

/* ── keyboard navigation ─────────────────────────── */
const handleKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') { emit('close'); return; }
  if (quickSearch.value && quickResults.value.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx.value = (selectedIdx.value + 1) % quickResults.value.length; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); selectedIdx.value = (selectedIdx.value - 1 + quickResults.value.length) % quickResults.value.length; }
    if (e.key === 'Enter')     { e.preventDefault(); openFile(quickResults.value[selectedIdx.value]); }
  }
};

onMounted(() => { init(); window.addEventListener('keydown', handleKey); });
onUnmounted(() => window.removeEventListener('keydown', handleKey));
</script>

<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-[1000] flex items-start justify-center pt-16 bg-black/55 backdrop-blur-[2px]"
    @mousedown.self="emit('close')"
  >
    <!-- Panel -->
    <div class="w-[540px] flex flex-col bg-[#0e0e14] border border-white/9 rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.85)] overflow-hidden"
      style="max-height: 72vh"
    >

      <!-- ── Search header ── -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-white/6 shrink-0">
        <Search :size="15" class="text-white/30 shrink-0" />
        <input
          v-model="quickSearch"
          @input="selectedIdx = 0"
          type="text"
          placeholder="Швидкий пошук файлів…"
          class="bg-transparent flex-1 text-[13px] text-white/80 placeholder:text-white/25 outline-none"
          autofocus
        />
        <div class="flex items-center gap-1 shrink-0">
          <button @click="openFolder" class="p-1.5 rounded text-white/25 hover:text-white/65 hover:bg-white/6 transition-colors" title="Відкрити папку">
            <FolderOpen :size="14" />
          </button>
          <button @click="emit('close')" class="p-1.5 rounded text-white/25 hover:text-white/65 hover:bg-white/6 transition-colors">
            <X :size="14" />
          </button>
        </div>
      </div>

      <!-- ── Quick search results ── -->
      <template v-if="quickSearch.trim()">
        <div class="flex-1 overflow-y-auto py-1" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
          <div
            v-for="(file, i) in quickResults"
            :key="file.path"
            @click="openFile(file)"
            @mouseenter="selectedIdx = i"
            class="flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors"
            :class="selectedIdx === i ? 'bg-white/8' : 'hover:bg-white/5'"
          >
            <span
              class="text-[9px] font-bold font-mono w-7 text-center shrink-0"
              :class="extColor[getExt(file.name)] ?? 'text-white/30'"
            >{{ getExt(file.name).slice(0, 4) || '·' }}</span>
            <span class="text-[13px] text-white/80 truncate flex-1">{{ file.name }}</span>
            <span class="text-[10px] text-white/20 truncate max-w-[160px] font-mono">
              {{ file.path.replace(/\\/g, '/').split('/').slice(-3, -1).join('/') }}
            </span>
            <ChevronRight :size="12" class="text-white/15 shrink-0" />
          </div>

          <div v-if="!quickResults.length" class="px-4 py-6 text-center">
            <p class="text-[12px] text-white/20 italic">Нічого не знайдено</p>
          </div>
        </div>

        <!-- Hint -->
        <div class="px-4 py-2 border-t border-white/5 flex items-center gap-4 shrink-0">
          <span class="text-[10px] text-white/20"><kbd class="border border-white/12 rounded px-1 font-mono">↑↓</kbd> навігація</span>
          <span class="text-[10px] text-white/20"><kbd class="border border-white/12 rounded px-1 font-mono">Enter</kbd> відкрити</span>
          <span class="text-[10px] text-white/20"><kbd class="border border-white/12 rounded px-1 font-mono">Esc</kbd> закрити</span>
        </div>
      </template>

      <!-- ── Normal mode: tabs + content ── -->
      <template v-else>

        <!-- Tab bar + file actions -->
        <div class="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
          <!-- Tabs -->
          <div class="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
            <button
              @click="activeTab = 'files'"
              class="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all"
              :class="activeTab === 'files' ? 'bg-white/10 text-white/80' : 'text-white/30 hover:text-white/55'"
            >
              <Files :size="12" />
              Провідник
            </button>
            <button
              @click="activeTab = 'git'"
              class="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all relative"
              :class="activeTab === 'git' ? 'bg-white/10 text-white/80' : 'text-white/30 hover:text-white/55'"
            >
              <GitBranch :size="12" />
              Git
              <span
                v-if="Object.keys(store.gitStatuses).length > 0"
                class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full"
              ></span>
            </button>
          </div>

          <!-- File actions (only on files tab) -->
          <div v-if="activeTab === 'files'" class="flex items-center gap-1.5">
            <button @click="createFile"   title="Новий файл"  class="p-1.5 rounded text-white/25 hover:text-white/65 hover:bg-white/6 transition-colors"><FilePlus   :size="13" /></button>
            <button @click="createFolder" title="Нова папка"  class="p-1.5 rounded text-white/25 hover:text-white/65 hover:bg-white/6 transition-colors"><FolderPlus :size="13" /></button>
            <button @click="init"         title="Оновити"
              class="p-1.5 rounded text-white/25 hover:text-white/65 hover:bg-white/6 transition-colors"
              :class="{ 'animate-spin': loading }"
            ><RefreshCw :size="13" /></button>
          </div>
        </div>

        <!-- Project path hint -->
        <div v-if="activeTab === 'files'" class="px-4 pb-1 shrink-0">
          <span class="text-[10px] text-white/20 font-mono">
            {{ store.currentProject ? store.currentProject.replace(/\\/g, '/') : 'Немає відкритої папки' }}
          </span>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-hidden flex flex-col min-h-0">

          <!-- Files -->
          <template v-if="activeTab === 'files'">
            <div
              class="flex-1 overflow-y-auto"
              style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent"
            >
              <div v-if="!store.fileTree.length && !loading" class="px-4 py-8 text-center">
                <p class="text-[12px] text-white/20 italic">Натисніть 📁 вище щоб відкрити проект</p>
              </div>
              <FileTreeItem
                v-for="item in store.fileTree"
                :key="item.path"
                :item="item"
                :depth="0"
                :expanded-dirs="expandedDirs"
                @click="handleFileClick"
                @refresh="init"
              />
            </div>
          </template>

          <!-- Git -->
          <template v-else-if="activeTab === 'git'">
            <GitPanel @refresh="init" />
          </template>

        </div>
      </template>
    </div>
  </div>
</template>
