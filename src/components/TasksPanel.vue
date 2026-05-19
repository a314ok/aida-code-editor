<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '../lib/electron/ipc';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ListChecks,
  Play,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-vue-next';
import { useEditorStore } from '../stores/editor';

interface ProjectTask {
  id: string;
  label: string;
  group: string;
  command_line: string;
  description: string;
}

interface TaskProblem {
  file?: string | null;
  line?: number | null;
  column?: number | null;
  severity: 'error' | 'warning' | 'info' | string;
  message: string;
  raw: string;
}

interface TaskRunResult {
  success: boolean;
  code: number | null;
  timed_out: boolean;
  duration_ms: number;
  output: string;
  problems: TaskProblem[];
}

const store = useEditorStore();
const emit = defineEmits(['close']);

const tasks = ref<ProjectTask[]>([]);
const selectedTaskId = ref<string | null>(null);
const result = ref<TaskRunResult | null>(null);
const loading = ref(false);
const running = ref(false);
const error = ref('');

const groupOrder: Record<string, number> = { npm: 0, cargo: 1, python: 2 };

const groupedTasks = computed(() => {
  const groups = new Map<string, ProjectTask[]>();
  for (const task of tasks.value) {
    const existing = groups.get(task.group) ?? [];
    existing.push(task);
    groups.set(task.group, existing);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (groupOrder[a] ?? 99) - (groupOrder[b] ?? 99) || a.localeCompare(b))
    .map(([group, items]) => ({
      group,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }));
});

const selectedTask = computed(() =>
  tasks.value.find(task => task.id === selectedTaskId.value) ?? tasks.value[0] ?? null
);

const projectName = computed(() => {
  if (!store.currentProject) return 'No project opened';
  return store.currentProject.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? store.currentProject;
});

const durationLabel = computed(() => {
  if (!result.value) return '';
  return `${(result.value.duration_ms / 1000).toFixed(1)}s`;
});

const loadTasks = async () => {
  if (!store.currentProject) {
    tasks.value = [];
    selectedTaskId.value = null;
    return;
  }

  loading.value = true;
  error.value = '';
  try {
    tasks.value = await invoke<ProjectTask[]>('get_project_tasks', { path: store.currentProject });
    if (!selectedTaskId.value || !tasks.value.some(task => task.id === selectedTaskId.value)) {
      selectedTaskId.value = tasks.value[0]?.id ?? null;
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
};

const runTask = async (task = selectedTask.value) => {
  if (!store.currentProject || !task || running.value) return;
  running.value = true;
  error.value = '';
  result.value = null;
  selectedTaskId.value = task.id;

  try {
    result.value = await invoke<TaskRunResult>('run_project_task', {
      path: store.currentProject,
      taskId: task.id,
    });
  } catch (e) {
    error.value = String(e);
  } finally {
    running.value = false;
  }
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

const shortPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  const project = store.currentProject?.replace(/\\/g, '/');
  return project && normalized.startsWith(project)
    ? normalized.slice(project.length).replace(/^\/+/, '')
    : normalized;
};

const openProblem = async (problem: TaskProblem) => {
  if (!problem.file) return;
  try {
    const content = await invoke<string>('read_file', { path: problem.file });
    store.openTab(problem.file, fileName(problem.file), content);
    store.revealLocation(problem.file, problem.line ?? 1, Math.max(0, (problem.column ?? 1) - 1));
    emit('close');
  } catch (e) {
    error.value = String(e);
  }
};

const severityClass = (severity: string) => {
  if (severity === 'warning') return 'text-amber-400 bg-amber-500/10';
  if (severity === 'info') return 'text-sky-400 bg-sky-500/10';
  return 'text-rose-400 bg-rose-500/10';
};

const handleKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close');
};

onMounted(() => {
  loadTasks();
  window.addEventListener('keydown', handleKey);
});
onUnmounted(() => window.removeEventListener('keydown', handleKey));
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[9998] flex items-start justify-center pt-14 bg-black/60"
      @mousedown.self="emit('close')"
    >
      <div class="w-[980px] max-w-[calc(100vw-32px)] h-[76vh] flex flex-col bg-[#0d0d11] border border-white/9 rounded-xl shadow-[0_24px_56px_rgba(0,0,0,0.78)] overflow-hidden">
        <div class="h-11 flex items-center justify-between px-4 border-b border-white/6 shrink-0 bg-[#0b0b0e]">
          <div class="flex items-center gap-3 text-white/70 min-w-0">
            <ListChecks :size="14" class="text-emerald-400/80 shrink-0" />
            <span class="text-[12px] font-bold uppercase tracking-widest shrink-0">Tasks</span>
            <span class="text-[10px] text-white/30 font-mono truncate">{{ projectName }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="loadTasks"
              class="p-1.5 rounded text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors"
              :class="{ 'animate-spin': loading }"
              title="Refresh tasks"
            >
              <RefreshCw :size="14" />
            </button>
            <button
              @click="emit('close')"
              class="p-1.5 rounded text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors"
              title="Close"
            >
              <X :size="14" />
            </button>
          </div>
        </div>

        <div class="flex-1 min-h-0 flex">
          <aside class="w-[300px] shrink-0 border-r border-white/6 bg-black/18 flex flex-col min-h-0">
            <div class="px-4 py-3 border-b border-white/5">
              <p class="text-[10px] font-bold uppercase tracking-widest text-white/28">Detected runners</p>
            </div>

            <div class="flex-1 overflow-y-auto py-2" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
              <div v-if="loading" class="px-4 py-8 text-center text-[12px] text-white/28">
                Scanning project tasks...
              </div>

              <div v-else-if="!tasks.length" class="px-4 py-8 text-center">
                <Terminal :size="18" class="mx-auto mb-2 text-white/20" />
                <p class="text-[12px] text-white/30">No npm, Cargo, or Python tasks found</p>
              </div>

              <div v-for="{ group, items } in groupedTasks" v-else :key="group" class="mb-3">
                <div class="px-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-white/25">{{ group }}</div>
                <button
                  v-for="task in items"
                  :key="task.id"
                  @click="selectedTaskId = task.id"
                  @dblclick="runTask(task)"
                  class="w-full text-left px-4 py-2.5 border-l-2 transition-colors"
                  :class="selectedTaskId === task.id ? 'border-emerald-400 bg-white/7' : 'border-transparent hover:bg-white/5'"
                >
                  <span class="block text-[12px] text-white/78 truncate">{{ task.label }}</span>
                  <span class="block text-[10px] text-white/28 font-mono truncate mt-0.5">{{ task.command_line }}</span>
                </button>
              </div>
            </div>
          </aside>

          <section class="flex-1 min-w-0 flex flex-col">
            <div class="px-4 py-3 border-b border-white/6 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-[12px] text-white/75 truncate">{{ selectedTask?.label ?? 'Select a task' }}</p>
                <p class="text-[10px] text-white/28 font-mono truncate">{{ selectedTask?.command_line ?? 'No command selected' }}</p>
              </div>
              <button
                @click="runTask()"
                :disabled="!selectedTask || running"
                class="h-8 px-3 rounded-md bg-emerald-500/14 text-emerald-200 hover:bg-emerald-500/22 disabled:opacity-40 disabled:hover:bg-emerald-500/14 transition-colors flex items-center gap-2 text-[12px] font-semibold shrink-0"
              >
                <Clock3 v-if="running" :size="14" class="animate-spin" />
                <Play v-else :size="14" />
                {{ running ? 'Running' : 'Run' }}
              </button>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
              <div v-if="error" class="m-4 px-3 py-2 rounded border border-rose-500/20 bg-rose-500/8 text-[12px] text-rose-200">
                {{ error }}
              </div>

              <div v-if="result" class="px-4 py-3 border-b border-white/5 flex items-center gap-3">
                <span
                  class="w-7 h-7 rounded flex items-center justify-center"
                  :class="result.success ? 'text-emerald-300 bg-emerald-500/10' : 'text-rose-300 bg-rose-500/10'"
                >
                  <CheckCircle2 v-if="result.success" :size="15" />
                  <AlertTriangle v-else :size="15" />
                </span>
                <div class="min-w-0">
                  <p class="text-[12px] text-white/75">
                    {{ result.success ? 'Task completed' : result.timed_out ? 'Task timed out' : 'Task failed' }}
                    <span class="text-white/30">in {{ durationLabel }}</span>
                  </p>
                  <p class="text-[10px] text-white/28">
                    Exit code: {{ result.code ?? 'unknown' }} · Problems: {{ result.problems.length }}
                  </p>
                </div>
              </div>

              <div v-if="result?.problems.length" class="border-b border-white/5">
                <div class="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/28">
                  Problems
                </div>
                <button
                  v-for="problem in result.problems"
                  :key="`${problem.file}:${problem.line}:${problem.column}:${problem.raw}`"
                  @click="openProblem(problem)"
                  class="w-full flex items-start gap-3 px-4 py-2 text-left hover:bg-white/5 transition-colors"
                  :disabled="!problem.file"
                >
                  <span
                    class="mt-0.5 w-6 h-6 rounded flex items-center justify-center shrink-0"
                    :class="severityClass(problem.severity)"
                  >
                    <AlertTriangle :size="13" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-[12px] text-white/75 leading-5">{{ problem.message }}</span>
                    <span class="block text-[10px] text-white/30 font-mono truncate">
                      {{ problem.file ? shortPath(problem.file) : 'task output' }}{{ problem.line ? `:${problem.line}` : '' }}{{ problem.column ? `:${problem.column}` : '' }}
                    </span>
                  </span>
                </button>
              </div>

              <pre class="m-0 p-4 min-h-full whitespace-pre-wrap break-words text-[11px] leading-5 font-mono text-white/58">{{ result?.output ?? 'Run a task to see output here.' }}</pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
