<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, highlightSpecialChars, drawSelection, highlightActiveLine,
  dropCursor, rectangularSelection, crosshairCursor, lineNumbers, highlightActiveLineGutter
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sass } from '@codemirror/lang-sass';
import { vue } from '@codemirror/lang-vue';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { vim, Vim } from '@replit/codemirror-vim';
import { useEditorStore } from '../stores/editor';
import { useFloating } from '../composables/useFloating';
import { tabDrag } from '../composables/useTabDrag';
import { X } from 'lucide-vue-next';

/* ── props ──────────────────────────────────────── */
const props = defineProps<{ windowId: string }>();

/* ── store ──────────────────────────────────────── */
const store = useEditorStore();

const win = computed(() => store.getWindow(props.windowId));
const tabs = computed(() => win.value?.tabs ?? []);
const activeTabPath = computed({
  get: () => win.value?.activeTabPath ?? null,
  set: (v) => { if (win.value) win.value.activeTabPath = v; },
});

/* ── floating window ────────────────────────────── */
const { pos, dragging, resizing, startDrag, startResize, initFromCanvas, bringToFront } =
  useFloating({ x: 8, y: 8, w: 800, h: 500 });

/* ── editor ─────────────────────────────────────── */
const editorWrap = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
let ro: ResizeObserver | null = null;

const getExt = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

const getLang = (name: string) => {
  switch (getExt(name)) {
    case 'js':              return javascript();
    case 'jsx':             return javascript({ jsx: true });
    case 'ts':              return javascript({ typescript: true });
    case 'tsx':             return javascript({ jsx: true, typescript: true });
    case 'rs':              return rust();
    case 'go':              return go();
    case 'py':              return python();
    case 'html': case 'htm': return html();
    case 'css':             return css();
    case 'scss': case 'sass': return sass();
    case 'vue':             return vue();
    case 'json': case 'jsonc': return json();
    case 'md':   case 'mdx':  return markdown();
    case 'xml':  case 'svg':  return xml();
    default:                return javascript();
  }
};

const getLangLabel = (name: string) => {
  const m: Record<string, string> = {
    js:'JS', jsx:'JSX', ts:'TS', tsx:'TSX', rs:'Rust', go:'Go', py:'Python',
    html:'HTML', htm:'HTML', css:'CSS', scss:'SCSS', sass:'SASS', vue:'Vue',
    json:'JSON', jsonc:'JSON', md:'MD', mdx:'MDX', xml:'XML', svg:'SVG',
  };
  return m[getExt(name)] ?? 'Text';
};

const getExtColor = (name: string) => {
  const m: Record<string, string> = {
    ts:'text-blue-400', tsx:'text-blue-400',
    js:'text-yellow-400', jsx:'text-yellow-400',
    rs:'text-orange-400', go:'text-cyan-400', py:'text-yellow-300',
    vue:'text-emerald-400', html:'text-red-400', css:'text-sky-400',
    scss:'text-pink-400', sass:'text-pink-400', json:'text-amber-300',
    jsonc:'text-amber-300', md:'text-slate-400', mdx:'text-slate-400',
    xml:'text-orange-300', svg:'text-orange-300',
  };
  return m[getExt(name)] ?? 'text-slate-400';
};

const editorTheme = EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: '#abb2bf' },
  '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: '13.5px', lineHeight: '1.65' },
  '.cm-content': { caretColor: '#528bff', padding: '4px 0' },
  '.cm-gutters': { background: 'transparent', color: '#3d4045', border: 'none', borderRight: '1px solid rgba(255,255,255,0.04)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '36px' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.02)' },
  '.cm-activeLineGutter': { background: 'rgba(255,255,255,0.02)', color: '#9da5b4' },
  '.cm-cursor': { borderLeftColor: '#528bff', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { background: 'rgba(82,139,255,0.18) !important' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(82,139,255,0.22) !important' },
  '.cm-tooltip': { background: '#18191e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 12px', fontSize: '12.5px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'rgba(82,139,255,0.25)' },
  '.cm-matchingBracket': { background: 'rgba(255,153,0,0.15)', color: '#ffa500 !important' },
}, { dark: true });

const lspComplete = async (ctx: CompletionContext) => {
  if (!activeTabPath.value) return null;
  const word = ctx.matchBefore(/[\w.]/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  try {
    const r = await invoke<any>('send_lsp_message', {
      message: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'textDocument/completion', params: {
        textDocument: { uri: `file://${activeTabPath.value}` },
        position: { line: store.cursorLine, character: store.cursorChar },
      }})
    });
    if (!r?.items?.length) return null;
    return { from: word.from, options: r.items.slice(0, 50).map((i: any) => ({
      label: i.label, type: i.kind === 3 ? 'function' : i.kind === 6 ? 'variable' : 'keyword', info: i.detail,
    }))};
  } catch { return null; }
};

const makeExtensions = (name: string) => {
  const exts = [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
    history(), foldGutter(), drawSelection(), dropCursor(),
    EditorState.allowMultipleSelections.of(true), indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(), closeBrackets(),
    autocompletion({ override: [lspComplete], activateOnTyping: true }),
    rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
    EditorView.updateListener.of(u => {
      if (u.docChanged && activeTabPath.value) {
        const t = tabs.value.find(t => t.path === activeTabPath.value);
        if (t) t.isDirty = true;
      }
      if (u.selectionSet) {
        const p = u.state.selection.main.head;
        const line = u.state.doc.lineAt(p);
        store.cursorLine = line.number - 1;
        store.cursorChar = p - line.from;
      }
    }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    getLang(name), oneDark, editorTheme,
  ];
  if (store.settings.vimEnabled) exts.unshift(vim());
  if (store.settings.wordWrap) exts.push(EditorView.lineWrapping);
  return exts;
};

const WELCOME = `// Ласкаво просимо до Aida Code Studio
// ────────────────────────────────────────────────────────
// Відкрий проект:  МЕНЮ → Провідник
//
// Мови:  TypeScript  JavaScript  Go  Rust  Python
//        Vue 3  HTML  CSS/SCSS  JSON  Markdown  XML
//
// Шорткати:
//   Ctrl+S    Зберегти       Ctrl+P    Палітра команд
//   Ctrl+J    Термінал       Ctrl+F    Пошук у файлі

`;

const initEditor = (doc: string, name: string) => {
  if (!editorWrap.value) return;
  view?.destroy();
  const state = EditorState.create({ doc, extensions: makeExtensions(name) });
  view = new EditorView({ state, parent: editorWrap.value });
  // Double RAF: first frame allows browser layout, second ensures CodeMirror remeasures
  requestAnimationFrame(() => requestAnimationFrame(() => view?.requestMeasure()));
};

const saveFile = async () => {
  if (!activeTabPath.value || !view) return;
  const content = view.state.doc.toString();
  try {
    await invoke('save_file', { path: activeTabPath.value, content });
    const t = tabs.value.find(t => t.path === activeTabPath.value);
    if (t) { t.content = content; t.isDirty = false; }
  } catch (e) { console.error('Save:', e); }
};

const handleKeys = (e: KeyboardEvent) => {
  if (e.ctrlKey && e.key === 'j') { e.preventDefault(); store.toggleTerminal(); }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
};

/* ── drag-and-drop ──────────────────────────────── */
const dropTarget = ref(false);

const onTabDragStart = (e: DragEvent, tabPath: string) => {
  e.dataTransfer!.effectAllowed = 'move';
  e.dataTransfer!.setData('text/plain', tabPath);
  tabDrag.active = true;
  tabDrag.fromWindowId = props.windowId;
  tabDrag.tabPath = tabPath;
  tabDrag.droppedInWindow = false;
};

const onTabDragEnd = (e: DragEvent) => {
  if (!tabDrag.droppedInWindow) {
    // Sync live content to store before copying the tab to the new window
    if (view && tabDrag.tabPath === activeTabPath.value) {
      const t = tabs.value.find(t => t.path === tabDrag.tabPath);
      if (t) t.content = view.state.doc.toString();
    }
    store.createWindowFromTab(tabDrag.tabPath, tabDrag.fromWindowId, e.clientX, e.clientY);
  }
  tabDrag.active = false;
  tabDrag.fromWindowId = '';
  tabDrag.tabPath = '';
  dropTarget.value = false;
};

const onPanelDragOver = (e: DragEvent) => {
  if (!tabDrag.active || tabDrag.fromWindowId === props.windowId) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'move';
  dropTarget.value = true;
};

const onPanelDragLeave = () => { dropTarget.value = false; };

const onPanelDrop = (e: DragEvent) => {
  e.preventDefault();
  dropTarget.value = false;
  if (!tabDrag.active || tabDrag.fromWindowId === props.windowId) return;
  tabDrag.droppedInWindow = true;
  store.moveTabToWindow(tabDrag.tabPath, tabDrag.fromWindowId, props.windowId);
};

/* ── lifecycle ──────────────────────────────────── */
onMounted(async () => {
  (Vim as any).on('vim-mode-change', (m: any) => { store.vimMode = m.mode.toUpperCase(); });
  window.addEventListener('keydown', handleKeys);

  await nextTick();

  const initPos = win.value?.initPos;
  if (initPos) {
    pos.x = initPos.x; pos.y = initPos.y;
    pos.w = initPos.w; pos.h = initPos.h;
    if (win.value) win.value.initPos = undefined;
  } else {
    initFromCanvas(0, 0.68);
  }

  // Persist the position we just applied
  if (win.value) win.value.savedPos = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };

  // RAF: browser finishes layout before CodeMirror measures
  await new Promise<void>(r => requestAnimationFrame(r));

  const path = activeTabPath.value;
  const tab = path ? tabs.value.find(t => t.path === path) : null;
  initEditor(tab?.content ?? WELCOME, tab?.name ?? 'welcome.js');

  if (editorWrap.value) {
    ro = new ResizeObserver(() => view?.requestMeasure());
    ro.observe(editorWrap.value);
  }
});

// React to initPos set AFTER mount (e.g. session restore sets initPos on already-mounted w1)
watch(() => win.value?.initPos, (ip) => {
  if (!ip) return;
  pos.x = ip.x; pos.y = ip.y; pos.w = ip.w; pos.h = ip.h;
  if (win.value) { win.value.initPos = undefined; win.value.savedPos = ip; }
});

watch(activeTabPath, (newPath) => {
  if (!newPath) { initEditor(WELCOME, 'welcome.js'); return; }
  const tab = tabs.value.find(t => t.path === newPath);
  if (!tab) return;
  if (tab.name.endsWith('.go'))  invoke('start_lsp', { cmd: 'gopls', args: [] }).catch(() => {});
  else if (tab.name.endsWith('.rs'))   invoke('start_lsp', { cmd: 'rust-analyzer', args: [] }).catch(() => {});
  else if (tab.name.endsWith('.py'))   invoke('start_lsp', { cmd: 'pyright-langserver', args: ['--stdio'] }).catch(() => {});
  else if (/\.[jt]sx?$/.test(tab.name)) invoke('start_lsp', { cmd: 'typescript-language-server', args: ['--stdio'] }).catch(() => {});
  initEditor(tab.content, tab.name);
});

watch(() => [store.settings.vimEnabled, store.settings.wordWrap], () => {
  const tab = tabs.value.find(t => t.path === activeTabPath.value);
  const doc  = view?.state.doc.toString() ?? tab?.content ?? WELCOME;
  initEditor(doc, tab?.name ?? 'welcome.js');
});

// Save window position/size when drag or resize ends
watch([dragging, resizing], ([d, r]) => {
  if (!d && !r && win.value) {
    win.value.savedPos = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeys);
  ro?.disconnect();
  view?.destroy();
});
</script>

<template>
  <!-- Floating editor panel -->
  <div
    class="absolute flex flex-col rounded-xl border bg-[#111116] shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden transition-[border-color] duration-150"
    :class="[
      dropTarget ? 'border-blue-500/60' : 'border-white/8',
      dragging || resizing ? 'select-none' : '',
    ]"
    :style="{ left: pos.x+'px', top: pos.y+'px', width: pos.w+'px', height: pos.h+'px', zIndex: pos.z }"
    @mousedown.capture="bringToFront(); store.activeWindowId = windowId"
    @dragover="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop="onPanelDrop"
  >

    <!-- Drop overlay hint -->
    <div
      v-if="dropTarget"
      class="absolute inset-0 z-50 bg-blue-500/8 border-2 border-blue-500/40 rounded-xl pointer-events-none flex items-center justify-center"
    >
      <span class="text-blue-400/70 text-[13px] font-semibold bg-[#111116]/80 px-4 py-2 rounded-lg border border-blue-500/30">
        Перемістити вкладку сюди
      </span>
    </div>

    <!-- Tab bar — drag handle -->
    <div
      class="h-10 flex items-stretch bg-[#0d0d10] border-b border-white/6 overflow-x-auto shrink-0 cursor-move"
      style="scrollbar-width:none"
      @mousedown="startDrag"
    >
      <!-- Tabs -->
      <div
        v-for="tab in tabs"
        :key="tab.path"
        class="tab-item group flex items-center gap-2 px-4 border-r border-white/5 cursor-pointer transition-all shrink-0 relative"
        :class="activeTabPath === tab.path
          ? 'bg-[#111116] text-white'
          : 'text-white/35 hover:text-white/60 hover:bg-white/3'"
        draggable="true"
        @click="activeTabPath = tab.path"
        @mousedown.stop
        @dragstart="onTabDragStart($event, tab.path)"
        @dragend="onTabDragEnd"
      >
        <!-- Active top indicator -->
        <div
          v-if="activeTabPath === tab.path"
          class="absolute top-0 left-3 right-3 h-px"
          :class="getExtColor(tab.name).replace('text-', 'bg-')"
        ></div>

        <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="getExtColor(tab.name).replace('text-', 'bg-')"></div>
        <span class="text-[12px] font-medium pointer-events-none">{{ tab.name }}</span>
        <span class="text-[9px] font-bold opacity-50 pointer-events-none">{{ getLangLabel(tab.name) }}</span>

        <div class="w-3.5 h-3.5 flex items-center justify-center">
          <div v-if="tab.isDirty" class="w-1.5 h-1.5 bg-amber-400 rounded-full group-hover:hidden shrink-0"></div>
          <button
            @click.stop="store.closeTab(tab.path, windowId)"
            class="hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-sm hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          ><X :size="10" /></button>
        </div>
      </div>

      <!-- Empty hint -->
      <div v-if="!tabs.length" class="flex items-center px-5 text-[12px] text-white/20 italic">
        Open a file — МЕНЮ → Провідник
      </div>

      <!-- Right: vim mode + cursor + close all -->
      <div class="ml-auto flex items-center gap-3 px-4 text-[11px] text-white/30 shrink-0" @mousedown.stop>
        <span
          class="font-bold px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
          :class="{
            'bg-emerald-500/20 text-emerald-400': store.vimMode === 'INSERT',
            'bg-amber-500/20  text-amber-400':   store.vimMode === 'VISUAL',
            'bg-blue-500/20   text-blue-400':    store.vimMode === 'NORMAL',
            'bg-red-500/20    text-red-400':     store.vimMode === 'REPLACE',
          }"
          @click="store.settings.vimEnabled = !store.settings.vimEnabled"
          :title="store.settings.vimEnabled ? 'Vim ON' : 'Vim OFF'"
        >
          {{ store.settings.vimEnabled ? store.vimMode : 'VIM OFF' }}
        </span>
        <span v-if="activeTabPath">
          Ln {{ store.cursorLine + 1 }}, Col {{ store.cursorChar + 1 }}
        </span>
        <button
          v-if="tabs.length > 0"
          @click="[...tabs].forEach(t => store.closeTab(t.path, windowId))"
          class="hover:text-white/70 transition-colors"
          title="Закрити всі"
        ><X :size="13" /></button>
      </div>
    </div>

    <!-- Editor area -->
    <div class="relative flex-1 bg-[#0e0e11]" style="min-height:0">
      <div ref="editorWrap" class="absolute inset-0"></div>
    </div>

    <!-- Status strip -->
    <div class="h-6 bg-[#0d0d10] border-t border-white/5 flex items-center justify-between px-4 text-[10px] text-white/25 shrink-0 select-none">
      <div class="flex items-center gap-3">
        <span v-if="activeTabPath" :class="getExtColor(tabs.find(t=>t.path===activeTabPath)?.name ?? '')">
          {{ getLangLabel(tabs.find(t=>t.path===activeTabPath)?.name ?? '') }}
        </span>
        <span>UTF-8</span>
        <span>{{ store.settings.tabSize }} spaces</span>
      </div>
      <div class="flex items-center gap-3">
        <span>{{ store.gitBranch }}</span>
        <span v-if="Object.keys(store.gitStatuses).length" class="text-amber-400/60">
          {{ Object.keys(store.gitStatuses).length }} changes
        </span>
      </div>
    </div>

    <!-- Resize handles -->
    <div class="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'s')"></div>
    <div class="absolute top-3 right-0 bottom-3 w-1.5 cursor-e-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'e')"></div>
    <div class="absolute top-3 left-0 bottom-3 w-1.5 cursor-w-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'w')"></div>
    <div class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-20" @mousedown="startResize($event,'se')"></div>
    <div class="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize z-20" @mousedown="startResize($event,'sw')"></div>
  </div>
</template>

<style>
.cm-editor { height: 100%; background: transparent !important; }
.cm-editor.cm-focused { outline: none !important; }
.cm-scroller { height: 100%; overflow: auto !important; }
.cm-fat-cursor .cm-cursor { background: #528bff !important; border-color: transparent !important; }
</style>
