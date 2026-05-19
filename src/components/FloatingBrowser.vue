<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { invoke } from '../lib/electron/ipc';
import { ArrowLeft, ArrowRight, Code2, ExternalLink, Globe2, Maximize2, Minimize2, Plus, RefreshCw, Search, TerminalSquare, X } from 'lucide-vue-next';
import { useEditorStore } from '../stores/editor';
import type { BrowserTab } from '../stores/editor';
import { useFloating } from '../composables/useFloating';
import { isCode, isPrimaryKey } from '../lib/shortcuts';

const props = defineProps<{ windowId: string }>();
const store = useEditorStore();

const win = computed(() => store.getBrowserWindow(props.windowId));
const tabs = computed(() => win.value?.tabs ?? []);
const activeTabId = computed({
  get: () => win.value?.activeTabId ?? null,
  set: value => { if (win.value) win.value.activeTabId = value; },
});
const activeTab = computed(() => tabs.value.find(tab => tab.id === activeTabId.value) ?? null);

const { pos, dragging, resizing, maximized, startDrag, startResize, initFromCanvas, bringToFront, toggleMaximize } =
  useFloating({ x: 48, y: 48, w: 900, h: 620 });

const frameRef = ref<HTMLIFrameElement | null>(null);
const nativeHostRef = ref<HTMLElement | null>(null);
const urlInput = ref('');
const inspectorOpen = ref(false);
const inspectorTab = ref<'dom' | 'console'>('dom');
const domRows = ref<Array<{ id: string; depth: number; label: string }>>([]);
const inspectorMessage = ref('');
const consoleInput = ref('');
const consoleOutput = ref<string[]>([]);
const reloadToken = ref(0);
const embeddedViewError = ref('');
const activeEmbeddedLabel = ref<string | null>(null);
let embeddedSyncRaf = 0;
let embeddedSyncNavigate = false;
let embeddedSettleTimer: number | null = null;

type BrowserRoute = 'embed' | 'native';
type QuickSite = { label: string; url: string; route: BrowserRoute };

const nativeHosts = [
  'google.com',
  'youtube.com',
  'music.youtube.com',
  'spotify.com',
  'github.com',
  'chatgpt.com',
  'openai.com',
  'figma.com',
  'notion.so',
];

const quickSites: QuickSite[] = [
  { label: 'Google', url: 'https://www.google.com/', route: 'native' },
  { label: 'GitHub', url: 'https://github.com/', route: 'native' },
  { label: 'ChatGPT', url: 'https://chatgpt.com/', route: 'native' },
  { label: 'Spotify', url: 'https://open.spotify.com/', route: 'native' },
  { label: 'YT Music', url: 'https://music.youtube.com/', route: 'native' },
  { label: 'YouTube', url: 'https://www.youtube.com/', route: 'native' },
  { label: 'MDN', url: 'https://developer.mozilla.org/', route: 'embed' },
  { label: 'Local 3000', url: 'http://127.0.0.1:3000/', route: 'embed' },
];

const directShortcuts: Record<string, string> = {
  google: 'https://www.google.com/',
  github: 'https://github.com/',
  chatgpt: 'https://chatgpt.com/',
  spotify: 'https://open.spotify.com/',
  youtube: 'https://www.youtube.com/',
  'yt music': 'https://music.youtube.com/',
  'youtube music': 'https://music.youtube.com/',
  mdn: 'https://developer.mozilla.org/',
};

const panelStyle = computed(() => ({
  left: `${pos.x}px`,
  top: `${pos.y}px`,
  width: `${pos.w}px`,
  height: `${pos.h}px`,
  zIndex: pos.z,
}));

const frameKey = computed(() => `${activeTab.value?.id ?? 'empty'}:${reloadToken.value}:${activeTab.value?.srcdoc ? 'srcdoc' : activeTab.value?.url}`);
const frameSrc = computed(() => activeTab.value?.srcdoc ? 'about:blank' : activeTab.value?.url ?? 'about:blank');
const isExternalPage = computed(() => {
  const url = activeTab.value?.url ?? '';
  return /^https?:\/\//i.test(url) && !activeTab.value?.srcdoc;
});
const isNativeMode = computed(() => activeTab.value?.mode === 'native');
const routeLabel = computed(() => {
  if (!activeTab.value) return '';
  if (activeTab.value.mode === 'native') return 'Native webview';
  if (activeTab.value.srcdoc) return 'Preview';
  return 'Embedded';
});

const persistPos = () => {
  if (win.value) win.value.savedPos = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };
};

const focusSelf = () => {
  store.activeBrowserWindowId = props.windowId;
  bringToFront();
};

const normalizeUrl = (raw: string) => {
  const value = raw.trim();
  if (!value) return 'about:blank';
  const shortcut = directShortcuts[value.toLowerCase()];
  if (shortcut) return shortcut;
  if (value === 'about:blank' || /^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  if (value.includes('.') && !value.includes(' ')) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
};

const hostMatches = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

const shouldUseNative = (url: string, requestedRoute?: BrowserRoute) => {
  if (requestedRoute) return requestedRoute === 'native';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return nativeHosts.some(host => hostMatches(parsed.hostname.toLowerCase(), host));
  } catch {
    return false;
  }
};

const nativeLabelFor = (tab: BrowserTab) => tab.nativeWindowLabel ?? `browser-${props.windowId}-${tab.id}`;

const hideEmbeddedView = async (label = activeEmbeddedLabel.value) => {
  if (!label) return;
  try {
    await invoke('hide_embedded_browser_view', { label });
  } catch {}
  if (activeEmbeddedLabel.value === label) activeEmbeddedLabel.value = null;
};

const embeddedBounds = () => {
  const rect = nativeHostRef.value?.getBoundingClientRect();
  if (!rect) return null;
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
};

const syncEmbeddedViewNow = async (navigate = false) => {
  const tab = activeTab.value;
  const bounds = embeddedBounds();
  if (!tab || tab.mode !== 'native' || !/^https?:\/\//i.test(tab.url) || !bounds) {
    await hideEmbeddedView();
    return;
  }

  const label = nativeLabelFor(tab);
  if (activeEmbeddedLabel.value && activeEmbeddedLabel.value !== label) {
    await hideEmbeddedView(activeEmbeddedLabel.value);
  }
  activeEmbeddedLabel.value = label;
  embeddedViewError.value = '';
  try {
    if (navigate || !tab.nativeOpened) {
      await invoke('open_embedded_browser_view', { label, url: tab.url, bounds });
    } else {
      await invoke('set_embedded_browser_view_bounds', { label, bounds, visible: true });
    }
    store.updateBrowserTab(props.windowId, tab.id, {
      nativeWindowLabel: label,
      nativeOpened: true,
    });
  } catch {
    embeddedViewError.value = 'Native browser view is not available in this Electron session.';
  }
};

const requestEmbeddedSync = (navigate = false) => {
  embeddedSyncNavigate ||= navigate;
  if (embeddedSyncRaf) return;
  embeddedSyncRaf = requestAnimationFrame(() => {
    const shouldNavigate = embeddedSyncNavigate;
    embeddedSyncNavigate = false;
    embeddedSyncRaf = 0;
    void syncEmbeddedViewNow(shouldNavigate);
  });
};

const temporarilyHideEmbeddedView = () => {
  if (!isNativeMode.value) return;
  const label = activeEmbeddedLabel.value ?? activeTab.value?.nativeWindowLabel;
  if (label) {
    void invoke('hide_embedded_browser_view', { label }).catch(() => {});
  }
  if (embeddedSettleTimer !== null) window.clearTimeout(embeddedSettleTimer);
  embeddedSettleTimer = window.setTimeout(() => {
    embeddedSettleTimer = null;
    requestEmbeddedSync();
  }, 90);
};

const routeTab = async (url: string, requestedRoute?: BrowserRoute, title?: string) => {
  const tab = activeTab.value;
  if (!tab) return;
  const native = shouldUseNative(url, requestedRoute);
  store.updateBrowserTab(props.windowId, tab.id, {
    url,
    title: title ?? (url === 'about:blank' ? 'Blank' : url),
    srcdoc: undefined,
    mode: native ? 'native' : 'embed',
    nativeOpened: false,
  });
  inspectorMessage.value = '';
  reloadToken.value++;
  if (native) {
    await nextTick();
    requestEmbeddedSync(true);
  } else {
    await hideEmbeddedView();
  }
};

const go = async () => {
  await routeTab(normalizeUrl(urlInput.value));
};

const openQuickSite = async (site: QuickSite) => {
  urlInput.value = site.url;
  await routeTab(site.url, site.route, site.label);
};

const newTab = () => {
  const tab = store.addBrowserTab(props.windowId, { url: 'about:blank', title: 'Blank' });
  if (tab) urlInput.value = tab.url;
  void nextTick(() => focusSelf());
};

const closeTab = (tabId: string) => {
  store.closeBrowserTab(props.windowId, tabId);
};

const reload = () => {
  reloadToken.value++;
  if (isNativeMode.value) requestEmbeddedSync(true);
};

const refocusNative = () => {
  requestEmbeddedSync(true);
};

const tryEmbeddedActive = async () => {
  const tab = activeTab.value;
  if (!tab) return;
  await routeTab(tab.url, 'embed', tab.title);
};

const navigateFrame = (direction: -1 | 1) => {
  try {
    if (direction < 0) frameRef.value?.contentWindow?.history.back();
    else frameRef.value?.contentWindow?.history.forward();
  } catch {
    inspectorMessage.value = 'Navigation is blocked by this page.';
  }
};

const describeElement = (el: Element) => {
  const id = el.id ? `#${el.id}` : '';
  const classes = el.classList.length ? `.${Array.from(el.classList).slice(0, 3).join('.')}` : '';
  return `<${el.tagName.toLowerCase()}${id}${classes}>`;
};

const snapshotDom = () => {
  domRows.value = [];
  inspectorMessage.value = '';
  try {
    const doc = frameRef.value?.contentDocument;
    if (!doc?.documentElement) {
      inspectorMessage.value = 'Inspector is available after the page loads.';
      return;
    }

    const rows: Array<{ id: string; depth: number; label: string }> = [];
    const walk = (el: Element, depth: number) => {
      if (rows.length > 240) return;
      rows.push({ id: `${rows.length}:${el.tagName}:${depth}`, depth, label: describeElement(el) });
      for (const child of Array.from(el.children)) walk(child, depth + 1);
    };
    walk(doc.documentElement, 0);
    domRows.value = rows;
    const title = doc.title?.trim();
    if (title && activeTab.value) store.updateBrowserTab(props.windowId, activeTab.value.id, { title });
  } catch {
    inspectorMessage.value = 'Inspector works for local/same-origin pages. This page blocks inspection.';
  }
};

const runConsole = () => {
  if (!consoleInput.value.trim()) return;
  try {
    const frameWindow = frameRef.value?.contentWindow as (Window & { eval?: (code: string) => unknown }) | null;
    const result = frameWindow?.eval?.(consoleInput.value);
    consoleOutput.value.unshift(`> ${consoleInput.value}\n${String(result)}`);
    consoleInput.value = '';
  } catch (error) {
    consoleOutput.value.unshift(`! ${String(error)}`);
  }
};

const toggleInspector = () => {
  inspectorOpen.value = !inspectorOpen.value;
  if (inspectorOpen.value) snapshotDom();
};

const handleKeys = (event: KeyboardEvent) => {
  if (store.activeBrowserWindowId !== props.windowId) return;
  if (isPrimaryKey(event, 'KeyT')) { event.preventDefault(); newTab(); return; }
  if (isPrimaryKey(event, 'KeyW')) { event.preventDefault(); if (activeTab.value) closeTab(activeTab.value.id); return; }
  if (isPrimaryKey(event, 'Tab') || isPrimaryKey(event, 'Tab', { shift: true })) {
    event.preventDefault();
    store.switchBrowserTab(props.windowId, event.shiftKey ? -1 : 1);
    return;
  }
  if (isPrimaryKey(event, 'KeyL')) {
    event.preventDefault();
    (document.querySelector(`[data-browser-url="${props.windowId}"]`) as HTMLInputElement | null)?.focus();
    return;
  }
  if (isCode(event, 'F5')) { event.preventDefault(); reload(); }
};

const handleViewportChange = () => {
  if (isNativeMode.value) temporarilyHideEmbeddedView();
};

onMounted(async () => {
  window.addEventListener('keydown', handleKeys);
  window.addEventListener('resize', handleViewportChange);
  document.getElementById('main-canvas')?.addEventListener('scroll', handleViewportChange, { passive: true });
  await nextTick();
  const restoredPos = win.value?.savedPos ?? win.value?.initPos;
  if (restoredPos) {
    pos.x = restoredPos.x;
    pos.y = restoredPos.y;
    pos.w = restoredPos.w;
    pos.h = restoredPos.h;
    if (win.value?.initPos) win.value.initPos = undefined;
  } else {
    initFromCanvas(0.06, 0.78);
  }
  persistPos();
  urlInput.value = activeTab.value?.url ?? 'about:blank';
  if (isNativeMode.value) requestEmbeddedSync(true);
});

watch(activeTab, tab => {
  urlInput.value = tab?.url ?? 'about:blank';
  domRows.value = [];
  inspectorMessage.value = '';
  if (tab?.mode === 'native') {
    void nextTick(() => requestEmbeddedSync(!tab.nativeOpened));
  } else {
    void hideEmbeddedView();
  }
});

watch(() => store.activeBrowserWindowId, id => {
  if (id === props.windowId) {
    if (isNativeMode.value) requestEmbeddedSync();
  } else {
    void hideEmbeddedView();
  }
});

watch(() => win.value?.initPos, initPos => {
  if (!initPos || !win.value) return;
  pos.x = initPos.x;
  pos.y = initPos.y;
  pos.w = initPos.w;
  pos.h = initPos.h;
  win.value.initPos = undefined;
  persistPos();
  requestEmbeddedSync();
});

watch([dragging, resizing], ([isDragging, isResizing]) => {
  if (!isDragging && !isResizing) persistPos();
  if (isNativeMode.value) {
    if (isDragging || isResizing) temporarilyHideEmbeddedView();
    else requestEmbeddedSync();
  }
});

watch(() => [pos.x, pos.y, pos.w, pos.h, inspectorOpen.value], () => {
  if (!isNativeMode.value) return;
  if (dragging.value || resizing.value) temporarilyHideEmbeddedView();
  else requestEmbeddedSync();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeys);
  window.removeEventListener('resize', handleViewportChange);
  document.getElementById('main-canvas')?.removeEventListener('scroll', handleViewportChange);
  if (embeddedSyncRaf) cancelAnimationFrame(embeddedSyncRaf);
  if (embeddedSettleTimer !== null) window.clearTimeout(embeddedSettleTimer);
  void hideEmbeddedView();
});
</script>

<template>
  <div
    data-floating-window
    class="absolute flex flex-col rounded-xl border border-white/8 bg-[#0d0d11] shadow-[0_8px_40px_rgba(0,0,0,0.62)] overflow-hidden"
    :style="panelStyle"
    @mousedown="focusSelf"
  >
    <div
      class="h-10 flex items-stretch bg-[#111116] border-b border-white/6 overflow-x-auto shrink-0 cursor-move"
      style="scrollbar-width:none"
      @mousedown="startDrag"
    >
      <div
        v-for="tab in tabs"
        :key="tab.id"
        role="button"
        tabindex="0"
        class="tab-item group flex items-center gap-2 px-3 border-r border-white/5 cursor-pointer transition-all shrink-0 relative max-w-[220px]"
        :class="activeTabId === tab.id ? 'bg-white/8 text-white' : 'text-white/38 hover:text-white/68 hover:bg-white/3'"
        @click.stop="activeTabId = tab.id"
        @keydown.enter.prevent.stop="activeTabId = tab.id"
        @keydown.space.prevent.stop="activeTabId = tab.id"
      >
        <Globe2 :size="12" class="shrink-0" />
        <span class="text-[12px] truncate pointer-events-none">{{ tab.title }}</span>
        <button
          class="hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-sm hover:bg-white/10 text-white/45 hover:text-white transition-colors"
          @click.stop="closeTab(tab.id)"
        >
          <X :size="10" />
        </button>
      </div>
      <button
        class="tab-item flex items-center justify-center px-3 text-white/35 hover:text-white/70 hover:bg-white/4"
        title="New browser tab (Ctrl+T)"
        @click.stop="newTab"
      >
        <Plus :size="13" />
      </button>
      <div class="ml-auto flex items-center gap-1 px-2" @mousedown.stop>
        <button class="p-1 rounded text-white/30 hover:text-white/70 hover:bg-white/6" title="Maximize" @click="toggleMaximize(); persistPos()">
          <Minimize2 v-if="maximized" :size="13" />
          <Maximize2 v-else :size="13" />
        </button>
        <button class="p-1 rounded text-white/30 hover:text-white/70 hover:bg-white/6" title="Close" @click="store.closeBrowserWindow(windowId)">
          <X :size="13" />
        </button>
      </div>
    </div>

    <div class="h-11 flex items-center gap-2 px-3 border-b border-white/6 bg-black/18 shrink-0">
      <button class="p-1.5 rounded text-white/30 hover:text-white/70 hover:bg-white/6" title="Back" @click="navigateFrame(-1)">
        <ArrowLeft :size="14" />
      </button>
      <button class="p-1.5 rounded text-white/30 hover:text-white/70 hover:bg-white/6" title="Forward" @click="navigateFrame(1)">
        <ArrowRight :size="14" />
      </button>
      <button class="p-1.5 rounded text-white/30 hover:text-white/70 hover:bg-white/6" title="Reload (F5)" @click="reload">
        <RefreshCw :size="14" />
      </button>
      <div class="min-w-0 flex-1 flex items-center gap-2 rounded-md border border-white/8 bg-black/30 px-2">
        <Search :size="13" class="text-white/25 shrink-0" />
        <input
          :data-browser-url="windowId"
          v-model="urlInput"
          class="h-7 min-w-0 flex-1 bg-transparent outline-none text-[12px] text-white/70 placeholder:text-white/22"
          placeholder="URL or search"
          @keydown.enter.prevent="go"
        />
      </div>
      <button class="px-3 h-7 rounded-md bg-white/8 hover:bg-white/12 text-[11px] text-white/60 transition-colors" @click="go">
        Go
      </button>
      <span class="px-2 py-1 rounded bg-white/5 text-[10px] text-white/32 shrink-0">
        {{ routeLabel }}
      </span>
      <button
        class="px-2 h-7 rounded-md border border-white/7 text-[11px] transition-colors"
        :class="inspectorOpen ? 'bg-emerald-400/10 text-emerald-200/70' : 'bg-white/4 text-white/42 hover:text-white/65'"
        title="Inspector"
        @click="toggleInspector"
      >
        <Code2 :size="13" />
      </button>
      <button
        v-if="isExternalPage && !isNativeMode"
        class="px-2 h-7 rounded-md border border-white/7 bg-white/4 text-white/42 hover:text-white/65 hover:bg-white/8 transition-colors"
        title="Open embedded native view"
        @click="activeTab && routeTab(activeTab.url, 'native', activeTab.title)"
      >
        <ExternalLink :size="13" />
      </button>
    </div>

    <div class="h-8 flex items-center gap-1 px-3 border-b border-white/6 bg-black/12 overflow-x-auto shrink-0" style="scrollbar-width:none">
      <button
        v-for="site in quickSites"
        :key="site.label"
        class="shrink-0 rounded-md border border-white/6 bg-white/4 px-2 py-1 text-[10px] text-white/42 hover:text-white/70 hover:bg-white/8 transition-colors"
        :title="site.route === 'native' ? 'Opens in native webview' : 'Opens embedded'"
        @click="openQuickSite(site)"
      >
        {{ site.label }}
      </button>
    </div>

    <div class="min-h-0 flex-1 grid" :class="inspectorOpen ? 'grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-1'">
      <div v-if="isExternalPage && !isNativeMode" class="absolute top-[96px] left-3 z-30 rounded-md border border-amber-300/15 bg-[#15110a]/90 px-2.5 py-1.5 text-[11px] text-amber-100/60 shadow-lg">
        This site may block embedded mode. Native mode is available on the right.
      </div>
      <div v-if="activeTab && isNativeMode" ref="nativeHostRef" class="relative min-h-0 bg-white">
        <div class="absolute inset-0 flex items-center justify-center bg-[#0f0f14]">
          <div class="w-[min(520px,calc(100%-40px))] rounded-xl border border-white/8 bg-white/4 p-5 text-center shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-200/80">
              <ExternalLink :size="20" />
            </div>
            <div class="text-[13px] font-bold text-white/75">
              {{ embeddedViewError ? 'Embedded webview is not active' : 'Loading native webview here' }}
            </div>
            <div class="mt-1 text-[12px] text-white/40 break-all">
              {{ embeddedViewError || activeTab.url }}
            </div>
            <div v-if="embeddedViewError" class="mt-4 flex items-center justify-center gap-2">
              <button
                class="rounded-md bg-emerald-300 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-emerald-200 transition-colors"
                @click="refocusNative"
              >
                Retry
              </button>
              <button
                class="rounded-md border border-white/8 bg-white/5 px-3 py-1.5 text-[11px] text-white/50 hover:text-white/75 hover:bg-white/8 transition-colors"
                @click="tryEmbeddedActive"
              >
                Try iframe
              </button>
            </div>
          </div>
        </div>
      </div>
      <iframe
        v-else-if="activeTab"
        ref="frameRef"
        :key="frameKey"
        class="w-full h-full bg-white"
        :src="frameSrc"
        :srcdoc="activeTab.srcdoc"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        @load="snapshotDom"
      ></iframe>
      <div v-else class="flex items-center justify-center text-[12px] text-white/25">No browser tab</div>

      <aside v-if="inspectorOpen" class="min-h-0 border-l border-white/7 bg-[#101015] flex flex-col">
        <div class="h-9 flex items-center justify-between px-3 border-b border-white/6 shrink-0">
          <div class="flex items-center gap-2">
            <TerminalSquare :size="13" class="text-white/35" />
            <span class="text-[10px] font-bold uppercase tracking-wide text-white/35">Inspector</span>
          </div>
          <button class="text-[10px] text-white/28 hover:text-white/65" @click="snapshotDom">refresh</button>
        </div>
        <div class="grid grid-cols-2 gap-1 p-2 border-b border-white/6">
          <button
            class="rounded px-2 py-1 text-[10px]"
            :class="inspectorTab === 'dom' ? 'bg-white/10 text-white/70' : 'bg-black/20 text-white/30 hover:text-white/55'"
            @click="inspectorTab = 'dom'"
          >
            DOM
          </button>
          <button
            class="rounded px-2 py-1 text-[10px]"
            :class="inspectorTab === 'console' ? 'bg-white/10 text-white/70' : 'bg-black/20 text-white/30 hover:text-white/55'"
            @click="inspectorTab = 'console'"
          >
            Console
          </button>
        </div>
        <div v-if="inspectorMessage" class="px-3 py-2 text-[11px] text-amber-200/55 border-b border-white/6">
          {{ inspectorMessage }}
        </div>
        <div v-if="inspectorTab === 'dom'" class="flex-1 overflow-auto p-2 font-mono text-[11px]" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
          <div
            v-for="row in domRows"
            :key="row.id"
            class="h-5 flex items-center rounded hover:bg-white/5 text-white/52 whitespace-nowrap"
            :style="{ paddingLeft: `${row.depth * 12 + 4}px` }"
          >
            {{ row.label }}
          </div>
          <div v-if="!domRows.length" class="text-white/22 italic px-1 py-3">No DOM snapshot</div>
        </div>
        <div v-else class="flex-1 min-h-0 flex flex-col">
          <div class="flex-1 overflow-auto p-2 space-y-2 font-mono text-[11px]" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <pre v-for="(line, idx) in consoleOutput" :key="idx" class="whitespace-pre-wrap text-white/55 bg-black/24 border border-white/5 rounded p-2">{{ line }}</pre>
          </div>
          <form class="p-2 border-t border-white/6 flex gap-1" @submit.prevent="runConsole">
            <input
              v-model="consoleInput"
              class="min-w-0 flex-1 bg-black/30 border border-white/7 rounded px-2 py-1 text-[11px] text-white/65 outline-none focus:border-white/18"
              placeholder="document.title"
            />
            <button class="px-2 rounded bg-white/8 hover:bg-white/12 text-[11px] text-white/60">Run</button>
          </form>
        </div>
      </aside>
    </div>

    <div class="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'s')"></div>
    <div class="absolute top-3 right-0 bottom-3 w-1.5 cursor-e-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'e')"></div>
    <div class="absolute top-3 left-0 bottom-3 w-1.5 cursor-w-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'w')"></div>
    <div class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-20" @mousedown="startResize($event,'se')"></div>
    <div class="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize z-20" @mousedown="startResize($event,'sw')"></div>
  </div>
</template>
