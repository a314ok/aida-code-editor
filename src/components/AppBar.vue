<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Bug, ChevronDown, GitBranch, Globe2, Layers2, LayoutTemplate, Send, Settings2 } from 'lucide-vue-next';
import { useEditorStore } from '../stores/editor';
import AidaLogo from './AidaLogo.vue';

const store = useEditorStore();

const emit = defineEmits<{
  toggleMenu: [];
  openGit: [];
  openDebug: [];
  openBrowser: [];
  openApi: [];
  openVisual: [];
  focusWindow: [windowId: string];
  focusBrowserWindow: [windowId: string];
  openSettings: [];
}>();

const dirtyCount = computed(() =>
  store.editorWindows.flatMap(w => w.tabs).filter(t => t.isDirty).length
);

const showWindows = ref(false);
const taskbarRoot = ref<HTMLElement | null>(null);
const windowTitle = (windowId: string) => {
  const win = store.getWindow(windowId);
  const tab = win?.tabs.find(t => t.path === win.activeTabPath) ?? win?.tabs[0];
  return tab?.name ?? 'Empty window';
};
const browserTitle = (windowId: string) => {
  const win = store.getBrowserWindow(windowId);
  const tab = win?.tabs.find(t => t.id === win.activeTabId) ?? win?.tabs[0];
  return tab?.title ?? 'Browser';
};

const focusWindow = (windowId: string) => {
  emit('focusWindow', windowId);
  showWindows.value = false;
};
const focusBrowserWindow = (windowId: string) => {
  emit('focusBrowserWindow', windowId);
  showWindows.value = false;
};

const handleGlobalMouseDown = (event: MouseEvent) => {
  if (!taskbarRoot.value?.contains(event.target as Node)) showWindows.value = false;
};

onMounted(() => window.addEventListener('mousedown', handleGlobalMouseDown, true));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalMouseDown, true));
</script>

<template>
  <div class="h-12 bg-[#0d0d10] border-b border-white/5 flex items-center px-4 gap-3 shrink-0 select-none">

    <!-- Left: Brand + Badge + Menu -->
    <div class="flex items-center gap-3 flex-1 min-w-0">

      <!-- Status dot + name -->
      <div class="flex items-center gap-2 shrink-0">
        <AidaLogo />
        <span class="text-[13px] font-semibold text-white/85 tracking-tight">Aida Studio</span>
      </div>

      <!-- Menu button -->
      <button
        class="flex items-center gap-1.5 bg-white/4 border border-white/7 rounded-md px-3 py-1 text-[12px] font-semibold text-white/45 hover:bg-white/8 hover:text-white/65 transition-colors shrink-0"
        @click="emit('toggleMenu')"
      >
        <span class="tracking-wide">МЕНЮ</span>
        <ChevronDown :size="13" />
      </button>

      <button
        class="relative flex items-center gap-1.5 bg-white/4 border border-white/7 rounded-md px-3 py-1 text-[12px] font-semibold text-white/45 hover:bg-white/8 hover:text-white/70 transition-colors shrink-0"
        @click="emit('openGit')"
        title="Git"
      >
        <GitBranch :size="13" />
        <span>Git</span>
        <span
          v-if="Object.keys(store.gitStatuses).length > 0"
          class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400"
        ></span>
      </button>

      <button
        class="flex items-center gap-1.5 bg-emerald-400/10 border border-emerald-300/15 rounded-md px-3 py-1 text-[12px] font-semibold text-emerald-200/70 hover:bg-emerald-400/15 hover:text-emerald-100 transition-colors shrink-0"
        @click="emit('openDebug')"
        title="Debug (Ctrl+Shift+D)"
      >
        <Bug :size="13" />
        <span>Debug</span>
      </button>

      <button
        class="flex items-center gap-1.5 bg-white/4 border border-white/7 rounded-md px-3 py-1 text-[12px] font-semibold text-white/45 hover:bg-white/8 hover:text-white/70 transition-colors shrink-0"
        @click="emit('openBrowser')"
        title="Browser (Ctrl+Shift+G)"
      >
        <Globe2 :size="13" />
        <span>Browser</span>
      </button>

      <button
        class="flex items-center gap-1.5 bg-white/4 border border-white/7 rounded-md px-3 py-1 text-[12px] font-semibold text-white/45 hover:bg-white/8 hover:text-white/70 transition-colors shrink-0"
        @click="emit('openApi')"
        title="API client"
      >
        <Send :size="13" />
        <span>API</span>
      </button>

      <button
        class="flex items-center gap-1.5 bg-white/4 border border-white/7 rounded-md px-3 py-1 text-[12px] font-semibold text-white/45 hover:bg-white/8 hover:text-white/70 transition-colors shrink-0"
        @click="emit('openVisual')"
        title="Visual builder"
      >
        <LayoutTemplate :size="13" />
        <span>Visual</span>
      </button>

      <div ref="taskbarRoot" class="relative shrink-0" @contextmenu.prevent="showWindows = !showWindows">
        <button
          class="flex items-center gap-1.5 bg-white/4 border border-white/7 rounded-md px-3 py-1 text-[12px] font-semibold text-white/45 hover:bg-white/8 hover:text-white/70 transition-colors"
          @click="showWindows = !showWindows"
          title="Floating windows"
        >
          <Layers2 :size="13" />
          <span>Windows</span>
          <span class="text-[10px] text-white/30">{{ store.editorWindows.length + store.browserWindows.length }}</span>
        </button>

        <div
          v-if="showWindows"
          class="absolute left-0 top-[calc(100%+8px)] z-[12000] w-72 rounded-lg border border-white/10 bg-[#141419] shadow-[0_18px_50px_rgba(0,0,0,0.75)] p-1"
          @mousedown.stop
        >
          <button
            v-for="win in store.editorWindows"
            :key="win.id"
            class="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors"
            :class="store.activeWindowId === win.id ? 'bg-white/10 text-white/85' : 'text-white/50 hover:bg-white/6 hover:text-white/75'"
            @click="focusWindow(win.id)"
          >
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="store.activeWindowId === win.id ? 'bg-emerald-300' : 'bg-white/20'"></span>
            <span class="truncate flex-1">{{ windowTitle(win.id) }}</span>
            <span class="text-[10px] text-white/25 font-mono">{{ win.tabs.length }}</span>
          </button>
          <button
            v-for="win in store.browserWindows"
            :key="win.id"
            class="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors"
            :class="store.activeBrowserWindowId === win.id ? 'bg-white/10 text-white/85' : 'text-white/50 hover:bg-white/6 hover:text-white/75'"
            @click="focusBrowserWindow(win.id)"
          >
            <Globe2 :size="12" class="text-white/35 shrink-0" />
            <span class="truncate flex-1">{{ browserTitle(win.id) }}</span>
            <span class="text-[10px] text-white/25 font-mono">{{ win.tabs.length }}</span>
          </button>
        </div>
      </div>

      <!-- Unsaved indicator -->
      <div v-if="dirtyCount > 0" class="flex items-center gap-1.5 text-amber-400/70 text-[11px] shrink-0">
        <div class="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></div>
        <span>{{ dirtyCount }} не збережено</span>
      </div>
    </div>

    <!-- Right: Settings -->
    <button
      @click="emit('openSettings')"
      class="p-1.5 rounded text-white/25 hover:text-white/55 hover:bg-white/5 transition-colors"
      title="Налаштування (Ctrl+,)"
    >
      <Settings2 :size="15" />
    </button>

  </div>
</template>
