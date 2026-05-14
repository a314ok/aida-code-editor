<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import {
  Globe, Maximize2, Minimize2, Plus, RefreshCw, X,
} from 'lucide-vue-next';
import { useEditorStore } from '../stores/editor';

const props = defineProps<{ windowId: string }>();
const store = useEditorStore();

const win = computed(() => store.getBrowserWindow(props.windowId)!);
const activeTab = computed(() => win.value?.tabs.find(t => t.id === win.value.activeTabId) ?? win.value?.tabs[0]);

// ── position / size ──────────────────────────────────────────────────────────
const pos = ref({ x: 200, y: 80, w: 1100, h: 700 });
const maximized = ref(false);
const savedBeforeMax = ref({ x: 200, y: 80, w: 1100, h: 700 });

onMounted(() => {
  const saved = win.value?.savedPos ?? win.value?.initPos;
  if (saved) pos.value = { x: saved.x, y: saved.y, w: saved.w, h: saved.h };
  else pos.value = { x: 200, y: 80, w: 1100, h: 700 };
  if (store.activeBrowserWindowId === props.windowId) {
    nextTick(() => syncWebview());
  }
});

const persistPos = () => {
  const w = store.getBrowserWindow(props.windowId);
  if (w) w.savedPos = { ...pos.value };
};

// ── native webview state ─────────────────────────────────────────────────────
// The native child webview renders at OS level above all Tauri content.
// We show it only when this window is active and not being dragged/resized.
const isDragging = ref(false);
const isResizing = ref(false);
const webviewLabel = computed(() => `bw_${props.windowId.replace(/[^a-z0-9]/gi, '_')}`);
const webviewCreated = ref(false);

const isActive = computed(() => store.activeBrowserWindowId === props.windowId);
const webviewVisible = computed(() => isActive.value && !isDragging.value && !isResizing.value);

const TITLEBAR_H = 70; // title bar (38px) + address bar (32px)

const screenBounds = () => {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: pos.value.x - canvas.scrollLeft + rect.left,
    y: pos.value.y - canvas.scrollTop + rect.top + TITLEBAR_H,
    width: pos.value.w,
    height: Math.max(80, pos.value.h - TITLEBAR_H),
  };
};

const syncWebview = async (navigateUrl?: string) => {
  const url = navigateUrl ?? activeTab.value?.url;
  if (!url || url === 'about:blank') return;
  const b = screenBounds();
  if (!b) return;

  if (!webviewCreated.value) {
    try {
      await invoke('open_embedded_browser_view', { label: webviewLabel.value, url, bounds: b });
      webviewCreated.value = true;
    } catch (e) {
      console.warn('[FloatingBrowser] open failed:', e);
    }
    return;
  }

  if (navigateUrl) {
    try {
      await invoke('open_embedded_browser_view', { label: webviewLabel.value, url, bounds: b });
    } catch {}
    return;
  }

  try {
    await invoke('set_embedded_browser_view_bounds', {
      label: webviewLabel.value,
      bounds: b,
      visible: webviewVisible.value,
    });
  } catch {}
};

const hideWebview = async () => {
  if (!webviewCreated.value) return;
  try { await invoke('hide_embedded_browser_view', { label: webviewLabel.value }); } catch {}
};

watch(webviewVisible, async (v) => {
  if (v) { await nextTick(); await syncWebview(); }
  else { await hideWebview(); }
});

watch(() => store.activeBrowserWindowId, (newId) => {
  if (newId !== props.windowId) hideWebview();
});

// Re-sync when canvas scrolls
let scrollRaf = 0;
const onCanvasScroll = () => {
  if (!webviewVisible.value) return;
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(async () => {
    scrollRaf = 0;
    await syncWebview();
  });
};

onMounted(() => {
  document.getElementById('main-canvas')?.addEventListener('scroll', onCanvasScroll, { passive: true });
});
onBeforeUnmount(() => {
  document.getElementById('main-canvas')?.removeEventListener('scroll', onCanvasScroll);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  hideWebview();
});

// ── z-order ──────────────────────────────────────────────────────────────────
const zIndex = ref(100);
let zCounter = 200;
const bringToFront = () => {
  zIndex.value = ++zCounter;
  store.activeBrowserWindowId = props.windowId;
};

// ── drag ─────────────────────────────────────────────────────────────────────
const startDrag = (e: MouseEvent) => {
  if (maximized.value || e.button !== 0) return;
  bringToFront();
  isDragging.value = true;
  hideWebview();
  const ox = e.clientX - pos.value.x;
  const oy = e.clientY - pos.value.y;
  const onMove = (ev: MouseEvent) => {
    pos.value.x = Math.max(0, ev.clientX - ox);
    pos.value.y = Math.max(0, ev.clientY - oy);
  };
  const onUp = async () => {
    isDragging.value = false;
    persistPos();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (isActive.value) await syncWebview();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

// ── resize ───────────────────────────────────────────────────────────────────
const startResize = (e: MouseEvent) => {
  if (e.button !== 0) return;
  e.stopPropagation();
  isResizing.value = true;
  hideWebview();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = pos.value.w;
  const startH = pos.value.h;
  const onMove = (ev: MouseEvent) => {
    pos.value.w = Math.max(480, startW + ev.clientX - startX);
    pos.value.h = Math.max(360, startH + ev.clientY - startY);
  };
  const onUp = async () => {
    isResizing.value = false;
    persistPos();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (isActive.value) await syncWebview();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

// ── maximize ─────────────────────────────────────────────────────────────────
const toggleMaximize = async () => {
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
  await nextTick();
  if (isActive.value) await syncWebview();
};

// ── address bar / navigation ─────────────────────────────────────────────────
const addressInput = ref('');
const addressFocused = ref(false);

watch(activeTab, (tab) => {
  if (tab && !addressFocused.value) addressInput.value = tab.url;
}, { immediate: true });

const navigate = async (raw: string) => {
  let url = raw.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('about:')) {
    url = url.includes('.') && !url.includes(' ') ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }
  const tab = activeTab.value;
  if (tab) store.updateBrowserTab(props.windowId, tab.id, { url, title: url });
  addressInput.value = url;
  bringToFront();
  await nextTick();
  await syncWebview(url);
};

const onAddressKeydown = async (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    addressFocused.value = false;
    (e.target as HTMLInputElement).blur();
    await navigate(addressInput.value);
  }
  if (e.key === 'Escape') {
    addressInput.value = activeTab.value?.url ?? '';
    (e.target as HTMLInputElement).blur();
  }
};

const addTab = async () => {
  const tab = store.addBrowserTab(props.windowId, { url: 'https://google.com', title: 'New Tab' });
  if (tab) {
    bringToFront();
    await nextTick();
    await syncWebview('https://google.com');
  }
};

// ── window style ─────────────────────────────────────────────────────────────
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
    @mousedown.capture="bringToFront(); store.activeWindowId = store.activeWindowId"
  >
    <!-- Title bar / tabs -->
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
          @click="win.activeTabId = tab.id; bringToFront(); syncWebview(tab.url)"
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
        <button class="p-1 rounded text-white/25 hover:text-white/55 hover:bg-white/6 transition-colors" @click="toggleMaximize">
          <Maximize2 v-if="!maximized" :size="12" />
          <Minimize2 v-else :size="12" />
        </button>
        <button class="p-1 rounded text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors" @click="store.closeBrowserWindow(windowId)">
          <X :size="12" />
        </button>
      </div>
    </div>

    <!-- Address bar -->
    <div class="flex items-center gap-2 px-2.5 h-[32px] bg-[#0f0f13] border-b border-white/5 shrink-0" @mousedown.stop>
      <button class="p-0.5 rounded text-white/25 hover:text-white/55 transition-colors shrink-0" title="Reload" @click="syncWebview(activeTab?.url)">
        <RefreshCw :size="11" />
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

    <!-- Viewport — native webview renders here at OS level when active -->
    <div
      class="flex-1 relative flex flex-col items-center justify-center bg-[#0c0c10] overflow-hidden"
      @mousedown.stop="bringToFront()"
    >
      <!-- Inactive overlay -->
      <div
        v-if="!isActive"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 cursor-pointer bg-[#0c0c10]/90 backdrop-blur-sm z-10"
        @click="bringToFront(); syncWebview()"
      >
        <Globe :size="28" class="text-white/15" />
        <span class="text-[11px] text-white/30">Click to show browser</span>
      </div>

      <!-- Dragging / resizing overlay -->
      <div v-else-if="isDragging || isResizing" class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0c0c10]/80 z-10">
        <Globe :size="24" class="text-white/20" />
      </div>

      <!-- No URL placeholder -->
      <div v-else-if="!activeTab?.url || activeTab.url === 'about:blank'" class="flex flex-col items-center justify-center gap-3 text-white/20">
        <Globe :size="36" />
        <p class="text-[12px]">Enter a URL above to navigate</p>
      </div>

      <!-- Active + valid URL: native webview is here (OS renders it above this element) -->
      <div v-else-if="!webviewCreated" class="text-[11px] text-white/20">Loading…</div>
    </div>

    <!-- Resize grip -->
    <div
      class="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-20"
      style="background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,0.07) 50%)"
      @mousedown.stop="startResize"
    />
  </div>
</template>
