<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { DEFAULT_KEYBINDINGS, useEditorStore } from '../stores/editor';
import { lspClient } from '../lib/lsp';
import { Keyboard, Monitor, Palette, RefreshCw, Server, Type, X } from 'lucide-vue-next';

const store = useEditorStore();
const emit = defineEmits(['close']);
const checkingLsp = ref(false);
const activeTab = ref<'editor' | 'theme' | 'shortcuts' | 'lsp'>('editor');
const capturingKey = ref<string | null>(null);

const fontFamilies = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
  { label: 'Consolas', value: "'Consolas', monospace" },
  { label: 'Courier New', value: "'Courier New', monospace" },
];

const keyBindingRows = [
  ['command-palette', 'Command Palette'],
  ['save-file', 'Save File'],
  ['new-file', 'New File'],
  ['maximize-window', 'Maximize Window'],
  ['go-to-line', 'Go to Line'],
  ['toggle-sidebar', 'Toggle Sidebar'],
  ['open-search', 'Find in Files'],
  ['open-problems', 'Problems Panel'],
  ['open-tasks', 'Run Task'],
  ['open-debug', 'Debugger'],
  ['open-browser', 'Browser Window'],
  ['open-api', 'API Client'],
  ['open-visual', 'Visual Builder'],
  ['toggle-terminal', 'Toggle Terminal'],
  ['next-file', 'Next File Tab'],
  ['prev-file', 'Previous File Tab'],
  ['lsp-definition', 'Go to Definition'],
  ['lsp-references', 'Find References'],
  ['lsp-rename', 'Rename Symbol'],
  ['lsp-actions', 'Code Actions'],
  ['lsp-format', 'Format Document'],
] as const;

const resetKeybindings = () => {
  store.settings.keybindings = { ...DEFAULT_KEYBINDINGS };
};

const startCapture = (id: string) => {
  capturingKey.value = id;
};

const stopCapture = () => {
  capturingKey.value = null;
};

const handleKeyCapture = (e: KeyboardEvent) => {
  if (!capturingKey.value) return;
  if (e.key === 'Escape') {
    stopCapture();
    return;
  }
  const modifiers = ['Control', 'Meta', 'Alt', 'Shift'];
  if (modifiers.includes(e.key)) return;

  e.preventDefault();
  e.stopPropagation();

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  parts.push(key);

  store.settings.keybindings[capturingKey.value] = parts.join('+');
  stopCapture();
};

const checkLsp = async () => {
  checkingLsp.value = true;
  try {
    store.setLspStatuses(await lspClient.checkServers(store.currentProject));
  } finally {
    checkingLsp.value = false;
  }
};

onMounted(() => {
  checkLsp();
  window.addEventListener('keydown', handleKeyCapture, { capture: true });
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyCapture, { capture: true });
});
</script>

<template>
  <div class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" @click.self="emit('close')">
    <div class="w-[960px] max-w-[calc(100vw-24px)] h-[82vh] flex flex-col bg-[#0f0f13] border border-white/8 rounded-2xl shadow-2xl overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/6 bg-white/[0.02] shrink-0">
        <div class="flex items-center gap-3">
          <Monitor :size="15" class="text-white/40" />
          <span class="text-[13px] font-semibold text-white/85 tracking-tight">Settings</span>
        </div>
        <button @click="emit('close')" class="p-1.5 rounded-lg text-white/32 hover:text-white/75 hover:bg-white/7 transition-colors">
          <X :size="15" />
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1 px-5 pt-3 border-b border-white/5 shrink-0 bg-[#0f0f13]">
        <button
          v-for="[id, label] in [['editor','Editor'],['theme','Theme'],['shortcuts','Shortcuts'],['lsp','Language Servers']]"
          :key="id"
          @click="activeTab = id as any"
          class="flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold rounded-t-lg transition-colors border border-b-0"
          :class="activeTab === id
            ? 'bg-[#18181f] border-white/10 text-white/85'
            : 'border-transparent text-white/35 hover:text-white/60 hover:bg-white/4'"
        >
          {{ label }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 bg-[#0f0f13]" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">

        <!-- EDITOR TAB -->
        <div v-if="activeTab === 'editor'" class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-4 rounded-xl border border-white/7 bg-white/[0.025] p-4">
            <div class="flex items-center gap-2">
              <Type :size="12" class="text-white/35" />
              <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Font</span>
            </div>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[11px] text-white/55">Family</label>
                <select v-model="store.settings.fontFamily" class="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white/75 outline-none focus:border-white/25">
                  <option v-for="f in fontFamilies" :key="f.value" :value="f.value">{{ f.label }}</option>
                </select>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[11px] text-white/55">Size: {{ store.settings.fontSize }}px</label>
                <input type="range" v-model.number="store.settings.fontSize" min="10" max="24" step="1" class="accent-emerald-400" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[11px] text-white/55">Tab Size</label>
                <select v-model.number="store.settings.tabSize" class="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white/75 outline-none focus:border-white/25">
                  <option :value="2">2 spaces</option>
                  <option :value="4">4 spaces</option>
                  <option :value="8">8 spaces</option>
                </select>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-xl border border-white/7 bg-white/[0.025] p-4">
            <div class="flex items-center gap-2">
              <Keyboard :size="12" class="text-white/35" />
              <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Behavior</span>
            </div>
            <div class="flex flex-col gap-4">
              <label class="flex items-center justify-between cursor-pointer">
                <div>
                  <div class="text-[12px] text-white/75">Word Wrap</div>
                  <div class="text-[10px] text-white/35">Wrap long lines</div>
                </div>
                <div @click="store.settings.wordWrap = !store.settings.wordWrap"
                  class="w-9 h-5 rounded-full transition-colors relative cursor-pointer"
                  :class="store.settings.wordWrap ? 'bg-emerald-400' : 'bg-white/12'">
                  <div class="w-3.5 h-3.5 bg-white rounded-full absolute transition-all" style="top:3px;left:3px"
                    :style="store.settings.wordWrap ? {transform:'translateX(16px)'} : {}"></div>
                </div>
              </label>
              <label class="flex items-center justify-between cursor-pointer">
                <div>
                  <div class="text-[12px] text-white/75">Vim Mode</div>
                  <div class="text-[10px] text-white/35">Vim keybindings in editor</div>
                </div>
                <div @click="store.settings.vimEnabled = !store.settings.vimEnabled"
                  class="w-9 h-5 rounded-full transition-colors relative cursor-pointer"
                  :class="store.settings.vimEnabled ? 'bg-emerald-400' : 'bg-white/12'">
                  <div class="w-3.5 h-3.5 bg-white rounded-full absolute transition-all" style="top:3px;left:3px"
                    :style="store.settings.vimEnabled ? {transform:'translateX(16px)'} : {}"></div>
                </div>
              </label>
            </div>
          </div>
        </div>

        <!-- THEME TAB -->
        <div v-else-if="activeTab === 'theme'" class="flex flex-col gap-4">
          <div class="rounded-xl border border-white/7 bg-white/[0.025] p-5">
            <div class="flex items-center gap-2 mb-4">
              <Palette :size="12" class="text-white/35" />
              <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Colors</span>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <label class="flex flex-col gap-2">
                <span class="text-[11px] text-white/55">Accent Color</span>
                <div class="flex items-center gap-2">
                  <input v-model="store.settings.accentColor" type="color" class="h-9 w-12 rounded bg-transparent border border-white/10 p-1 cursor-pointer" />
                  <span class="text-[11px] font-mono text-white/45">{{ store.settings.accentColor }}</span>
                </div>
              </label>
              <label class="flex flex-col gap-2">
                <span class="text-[11px] text-white/55">Background</span>
                <div class="flex items-center gap-2">
                  <input v-model="store.settings.backgroundColor" type="color" class="h-9 w-12 rounded bg-transparent border border-white/10 p-1 cursor-pointer" />
                  <span class="text-[11px] font-mono text-white/45">{{ store.settings.backgroundColor }}</span>
                </div>
              </label>
              <label class="flex flex-col gap-2">
                <span class="text-[11px] text-white/55">Panels</span>
                <div class="flex items-center gap-2">
                  <input v-model="store.settings.panelColor" type="color" class="h-9 w-12 rounded bg-transparent border border-white/10 p-1 cursor-pointer" />
                  <span class="text-[11px] font-mono text-white/45">{{ store.settings.panelColor }}</span>
                </div>
              </label>
            </div>
            <div class="mt-4 rounded-xl border border-white/7 bg-black/20 p-4 flex items-center gap-4">
              <div class="h-8 w-8 rounded-lg" :style="{background: store.settings.accentColor}"></div>
              <div class="h-8 w-8 rounded-lg border border-white/10" :style="{background: store.settings.backgroundColor}"></div>
              <div class="h-8 w-8 rounded-lg border border-white/10" :style="{background: store.settings.panelColor}"></div>
              <span class="text-[11px] text-white/35">Color preview</span>
            </div>
          </div>
        </div>

        <!-- SHORTCUTS TAB -->
        <div v-else-if="activeTab === 'shortcuts'" class="flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <p class="text-[11px] text-white/35">Click a shortcut field and press the key combination to assign it. Press Escape to cancel.</p>
            <button @click="resetKeybindings" class="rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 text-[11px] text-white/45 hover:text-white/75 hover:bg-white/8 transition-colors">
              Reset All
            </button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="[id, action] in keyBindingRows"
              :key="id"
              class="flex items-center justify-between gap-2 py-2 px-3 rounded-xl border transition-colors"
              :class="capturingKey === id ? 'border-emerald-300/35 bg-emerald-400/8' : 'border-white/6 bg-white/[0.025]'"
            >
              <span class="text-[11px] text-white/58 truncate min-w-0">{{ action }}</span>
              <button
                @click="capturingKey === id ? stopCapture() : startCapture(id)"
                class="shrink-0 min-w-[110px] text-right rounded-lg border px-2.5 py-1 text-[10px] font-mono transition-colors"
                :class="capturingKey === id
                  ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-200 animate-pulse'
                  : 'border-white/10 bg-black/25 text-white/55 hover:border-white/20 hover:text-white/80'"
              >
                {{ capturingKey === id ? 'Press key...' : (store.settings.keybindings[id] || '—') }}
              </button>
            </div>
          </div>
        </div>

        <!-- LSP TAB -->
        <div v-else-if="activeTab === 'lsp'" class="flex flex-col gap-4">
          <div class="rounded-xl border border-white/7 bg-white/[0.025] p-4">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-2">
                <Server :size="12" class="text-white/35" />
                <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Language Servers</span>
              </div>
              <button @click="checkLsp" :disabled="checkingLsp" class="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors disabled:opacity-40" title="Re-check all servers">
                <RefreshCw :size="13" :class="checkingLsp ? 'animate-spin' : ''" />
              </button>
            </div>
            <div class="flex flex-col gap-2">
              <div v-for="status in store.lspStatuses" :key="status.id"
                class="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl border border-white/5 bg-black/15">
                <div class="min-w-0 flex-1">
                  <div class="text-[12px] text-white/78">{{ status.label }}</div>
                  <div class="text-[10px] text-white/32 font-mono truncate mt-0.5">{{ status.command || status.languages.join(', ') }}</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <div class="w-1.5 h-1.5 rounded-full" :class="status.available ? 'bg-emerald-400' : 'bg-red-400'"></div>
                  <span class="text-[10px] font-semibold" :class="status.available ? 'text-emerald-300' : 'text-rose-300'">
                    {{ status.available ? 'ready' : 'not found' }}
                  </span>
                </div>
              </div>
              <div v-if="!store.lspStatuses.length && !checkingLsp" class="py-6 text-center text-[12px] text-white/25 italic">
                Click refresh to check installed language servers.
              </div>
            </div>
          </div>
          <div class="rounded-xl border border-white/7 bg-white/[0.025] p-4">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Install Guide</span>
            </div>
            <div class="grid grid-cols-2 gap-2 text-[11px]">
              <div v-for="[name, cmd] in [
                ['TypeScript', 'npm i -g typescript-language-server typescript'],
                ['Vue', 'npm i -g @vue/language-server'],
                ['Python', 'pip install pyright'],
                ['Rust', 'rustup component add rust-analyzer'],
                ['Go', 'go install golang.org/x/tools/gopls@latest'],
                ['HTML/CSS/JSON', 'npm i -g vscode-langservers-extracted'],
              ]" :key="name" class="rounded-lg border border-white/6 bg-black/15 px-3 py-2">
                <div class="text-white/62 font-medium mb-1">{{ name }}</div>
                <code class="text-[10px] text-white/35 font-mono">{{ cmd }}</code>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
