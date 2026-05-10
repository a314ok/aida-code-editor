<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Bug,
  ChevronRight,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
  X,
} from 'lucide-vue-next';
import { dapClient, getDapAdapterProbes, joinCommandLine, splitCommandLine, type DapAdapterStatus, type DapMessage } from '../lib/dap';
import { useEditorStore } from '../stores/editor';

const store = useEditorStore();
const emit = defineEmits(['close']);

const adapterProbes = getDapAdapterProbes();
const adapterStatuses = ref<DapAdapterStatus[]>([]);
const selectedAdapter = ref('custom');
const adapterCommand = ref('');
const adapterArgsText = ref('');
const requestType = ref<'launch' | 'attach'>('launch');
const program = ref('');
const cwd = ref(store.currentProject ?? '');
const programArgs = ref('');
const processId = ref('');
const stopOnEntry = ref(false);
const extraJson = ref('');
const breakpointPath = ref('');
const breakpointLine = ref(1);
const breakpoints = ref<Array<{ path: string; line: number }>>([]);
const output = ref<string[]>([]);
const error = ref('');
const running = ref(false);
const stopped = ref(false);
const currentThreadId = ref<number | null>(null);
const threads = ref<any[]>([]);
const stackFrames = ref<any[]>([]);
const scopes = ref<any[]>([]);
const variables = ref<any[]>([]);
const pendingConfiguration = ref(false);
let configurationTimer: number | null = null;

const activeTab = computed(() => {
  const windowState = store.getActiveWindow();
  return windowState?.tabs.find(tab => tab.path === windowState.activeTabPath) ?? null;
});

const selectedStatus = computed(() => adapterStatuses.value.find(item => item.id === selectedAdapter.value));
const availableAdapters = computed(() => adapterStatuses.value.filter(item => item.available));
const canControl = computed(() => running.value && currentThreadId.value !== null);

const appendOutput = (line: string) => {
  output.value = [...output.value.slice(-399), line];
};

const refreshAdapters = async () => {
  adapterStatuses.value = await dapClient.checkAdapters(store.currentProject);
  const firstAvailable = adapterStatuses.value.find(item => item.available);
  if (selectedAdapter.value === 'custom' && firstAvailable) {
    selectedAdapter.value = firstAvailable.id;
  }
};

const syncSelectedAdapterCommand = async () => {
  if (selectedAdapter.value === 'custom') return;
  const probe = adapterProbes.find(item => item.id === selectedAdapter.value);
  if (!probe) return;
  const status = selectedStatus.value;
  if (status?.available) {
    const resolved = await dapClient.resolveCommand(probe.candidates, store.currentProject);
    if (!resolved) return;
    adapterCommand.value = resolved.cmd;
    adapterArgsText.value = joinCommandLine(resolved.args);
  }
};

const parseExtraJson = () => {
  if (!extraJson.value.trim()) return {};
  const parsed = JSON.parse(extraJson.value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Extra DAP JSON must be an object');
  }
  return parsed;
};

const buildRequestArguments = () => {
  const extra = parseExtraJson();
  const args: Record<string, any> = {
    ...extra,
    name: extra.name ?? 'Aida Debug',
    type: extra.type ?? selectedAdapter.value,
    request: requestType.value,
    stopOnEntry: stopOnEntry.value,
  };

  if (cwd.value.trim()) args.cwd = cwd.value.trim();
  if (program.value.trim()) args.program = program.value.trim();
  const parsedProgramArgs = splitCommandLine(programArgs.value);
  if (parsedProgramArgs.length) args.args = parsedProgramArgs;
  if (requestType.value === 'attach' && processId.value.trim()) {
    const numericProcess = Number(processId.value.trim());
    args.processId = Number.isFinite(numericProcess) ? numericProcess : processId.value.trim();
  }
  return args;
};

const resolveSelectedCommand = async () => {
  if (selectedAdapter.value === 'custom') {
    if (!adapterCommand.value.trim()) throw new Error('Adapter command is required');
    return {
      cmd: adapterCommand.value.trim(),
      args: splitCommandLine(adapterArgsText.value),
      source: 'custom',
    };
  }

  const probe = adapterProbes.find(item => item.id === selectedAdapter.value);
  if (!probe) throw new Error('Unknown DAP adapter');
  const resolved = await dapClient.resolveCommand(probe.candidates, store.currentProject);
  if (!resolved) throw new Error(`Adapter is not installed: ${probe.label}`);
  adapterCommand.value = resolved.cmd;
  adapterArgsText.value = resolved.args.join(' ');
  return resolved;
};

const groupedBreakpoints = () => {
  const groups = new Map<string, number[]>();
  for (const bp of breakpoints.value) {
    if (!groups.has(bp.path)) groups.set(bp.path, []);
    groups.get(bp.path)!.push(bp.line);
  }
  return [...groups.entries()].map(([path, lines]) => ({
    path,
    lines: [...new Set(lines)].sort((a, b) => a - b),
  }));
};

const applyBreakpoints = async () => {
  for (const group of groupedBreakpoints()) {
    await dapClient.setBreakpoints(group.path, group.lines);
  }
};

const configureSession = async () => {
  if (!pendingConfiguration.value) return;
  pendingConfiguration.value = false;
  if (configurationTimer !== null) {
    window.clearTimeout(configurationTimer);
    configurationTimer = null;
  }
  try {
    await applyBreakpoints();
    await dapClient.configurationDone().catch(() => null);
    appendOutput('configuration done');
  } catch (e: any) {
    appendOutput(String(e?.message ?? e));
  }
};

const startDebug = async () => {
  error.value = '';
  output.value = [];
  stopped.value = false;
  threads.value = [];
  stackFrames.value = [];
  scopes.value = [];
  variables.value = [];
  try {
    const command = await resolveSelectedCommand();
    appendOutput(`adapter: ${[command.cmd, ...command.args].join(' ')}`);
    await dapClient.start(command, cwd.value || store.currentProject);
    const args = buildRequestArguments();
    pendingConfiguration.value = true;
    configurationTimer = window.setTimeout(() => configureSession(), 750);
    const request = requestType.value === 'launch'
      ? dapClient.launch(args)
      : dapClient.attach(args);
    running.value = true;
    appendOutput(`${requestType.value}: ${args.program ?? args.processId ?? 'session'}`);
    request.catch((launchError: any) => {
      running.value = false;
      error.value = String(launchError?.message ?? launchError);
      appendOutput(error.value);
    });
  } catch (e: any) {
    running.value = false;
    error.value = String(e?.message ?? e);
    appendOutput(error.value);
  }
};

const stopDebug = async () => {
  pendingConfiguration.value = false;
  if (configurationTimer !== null) {
    window.clearTimeout(configurationTimer);
    configurationTimer = null;
  }
  await dapClient.stop();
  running.value = false;
  stopped.value = false;
  currentThreadId.value = null;
  appendOutput('debug session stopped');
};

const refreshStack = async (preferredThreadId?: number) => {
  if (!running.value) return;
  try {
    const threadResponse = await dapClient.threads();
    threads.value = threadResponse.threads ?? [];
    const thread = threads.value.find(item => item.id === preferredThreadId) ?? threads.value[0];
    currentThreadId.value = thread?.id ?? preferredThreadId ?? null;
    if (!currentThreadId.value) return;

    const stackResponse = await dapClient.stackTrace(currentThreadId.value);
    stackFrames.value = stackResponse.stackFrames ?? [];
    if (stackFrames.value[0]) await loadScopes(stackFrames.value[0].id);
  } catch (e: any) {
    appendOutput(String(e?.message ?? e));
  }
};

const loadScopes = async (frameId: number) => {
  try {
    const scopeResponse = await dapClient.scopes(frameId);
    scopes.value = scopeResponse.scopes ?? [];
    const scope = scopes.value.find(item => item.variablesReference) ?? scopes.value[0];
    if (scope?.variablesReference) {
      const variableResponse = await dapClient.variables(scope.variablesReference);
      variables.value = variableResponse.variables ?? [];
    } else {
      variables.value = [];
    }
  } catch (e: any) {
    appendOutput(String(e?.message ?? e));
  }
};

const runControl = async (action: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut' | 'restart') => {
  if (!canControl.value && action !== 'restart') return;
  try {
    if (action === 'continue') {
      await dapClient.continue(currentThreadId.value!);
      stopped.value = false;
    } else if (action === 'pause') {
      await dapClient.pause(currentThreadId.value!);
    } else if (action === 'next') {
      await dapClient.next(currentThreadId.value!);
    } else if (action === 'stepIn') {
      await dapClient.stepIn(currentThreadId.value!);
    } else if (action === 'stepOut') {
      await dapClient.stepOut(currentThreadId.value!);
    } else {
      await dapClient.restart();
    }
  } catch (e: any) {
    appendOutput(String(e?.message ?? e));
  }
};

const addBreakpoint = () => {
  const path = breakpointPath.value.trim();
  const line = Number(breakpointLine.value);
  if (!path || !Number.isFinite(line) || line < 1) return;
  if (!breakpoints.value.some(bp => bp.path === path && bp.line === line)) {
    breakpoints.value = [...breakpoints.value, { path, line }];
  }
};

const removeBreakpoint = (index: number) => {
  breakpoints.value = breakpoints.value.filter((_, i) => i !== index);
};

const addActiveBreakpoint = () => {
  if (activeTab.value?.path) {
    breakpointPath.value = activeTab.value.path;
    breakpointLine.value = Math.max(1, store.cursorLine || 1);
    addBreakpoint();
  }
};

const handleDapEvent = (event: Event) => {
  const message = (event as CustomEvent<DapMessage>).detail;
  if (message.type !== 'event') return;
  if (message.event === 'output') {
    const text = String(message.body?.output ?? '').trimEnd();
    if (text) appendOutput(text);
  } else if (message.event === 'stopped') {
    running.value = true;
    stopped.value = true;
    appendOutput(`stopped: ${message.body?.reason ?? 'breakpoint'}`);
    refreshStack(message.body?.threadId);
  } else if (message.event === 'continued') {
    stopped.value = false;
  } else if (message.event === 'initialized') {
    appendOutput('initialized');
    configureSession();
  } else if (message.event === 'terminated' || message.event === 'exited') {
    running.value = false;
    stopped.value = false;
    appendOutput(message.event);
  } else if (message.event) {
    appendOutput(`event: ${message.event}`);
  }
};

watch(selectedAdapter, syncSelectedAdapterCommand);
watch(activeTab, tab => {
  if (!tab) return;
  if (!program.value) program.value = tab.path;
  if (!breakpointPath.value) breakpointPath.value = tab.path;
});

onMounted(() => {
  refreshAdapters();
  if (activeTab.value?.path) {
    program.value = activeTab.value.path;
    breakpointPath.value = activeTab.value.path;
  }
  window.addEventListener('aida:dap-event', handleDapEvent);
});

onUnmounted(() => {
  if (configurationTimer !== null) window.clearTimeout(configurationTimer);
  window.removeEventListener('aida:dap-event', handleDapEvent);
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[1000] flex items-start justify-center pt-10 bg-black/60"
      @mousedown.self="emit('close')"
    >
      <div class="w-[980px] max-w-[calc(100vw-32px)] h-[78vh] flex flex-col bg-[#0e0e14] border border-white/9 rounded-2xl shadow-[0_24px_56px_rgba(0,0,0,0.78)] overflow-hidden">
        <div class="h-11 flex items-center justify-between gap-3 px-4 border-b border-white/6 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <Bug :size="15" class="text-emerald-300/70 shrink-0" />
            <span class="text-[11px] font-bold uppercase tracking-widest text-white/40">Debug</span>
            <span
              class="text-[10px] px-2 py-0.5 rounded-full border shrink-0"
              :class="running ? 'border-emerald-500/25 text-emerald-300/70 bg-emerald-500/8' : 'border-white/8 text-white/25 bg-white/4'"
            >
              {{ running ? (stopped ? 'stopped' : 'running') : 'idle' }}
            </span>
          </div>
          <button
            @click="emit('close')"
            class="p-1.5 rounded text-white/25 hover:text-white/70 hover:bg-white/6 transition-colors"
            title="Close"
          >
            <X :size="14" />
          </button>
        </div>

        <div class="flex-1 grid grid-cols-[310px_minmax(0,1fr)] min-h-0">
          <aside class="border-r border-white/6 p-3 flex flex-col gap-3 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Adapter</span>
              <button
                @click="refreshAdapters"
                class="p-1 rounded text-white/25 hover:text-white/65 hover:bg-white/6 transition-colors"
                title="Refresh adapters"
              >
                <RefreshCw :size="12" />
              </button>
            </div>

            <select
              v-model="selectedAdapter"
              class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 outline-none focus:border-white/20"
            >
              <option value="custom">Custom adapter command</option>
              <option v-for="adapter in adapterStatuses" :key="adapter.id" :value="adapter.id">
                {{ adapter.label }}{{ adapter.available ? '' : ' (missing)' }}
              </option>
            </select>

            <div class="grid grid-cols-[1fr_92px] gap-2">
              <input
                v-model="adapterCommand"
                placeholder="adapter command"
                class="min-w-0 bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
              />
              <select
                v-model="requestType"
                class="bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 outline-none focus:border-white/20"
              >
                <option value="launch">launch</option>
                <option value="attach">attach</option>
              </select>
            </div>
            <input
              v-model="adapterArgsText"
              placeholder="adapter args"
              class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
            />

            <div class="grid gap-2">
              <input
                v-model="program"
                placeholder="program"
                class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
              />
              <input
                v-model="cwd"
                placeholder="cwd"
                class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
              />
              <input
                v-model="programArgs"
                placeholder="program args"
                class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
              />
              <input
                v-if="requestType === 'attach'"
                v-model="processId"
                placeholder="process id"
                class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
              />
              <label class="flex items-center gap-2 text-[11px] text-white/45">
                <input v-model="stopOnEntry" type="checkbox" class="accent-emerald-400" />
                Stop on entry
              </label>
              <textarea
                v-model="extraJson"
                placeholder="{ } extra DAP JSON"
                class="h-20 w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[11px] leading-4 text-white/70 placeholder:text-white/20 outline-none focus:border-white/20 font-mono resize-none"
              ></textarea>
            </div>

            <div class="flex gap-2">
              <button
                @click="startDebug"
                :disabled="running"
                class="flex-1 h-8 rounded-lg bg-emerald-300 text-black text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-200 disabled:opacity-30 transition-colors"
              >
                <Play :size="12" />
                Start
              </button>
              <button
                @click="stopDebug"
                :disabled="!running"
                class="h-8 px-3 rounded-lg bg-white/6 text-white/55 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-white/10 disabled:opacity-30 transition-colors"
                title="Stop"
              >
                <Square :size="12" />
              </button>
            </div>

            <div v-if="error" class="text-[11px] text-rose-300 bg-rose-500/8 border border-rose-500/20 rounded-lg px-2 py-1.5 break-all">
              {{ error }}
            </div>

            <div class="flex items-center justify-between gap-2 pt-1">
              <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Adapters</span>
              <span class="text-[10px] text-white/25">{{ availableAdapters.length }}/{{ adapterStatuses.length }}</span>
            </div>
            <div class="grid gap-1">
              <div
                v-for="adapter in adapterStatuses"
                :key="adapter.id"
                class="rounded-lg border border-white/6 bg-white/3 px-2 py-1.5"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] text-white/55 truncate">{{ adapter.label }}</span>
                  <span
                    class="text-[9px] font-bold uppercase shrink-0"
                    :class="adapter.available ? 'text-emerald-300/70' : 'text-white/18'"
                  >
                    {{ adapter.available ? 'ready' : 'missing' }}
                  </span>
                </div>
                <div class="text-[10px] text-white/22 font-mono truncate">{{ adapter.command || adapter.source || adapter.languages.join(', ') }}</div>
              </div>
            </div>
          </aside>

          <main class="min-w-0 min-h-0 flex flex-col">
            <div class="h-11 flex items-center gap-2 px-3 border-b border-white/6 shrink-0">
              <button
                @click="runControl('continue')"
                :disabled="!canControl"
                class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors flex items-center gap-1 text-[11px]"
                title="Continue"
              >
                <Play :size="12" />
                Continue
              </button>
              <button
                @click="runControl('pause')"
                :disabled="!canControl"
                class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors flex items-center gap-1 text-[11px]"
                title="Pause"
              >
                <Pause :size="12" />
                Pause
              </button>
              <button @click="runControl('next')" :disabled="!canControl" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors text-[11px]">Over</button>
              <button @click="runControl('stepIn')" :disabled="!canControl" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors text-[11px]">In</button>
              <button @click="runControl('stepOut')" :disabled="!canControl" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors text-[11px]">Out</button>
              <button
                @click="runControl('restart')"
                :disabled="!running"
                class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors flex items-center gap-1 text-[11px]"
                title="Restart"
              >
                <RotateCw :size="12" />
                Restart
              </button>
            </div>

            <div class="flex-1 grid grid-cols-[minmax(0,1fr)_260px] min-h-0">
              <section class="min-w-0 min-h-0 flex flex-col border-r border-white/6">
                <div class="p-3 border-b border-white/6 shrink-0">
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Breakpoints</span>
                    <button
                      @click="addActiveBreakpoint"
                      class="text-[10px] text-emerald-300/55 hover:text-emerald-200 transition-colors"
                    >
                      add active
                    </button>
                  </div>
                  <div class="grid grid-cols-[1fr_72px_30px] gap-2">
                    <input
                      v-model="breakpointPath"
                      placeholder="file path"
                      class="min-w-0 bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
                    />
                    <input
                      v-model.number="breakpointLine"
                      type="number"
                      min="1"
                      class="bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 outline-none focus:border-white/20"
                    />
                    <button
                      @click="addBreakpoint"
                      class="rounded-lg bg-white/6 hover:bg-white/10 text-white/55 transition-colors flex items-center justify-center"
                      title="Add breakpoint"
                    >
                      <Plus :size="12" />
                    </button>
                  </div>
                  <div class="mt-2 max-h-24 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
                    <div
                      v-for="(bp, index) in breakpoints"
                      :key="`${bp.path}:${bp.line}`"
                      class="flex items-center gap-2 px-1 py-1 rounded hover:bg-white/4"
                    >
                      <ChevronRight :size="11" class="text-emerald-300/40 shrink-0" />
                      <span class="text-[11px] text-white/50 font-mono truncate flex-1">{{ bp.path }}:{{ bp.line }}</span>
                      <button
                        @click="removeBreakpoint(index)"
                        class="p-1 rounded text-white/22 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                        title="Remove breakpoint"
                      >
                        <Trash2 :size="11" />
                      </button>
                    </div>
                    <div v-if="!breakpoints.length" class="text-[11px] text-white/20 italic px-1 py-2">No breakpoints</div>
                  </div>
                </div>

                <div class="grid grid-cols-2 flex-1 min-h-0">
                  <div class="min-w-0 min-h-0 border-r border-white/6 flex flex-col">
                    <div class="px-3 py-2 border-b border-white/6 text-[10px] font-bold uppercase tracking-wide text-white/28 shrink-0">Call Stack</div>
                    <div class="flex-1 overflow-y-auto p-2" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
                      <button
                        v-for="frame in stackFrames"
                        :key="frame.id"
                        @click="loadScopes(frame.id)"
                        class="w-full text-left rounded-lg px-2 py-1.5 hover:bg-white/5 transition-colors"
                      >
                        <div class="text-[11px] text-white/60 truncate">{{ frame.name }}</div>
                        <div class="text-[10px] text-white/25 font-mono truncate">{{ frame.source?.path || frame.source?.name || 'unknown' }}:{{ frame.line }}</div>
                      </button>
                      <div v-if="!stackFrames.length" class="text-[11px] text-white/20 italic px-2 py-4">No frames</div>
                    </div>
                  </div>

                  <div class="min-w-0 min-h-0 flex flex-col">
                    <div class="px-3 py-2 border-b border-white/6 text-[10px] font-bold uppercase tracking-wide text-white/28 shrink-0">Variables</div>
                    <div class="flex-1 overflow-y-auto p-2" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
                      <div
                        v-for="scope in scopes"
                        :key="scope.name"
                        class="text-[10px] text-white/28 uppercase tracking-wide px-1 py-1"
                      >
                        {{ scope.name }}
                      </div>
                      <div
                        v-for="variable in variables"
                        :key="`${variable.name}:${variable.value}`"
                        class="grid grid-cols-[100px_minmax(0,1fr)] gap-2 px-1 py-1 rounded hover:bg-white/4"
                      >
                        <span class="text-[11px] text-white/45 font-mono truncate">{{ variable.name }}</span>
                        <span class="text-[11px] text-white/62 font-mono truncate">{{ variable.value }}</span>
                      </div>
                      <div v-if="!variables.length" class="text-[11px] text-white/20 italic px-2 py-4">No variables</div>
                    </div>
                  </div>
                </div>
              </section>

              <section class="min-w-0 min-h-0 flex flex-col">
                <div class="px-3 py-2 border-b border-white/6 text-[10px] font-bold uppercase tracking-wide text-white/28 shrink-0">Output</div>
                <pre class="flex-1 overflow-auto p-3 text-[11px] leading-5 text-white/55 font-mono whitespace-pre-wrap" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">{{ output.join('\n') }}</pre>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  </Teleport>
</template>
