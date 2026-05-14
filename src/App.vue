<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { CSSProperties } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import AppBar from './components/AppBar.vue';
import FloatingEditor from './components/FloatingEditor.vue';
import FloatingBrowser from './components/FloatingBrowser.vue';
import FloatingApiClient from './components/FloatingApiClient.vue';
import FloatingVisualBuilder from './components/FloatingVisualBuilder.vue';
import FloatingTerminal from './components/FloatingTerminal.vue';
import FloatingMenu from './components/FloatingMenu.vue';
import CommandPalette from './components/CommandPalette.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import SearchPanel from './components/SearchPanel.vue';
import ProblemsPanel from './components/ProblemsPanel.vue';
import TasksPanel from './components/TasksPanel.vue';
import DebugPanel from './components/DebugPanel.vue';
import { useEditorStore, type ActiveLspStatus, type EditorDiagnostic, type FileEntry } from './stores/editor';
import { isCode, isPrimaryKey, matchesShortcut } from './lib/shortcuts';

const store = useEditorStore();
const showSettings = ref(false);
const showMenu = ref(false);
const showSearch = ref(false);
const showProblems = ref(false);
const showTasks = ref(false);
const showDebug = ref(false);
const showApiClient = ref(false);
const showVisualBuilder = ref(false);
const menuInitialTab = ref<'files' | 'git'>('files');
const menuKey = ref(0);
const canvasRef = ref<HTMLDivElement | null>(null);
const viewport = ref({ left: 0, top: 0, right: 0, bottom: 0 });
const isPanningCanvas = ref(false);
let viewportRaf = 0;

const toggleMenu = () => {
  menuInitialTab.value = 'files';
  showMenu.value = !showMenu.value;
  if (showMenu.value) menuKey.value++;
};

const openGit = () => {
  menuInitialTab.value = 'git';
  menuKey.value++;
  showMenu.value = true;
};

// Only block browser shortcuts that don't conflict with editor/vim commands
const blockBrowserShortcuts = (e: KeyboardEvent) => {
  // Prevent page refresh (F5 has no editor use)
  if (isCode(e, 'F5')) { e.preventDefault(); return; }
  // Ctrl+P: prevent WebView print dialog — our command palette uses this
  if (matchesShortcut(e, store.settings.keybindings['command-palette'] ?? 'Ctrl+P')) e.preventDefault();
  if (matchesShortcut(e, store.settings.keybindings['open-debug'] ?? 'Ctrl+Shift+D')) e.preventDefault();
  if (matchesShortcut(e, store.settings.keybindings['open-api'] ?? 'Ctrl+Shift+A')) e.preventDefault();
  if (matchesShortcut(e, store.settings.keybindings['open-browser'] ?? 'Ctrl+Shift+G')) e.preventDefault();
  if (matchesShortcut(e, store.settings.keybindings['open-visual'] ?? 'Ctrl+Shift+V')) e.preventDefault();
  if (matchesShortcut(e, store.settings.keybindings['new-file'] ?? 'Ctrl+N')) e.preventDefault();
  if (matchesShortcut(e, store.settings.keybindings['toggle-sidebar'] ?? 'Ctrl+B')) e.preventDefault();
  if (matchesShortcut(e, store.settings.keybindings['maximize-window'] ?? 'F11')) e.preventDefault();
  if (isPrimaryKey(e, 'Tab') || isPrimaryKey(e, 'Tab', { shift: true })) e.preventDefault();
};

const handleGlobalShortcuts = (e: KeyboardEvent) => {
  if (matchesShortcut(e, store.settings.keybindings['new-file'] ?? 'Ctrl+N')) {
    e.preventDefault();
    menuInitialTab.value = 'files';
    showMenu.value = true;
    menuKey.value++;
    return;
  }
  if (matchesShortcut(e, store.settings.keybindings['toggle-sidebar'] ?? 'Ctrl+B')) {
    e.preventDefault();
    store.isSidebarVisible = !store.isSidebarVisible;
    return;
  }
  if (matchesShortcut(e, store.settings.keybindings['maximize-window'] ?? 'F11')) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('aida:maximize-active-window'));
    return;
  }
  // Alt+1-9: focus nth editor window
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key) - 1;
    const win = store.editorWindows[idx];
    if (win) {
      e.preventDefault();
      centerWindow(win.id);
    }
  }
};

const windowBounds = (win: { savedPos?: { x: number; y: number; w: number; h: number }; initPos?: { x: number; y: number; w: number; h: number } }) => {
  const pos = win.savedPos ?? win.initPos ?? { x: 8, y: 8, w: 800, h: 500 };
  return { left: pos.x, top: pos.y, right: pos.x + pos.w, bottom: pos.y + pos.h };
};

const updateViewport = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const buffer = 900;
  viewport.value = {
    left: Math.max(0, canvas.scrollLeft - buffer),
    top: Math.max(0, canvas.scrollTop - buffer),
    right: canvas.scrollLeft + canvas.clientWidth + buffer,
    bottom: canvas.scrollTop + canvas.clientHeight + buffer,
  };
};

const scheduleViewportUpdate = () => {
  if (viewportRaf) return;
  viewportRaf = requestAnimationFrame(() => {
    viewportRaf = 0;
    updateViewport();
  });
};

const visibleEditorWindows = computed(() => {
  const v = viewport.value;
  return store.editorWindows.filter(win => {
    const b = windowBounds(win);
    return b.right >= v.left && b.left <= v.right && b.bottom >= v.top && b.top <= v.bottom;
  });
});

const visibleBrowserWindows = computed(() => {
  const v = viewport.value;
  return store.browserWindows.filter(win => {
    const b = windowBounds(win);
    return b.right >= v.left && b.left <= v.right && b.bottom >= v.top && b.top <= v.bottom;
  });
});

const canvasStyle = computed<CSSProperties>(() => {
  let right = Math.max(4096, viewport.value.right + 1800);
  let bottom = Math.max(3072, viewport.value.bottom + 1400);

  for (const win of store.editorWindows) {
    const b = windowBounds(win);
    right = Math.max(right, b.right + 1800);
    bottom = Math.max(bottom, b.bottom + 1400);
  }

  return {
    position: 'relative',
    width: `${Math.min(right, 24000)}px`,
    height: `${Math.min(bottom, 18000)}px`,
    contain: 'layout paint',
  };
});

const appThemeStyle = computed<CSSProperties>(() => ({
  '--aida-accent': store.settings.accentColor,
  '--aida-bg': store.settings.backgroundColor,
  '--aida-panel': store.settings.panelColor,
} as CSSProperties));

const centerWindow = async (windowId: string) => {
  const canvas = canvasRef.value;
  const win = store.getWindow(windowId);
  if (!canvas || !win) return;
  store.activeWindowId = windowId;
  const b = windowBounds(win);
  canvas.scrollTo({
    left: Math.max(0, b.left - canvas.clientWidth / 2 + (b.right - b.left) / 2),
    top: Math.max(0, b.top - canvas.clientHeight / 2 + (b.bottom - b.top) / 2),
    behavior: 'smooth',
  });
  await nextTick();
  updateViewport();
};

const centerBrowserWindow = async (windowId: string) => {
  const canvas = canvasRef.value;
  const win = store.getBrowserWindow(windowId);
  if (!canvas || !win) return;
  store.activeBrowserWindowId = windowId;
  const b = windowBounds(win);
  canvas.scrollTo({
    left: Math.max(0, b.left - canvas.clientWidth / 2 + (b.right - b.left) / 2),
    top: Math.max(0, b.top - canvas.clientHeight / 2 + (b.bottom - b.top) / 2),
    behavior: 'smooth',
  });
  await nextTick();
  updateViewport();
};

const handleCanvasMouseDown = (e: MouseEvent) => {
  if (e.button !== 1) return;
  if ((e.target as HTMLElement).closest('[data-floating-window]')) return;
  const canvas = canvasRef.value;
  if (!canvas) return;
  e.preventDefault();
  isPanningCanvas.value = true;
  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = canvas.scrollLeft;
  const startTop = canvas.scrollTop;

  const onMove = (event: MouseEvent) => {
    canvas.scrollLeft = startLeft - (event.clientX - startX);
    canvas.scrollTop = startTop - (event.clientY - startY);
    scheduleViewportUpdate();
  };
  const onUp = () => {
    isPanningCanvas.value = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

const confirmBeforeUnload = (e: BeforeUnloadEvent) => {
  if (!store.hasDirtyTabs()) return;
  e.preventDefault();
  e.returnValue = '';
};

const handleLspDiagnostics = (e: Event) => {
  const detail = (e as CustomEvent<{ path: string; diagnostics: EditorDiagnostic[] }>).detail;
  if (!detail?.path) return;
  store.setDiagnostics(detail.path, detail.diagnostics);
};

const handleActiveLsp = (e: Event) => {
  const detail = (e as CustomEvent<ActiveLspStatus>).detail;
  if (!detail?.path) return;
  store.setActiveLsp(detail);
};

onMounted(async () => {
  window.addEventListener('keydown', blockBrowserShortcuts, { capture: true });
  window.addEventListener('keydown', handleGlobalShortcuts);
  window.addEventListener('beforeunload', confirmBeforeUnload);
  window.addEventListener('aida:lsp-diagnostics', handleLspDiagnostics);
  window.addEventListener('aida:lsp-active', handleActiveLsp);
  window.addEventListener('resize', updateViewport);
  await nextTick();
  updateViewport();

  // Restore file tree
  if (store.currentProject) {
    try {
      store.fileTree = await invoke<FileEntry[]>('get_dir_tree', { path: store.currentProject });
    } catch {}
  }

  // Restore session (all windows + terminal state)
  const saved = localStorage.getItem('aida:session');
  if (saved) {
    try {
      const session = JSON.parse(saved) as {
        windows: Array<{
          id?: string;
          tabs?: { path: string; name: string; content?: string; isDirty?: boolean }[];
          tabPaths: { path: string; name: string }[];
          activeTabPath: string | null;
          savedPos?: { x: number; y: number; w: number; h: number };
        }>;
        browserWindows?: Array<{
          id?: string;
          tabs?: { id?: string; title: string; url: string; srcdoc?: string }[];
          activeTabId?: string | null;
          savedPos?: { x: number; y: number; w: number; h: number };
        }>;
        terminalOpen?: boolean;
        activeWindowId?: string;
        activeBrowserWindowId?: string | null;
        currentProject?: string | null;
        workspaceRoots?: string[];
      };
      const windows = Array.isArray(session)
        ? session.map((w: any) => ({ id: w.id, tabs: w.tabs, tabPaths: w.tabPaths, activeTabPath: w.activeTabPath, savedPos: w.savedPos }))
        : session.windows ?? [];

      for (let i = 0; i < windows.length; i++) {
        const winData = windows[i];
        const windowId = i === 0 ? 'w1' : winData.id ?? `w_s${i}`;
        if (i > 0) store.ensureWindow(windowId);

        const w = store.getWindow(windowId);
        if (w && winData.savedPos) w.initPos = winData.savedPos;

        const tabs = winData.tabs?.length ? winData.tabs : winData.tabPaths ?? [];
        for (const savedTab of tabs) {
          const { path, name } = savedTab;
          try {
            const content = savedTab.isDirty && typeof savedTab.content === 'string'
              ? savedTab.content
              : await invoke<string>('read_file', { path });
            const tab = store.openTab(path, name, content, windowId);
            if (tab && savedTab.isDirty) {
              tab.content = content;
              tab.isDirty = true;
            }
          } catch {}
        }
        const wFinal = store.getWindow(windowId);
        if (wFinal && winData.activeTabPath) wFinal.activeTabPath = winData.activeTabPath;
      }
      if (session.terminalOpen) store.isBottomPanelVisible = true;
      if (session.activeWindowId && store.getWindow(session.activeWindowId)) {
        store.activeWindowId = session.activeWindowId;
      }
      if (Array.isArray(session.browserWindows)) {
        store.browserWindows = session.browserWindows
          .filter(win => Array.isArray(win.tabs) && win.tabs.length)
          .map((win, index) => ({
            id: win.id ?? `b_s${index}`,
            tabs: (win.tabs ?? []).map((tab, tabIndex) => ({
              id: tab.id ?? `bt_s${index}_${tabIndex}`,
              title: tab.title,
              url: tab.url,
              srcdoc: tab.srcdoc,
            })),
            activeTabId: win.activeTabId ?? win.tabs?.[0]?.id ?? `bt_s${index}_0`,
            initPos: win.savedPos,
            savedPos: win.savedPos,
          }));
        if (session.activeBrowserWindowId && store.getBrowserWindow(session.activeBrowserWindowId)) {
          store.activeBrowserWindowId = session.activeBrowserWindowId;
        }
      }
      if (Array.isArray(session.workspaceRoots)) {
        for (const root of session.workspaceRoots) store.addWorkspaceRoot(root);
      }
      if (session.currentProject) store.setCurrentProject(session.currentProject);
    } catch {}
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', blockBrowserShortcuts, { capture: true });
  window.removeEventListener('keydown', handleGlobalShortcuts);
  window.removeEventListener('beforeunload', confirmBeforeUnload);
  window.removeEventListener('aida:lsp-diagnostics', handleLspDiagnostics);
  window.removeEventListener('aida:lsp-active', handleActiveLsp);
  window.removeEventListener('resize', updateViewport);
  if (viewportRaf) cancelAnimationFrame(viewportRaf);
});
</script>

<template>
  <div class="flex flex-col h-screen bg-[var(--aida-bg)] text-white overflow-hidden select-none" :style="appThemeStyle">

    <AppBar
      @toggle-menu="toggleMenu"
      @open-git="openGit"
      @open-debug="showDebug = true"
      @open-browser="store.openBrowserWindow({ url: 'https://google.com', title: 'Browser' })"
      @open-api="showApiClient = true"
      @open-visual="showVisualBuilder = true"
      @focus-window="centerWindow"
      @focus-browser-window="centerBrowserWindow"
      @open-settings="showSettings = true"
    />

    <CommandPalette
      @open-settings="showSettings = true"
      @open-search="showSearch = true"
      @open-problems="showProblems = true"
      @open-tasks="showTasks = true"
      @open-debug="showDebug = true"
      @open-browser="store.openBrowserWindow({ url: 'https://google.com', title: 'Browser' })"
      @open-api="showApiClient = true"
      @open-visual="showVisualBuilder = true"
    />
    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
    <SearchPanel v-if="showSearch" @close="showSearch = false" />
    <ProblemsPanel v-if="showProblems" @close="showProblems = false" />
    <TasksPanel v-if="showTasks" @close="showTasks = false" />
    <DebugPanel v-if="showDebug" @close="showDebug = false" />
    <FloatingApiClient v-if="showApiClient" @close="showApiClient = false" />
    <FloatingMenu v-if="showMenu" :key="menuKey" :initial-tab="menuInitialTab" @close="showMenu = false" />

    <!-- Floating window workspace — scrollable infinite canvas -->
    <div
      id="main-canvas"
      ref="canvasRef"
      class="flex-1 overflow-auto"
      :class="isPanningCanvas ? 'cursor-grabbing' : 'cursor-default'"
      style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.06) transparent; overscroll-behavior: contain;"
      @scroll="scheduleViewportUpdate"
      @mousedown="handleCanvasMouseDown"
    >
      <div :style="canvasStyle">
        <FloatingEditor
          v-for="win in visibleEditorWindows"
          :key="win.id"
          :window-id="win.id"
        />
        <FloatingBrowser
          v-for="win in visibleBrowserWindows"
          :key="win.id"
          :window-id="win.id"
        />
        <FloatingVisualBuilder v-if="showVisualBuilder" @close="showVisualBuilder = false" />
        <FloatingTerminal v-if="store.isBottomPanelVisible" />
      </div>
    </div>
  </div>
</template>
