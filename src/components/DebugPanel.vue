<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Bug,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Eye,
  FileCode2,
  Info,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-vue-next';
import { dapClient, getDapAdapterProbes, joinCommandLine, splitCommandLine, type DapAdapterStatus, type DapMessage } from '../lib/dap';
import { useEditorStore } from '../stores/editor';
import { isCode } from '../lib/shortcuts';

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

type VariableNode = {
  name: string; value: string; type?: string;
  variablesReference: number;
  expanded?: boolean;
  children?: VariableNode[];
  loading?: boolean;
};
const variableTree = ref<VariableNode[]>([]);

const watchExpressions = ref<{ expr: string; value: string; error?: boolean }[]>([]);
const watchInput = ref('');
const watchInputEl = ref<HTMLInputElement | null>(null);
const mainTab = ref<'variables' | 'watch' | 'output'>('variables');

const activeTab = computed(() => {
  const windowState = store.getActiveWindow();
  return windowState?.tabs.find(tab => tab.path === windowState.activeTabPath) ?? null;
});

const selectedStatus = computed(() => adapterStatuses.value.find(item => item.id === selectedAdapter.value));
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
      variableTree.value = variables.value.map(v => ({
        name: v.name, value: v.value, type: v.type,
        variablesReference: v.variablesReference ?? 0,
      }));
    } else {
      variables.value = [];
      variableTree.value = [];
    }
  } catch (e: any) {
    appendOutput(String(e?.message ?? e));
  }
};

const expandVariable = async (node: VariableNode) => {
  if (!node.variablesReference) return;
  if (node.expanded) { node.expanded = false; return; }
  if (node.children) { node.expanded = true; return; }
  node.loading = true;
  try {
    const resp = await dapClient.variables(node.variablesReference);
    node.children = (resp.variables ?? []).map((v: any) => ({
      name: v.name, value: v.value, type: v.type,
      variablesReference: v.variablesReference ?? 0,
    }));
    node.expanded = true;
  } catch { node.children = []; }
  node.loading = false;
};

const addWatch = async () => {
  const expr = watchInput.value.trim();
  if (!expr) return;
  watchInput.value = '';
  const entry = { expr, value: '…', error: false };
  watchExpressions.value.push(entry);
  if (running.value && currentThreadId.value !== null) {
    try {
      const frames = await dapClient.stackTrace(currentThreadId.value);
      const frameId = frames.stackFrames?.[0]?.id;
      if (frameId != null) {
        const resp = await dapClient.evaluate(expr, frameId).catch((e: any) => ({ result: String(e), success: false }));
        entry.value = resp?.result ?? '?';
        entry.error = resp?.success === false;
      }
    } catch (e: any) { entry.value = String(e); entry.error = true; }
  } else {
    entry.value = 'not running';
  }
};

const removeWatch = (idx: number) => { watchExpressions.value.splice(idx, 1); };

const navigateToBreakpoint = (bp: { path: string; line: number }) => {
  if (!bp.path) return;
  store.revealLocation(bp.path, bp.line, 0);
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

const handleKeys = (event: KeyboardEvent) => {
  if (isCode(event, 'F5')) {
    event.preventDefault();
    if (event.shiftKey) void stopDebug();
    else if (running.value) void runControl('continue');
    else void startDebug();
  } else if (isCode(event, 'F10')) {
    event.preventDefault();
    void runControl('next');
  } else if (isCode(event, 'F11')) {
    event.preventDefault();
    void runControl(event.shiftKey ? 'stepOut' : 'stepIn');
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
  window.addEventListener('keydown', handleKeys);
});

onUnmounted(() => {
  if (configurationTimer !== null) window.clearTimeout(configurationTimer);
  window.removeEventListener('aida:dap-event', handleDapEvent);
  window.removeEventListener('keydown', handleKeys);
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[1000] flex items-start justify-center pt-10 bg-black/60"
      @mousedown.self="emit('close')"
    >
      <div class="w-[1120px] max-w-[calc(100vw-32px)] h-[82vh] flex flex-col bg-[#0e0e14] border border-white/9 rounded-2xl shadow-[0_24px_56px_rgba(0,0,0,0.78)] overflow-hidden">
        <div class="h-11 flex items-center justify-between gap-3 px-4 border-b border-white/6 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <Bug :size="15" class="text-emerald-300/70 shrink-0" />
            <span class="text-[11px] font-bold uppercase tracking-widest text-white/40">Debug</span>
            <span class="hidden sm:inline text-[10px] text-white/22 truncate">adapters, breakpoints, stack and variables</span>
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

        <div class="flex-1 grid grid-cols-[340px_minmax(0,1fr)] min-h-0">
          <!-- LEFT SIDEBAR: Configuration -->
          <aside class="border-r border-white/6 flex flex-col min-h-0 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">

            <!-- Adapter selector -->
            <div class="p-3 border-b border-white/6 flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <Layers :size="11" class="text-white/30" />
                  <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Adapter</span>
                  <span class="text-[9px] text-white/18 bg-white/5 rounded px-1" title="A debug adapter speaks DAP protocol and communicates with the runtime (e.g., node --inspect, lldb-vscode)">?</span>
                </div>
                <button @click="refreshAdapters" class="p-1 rounded text-white/25 hover:text-white/65 hover:bg-white/6 transition-colors" title="Refresh adapter list">
                  <RefreshCw :size="11" />
                </button>
              </div>
              <select v-model="selectedAdapter" class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 outline-none focus:border-white/20">
                <option value="custom">Custom adapter command</option>
                <option v-for="adapter in adapterStatuses" :key="adapter.id" :value="adapter.id">
                  {{ adapter.label }}{{ adapter.available ? '' : ' (missing)' }}
                </option>
              </select>
              <div class="grid grid-cols-2 gap-1">
                <div
                  v-for="adapter in adapterStatuses.slice(0,4)"
                  :key="adapter.id"
                  class="rounded-lg border px-2 py-1.5 cursor-pointer transition-colors"
                  :class="adapter.available
                    ? (selectedAdapter === adapter.id ? 'border-emerald-300/30 bg-emerald-400/8 text-emerald-300/75' : 'border-white/7 bg-white/3 text-white/45 hover:border-white/12')
                    : 'border-white/4 bg-white/1 text-white/20 cursor-default'"
                  @click="adapter.available && (selectedAdapter = adapter.id)"
                >
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-[10px] truncate">{{ adapter.label }}</span>
                    <span class="text-[8px] font-bold" :class="adapter.available ? 'text-emerald-300/60' : 'text-white/18'">
                      {{ adapter.available ? '●' : '○' }}
                    </span>
                  </div>
                  <div class="text-[9px] text-white/22 font-mono truncate">{{ adapter.languages.join(', ') }}</div>
                </div>
              </div>
            </div>

            <!-- Launch config -->
            <div class="p-3 border-b border-white/6 flex flex-col gap-2">
              <div class="flex items-center gap-1.5 mb-0.5">
                <FileCode2 :size="11" class="text-white/30" />
                <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Launch Config</span>
              </div>
              <div class="grid grid-cols-[1fr_88px] gap-2">
                <input v-model="adapterCommand" placeholder="adapter command" class="min-w-0 bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20" />
                <select v-model="requestType" class="bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 outline-none focus:border-white/20">
                  <option value="launch">launch</option>
                  <option value="attach">attach</option>
                </select>
              </div>
              <input v-model="adapterArgsText" placeholder="adapter args (space-separated)" class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20" />
              <input v-model="program" placeholder="program path" class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20" />
              <input v-model="cwd" placeholder="working directory" class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20" />
              <input v-model="programArgs" placeholder="program args" class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20" />
              <input v-if="requestType === 'attach'" v-model="processId" placeholder="process id or name" class="w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20" />
              <label class="flex items-center gap-2 text-[11px] text-white/45">
                <input v-model="stopOnEntry" type="checkbox" class="accent-emerald-400" />
                Stop on entry
                <span class="text-[9px] text-white/20" title="Pause immediately on program start, before any user code runs">(?)</span>
              </label>
              <textarea v-model="extraJson" placeholder='{ "env": { "NODE_ENV": "development" } }' class="h-16 w-full bg-black/25 border border-white/8 rounded-lg px-2 py-1.5 text-[11px] leading-4 text-white/70 placeholder:text-white/20 outline-none focus:border-white/20 font-mono resize-none"></textarea>
            </div>

            <!-- Control buttons -->
            <div class="p-3 flex flex-col gap-2">
              <div class="flex gap-2">
                <button @click="startDebug" :disabled="running" class="flex-1 h-8 rounded-lg bg-emerald-300 text-black text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-200 disabled:opacity-30 transition-colors">
                  <Play :size="12" /> Start
                </button>
                <button @click="stopDebug" :disabled="!running" class="h-8 px-3 rounded-lg bg-white/6 text-white/55 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-white/10 disabled:opacity-30 transition-colors" title="Stop (Shift+F5)">
                  <Square :size="12" />
                </button>
              </div>
              <div v-if="error" class="text-[11px] text-rose-300 bg-rose-500/8 border border-rose-500/20 rounded-lg px-2 py-1.5 break-all">{{ error }}</div>

              <!-- Keyboard shortcuts hint -->
              <div class="rounded-lg bg-white/3 border border-white/6 p-2">
                <div class="text-[9px] font-bold uppercase tracking-wide text-white/22 mb-1.5">Keyboard shortcuts</div>
                <div class="flex flex-wrap gap-1">
                  <span class="rounded bg-black/30 border border-white/6 px-1.5 py-0.5 text-[9px] text-white/35">F5 run</span>
                  <span class="rounded bg-black/30 border border-white/6 px-1.5 py-0.5 text-[9px] text-white/35">Shift+F5 stop</span>
                  <span class="rounded bg-black/30 border border-white/6 px-1.5 py-0.5 text-[9px] text-white/35">F10 step over</span>
                  <span class="rounded bg-black/30 border border-white/6 px-1.5 py-0.5 text-[9px] text-white/35">F11 step in</span>
                  <span class="rounded bg-black/30 border border-white/6 px-1.5 py-0.5 text-[9px] text-white/35">Shift+F11 step out</span>
                </div>
              </div>
            </div>
          </aside>

          <!-- RIGHT MAIN: Breakpoints, Stack, Variables, Watch, Output -->
          <main class="min-w-0 min-h-0 flex flex-col">

            <!-- Debug toolbar -->
            <div class="h-10 flex items-center gap-1 px-3 border-b border-white/6 shrink-0 bg-black/10">
              <button @click="runControl('continue')" :disabled="!canControl" class="h-7 px-2.5 rounded bg-white/6 hover:bg-emerald-500/15 hover:text-emerald-300 text-white/55 disabled:opacity-30 transition-colors flex items-center gap-1.5 text-[11px]" title="Continue (F5)">
                <Play :size="11" /> Continue
              </button>
              <button @click="runControl('pause')" :disabled="!canControl" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors flex items-center gap-1 text-[11px]" title="Pause">
                <Pause :size="11" /> Pause
              </button>
              <div class="w-px h-4 bg-white/8 mx-0.5"></div>
              <button @click="runControl('next')" :disabled="!canControl" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors text-[11px]" title="Step Over (F10)">Over</button>
              <button @click="runControl('stepIn')" :disabled="!canControl" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors text-[11px]" title="Step Into (F11)">In</button>
              <button @click="runControl('stepOut')" :disabled="!canControl" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors text-[11px]" title="Step Out (Shift+F11)">Out</button>
              <div class="w-px h-4 bg-white/8 mx-0.5"></div>
              <button @click="runControl('restart')" :disabled="!running" class="h-7 px-2 rounded bg-white/6 hover:bg-white/10 text-white/55 disabled:opacity-30 transition-colors flex items-center gap-1 text-[11px]" title="Restart">
                <RotateCw :size="11" /> Restart
              </button>
            </div>

            <div class="flex-1 grid grid-cols-[minmax(0,1fr)_240px] min-h-0">

              <!-- Center: Breakpoints + Call Stack -->
              <section class="min-w-0 min-h-0 flex flex-col border-r border-white/6">

                <!-- Breakpoints -->
                <div class="p-2.5 border-b border-white/6 shrink-0">
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="flex items-center gap-1.5">
                      <CircleDot :size="11" class="text-rose-400/70" />
                      <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Breakpoints</span>
                      <span class="text-[9px] text-white/18 bg-white/5 rounded px-1" title="Program will pause execution when reaching these lines">?</span>
                    </div>
                    <button @click="addActiveBreakpoint" class="text-[10px] text-emerald-300/55 hover:text-emerald-200 transition-colors" title="Add breakpoint at current cursor position">
                      + from cursor
                    </button>
                  </div>
                  <div class="grid grid-cols-[1fr_64px_28px] gap-1.5 mb-2">
                    <input v-model="breakpointPath" placeholder="file path" class="min-w-0 bg-black/25 border border-white/8 rounded-lg px-2 py-1 text-[11px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20" />
                    <input v-model.number="breakpointLine" type="number" min="1" class="bg-black/25 border border-white/8 rounded-lg px-2 py-1 text-[11px] text-white/70 outline-none focus:border-white/20" />
                    <button @click="addBreakpoint" class="rounded-lg bg-white/6 hover:bg-white/10 text-white/55 transition-colors flex items-center justify-center" title="Add breakpoint">
                      <Plus :size="11" />
                    </button>
                  </div>
                  <div class="max-h-28 overflow-y-auto space-y-0.5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
                    <div
                      v-for="(bp, index) in breakpoints"
                      :key="`${bp.path}:${bp.line}`"
                      class="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-white/4 group"
                    >
                      <CircleDot :size="10" class="text-rose-400/60 shrink-0" />
                      <button class="flex-1 text-left min-w-0" @click="navigateToBreakpoint(bp)" title="Navigate to this breakpoint in editor">
                        <span class="text-[10px] text-white/48 font-mono truncate block hover:text-white/70 transition-colors">
                          {{ bp.path.split(/[\\/]/).pop() }}:{{ bp.line }}
                        </span>
                        <span class="text-[9px] text-white/22 font-mono truncate block">{{ bp.path }}</span>
                      </button>
                      <button @click="removeBreakpoint(index)" class="p-0.5 rounded text-white/20 hover:text-rose-300 hover:bg-rose-500/10 transition-colors hidden group-hover:block" title="Remove">
                        <Trash2 :size="10" />
                      </button>
                    </div>
                    <div v-if="!breakpoints.length" class="text-[11px] text-white/20 italic px-1.5 py-2">No breakpoints</div>
                  </div>
                </div>

                <!-- Call Stack -->
                <div class="min-h-0 flex-1 flex flex-col">
                  <div class="px-2.5 py-2 border-b border-white/6 text-[10px] font-bold uppercase tracking-wide text-white/28 shrink-0 flex items-center gap-1.5">
                    <Layers :size="10" class="text-white/25" />
                    Call Stack
                    <span class="text-[9px] text-white/18 bg-white/5 rounded px-1" title="Function call hierarchy — click a frame to inspect variables at that scope">?</span>
                  </div>
                  <div class="flex-1 overflow-y-auto p-1.5 space-y-0.5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
                    <button
                      v-for="frame in stackFrames"
                      :key="frame.id"
                      @click="loadScopes(frame.id)"
                      class="w-full text-left rounded px-2 py-1.5 hover:bg-white/5 transition-colors"
                    >
                      <div class="text-[11px] text-white/62 truncate font-mono">{{ frame.name }}</div>
                      <div class="text-[9px] text-white/28 font-mono truncate">{{ frame.source?.path?.split(/[\\/]/).pop() || frame.source?.name || 'unknown' }}:{{ frame.line }}</div>
                    </button>
                    <div v-if="!stackFrames.length" class="text-[11px] text-white/20 italic px-2 py-4">
                      {{ running ? 'Paused: no frames' : 'Not paused' }}
                    </div>
                  </div>
                </div>
              </section>

              <!-- Right column: tabbed Variables/Watch/Output -->
              <section class="min-w-0 min-h-0 flex flex-col">

                <!-- Tabs -->
                <div class="h-9 flex items-center border-b border-white/6 shrink-0 bg-black/10">
                  <button class="flex-1 h-full flex items-center justify-center gap-1 text-[10px] transition-colors" :class="mainTab === 'variables' ? 'text-white/60 bg-white/5' : 'text-white/25 hover:text-white/45'" @click="mainTab = 'variables'">
                    <Info :size="10" /> Vars
                  </button>
                  <button class="flex-1 h-full flex items-center justify-center gap-1 text-[10px] transition-colors" :class="mainTab === 'watch' ? 'text-white/60 bg-white/5' : 'text-white/25 hover:text-white/45'" @click="mainTab = 'watch'">
                    <Eye :size="10" /> Watch
                  </button>
                  <button class="flex-1 h-full flex items-center justify-center gap-1 text-[10px] transition-colors" :class="mainTab === 'output' ? 'text-white/60 bg-white/5' : 'text-white/25 hover:text-white/45'" @click="mainTab = 'output'">
                    <Terminal :size="10" /> Output
                  </button>
                </div>

                <!-- Variables tab -->
                <div v-if="mainTab === 'variables'" class="flex-1 overflow-y-auto p-1.5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
                  <div v-if="scopes.length" class="mb-1 px-1.5 text-[9px] font-bold uppercase tracking-wide text-white/22">
                    {{ scopes.map(s => s.name).join(' · ') }}
                  </div>
                  <!-- Variable tree nodes -->
                  <template v-for="node in variableTree" :key="`${node.name}:${node.value}`">
                    <div
                      class="flex items-start gap-1 px-1.5 py-1 rounded hover:bg-white/4 cursor-pointer"
                      @click="expandVariable(node)"
                    >
                      <component :is="node.variablesReference ? (node.expanded ? ChevronDown : ChevronRight) : 'span'" :size="10" class="text-white/25 shrink-0 mt-0.5 w-3" />
                      <span class="text-[10px] text-white/45 font-mono truncate min-w-[72px] max-w-[72px] shrink-0">{{ node.name }}</span>
                      <span class="text-[10px] text-white/62 font-mono truncate flex-1 break-all">{{ node.value }}</span>
                      <span v-if="node.type" class="text-[8px] text-white/20 shrink-0 ml-1">{{ node.type }}</span>
                    </div>
                    <!-- Children -->
                    <div v-if="node.expanded && node.children" class="pl-4 border-l border-white/6 ml-2.5">
                      <div
                        v-for="child in node.children"
                        :key="`${child.name}:${child.value}`"
                        class="flex items-start gap-1 px-1.5 py-0.5 rounded hover:bg-white/4 cursor-pointer"
                        @click="expandVariable(child)"
                      >
                        <component :is="child.variablesReference ? (child.expanded ? ChevronDown : ChevronRight) : 'span'" :size="9" class="text-white/20 shrink-0 mt-0.5 w-3" />
                        <span class="text-[10px] text-white/40 font-mono truncate min-w-[64px] max-w-[64px] shrink-0">{{ child.name }}</span>
                        <span class="text-[10px] text-white/58 font-mono truncate flex-1">{{ child.value }}</span>
                      </div>
                    </div>
                  </template>
                  <div v-if="!variableTree.length" class="text-[11px] text-white/20 italic px-2 py-4 text-center">
                    {{ running && stopped ? 'No variables in scope' : 'Pause to inspect variables' }}
                  </div>
                </div>

                <!-- Watch tab -->
                <div v-else-if="mainTab === 'watch'" class="flex-1 flex flex-col min-h-0">
                  <div class="p-2 border-b border-white/6 shrink-0">
                    <div class="flex items-center gap-1.5 text-[9px] text-white/22 mb-2">
                      <Eye :size="9" />
                      <span>Evaluate expressions while paused</span>
                    </div>
                    <div class="flex gap-1.5">
                      <input
                        ref="watchInputEl"
                        v-model="watchInput"
                        placeholder="expression (e.g. user.id)"
                        class="flex-1 min-w-0 bg-black/25 border border-white/8 rounded-lg px-2 py-1 text-[11px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/20"
                        @keydown.enter.prevent="addWatch"
                      />
                      <button @click="addWatch" class="h-7 px-2 rounded-lg bg-white/6 hover:bg-white/10 text-white/55 transition-colors" title="Add watch expression">
                        <Plus :size="11" />
                      </button>
                    </div>
                  </div>
                  <div class="flex-1 overflow-y-auto p-1.5 space-y-0.5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
                    <div
                      v-for="(w, wi) in watchExpressions"
                      :key="wi"
                      class="flex items-start gap-1.5 px-1.5 py-1 rounded hover:bg-white/4 group"
                    >
                      <Eye :size="10" class="text-white/25 shrink-0 mt-0.5" />
                      <div class="flex-1 min-w-0">
                        <div class="text-[10px] text-sky-300/65 font-mono truncate">{{ w.expr }}</div>
                        <div class="text-[10px] font-mono truncate" :class="w.error ? 'text-rose-300/65' : 'text-white/62'">{{ w.value }}</div>
                      </div>
                      <button @click="removeWatch(wi)" class="hidden group-hover:block p-0.5 rounded text-white/20 hover:text-rose-300" title="Remove watch">
                        <X :size="9" />
                      </button>
                    </div>
                    <div v-if="!watchExpressions.length" class="text-[11px] text-white/20 italic px-2 py-4 text-center">Add an expression above</div>
                  </div>
                </div>

                <!-- Output tab -->
                <div v-else class="flex-1 min-h-0 flex flex-col">
                  <pre class="flex-1 overflow-auto p-2.5 text-[10px] leading-5 text-white/50 font-mono whitespace-pre-wrap" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">{{ output.join('\n') || '(no output)' }}</pre>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  </Teleport>
</template>
