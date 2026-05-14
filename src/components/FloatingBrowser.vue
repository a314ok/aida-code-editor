<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  Code2, Globe, Maximize2, Minimize2, Plus, RefreshCw, X,
} from 'lucide-vue-next';
import { useEditorStore } from '../stores/editor';

type BrowserWebview = HTMLElementTagNameMap['webview'];
type WebviewTitleEvent = Event & { title?: string };
type WebviewUrlEvent = Event & { url?: string };

const props = defineProps<{ windowId: string }>();
const store = useEditorStore();

const win = computed(() => store.getBrowserWindow(props.windowId)!);
const activeTab = computed(() => win.value?.tabs.find(t => t.id === win.value.activeTabId) ?? win.value?.tabs[0]);
const isActive = computed(() => store.activeBrowserWindowId === props.windowId);
const webviewEl = ref<BrowserWebview | null>(null);

const pos = ref({ x: 200, y: 80, w: 1100, h: 700 });
const maximized = ref(false);
const savedBeforeMax = ref({ x: 200, y: 80, w: 1100, h: 700 });
const dragging = ref(false);
const resizing = ref(false);
const zIndex = ref(100);
let zCounter = 200;

const addressInput = ref('');
const addressFocused = ref(false);

const tabToSrc = (tab: typeof activeTab.value) => {
  if (!tab) return 'about:blank';
  if (tab.srcdoc !== undefined) {
    return `data:text/html;charset=utf-8,${encodeURIComponent(tab.srcdoc)}`;
  }
  return tab.url || 'about:blank';
};

const webviewSrc = computed(() => tabToSrc(activeTab.value));

const bringToFront = () => {
  zIndex.value = ++zCounter;
  store.activeBrowserWindowId = props.windowId;
  store.activeWindowId = store.activeWindowId;
};

const persistPos = () => {
  const browserWindow = store.getBrowserWindow(props.windowId);
  if (browserWindow) browserWindow.savedPos = { ...pos.value };
};

onMounted(() => {
  const saved = win.value?.savedPos ?? win.value?.initPos;
  pos.value = saved ? { x: saved.x, y: saved.y, w: saved.w, h: saved.h } : { x: 200, y: 80, w: 1100, h: 700 };
  if (win.value?.initPos) win.value.initPos = undefined;
  persistPos();
});

watch(activeTab, (tab) => {
  if (tab && !addressFocused.value) addressInput.value = tab.url;
}, { immediate: true });

const updateTabFromWebview = () => {
  const tab = activeTab.value;
  const webview = webviewEl.value;
  if (!tab || !webview || tab.srcdoc !== undefined) return;
  const url = webview.getURL?.() || tab.url;
  const title = webview.getTitle?.() || tab.title || url;
  store.updateBrowserTab(props.windowId, tab.id, { url, title });
  if (!addressFocused.value) addressInput.value = url;
};

const handleTitle = (event: WebviewTitleEvent) => {
  const tab = activeTab.value;
  if (!tab || tab.srcdoc !== undefined) return;
  const title = event.title || webviewEl.value?.getTitle?.() || tab.title;
  store.updateBrowserTab(props.windowId, tab.id, { title });
};

const handleNavigate = (event: WebviewUrlEvent) => {
  const tab = activeTab.value;
  if (!tab || tab.srcdoc !== undefined) return;
  const url = event.url || webviewEl.value?.getURL?.() || tab.url;
  store.updateBrowserTab(props.windowId, tab.id, { url, title: tab.title || url });
  if (!addressFocused.value) addressInput.value = url;
};

const navigate = async (raw: string) => {
  let url = raw.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('about:')) {
    url = url.includes('.') && !url.includes(' ') ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  const tab = activeTab.value;
  if (tab) store.updateBrowserTab(props.windowId, tab.id, { url, title: url, srcdoc: undefined });
  addressInput.value = url;
  bringToFront();
  await nextTick();
  await webviewEl.value?.loadURL(url);
};

const reloadWebview = () => {
  webviewEl.value?.reload();
};

const openDevTools = () => {
  webviewEl.value?.openDevTools();
};

const onAddressKeydown = async (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    addressFocused.value = false;
    (event.target as HTMLInputElement).blur();
    await navigate(addressInput.value);
  }
  if (event.key === 'Escape') {
    addressInput.value = activeTab.value?.url ?? '';
    (event.target as HTMLInputElement).blur();
  }
};

const addTab = async () => {
  const tab = store.addBrowserTab(props.windowId, { url: 'https://google.com', title: 'New Tab' });
  if (!tab) return;
  bringToFront();
  await nextTick();
  await webviewEl.value?.loadURL(tab.url);
};

const startDrag = (event: MouseEvent) => {
  if (maximized.value || event.button !== 0) return;
  bringToFront();
  dragging.value = true;
  const startX = event.clientX;
  const startY = event.clientY;
  const startPos = { ...pos.value };

  const onMove = (moveEvent: MouseEvent) => {
    pos.value.x = Math.max(0, startPos.x + moveEvent.clientX - startX);
    pos.value.y = Math.max(0, startPos.y + moveEvent.clientY - startY);
  };
  const onUp = () => {
    dragging.value = false;
    persistPos();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

const startResize = (event: MouseEvent) => {
  if (event.button !== 0) return;
  event.stopPropagation();
  bringToFront();
  resizing.value = true;
  const startX = event.clientX;
  const startY = event.clientY;
  const startPos = { ...pos.value };

  const onMove = (moveEvent: MouseEvent) => {
    pos.value.w = Math.max(480, startPos.w + moveEvent.clientX - startX);
    pos.value.h = Math.max(360, startPos.h + moveEvent.clientY - startY);
  };
  const onUp = () => {
    resizing.value = false;
    persistPos();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

const toggleMaximize = () => {
  if (maximized.value) {
    pos.value = { ...savedBeforeMax.value };
    maximized.value = false;
  } else {
    savedBeforeMax.value = { ...pos.value };
    const canvas = document.getElementById('main-canvas');
    if (canvas) {
      pos.value = { x: canvas.scrollLeft, y: canvas.scrollTop, w: canvas.clientWidth, h: canvas.clientHeight };
    }
    maximized.value = true;
  }
  persistPos();
};

const windowStyle = computed(() => ({
  position: 'absolute' as const,
  left: `${pos.value.x}px`,
  top: `${pos.value.y}px`,
  width: `${pos.value.w}px`,
  height: `${pos.value.h}px`,
  zIndex: zIndex.value,
}));
</script>

<template>
  <div
    data-floating-window
    :style="windowStyle"
    class="flex flex-col rounded-xl overflow-hidden border shadow-[0_24px_60px_rgba(0,0,0,0.75)] bg-[#111116] select-none"
    :class="isActive ? 'border-white/12' : 'border-white/6'"
    @mousedown.capture="bringToFront"
  >
    <div
      class="flex items-center gap-1 px-2 h-[38px] bg-[#0d0d10] border-b border-white/6 shrink-0 cursor-grab active:cursor-grabbing"
      @mousedown="startDrag"
      @dblclick.self="toggleMaximize"
    >
      <div class="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto" style="scrollbar-width:none">
        <button
          v-for="tab in win.tabs"
          :key="tab.id"
          class="group flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] shrink-0 transition-colors max-w-[180px]"
          :class="win.activeTabId === tab.id ? 'bg-white/10 text-white/85' : 'text-white/35 hover:bg-white/6 hover:text-white/65'"
          @mousedown.stop
          @click="win.activeTabId = tab.id; bringToFront()"
        >
          <Globe :size="10" class="shrink-0 text-sky-400/50" />
          <span class="truncate max-w-[120px]">{{ tab.title }}</span>
          <button
            class="opacity-0 group-hover:opacity-100 ml-0.5 p-0.5 rounded hover:bg-white/10"
            @mousedown.stop
            @click.stop="store.closeBrowserTab(windowId, tab.id)"
          ><X :size="9" /></button>
        </button>
        <button
          class="p-1 rounded text-white/25 hover:text-white/55 hover:bg-white/6 transition-colors shrink-0"
          title="New tab"
          @mousedown.stop
          @click="addTab"
        ><Plus :size="12" /></button>
      </div>
      <div class="flex items-center gap-1 shrink-0 ml-1" @mousedown.stop>
        <button class="p-1 rounded text-white/25 hover:text-white/55 hover:bg-white/6 transition-colors" title="Maximize" @click="toggleMaximize">
          <Maximize2 v-if="!maximized" :size="12" />
          <Minimize2 v-else :size="12" />
        </button>
        <button class="p-1 rounded text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Close" @click="store.closeBrowserWindow(windowId)">
          <X :size="12" />
        </button>
      </div>
    </div>

    <div class="flex items-center gap-2 px-2.5 h-[32px] bg-[#0f0f13] border-b border-white/5 shrink-0" @mousedown.stop>
      <button class="p-0.5 rounded text-white/25 hover:text-white/55 transition-colors shrink-0" title="Reload" @click="reloadWebview">
        <RefreshCw :size="11" />
      </button>
      <button class="p-0.5 rounded text-white/25 hover:text-white/55 transition-colors shrink-0" title="Open DevTools" @click="openDevTools">
        <Code2 :size="11" />
      </button>
      <Globe :size="11" class="text-white/18 shrink-0" />
      <input
        v-model="addressInput"
        class="flex-1 bg-transparent text-[12px] text-white/65 placeholder-white/20 outline-none font-mono min-w-0"
        placeholder="https://..."
        spellcheck="false"
        @mousedown.stop
        @focus="addressFocused = true; ($event.target as HTMLInputElement).select()"
        @blur="addressFocused = false; addressInput = activeTab?.url ?? ''"
        @keydown="onAddressKeydown"
      />
    </div>

    <div class="flex-1 relative bg-[#0c0c10] overflow-hidden" @mousedown.stop="bringToFront">
      <div v-if="!activeTab" class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/20">
        <Globe :size="36" />
        <p class="text-[12px]">No browser tab</p>
      </div>
      <webview
        v-else
        ref="webviewEl"
        :key="activeTab.id"
        :src="webviewSrc"
        class="absolute inset-0"
        style="width:100%;height:100%;border:none;"
        allowpopups
        webpreferences="contextIsolation=yes,nodeIntegration=no"
        @dom-ready="updateTabFromWebview"
        @did-navigate="handleNavigate"
        @did-navigate-in-page="handleNavigate"
        @page-title-updated="handleTitle"
      />
    </div>

    <div
      class="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-20"
      style="background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,0.07) 50%)"
      @mousedown.stop="startResize"
    />
  </div>
</template>
