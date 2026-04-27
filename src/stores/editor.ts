import { defineStore } from 'pinia';
import { ref, reactive, watch } from 'vue';

export interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: FileEntry[];
  gitStatus?: string;
}

export interface Tab {
  path: string;
  name: string;
  isDirty: boolean;
  content: string;
}

export interface SearchResult {
  path: string;
  line: number;
  content: string;
}

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  vimEnabled: boolean;
  wordWrap: boolean;
  fontFamily: string;
}

export interface EditorWindowState {
  id: string;
  tabs: Tab[];
  activeTabPath: string | null;
  /** Used once by FloatingEditor on mount to set initial position */
  initPos?: { x: number; y: number; w: number; h: number };
  /** Last known position, persisted to localStorage */
  savedPos?: { x: number; y: number; w: number; h: number };
}

export const useEditorStore = defineStore('editor', () => {
  const currentProject = ref<string | null>(localStorage.getItem('aida:project'));
  watch(currentProject, v => {
    if (v) localStorage.setItem('aida:project', v);
    else localStorage.removeItem('aida:project');
  });
  const fileTree = ref<FileEntry[]>([]);
  const gitStatuses = ref<Record<string, string>>({});
  const gitBranch = ref<string>('main');

  const isBottomPanelVisible = ref(false);
  const isSidebarVisible = ref(true);
  const vimMode = ref('NORMAL');
  const cursorLine = ref(0);
  const cursorChar = ref(0);

  const activeWindowId = ref('w1');

  const editorWindows = ref<EditorWindowState[]>([
    { id: 'w1', tabs: [], activeTabPath: null },
  ]);

  const settings = reactive<EditorSettings>({
    fontSize: 14,
    tabSize: 2,
    vimEnabled: true,
    wordWrap: false,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  });

  /* ── window helpers ─────────────────────────── */

  function getWindow(id: string): EditorWindowState | undefined {
    return editorWindows.value.find(w => w.id === id);
  }

  function makeWindowId() {
    return `w${Date.now()}`;
  }

  /* ── tab operations ─────────────────────────── */

  function openTab(path: string, name: string, content: string, windowId?: string) {
    const wid = windowId ?? activeWindowId.value;
    const win = getWindow(wid);
    if (!win) return;
    const existing = win.tabs.find(t => t.path === path);
    if (existing) { win.activeTabPath = path; return; }
    win.tabs.push({ path, name, content, isDirty: false });
    win.activeTabPath = path;
  }

  function closeTab(path: string, windowId: string) {
    const win = getWindow(windowId);
    if (!win) return;
    const idx = win.tabs.findIndex(t => t.path === path);
    if (idx === -1) return;
    win.tabs.splice(idx, 1);
    if (win.activeTabPath === path) {
      win.activeTabPath = win.tabs.length > 0
        ? win.tabs[Math.max(0, idx - 1)].path
        : null;
    }
    // remove empty window (keep at least one)
    if (win.tabs.length === 0 && editorWindows.value.length > 1) {
      editorWindows.value = editorWindows.value.filter(w => w.id !== windowId);
      if (activeWindowId.value === windowId) {
        activeWindowId.value = editorWindows.value[0].id;
      }
    }
  }

  function moveTabToWindow(tabPath: string, fromWindowId: string, toWindowId: string) {
    if (fromWindowId === toWindowId) return;
    const fromWin = getWindow(fromWindowId);
    const toWin   = getWindow(toWindowId);
    if (!fromWin || !toWin) return;

    const tab = fromWin.tabs.find(t => t.path === tabPath);
    if (!tab) return;

    if (!toWin.tabs.find(t => t.path === tabPath)) {
      toWin.tabs.push({ ...tab });
    }
    toWin.activeTabPath = tabPath;

    closeTab(tabPath, fromWindowId);
    activeWindowId.value = toWindowId;
  }

  function createWindowFromTab(tabPath: string, fromWindowId: string, dropX: number, dropY: number) {
    const fromWin = getWindow(fromWindowId);
    if (!fromWin) return;
    const tab = fromWin.tabs.find(t => t.path === tabPath);
    if (!tab) return;

    const canvas = document.getElementById('main-canvas');
    const cr = canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const sl = canvas?.scrollLeft ?? 0;
    const st = canvas?.scrollTop  ?? 0;
    const newId = makeWindowId();

    editorWindows.value.push({
      id: newId,
      tabs: [{ ...tab }],
      activeTabPath: tabPath,
      initPos: {
        x: Math.max(0, dropX - cr.left + sl - 100),
        y: Math.max(0, dropY - cr.top  + st - 20),
        w: 680,
        h: 460,
      },
    });

    closeTab(tabPath, fromWindowId);
    activeWindowId.value = newId;
  }

  /* ── persistence ────────────────────────────── */

  function saveSession() {
    const session = {
      windows: editorWindows.value.map(w => ({
        tabPaths: w.tabs.map(t => ({ path: t.path, name: t.name })),
        activeTabPath: w.activeTabPath,
        savedPos: w.savedPos,
      })),
      terminalOpen: isBottomPanelVisible.value,
    };
    localStorage.setItem('aida:session', JSON.stringify(session));
  }

  watch(editorWindows, saveSession, { deep: true });
  watch(isBottomPanelVisible, saveSession);

  /* ── misc ───────────────────────────────────── */

  function toggleTerminal() {
    isBottomPanelVisible.value = !isBottomPanelVisible.value;
  }

  function ensureWindow(id: string) {
    if (!getWindow(id)) {
      editorWindows.value.push({ id, tabs: [], activeTabPath: null });
    }
  }

  function getActiveWindow() {
    return getWindow(activeWindowId.value);
  }

  return {
    currentProject,
    fileTree,
    gitStatuses,
    gitBranch,
    isBottomPanelVisible,
    isSidebarVisible,
    vimMode,
    cursorLine,
    cursorChar,
    activeWindowId,
    editorWindows,
    settings,
    getWindow,
    openTab,
    closeTab,
    moveTabToWindow,
    createWindowFromTab,
    toggleTerminal,
    ensureWindow,
    getActiveWindow,
  };
});
