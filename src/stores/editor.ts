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

export interface EditorNavigationRequest {
  path: string;
  line: number;
  column: number;
  token: number;
}

export interface EditorDiagnostic {
  path: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
  worktree?: boolean;
  index_status?: string | null;
  worktree_status?: string | null;
}

export interface LspServerStatus {
  id: string;
  label: string;
  languages: string[];
  available: boolean;
  command?: string | null;
  source?: string | null;
}

export interface ActiveLspStatus {
  path: string;
  available: boolean;
  label: string;
  languageId: string;
  command?: string;
}

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  vimEnabled: boolean;
  wordWrap: boolean;
  fontFamily: string;
  accentColor: string;
  backgroundColor: string;
  panelColor: string;
  keybindings: Record<string, string>;
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

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  srcdoc?: string;
  mode?: 'embed' | 'native';
  nativeWindowLabel?: string;
  nativeOpened?: boolean;
}

export interface BrowserWindowState {
  id: string;
  tabs: BrowserTab[];
  activeTabId: string | null;
  initPos?: { x: number; y: number; w: number; h: number };
  savedPos?: { x: number; y: number; w: number; h: number };
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'command-palette': 'Ctrl+P',
  'open-settings': 'Ctrl+,',
  'open-search': 'Ctrl+Shift+F',
  'open-problems': 'Ctrl+Shift+M',
  'open-tasks': 'Ctrl+Shift+B',
  'open-debug': 'Ctrl+Shift+D',
  'open-browser': 'Ctrl+Shift+G',
  'open-api': 'Ctrl+Shift+A',
  'open-visual': 'Ctrl+Shift+V',
  'save-file': 'Ctrl+S',
  'next-file': 'Ctrl+Tab',
  'prev-file': 'Ctrl+Shift+Tab',
  'lsp-definition': 'F12',
  'lsp-references': 'Shift+F12',
  'lsp-rename': 'F2',
  'lsp-actions': 'Ctrl+.',
  'lsp-format': 'Shift+Alt+F',
  'toggle-terminal': 'Ctrl+J',
};

export const useEditorStore = defineStore('editor', () => {
  const normalizePath = (path: string) => path.replace(/\\/g, '/');
  const readWorkspaceRoots = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('aida:projects') ?? '[]');
      if (Array.isArray(saved)) return [...new Set(saved.map(String).filter(Boolean).map(normalizePath))];
    } catch {}
    return [];
  };

  const savedProject = localStorage.getItem('aida:project');
  const workspaceRoots = ref<string[]>(readWorkspaceRoots());
  if (savedProject && !workspaceRoots.value.includes(normalizePath(savedProject))) {
    workspaceRoots.value.unshift(normalizePath(savedProject));
  }

  const currentProject = ref<string | null>(savedProject ? normalizePath(savedProject) : workspaceRoots.value[0] ?? null);
  watch(currentProject, v => {
    if (v) localStorage.setItem('aida:project', v);
    else localStorage.removeItem('aida:project');
  });
  watch(workspaceRoots, roots => {
    localStorage.setItem('aida:projects', JSON.stringify(roots));
  }, { deep: true });
  const fileTree = ref<FileEntry[]>([]);
  const gitStatuses = ref<Record<string, string>>({});
  const gitStatusEntries = ref<GitFileStatus[]>([]);
  const gitBranch = ref<string>('main');
  const diagnostics = ref<Record<string, EditorDiagnostic[]>>({});
  const lspStatuses = ref<LspServerStatus[]>([]);
  const activeLsp = ref<ActiveLspStatus | null>(null);

  const isBottomPanelVisible = ref(false);
  const isSidebarVisible = ref(true);
  const vimMode = ref('NORMAL');
  const cursorLine = ref(0);
  const cursorChar = ref(0);
  const navigationRequest = ref<EditorNavigationRequest | null>(null);

  const activeWindowId = ref('w1');
  const activeBrowserWindowId = ref<string | null>(null);

  const editorWindows = ref<EditorWindowState[]>([
    { id: 'w1', tabs: [], activeTabPath: null },
  ]);
  const browserWindows = ref<BrowserWindowState[]>([]);

  const defaultSettings: EditorSettings = {
    fontSize: 14,
    tabSize: 2,
    vimEnabled: true,
    wordWrap: false,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    accentColor: '#5ee0b5',
    backgroundColor: '#0b0b0d',
    panelColor: '#111116',
    keybindings: { ...DEFAULT_KEYBINDINGS },
  };

  const settings = reactive<EditorSettings>({ ...defaultSettings });
  try {
    const savedSettings = localStorage.getItem('aida:settings');
    if (savedSettings) Object.assign(settings, defaultSettings, JSON.parse(savedSettings));
    settings.keybindings = { ...DEFAULT_KEYBINDINGS, ...(settings.keybindings ?? {}) };
  } catch {}

  watch(settings, v => {
    localStorage.setItem('aida:settings', JSON.stringify(v));
  }, { deep: true });

  /* ── window helpers ─────────────────────────── */

  function getWindow(id: string): EditorWindowState | undefined {
    return editorWindows.value.find(w => w.id === id);
  }

  function makeWindowId() {
    return `w${Date.now()}`;
  }

  function makeBrowserWindowId() {
    return `b${Date.now()}`;
  }

  function makeBrowserTabId() {
    return `bt${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }

  /* ── tab operations ─────────────────────────── */

  function openTab(path: string, name: string, content: string, windowId?: string) {
    path = normalizePath(path);
    const wid = windowId ?? activeWindowId.value;
    const win = getWindow(wid);
    if (!win) return;
    const existing = win.tabs.find(t => t.path === path);
    if (existing) { win.activeTabPath = path; return existing; }
    const tab = { path, name, content, isDirty: false };
    win.tabs.push(tab);
    win.activeTabPath = path;
    return tab;
  }

  function updateTabContent(path: string, content: string, dirty = true) {
    const normalized = normalizePath(path);
    for (const win of editorWindows.value) {
      const tab = win.tabs.find(tab => tab.path === normalized);
      if (!tab) continue;
      tab.content = content;
      tab.isDirty = dirty;
      window.dispatchEvent(new CustomEvent('aida:tab-content-updated', {
        detail: { path: normalized, content },
      }));
      return true;
    }
    return false;
  }

  function switchTab(windowId: string, direction: 1 | -1) {
    const win = getWindow(windowId);
    if (!win?.tabs.length) return;
    const currentIndex = Math.max(0, win.tabs.findIndex(tab => tab.path === win.activeTabPath));
    const nextIndex = (currentIndex + direction + win.tabs.length) % win.tabs.length;
    win.activeTabPath = win.tabs[nextIndex].path;
  }

  function hasDirtyTabs() {
    return editorWindows.value.some(w => w.tabs.some(t => t.isDirty));
  }

  function confirmCloseDirty(tabsToClose: Tab[]) {
    const dirty = tabsToClose.filter(t => t.isDirty);
    if (!dirty.length) return true;
    const label = dirty.length === 1
      ? `"${dirty[0].name}" has unsaved changes.`
      : `${dirty.length} files have unsaved changes.`;
    return window.confirm(`${label}\n\nClose without saving?`);
  }

  function closeTab(path: string, windowId: string, options: { force?: boolean } = {}) {
    path = normalizePath(path);
    const win = getWindow(windowId);
    if (!win) return;
    const idx = win.tabs.findIndex(t => t.path === path);
    if (idx === -1) return;
    if (!options.force && !confirmCloseDirty([win.tabs[idx]])) return;
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

  function closeAllTabs(windowId: string) {
    const win = getWindow(windowId);
    if (!win || !confirmCloseDirty(win.tabs)) return;
    for (const tab of [...win.tabs]) closeTab(tab.path, windowId, { force: true });
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

    closeTab(tabPath, fromWindowId, { force: true });
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

    closeTab(tabPath, fromWindowId, { force: true });
    activeWindowId.value = newId;
  }

  function nextWindowPosition() {
    const canvas = document.getElementById('main-canvas');
    const sl = canvas?.scrollLeft ?? 0;
    const st = canvas?.scrollTop ?? 0;
    const offset = Math.min(180, editorWindows.value.length * 34);
    return {
      x: Math.max(0, sl + 80 + offset),
      y: Math.max(0, st + 56 + offset),
      w: 760,
      h: 500,
    };
  }

  function nextBrowserWindowPosition() {
    const pos = nextWindowPosition();
    return { ...pos, w: Math.max(900, pos.w), h: Math.max(620, pos.h) };
  }

  function openFileInNewWindow(path: string, name: string, content: string) {
    const newId = makeWindowId();
    const normalized = normalizePath(path);
    editorWindows.value.push({
      id: newId,
      tabs: [{ path: normalized, name, content, isDirty: false }],
      activeTabPath: normalized,
      initPos: nextWindowPosition(),
    });
    activeWindowId.value = newId;
    return newId;
  }

  function getBrowserWindow(id: string) {
    return browserWindows.value.find(w => w.id === id);
  }

  function createBrowserTab(input: Partial<BrowserTab> = {}): BrowserTab {
    const url = input.url ?? 'about:blank';
    return {
      id: input.id ?? makeBrowserTabId(),
      title: input.title ?? (input.srcdoc ? 'Preview' : url),
      url,
      srcdoc: input.srcdoc,
      mode: input.mode ?? 'embed',
      nativeWindowLabel: input.nativeWindowLabel,
      nativeOpened: input.nativeOpened,
    };
  }

  function openBrowserWindow(input: Partial<BrowserTab> = {}) {
    const id = makeBrowserWindowId();
    const tab = createBrowserTab(input);
    browserWindows.value.push({
      id,
      tabs: [tab],
      activeTabId: tab.id,
      initPos: nextBrowserWindowPosition(),
    });
    activeBrowserWindowId.value = id;
    return id;
  }

  function closeBrowserWindow(id: string) {
    browserWindows.value = browserWindows.value.filter(w => w.id !== id);
    if (activeBrowserWindowId.value === id) {
      activeBrowserWindowId.value = browserWindows.value[browserWindows.value.length - 1]?.id ?? null;
    }
  }

  function addBrowserTab(windowId: string, input: Partial<BrowserTab> = {}) {
    const win = getBrowserWindow(windowId);
    if (!win) return null;
    const tab = createBrowserTab(input);
    win.tabs.push(tab);
    win.activeTabId = tab.id;
    return tab;
  }

  function closeBrowserTab(windowId: string, tabId: string) {
    const win = getBrowserWindow(windowId);
    if (!win) return;
    const idx = win.tabs.findIndex(tab => tab.id === tabId);
    if (idx === -1) return;
    win.tabs.splice(idx, 1);
    if (!win.tabs.length) {
      closeBrowserWindow(windowId);
      return;
    }
    if (win.activeTabId === tabId) {
      win.activeTabId = win.tabs[Math.max(0, idx - 1)].id;
    }
  }

  function updateBrowserTab(windowId: string, tabId: string, patch: Partial<BrowserTab>) {
    const win = getBrowserWindow(windowId);
    const tab = win?.tabs.find(tab => tab.id === tabId);
    if (!tab) return;
    Object.assign(tab, patch);
  }

  function switchBrowserTab(windowId: string, direction: 1 | -1) {
    const win = getBrowserWindow(windowId);
    if (!win?.tabs.length) return;
    const currentIndex = Math.max(0, win.tabs.findIndex(tab => tab.id === win.activeTabId));
    const nextIndex = (currentIndex + direction + win.tabs.length) % win.tabs.length;
    win.activeTabId = win.tabs[nextIndex].id;
  }

  function revealLocation(path: string, line: number, column = 0) {
    navigationRequest.value = {
      path: normalizePath(path),
      line: Math.max(1, line),
      column: Math.max(0, column),
      token: Date.now(),
    };
  }

  function setDiagnostics(path: string, items: EditorDiagnostic[]) {
    const normalized = normalizePath(path);
    diagnostics.value = {
      ...diagnostics.value,
      [normalized]: items.map(item => ({ ...item, path: normalized })),
    };
  }

  function getAllDiagnostics() {
    return Object.values(diagnostics.value).flat();
  }

  function setLspStatuses(statuses: LspServerStatus[]) {
    lspStatuses.value = statuses;
  }

  function setActiveLsp(status: ActiveLspStatus) {
    activeLsp.value = {
      ...status,
      path: normalizePath(status.path),
    };
  }

  /* ── persistence ────────────────────────────── */

  function saveSession() {
    const session = {
      windows: editorWindows.value.map(w => ({
        id: w.id,
        tabs: w.tabs.map(t => ({
          path: t.path,
          name: t.name,
          content: t.content,
          isDirty: t.isDirty,
        })),
        tabPaths: w.tabs.map(t => ({ path: t.path, name: t.name })),
        activeTabPath: w.activeTabPath,
        savedPos: w.savedPos ?? w.initPos,
      })),
      browserWindows: browserWindows.value.map(w => ({
        id: w.id,
        tabs: w.tabs.map(t => ({ ...t })),
        activeTabId: w.activeTabId,
        savedPos: w.savedPos ?? w.initPos,
      })),
      terminalOpen: isBottomPanelVisible.value,
      activeWindowId: activeWindowId.value,
      activeBrowserWindowId: activeBrowserWindowId.value,
      currentProject: currentProject.value,
      workspaceRoots: workspaceRoots.value,
    };
    localStorage.setItem('aida:session', JSON.stringify(session));
  }

  watch(editorWindows, saveSession, { deep: true });
  watch(browserWindows, saveSession, { deep: true });
  watch(isBottomPanelVisible, saveSession);
  watch(activeWindowId, saveSession);
  watch(activeBrowserWindowId, saveSession);

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

  function addWorkspaceRoot(path: string) {
    const normalized = normalizePath(path);
    if (!workspaceRoots.value.includes(normalized)) {
      workspaceRoots.value.push(normalized);
    }
    currentProject.value = normalized;
  }

  function removeWorkspaceRoot(path: string) {
    const normalized = normalizePath(path);
    workspaceRoots.value = workspaceRoots.value.filter(root => root !== normalized);
    if (currentProject.value === normalized) {
      currentProject.value = workspaceRoots.value[0] ?? null;
    }
  }

  function setCurrentProject(path: string) {
    const normalized = normalizePath(path);
    if (!workspaceRoots.value.includes(normalized)) {
      workspaceRoots.value.push(normalized);
    }
    currentProject.value = normalized;
  }

  return {
    workspaceRoots,
    currentProject,
    fileTree,
    gitStatuses,
    gitStatusEntries,
    gitBranch,
    diagnostics,
    lspStatuses,
    activeLsp,
    isBottomPanelVisible,
    isSidebarVisible,
    vimMode,
    cursorLine,
    cursorChar,
    navigationRequest,
    activeWindowId,
    activeBrowserWindowId,
    editorWindows,
    browserWindows,
    settings,
    getWindow,
    normalizePath,
    openTab,
    updateTabContent,
    switchTab,
    openFileInNewWindow,
    getBrowserWindow,
    openBrowserWindow,
    closeBrowserWindow,
    addBrowserTab,
    closeBrowserTab,
    updateBrowserTab,
    switchBrowserTab,
    closeTab,
    closeAllTabs,
    moveTabToWindow,
    createWindowFromTab,
    hasDirtyTabs,
    revealLocation,
    setDiagnostics,
    getAllDiagnostics,
    setLspStatuses,
    setActiveLsp,
    toggleTerminal,
    ensureWindow,
    getActiveWindow,
    addWorkspaceRoot,
    removeWorkspaceRoot,
    setCurrentProject,
  };
});
