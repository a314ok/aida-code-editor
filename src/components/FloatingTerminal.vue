<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { invoke } from '../lib/electron/ipc';
import { listen } from '../lib/electron/events';
import 'xterm/css/xterm.css';
import { useEditorStore } from '../stores/editor';
import { useFloating } from '../composables/useFloating';
import { X, Trash2 } from 'lucide-vue-next';

const store = useEditorStore();
const terminalEl = ref<HTMLElement | null>(null);
const activeTab = ref<'terminal' | 'output'>('terminal');

const { pos, dragging, resizing, startDrag, startResize, initFromCanvas, bringToFront } = useFloating({ x: 8, y: 0, w: 800, h: 220 });

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let unlisten: (() => void) | null = null;
let ro: ResizeObserver | null = null;

onMounted(async () => {
  await nextTick();
  initFromCanvas(0.7, 0.3);

  if (!terminalEl.value) return;

  term = new Terminal({
    theme: {
      background: 'transparent',
      foreground: '#c0c0c8',
      cursor: '#528bff',
      selectionBackground: 'rgba(82,139,255,0.2)',
      black: '#1e1e24', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#828cf9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#e0e0e6',
      brightBlack: '#555566', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#a6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
    fontSize: 13,
    fontFamily: "'JetBrains Mono','Fira Code',monospace",
    cursorBlink: true,
    allowTransparency: true,
    scrollback: 3000,
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalEl.value);

  try { term.loadAddon(new WebglAddon()); } catch {}

  fitAddon.fit();

  unlisten = await listen<string>('pty-data', e => term?.write(e.payload));

  try {
    await invoke('spawn_pty');
  } catch (e) {
    term.writeln(`\x1b[31mTerminal error: ${e}\x1b[0m`);
  }

  term.onData(d => invoke('write_pty', { data: d }));
  term.onResize(({ rows, cols }) => invoke('resize_pty', { rows, cols }));

  ro = new ResizeObserver(() => fitAddon?.fit());
  ro.observe(terminalEl.value);
});

const clearTerminal = () => { term?.clear(); };

onBeforeUnmount(() => {
  ro?.disconnect();
  unlisten?.();
  term?.dispose();
});
</script>

<template>
  <div
    class="absolute flex flex-col rounded-xl border border-white/8 bg-[#0d0d10] shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden"
    :class="{ 'cursor-move': dragging, 'cursor-nwse-resize': resizing }"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', width: pos.w + 'px', height: pos.h + 'px', zIndex: pos.z }"
    @mousedown.capture="bringToFront"
  >
    <div
      class="h-9 flex items-center justify-between px-4 border-b border-white/6 shrink-0 bg-[#0b0b0e] cursor-move"
      @mousedown="startDrag"
    >
      <div class="flex items-center gap-4" @mousedown.stop>
        <button
          @click="activeTab = 'terminal'"
          class="text-[11px] font-bold uppercase tracking-widest transition-colors"
          :class="activeTab === 'terminal' ? 'text-white/80' : 'text-white/30 hover:text-white/50'"
        >Terminal</button>
        <button
          @click="activeTab = 'output'"
          class="text-[11px] font-bold uppercase tracking-widest transition-colors"
          :class="activeTab === 'output' ? 'text-white/80' : 'text-white/30 hover:text-white/50'"
        >Output</button>
      </div>

      <div class="flex items-center gap-2" @mousedown.stop>
        <button
          @click="clearTerminal"
          class="text-[10px] font-bold uppercase tracking-widest text-white/25 hover:text-white/55 transition-colors flex items-center gap-1"
        >
          <Trash2 :size="11" />
          Clear
        </button>
        <button
          @click="store.isBottomPanelVisible = false"
          class="text-white/25 hover:text-white/65 transition-colors p-0.5 rounded"
        ><X :size="14" /></button>
      </div>
    </div>

    <div class="flex-1 relative bg-[#0b0b0e]" style="min-height:0">
      <div ref="terminalEl" class="absolute inset-0 p-1.5"></div>
    </div>

    <div
      class="absolute top-0 left-3 right-3 h-1.5 cursor-n-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full"
      @mousedown="startResize($event, 'n')"
    ></div>
    <div
      class="absolute top-3 right-0 bottom-3 w-1.5 cursor-e-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full"
      @mousedown="startResize($event, 'e')"
    ></div>
    <div
      class="absolute top-3 left-0 bottom-3 w-1.5 cursor-w-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full"
      @mousedown="startResize($event, 'w')"
    ></div>
    <div
      class="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full"
      @mousedown="startResize($event, 's')"
    ></div>
    <div
      class="absolute top-0 right-0 w-4 h-4 cursor-ne-resize z-20"
      @mousedown="startResize($event, 'ne')"
    ></div>
    <div
      class="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-20"
      @mousedown="startResize($event, 'nw')"
    ></div>
  </div>
</template>

<style scoped>
:deep(.xterm) { height: 100%; }
:deep(.xterm-viewport) { background: transparent !important; }
:deep(.xterm-screen) { background: transparent !important; }
</style>
