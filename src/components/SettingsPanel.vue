<script setup lang="ts">
import { useEditorStore } from '../stores/editor';
import { X, Monitor, Type, Keyboard, Palette } from 'lucide-vue-next';

const store = useEditorStore();
const emit = defineEmits(['close']);

const fontFamilies = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
  { label: 'Consolas', value: "'Consolas', monospace" },
  { label: 'Courier New', value: "'Courier New', monospace" },
];
</script>

<template>
  <div class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div class="w-[560px] bg-[#111] border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <div class="flex items-center gap-2">
          <Monitor :size="16" class="text-blue-400" />
          <span class="font-semibold text-sm">Settings</span>
        </div>
        <button @click="emit('close')" class="text-foreground/40 hover:text-foreground/80 transition-colors p-1 rounded">
          <X :size="16" />
        </button>
      </div>

      <div class="p-5 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
        <!-- Editor section -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2 text-foreground/40">
            <Type :size="13" />
            <span class="text-[11px] font-bold uppercase tracking-widest">Editor</span>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <!-- Font size -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs text-foreground/60">Font Size</label>
              <div class="flex items-center gap-2">
                <input
                  type="range"
                  v-model.number="store.settings.fontSize"
                  min="10" max="24" step="1"
                  class="flex-1 accent-blue-500"
                />
                <span class="text-xs text-foreground/60 w-8 text-right">{{ store.settings.fontSize }}px</span>
              </div>
            </div>

            <!-- Tab size -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs text-foreground/60">Tab Size</label>
              <select
                v-model.number="store.settings.tabSize"
                class="bg-[#1a1a1a] border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-white/30"
              >
                <option :value="2">2 spaces</option>
                <option :value="4">4 spaces</option>
                <option :value="8">8 spaces</option>
              </select>
            </div>

            <!-- Font family -->
            <div class="flex flex-col gap-1.5 col-span-2">
              <label class="text-xs text-foreground/60">Font Family</label>
              <select
                v-model="store.settings.fontFamily"
                class="bg-[#1a1a1a] border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-white/30"
              >
                <option v-for="f in fontFamilies" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </div>
          </div>

          <!-- Toggles -->
          <div class="flex flex-col gap-3">
            <label class="flex items-center justify-between cursor-pointer group">
              <div class="flex flex-col">
                <span class="text-xs text-foreground/80">Word Wrap</span>
                <span class="text-[11px] text-foreground/40">Wrap long lines at editor width</span>
              </div>
              <div
                @click="store.settings.wordWrap = !store.settings.wordWrap"
                class="w-9 h-5 rounded-full transition-colors relative cursor-pointer"
                :class="store.settings.wordWrap ? 'bg-blue-500' : 'bg-white/10'"
              >
                <div class="w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform"
                  :class="store.settings.wordWrap ? 'translate-x-4.5' : 'translate-x-0.75'"
                  style="top: 3px; left: 3px;"
                  :style="store.settings.wordWrap ? { transform: 'translateX(16px)' } : {}"
                ></div>
              </div>
            </label>
          </div>
        </div>

        <!-- Vim section -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2 text-foreground/40">
            <Keyboard :size="13" />
            <span class="text-[11px] font-bold uppercase tracking-widest">Vim</span>
          </div>

          <label class="flex items-center justify-between cursor-pointer">
            <div class="flex flex-col">
              <span class="text-xs text-foreground/80">Enable Vim Mode</span>
              <span class="text-[11px] text-foreground/40">Use Vim keybindings in the editor</span>
            </div>
            <div
              @click="store.settings.vimEnabled = !store.settings.vimEnabled"
              class="w-9 h-5 rounded-full transition-colors relative cursor-pointer"
              :class="store.settings.vimEnabled ? 'bg-blue-500' : 'bg-white/10'"
            >
              <div class="w-3.5 h-3.5 bg-white rounded-full absolute transition-all"
                style="top: 3px; left: 3px;"
                :style="store.settings.vimEnabled ? { transform: 'translateX(16px)' } : {}"
              ></div>
            </div>
          </label>
        </div>

        <!-- Keyboard shortcuts info -->
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2 text-foreground/40">
            <Palette :size="13" />
            <span class="text-[11px] font-bold uppercase tracking-widest">Keyboard Shortcuts</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div v-for="[key, action] in [
              ['Ctrl+S', 'Save File'],
              ['Ctrl+B', 'Toggle Sidebar'],
              ['Ctrl+J', 'Toggle Terminal'],
              ['Ctrl+P', 'Command Palette'],
              ['Ctrl+F', 'Find in File'],
              ['Ctrl+H', 'Find & Replace'],
              ['Ctrl+/', 'Toggle Comment'],
              ['Alt+↑↓', 'Move Line'],
            ]" :key="key" class="flex items-center justify-between gap-2 py-1 px-2 rounded bg-white/3 border border-white/5">
              <span class="text-[11px] text-foreground/50">{{ action }}</span>
              <kbd class="text-[10px] font-mono bg-white/10 px-1.5 py-0.5 rounded text-foreground/60 whitespace-nowrap">{{ key }}</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
