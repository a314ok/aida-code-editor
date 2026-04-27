<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import AppBar from './components/AppBar.vue';
import FloatingEditor from './components/FloatingEditor.vue';
import FloatingTerminal from './components/FloatingTerminal.vue';
import FloatingMenu from './components/FloatingMenu.vue';
import CommandPalette from './components/CommandPalette.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { useEditorStore, type FileEntry } from './stores/editor';

const store = useEditorStore();
const showSettings = ref(false);
const showMenu = ref(false);

// Only block browser shortcuts that don't conflict with editor/vim commands
const blockBrowserShortcuts = (e: KeyboardEvent) => {
  // Prevent page refresh (F5 has no editor use)
  if (e.key === 'F5') { e.preventDefault(); return; }
  // Ctrl+P: prevent WebView print dialog — our command palette uses this
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') e.preventDefault();
};

onMounted(async () => {
  window.addEventListener('keydown', blockBrowserShortcuts, { capture: true });

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
          tabPaths: { path: string; name: string }[];
          activeTabPath: string | null;
          savedPos?: { x: number; y: number; w: number; h: number };
        }>;
        terminalOpen?: boolean;
      };
      const windows = Array.isArray(session) ? session.map((w: any) => ({ tabPaths: w.tabPaths, activeTabPath: w.activeTabPath, savedPos: w.savedPos })) : session.windows ?? [];

      for (let i = 0; i < windows.length; i++) {
        const winData = windows[i];
        if (!winData.tabPaths?.length) continue;
        const windowId = i === 0 ? 'w1' : `w_s${i}`;
        if (i > 0) store.ensureWindow(windowId);

        const w = store.getWindow(windowId);
        if (w && winData.savedPos) w.initPos = winData.savedPos;

        for (const { path, name } of winData.tabPaths) {
          try {
            const content = await invoke<string>('read_file', { path });
            store.openTab(path, name, content, windowId);
          } catch {}
        }
        const wFinal = store.getWindow(windowId);
        if (wFinal && winData.activeTabPath) wFinal.activeTabPath = winData.activeTabPath;
      }
      if (session.terminalOpen) store.isBottomPanelVisible = true;
    } catch {}
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', blockBrowserShortcuts, { capture: true });
});
</script>

<template>
  <div class="flex flex-col h-screen bg-[#0b0b0d] text-white overflow-hidden select-none">

    <AppBar
      @toggle-menu="showMenu = !showMenu"
      @open-settings="showSettings = true"
    />

    <CommandPalette @open-settings="showSettings = true" />
    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
    <FloatingMenu v-if="showMenu" @close="showMenu = false" />

    <!-- Floating window workspace — scrollable infinite canvas -->
    <div id="main-canvas" class="flex-1 overflow-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.06) transparent">
      <div style="position: relative; width: 4000px; height: 3000px;">
        <FloatingEditor
          v-for="win in store.editorWindows"
          :key="win.id"
          :window-id="win.id"
        />
        <FloatingTerminal v-if="store.isBottomPanelVisible" />
      </div>
    </div>
  </div>
</template>
