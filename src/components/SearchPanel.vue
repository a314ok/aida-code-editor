<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '../lib/electron/ipc';
import { useEditorStore, type SearchResult } from '../stores/editor';
import { Search, Loader2, X } from 'lucide-vue-next';

const store = useEditorStore();
const emit = defineEmits(['close']);
const query = ref('');
const replacement = ref('');
const results = ref<SearchResult[]>([]);
const loading = ref(false);
const replacing = ref(false);
const message = ref('');

interface ReplaceSummary {
  files_changed: number;
  replacements: number;
}

const performSearch = async () => {
  if (!query.value.trim()) return;
  loading.value = true;
  results.value = [];
  message.value = '';
  try {
    results.value = await invoke<SearchResult[]>('search_in_files', {
      path: store.currentProject ?? './',
      pattern: query.value.trim(),
    });
  } catch {}
  finally { loading.value = false; }
};

const clearSearch = () => { query.value = ''; results.value = []; };

const replaceInFiles = async () => {
  if (!query.value.trim()) return;
  if (!confirm(`Replace exact matches of "${query.value}" in project files?`)) return;
  replacing.value = true;
  message.value = '';
  try {
    const summary = await invoke<ReplaceSummary>('replace_in_files', {
      path: store.currentProject ?? './',
      pattern: query.value,
      replacement: replacement.value,
    });
    await performSearch();
    message.value = `Replaced ${summary.replacements} matches in ${summary.files_changed} files.`;
  } catch (e: any) {
    message.value = String(e);
  } finally {
    replacing.value = false;
  }
};

const openResult = async (res: SearchResult) => {
  try {
    const content = await invoke<string>('read_file', { path: res.path });
    const name = res.path.split(/[/\\]/).pop() ?? 'file';
    store.openTab(res.path, name, content);
    store.revealLocation(res.path, res.line);
    emit('close');
  } catch {}
};

const grouped = () => {
  const map = new Map<string, SearchResult[]>();
  for (const r of results.value) {
    if (!map.has(r.path)) map.set(r.path, []);
    map.get(r.path)!.push(r);
  }
  return map;
};

const handleKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close');
};

onMounted(() => window.addEventListener('keydown', handleKey));
onUnmounted(() => window.removeEventListener('keydown', handleKey));
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[9998] flex items-start justify-center pt-16 bg-black/60"
      @mousedown.self="emit('close')"
    >
      <div class="w-[760px] max-w-[calc(100vw-32px)] h-[72vh] flex flex-col bg-[#0d0d11] border border-white/9 rounded-xl shadow-[0_24px_56px_rgba(0,0,0,0.78)] overflow-hidden">
        <div class="h-11 flex items-center justify-between px-4 border-b border-white/6 shrink-0 bg-[#0b0b0e]">
          <div class="flex items-center gap-2 text-white/70">
            <Search :size="14" class="text-blue-400/70" />
            <span class="text-[12px] font-bold uppercase tracking-widest">Find in Files</span>
          </div>
          <button
            @click="emit('close')"
            class="p-1.5 rounded text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors"
            title="Close"
          >
            <X :size="14" />
          </button>
        </div>

    <!-- Search input -->
    <div class="p-3 border-b border-white/5 shrink-0">
      <div class="relative">
        <Search :size="12" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
        <input
          v-model="query"
          @keyup.enter="performSearch"
          type="text"
          placeholder="Пошук у проекті…"
          class="w-full bg-white/5 border border-white/8 rounded-md pl-7 pr-14 py-1.5 text-[12px] text-white/75 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition-colors"
        />
        <div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-0.5">
          <button v-if="query" @click="clearSearch" class="p-1 text-white/30 hover:text-white/60 transition-colors rounded">
            <X :size="11" />
          </button>
          <button @click="performSearch" class="p-1 text-white/30 hover:text-white/60 transition-colors rounded">
            <Loader2 v-if="loading" :size="12" class="animate-spin" />
            <Search v-else :size="12" />
          </button>
        </div>
      </div>
      <div v-if="results.length" class="mt-1.5 text-[10px] text-white/25">
        {{ results.length }} збігів у {{ grouped().size }} файлах
      </div>
      <div class="mt-2 flex items-center gap-2">
        <input
          v-model="replacement"
          type="text"
          placeholder="Replace exact matches with..."
          class="flex-1 bg-white/5 border border-white/8 rounded-md px-3 py-1.5 text-[12px] text-white/75 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition-colors"
        />
        <button
          @click="replaceInFiles"
          :disabled="!query.trim() || replacing"
          class="px-3 py-1.5 rounded-md border border-white/8 bg-white/5 text-[11px] font-bold text-white/55 hover:bg-white/8 hover:text-white/75 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Loader2 v-if="replacing" :size="12" class="animate-spin" />
          <span v-else>Replace</span>
        </button>
      </div>
      <div v-if="message" class="mt-1.5 text-[10px] text-white/35">
        {{ message }}
      </div>
    </div>

    <!-- Results -->
    <div class="flex-1 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">

      <template v-for="[filePath, fileResults] in grouped()" :key="filePath">
        <!-- File header -->
        <div class="px-3 py-1.5 text-[10px] font-semibold text-blue-400/70 bg-white/2 border-b border-white/4 truncate sticky top-0">
          {{ filePath.split(/[/\\]/).pop() }}
          <span class="text-white/20 ml-1 font-normal">{{ filePath }}</span>
        </div>

        <!-- Matches -->
        <div
          v-for="(res, i) in fileResults"
          :key="i"
          @click="openResult(res)"
          class="flex items-start gap-2 px-3 py-1.5 border-b border-white/3 hover:bg-white/4 cursor-pointer group transition-colors"
        >
          <span class="text-[10px] text-white/20 font-mono w-8 shrink-0 text-right mt-0.5">{{ res.line }}</span>
          <p class="text-[11px] text-white/50 font-mono truncate group-hover:text-white/75 transition-colors">
            {{ res.content.trim() }}
          </p>
        </div>
      </template>

      <div v-if="!loading && query && !results.length" class="px-4 py-8 text-center">
        <p class="text-[11px] text-white/20 italic">Нічого не знайдено для "{{ query }}"</p>
      </div>
      <div v-if="!query" class="px-4 py-8 text-center">
        <p class="text-[11px] text-white/20 italic">Введіть запит для пошуку по файлах</p>
      </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
