<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore, type SearchResult } from '../stores/editor';
import { Search, Loader2, X } from 'lucide-vue-next';

const store = useEditorStore();
const query = ref('');
const results = ref<SearchResult[]>([]);
const loading = ref(false);

const performSearch = async () => {
  if (!query.value.trim()) return;
  loading.value = true;
  results.value = [];
  try {
    results.value = await invoke<SearchResult[]>('search_in_files', {
      path: store.currentProject ?? './',
      pattern: query.value.trim(),
    });
  } catch {}
  finally { loading.value = false; }
};

const clearSearch = () => { query.value = ''; results.value = []; };

const openResult = async (res: SearchResult) => {
  try {
    const content = await invoke<string>('read_file', { path: res.path });
    const name = res.path.split(/[/\\]/).pop() ?? 'file';
    store.openTab(res.path, name, content);
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
</script>

<template>
  <div class="flex flex-col h-full bg-[#0d0d11] overflow-hidden">

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
</template>
