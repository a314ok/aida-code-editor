<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../stores/editor';
import { GitCommit, Loader2, Plus, Upload, Download } from 'lucide-vue-next';

const store = useEditorStore();
const commitMessage = ref('');
const loading = ref(false);
const statusMsg = ref('');
const errMsg = ref('');

const emit = defineEmits(['refresh']);

const flash = (msg: string, isErr = false) => {
  if (isErr) errMsg.value = msg;
  else statusMsg.value = msg;
  setTimeout(() => { statusMsg.value = ''; errMsg.value = ''; }, 3000);
};

const stageAll = async () => {
  if (!store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_stage_all', { path: store.currentProject });
    flash('Всі зміни додано до індексу');
    emit('refresh');
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

const commitChanges = async () => {
  if (!commitMessage.value.trim() || !store.currentProject) return;
  loading.value = true;
  try {
    await invoke('git_commit', { path: store.currentProject, message: commitMessage.value.trim() });
    flash('Коміт створено успішно');
    commitMessage.value = '';
    emit('refresh');
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
    emit('refresh');
  } catch (e: any) { flash(String(e), true); }
  finally { loading.value = false; }
};

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
      <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Source Control</span>
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

    <div class="p-3 flex flex-col gap-3 flex-1 overflow-hidden">

      <!-- Commit input -->
      <div class="flex flex-col gap-2">
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
      <div v-if="statusMsg" class="text-[11px] text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-1.5">
        {{ statusMsg }}
      </div>
      <div v-if="errMsg" class="text-[11px] text-rose-400 bg-rose-500/8 border border-rose-500/20 rounded-lg px-3 py-1.5 break-all">
        {{ errMsg }}
      </div>

      <!-- Changes list -->
      <div class="flex flex-col gap-1 flex-1 overflow-hidden min-h-0">
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
            class="flex items-center justify-between py-1 px-2 hover:bg-white/4 rounded cursor-pointer group transition-colors"
          >
            <span class="text-[11px] text-white/55 truncate flex-1 font-mono group-hover:text-white/75 transition-colors">
              {{ String(filePath).split(/[/\\]/).pop() }}
            </span>
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
    </div>
  </div>
</template>
