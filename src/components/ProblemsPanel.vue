<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { AlertCircle, AlertTriangle, Info, Lightbulb, X } from 'lucide-vue-next';
import { useEditorStore, type EditorDiagnostic } from '../stores/editor';

const store = useEditorStore();
const emit = defineEmits(['close']);

const problems = computed(() =>
  store.getAllDiagnostics().sort((a, b) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column
  )
);

const severityRank: Record<EditorDiagnostic['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

const counts = computed(() => {
  const result = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const problem of problems.value) result[problem.severity]++;
  return result;
});

const sortedProblems = computed(() =>
  [...problems.value].sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity]
    || a.path.localeCompare(b.path)
    || a.line - b.line
    || a.column - b.column
  )
);

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

const severityClass = (severity: EditorDiagnostic['severity']) => ({
  error: 'text-rose-400 bg-rose-500/10',
  warning: 'text-amber-400 bg-amber-500/10',
  info: 'text-sky-400 bg-sky-500/10',
  hint: 'text-violet-300 bg-violet-500/10',
}[severity]);

const openProblem = async (problem: EditorDiagnostic) => {
  try {
    const content = await invoke<string>('read_file', { path: problem.path });
    store.openTab(problem.path, fileName(problem.path), content);
    store.revealLocation(problem.path, problem.line, problem.column);
    emit('close');
  } catch {}
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
      <div class="w-[820px] max-w-[calc(100vw-32px)] h-[70vh] flex flex-col bg-[#0d0d11] border border-white/9 rounded-xl shadow-[0_24px_56px_rgba(0,0,0,0.78)] overflow-hidden">
        <div class="h-11 flex items-center justify-between px-4 border-b border-white/6 shrink-0 bg-[#0b0b0e]">
          <div class="flex items-center gap-3 text-white/70">
            <AlertCircle :size="14" class="text-rose-400/80" />
            <span class="text-[12px] font-bold uppercase tracking-widest">Problems</span>
            <div class="flex items-center gap-2 text-[10px] text-white/35">
              <span class="text-rose-400">{{ counts.error }} errors</span>
              <span class="text-amber-400">{{ counts.warning }} warnings</span>
              <span>{{ counts.info + counts.hint }} info</span>
            </div>
          </div>
          <button
            @click="emit('close')"
            class="p-1.5 rounded text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors"
            title="Close"
          >
            <X :size="14" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
          <button
            v-for="problem in sortedProblems"
            :key="`${problem.path}:${problem.line}:${problem.column}:${problem.message}`"
            @click="openProblem(problem)"
            class="w-full flex items-start gap-3 px-4 py-2 border-b border-white/4 hover:bg-white/5 text-left transition-colors"
          >
            <span
              class="mt-0.5 w-6 h-6 rounded flex items-center justify-center shrink-0"
              :class="severityClass(problem.severity)"
            >
              <AlertCircle v-if="problem.severity === 'error'" :size="13" />
              <AlertTriangle v-else-if="problem.severity === 'warning'" :size="13" />
              <Lightbulb v-else-if="problem.severity === 'hint'" :size="13" />
              <Info v-else :size="13" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[12px] text-white/75 leading-5">{{ problem.message }}</span>
              <span class="block text-[10px] text-white/30 font-mono truncate">
                {{ fileName(problem.path) }}:{{ problem.line }}:{{ problem.column + 1 }}
                <span v-if="problem.source"> - {{ problem.source }}</span>
              </span>
            </span>
          </button>

          <div v-if="!sortedProblems.length" class="h-full flex items-center justify-center">
            <p class="text-[12px] text-white/25 italic">No diagnostics reported yet</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
