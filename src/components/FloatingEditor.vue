<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { invoke } from '../lib/ipc';
import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, highlightSpecialChars, drawSelection, highlightActiveLine,
  dropCursor, rectangularSelection, crosshairCursor, lineNumbers, highlightActiveLineGutter
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, indentUnit, syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from '@codemirror/language';
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
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { getCM, vim } from '@replit/codemirror-vim';
import { useEditorStore, type Tab } from '../stores/editor';
import {
  lspClient,
  uriToPath,
  type LspCodeAction,
  type LspLocation,
  type LspLocationLink,
  type LspRange,
  type LspTextEdit,
  type LspWorkspaceEdit,
} from '../lib/lsp';
import { useFloating } from '../composables/useFloating';
import { tabDrag } from '../composables/useTabDrag';
import { isAltKey, matchesShortcut } from '../lib/shortcuts';
import { AlignLeft, BookOpen, ChevronRight, Hash, Info, Lightbulb, ListTree, LocateFixed, Loader2, Maximize2, Minimize2, MonitorPlay, Pencil, X } from 'lucide-vue-next';

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
const activeTab = computed(() => tabs.value.find(t => t.path === activeTabPath.value) ?? null);

/* ── floating window ────────────────────────────── */
const { pos, dragging, resizing, maximized, startDrag, startResize, initFromCanvas, bringToFront, toggleMaximize } =
  useFloating({ x: 8, y: 8, w: 800, h: 500 });

const panelStyle = computed(() => ({
  left: `${pos.x}px`,
  top: `${pos.y}px`,
  width: `${pos.w}px`,
  height: `${pos.h}px`,
  zIndex: pos.z,
  backgroundColor: `${store.settings.panelColor}/10`,
}));

const applyWindowPos = (nextPos: { x: number; y: number; w: number; h: number }) => {
  pos.x = nextPos.x;
  pos.y = nextPos.y;
  pos.w = nextPos.w;
  pos.h = nextPos.h;
};

const persistWindowPos = () => {
  if (win.value) win.value.savedPos = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };
};

const toggleWindowMaximize = () => {
  toggleMaximize();
  persistWindowPos();
  requestAnimationFrame(() => view?.requestMeasure());
};

const canPreviewHtml = computed(() => {
  const name = activeTab.value?.name.toLowerCase() ?? '';
  return name.endsWith('.html') || name.endsWith('.htm');
});
const canPreviewMarkdown = computed(() => {
  const name = activeTab.value?.name.toLowerCase() ?? '';
  return name.endsWith('.md') || name.endsWith('.mdx');
});

const breadcrumbs = computed(() => {
  if (!activeTabPath.value) return [];
  return activeTabPath.value.replace(/\\/g, '/').split('/').filter(Boolean);
});

const goToLineOpen = ref(false);
const goToLineValue = ref('');
const goToLineInputEl = ref<HTMLInputElement | null>(null);
const selectionInfo = ref('');
const totalLines = ref(0);

const openGoToLine = () => {
  goToLineValue.value = String(store.cursorLine + 1);
  goToLineOpen.value = true;
  nextTick(() => { goToLineInputEl.value?.select(); });
};

const confirmGoToLine = () => {
  const n = parseInt(goToLineValue.value, 10);
  if (Number.isFinite(n) && n >= 1) revealLine(n);
  goToLineOpen.value = false;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const renderInlineMarkdown = (value: string) => escapeHtml(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

const renderMarkdownPreview = (source: string, title: string) => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; font-family: Inter, Segoe UI, sans-serif; background:#111116; color:#e7e7ea; }
  body { margin:0; padding:32px; line-height:1.65; }
  main { max-width:820px; margin:0 auto; }
  h1,h2,h3,h4,h5,h6 { line-height:1.2; margin:1.4em 0 .55em; color:#fff; }
  h1 { font-size:2rem; border-bottom:1px solid rgba(255,255,255,.12); padding-bottom:.35em; }
  p,li,blockquote { color:rgba(255,255,255,.76); }
  a { color:#5ee0b5; }
  code { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.08); border-radius:5px; padding:.12em .35em; }
  pre { overflow:auto; padding:16px; border-radius:8px; background:#08080b; border:1px solid rgba(255,255,255,.08); }
  pre code { padding:0; border:0; background:transparent; }
  blockquote { margin:1em 0; padding:.2em 1em; border-left:3px solid #5ee0b5; background:rgba(94,224,181,.07); }
</style>
</head>
<body><main>${html.join('\n')}</main></body>
</html>`;
};

const previewActiveHtml = () => {
  const tab = activeTab.value;
  if (!tab) return;
  const content = view?.state.doc.toString() ?? tab.content;
  store.openBrowserWindow({
    title: `Preview: ${tab.name}`,
    url: `aida-preview://${tab.name}`,
    srcdoc: content,
  });
};

const previewActiveMarkdown = () => {
  const tab = activeTab.value;
  if (!tab) return;
  const content = view?.state.doc.toString() ?? tab.content;
  store.openBrowserWindow({
    title: `Preview: ${tab.name}`,
    url: `aida-markdown://${tab.name}`,
    srcdoc: renderMarkdownPreview(content, tab.name),
  });
};

/* ── editor ─────────────────────────────────────── */
const editorWrap = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
let ro: ResizeObserver | null = null;
let filePoll: number | null = null;

type LspPanelState =
  | { type: 'hover'; title: string; content: string }
  | { type: 'references'; title: string; items: Array<{ path: string; line: number; column: number; label: string; location: LspLocation | LspLocationLink }> }
  | { type: 'actions'; title: string; items: Array<{ title: string; action: LspCodeAction }> };

const lspPanel = ref<LspPanelState | null>(null);
const lspBusy = ref<string | null>(null);
const lspMessage = ref('');

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
    case 'yaml': case 'yml': return yaml();
    case 'sh': case 'bash': case 'zsh': return StreamLanguage.define(shell);
    case 'toml': return StreamLanguage.define(toml);
    case 'dockerfile': return StreamLanguage.define(dockerFile);
    default:                return javascript();
  }
};

const getLangLabel = (name: string) => {
  const m: Record<string, string> = {
    js:'JS', jsx:'JSX', ts:'TS', tsx:'TSX', rs:'Rust', go:'Go', py:'Python',
    html:'HTML', htm:'HTML', css:'CSS', scss:'SCSS', sass:'SASS', vue:'Vue',
    json:'JSON', jsonc:'JSON', md:'MD', mdx:'MDX', xml:'XML', svg:'SVG',
    yaml:'YAML', yml:'YAML', sh:'Shell', bash:'Shell', zsh:'Shell', toml:'TOML', dockerfile:'Docker',
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
    yaml:'text-red-300', yml:'text-red-300', sh:'text-green-300', bash:'text-green-300',
    zsh:'text-green-300', toml:'text-orange-200', dockerfile:'text-blue-300',
  };
  return m[getExt(name)] ?? 'text-slate-400';
};

const makeEditorTheme = () => {
  const accent = store.settings.accentColor;
  return EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: '#abb2bf' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: store.settings.fontFamily,
    fontSize: `${store.settings.fontSize}px`,
    lineHeight: '1.65',
  },
  '.cm-content': { caretColor: accent, padding: '4px 0' },
  '.cm-gutters': { background: 'transparent', color: '#3d4045', border: 'none', borderRight: '1px solid rgba(255,255,255,0.04)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '36px' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.02)' },
  '.cm-activeLineGutter': { background: 'rgba(255,255,255,0.02)', color: '#9da5b4' },
  '.cm-cursor': { borderLeftColor: accent, borderLeftWidth: '2px' },
  '.cm-selectionBackground': { background: `${accent}33 !important` },
  '&.cm-focused .cm-selectionBackground': { background: `${accent}44 !important` },
  '.cm-tooltip': { background: '#18191e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 12px', fontSize: '12.5px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: `${accent}40` },
  '.cm-matchingBracket': { background: 'rgba(255,153,0,0.15)', color: '#ffa500 !important' },
}, { dark: true });
};

const lspComplete = async (ctx: CompletionContext) => {
  if (!activeTabPath.value) return null;
  const word = ctx.matchBefore(/[\w.]/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  try {
    const r = await lspClient.completion(activeTabPath.value, store.cursorLine, store.cursorChar);
    const items = Array.isArray(r) ? r : r?.items;
    if (!items?.length) return null;
    return { from: word.from, options: items.slice(0, 50).map((i: any) => ({
      label: i.label, type: i.kind === 3 ? 'function' : i.kind === 6 ? 'variable' : 'keyword', info: i.detail,
    }))};
  } catch { return null; }
};

const makeExtensions = (name: string) => {
  const exts = [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
    history(), foldGutter(), drawSelection(), dropCursor(),
    EditorState.tabSize.of(store.settings.tabSize),
    indentUnit.of(' '.repeat(store.settings.tabSize)),
    EditorState.allowMultipleSelections.of(true), indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(), closeBrackets(),
    autocompletion({ override: [lspComplete], activateOnTyping: true }),
    rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
    EditorView.updateListener.of(u => {
      if (u.docChanged && activeTabPath.value) {
        const t = tabs.value.find(t => t.path === activeTabPath.value);
        if (t) {
          const content = u.state.doc.toString();
          t.content = content;
          t.isDirty = true;
          lspClient.didChange(activeTabPath.value, content);
        }
      }
      if (u.selectionSet || u.docChanged) {
        const sel = u.state.selection.main;
        const selLen = Math.abs(sel.to - sel.from);
        selectionInfo.value = selLen > 0 ? `${selLen} sel` : '';
        totalLines.value = u.state.doc.lines;
        const p = sel.head;
        const line = u.state.doc.lineAt(p);
        store.cursorLine = line.number - 1;
        store.cursorChar = p - line.from;
      }
    }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    getLang(name), oneDark, makeEditorTheme(),
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
  const cm = getCM(view);
  if (cm && typeof (cm as any).on === 'function') {
    (cm as any).on('vim-mode-change', (m: any) => { store.vimMode = String(m.mode ?? 'normal').toUpperCase(); });
  }
  // Double RAF: first frame allows browser layout, second ensures CodeMirror remeasures
  requestAnimationFrame(() => requestAnimationFrame(() => view?.requestMeasure()));
};

const revealLine = (line: number, column = 0) => {
  if (!view) return;
  const safeLine = Math.min(Math.max(1, line), view.state.doc.lines);
  const docLine = view.state.doc.line(safeLine);
  const pos = Math.min(docLine.to, docLine.from + Math.max(0, column));
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  view.focus();
  store.cursorLine = safeLine - 1;
  store.cursorChar = pos - docLine.from;
};

const rangeFromSelection = (): LspRange => {
  if (!view) {
    return {
      start: { line: store.cursorLine, character: store.cursorChar },
      end: { line: store.cursorLine, character: store.cursorChar },
    };
  }

  const selection = view.state.selection.main;
  const anchor = view.state.doc.lineAt(selection.from);
  const head = view.state.doc.lineAt(selection.to);
  return {
    start: { line: anchor.number - 1, character: selection.from - anchor.from },
    end: { line: head.number - 1, character: selection.to - head.from },
  };
};

const offsetForPosition = (doc: EditorState['doc'], line: number, character: number) => {
  const safeLine = Math.min(Math.max(1, line + 1), doc.lines);
  const docLine = doc.line(safeLine);
  return Math.min(docLine.to, docLine.from + Math.max(0, character));
};

const offsetForText = (text: string, line: number, character: number) => {
  const lines = text.split(/\r\n|\n|\r/);
  let offset = 0;
  for (let i = 0; i < Math.min(line, lines.length - 1); i++) {
    offset += lines[i].length + 1;
  }
  return offset + Math.min(Math.max(0, character), lines[Math.min(line, lines.length - 1)]?.length ?? 0);
};

const findOpenTab = (path: string) => {
  const normalized = store.normalizePath(path);
  for (const editorWindow of store.editorWindows) {
    const tab = editorWindow.tabs.find(t => t.path === normalized);
    if (tab) return tab;
  }
  return null;
};

const applyTextEditsToView = (edits: LspTextEdit[]) => {
  if (!view || !edits.length) return;
  const changes = edits
    .map(edit => ({
      from: offsetForPosition(view!.state.doc, edit.range.start.line, edit.range.start.character),
      to: offsetForPosition(view!.state.doc, edit.range.end.line, edit.range.end.character),
      insert: edit.newText,
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  view.dispatch({ changes });
  const tab = activeTab.value;
  if (tab && view) {
    tab.content = view.state.doc.toString();
    tab.isDirty = true;
    lspClient.didChange(tab.path, tab.content);
  }
};

const applyTextEditsToString = (content: string, edits: LspTextEdit[]) => {
  let next = content;
  const sorted = edits
    .map(edit => ({
      edit,
      from: offsetForText(content, edit.range.start.line, edit.range.start.character),
      to: offsetForText(content, edit.range.end.line, edit.range.end.character),
    }))
    .sort((a, b) => b.from - a.from || b.to - a.to);

  for (const { edit, from, to } of sorted) {
    next = `${next.slice(0, from)}${edit.newText}${next.slice(to)}`;
  }
  return next;
};

const editsByPath = (edit: LspWorkspaceEdit) => {
  const grouped = new Map<string, LspTextEdit[]>();
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      grouped.set(store.normalizePath(uriToPath(uri)), edits);
    }
  }

  for (const change of edit.documentChanges ?? []) {
    const uri = change.textDocument?.uri;
    if (!uri || !change.edits) continue;
    const path = store.normalizePath(uriToPath(uri));
    grouped.set(path, [...(grouped.get(path) ?? []), ...change.edits]);
  }

  return grouped;
};

const applyWorkspaceEdit = async (edit?: LspWorkspaceEdit) => {
  if (!edit) return false;
  const grouped = editsByPath(edit);
  if (!grouped.size) return false;

  for (const [path, edits] of grouped) {
    if (path === activeTabPath.value && view) {
      applyTextEditsToView(edits);
      continue;
    }

    const opened = findOpenTab(path);
    if (opened) {
      opened.content = applyTextEditsToString(opened.content, edits);
      opened.isDirty = true;
      continue;
    }

    const content = await invoke<string>('read_file', { path });
    await invoke('save_file', { path, content: applyTextEditsToString(content, edits) });
  }

  return true;
};

const locationRange = (location: LspLocation | LspLocationLink) =>
  'targetUri' in location
    ? (location.targetSelectionRange ?? location.targetRange)
    : location.range;

const locationUri = (location: LspLocation | LspLocationLink) =>
  'targetUri' in location ? location.targetUri : location.uri;

const openLspLocation = async (location: LspLocation | LspLocationLink) => {
  const path = store.normalizePath(uriToPath(locationUri(location)));
  const range = locationRange(location);
  if (!path) return;

  if (!findOpenTab(path)) {
    const content = await invoke<string>('read_file', { path });
    store.openTab(path, path.split(/[\\/]/).pop() ?? path, content);
  } else {
    activeTabPath.value = path;
  }
  store.revealLocation(path, range.start.line + 1, range.start.character);
  lspPanel.value = null;
};

const hoverText = (contents: any): string => {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n\n');
  if (typeof contents.value === 'string') return contents.value;
  if (contents.language && contents.value) return `\`\`\`${contents.language}\n${contents.value}\n\`\`\``;
  return String(contents);
};

const ensureLspForActive = async () => {
  const tab = activeTab.value;
  if (!tab || !view) return false;
  const content = view.state.doc.toString();
  tab.content = content;
  return lspClient.ensureForFile(tab.path, tab.name, content, store.currentProject);
};

const runLspAction = async (action: 'hover' | 'definition' | 'references' | 'rename' | 'actions' | 'format') => {
  const tab = activeTab.value;
  if (!tab || !view || lspBusy.value) return;

  lspBusy.value = action;
  lspMessage.value = '';
  try {
    const hasLsp = await ensureLspForActive();
    if (!hasLsp) {
      lspMessage.value = 'No language server configured for this file.';
      return;
    }

    if (action === 'hover') {
      const result = await lspClient.hover(tab.path, store.cursorLine, store.cursorChar);
      const content = hoverText(result?.contents).trim();
      lspPanel.value = content
        ? { type: 'hover', title: 'Hover', content }
        : { type: 'hover', title: 'Hover', content: 'No hover info returned.' };
    }

    if (action === 'definition') {
      const result = await lspClient.definition(tab.path, store.cursorLine, store.cursorChar);
      const location = Array.isArray(result) ? result[0] : result;
      if (location) await openLspLocation(location);
      else lspMessage.value = 'No definition found.';
    }

    if (action === 'references') {
      const result = await lspClient.references(tab.path, store.cursorLine, store.cursorChar);
      const locations = (Array.isArray(result) ? result : []).filter(Boolean);
      lspPanel.value = {
        type: 'references',
        title: `References (${locations.length})`,
        items: locations.map((location: LspLocation | LspLocationLink) => {
          const path = store.normalizePath(uriToPath(locationUri(location)));
          const range = locationRange(location);
          return {
            path,
            line: range.start.line + 1,
            column: range.start.character,
            label: `${path.split(/[\\/]/).pop() ?? path}:${range.start.line + 1}:${range.start.character + 1}`,
            location,
          };
        }),
      };
    }

    if (action === 'rename') {
      const newName = prompt('New symbol name:');
      if (!newName?.trim()) return;
      const edit = await lspClient.rename(tab.path, store.cursorLine, store.cursorChar, newName.trim());
      const applied = await applyWorkspaceEdit(edit);
      lspMessage.value = applied ? 'Rename applied.' : 'Rename returned no edits.';
    }

    if (action === 'actions') {
      const result = await lspClient.codeActions(tab.path, rangeFromSelection());
      const actions = (Array.isArray(result) ? result : []).filter((item: any) => item?.title);
      lspPanel.value = {
        type: 'actions',
        title: `Code Actions (${actions.length})`,
        items: actions.map((codeAction: LspCodeAction) => ({
          title: codeAction.title,
          action: codeAction,
        })),
      };
    }

    if (action === 'format') {
      const edits = await lspClient.formatDocument(tab.path, store.settings.tabSize);
      if (Array.isArray(edits) && edits.length) {
        applyTextEditsToView(edits);
        lspMessage.value = 'Document formatted.';
      } else {
        lspMessage.value = 'Formatter returned no edits.';
      }
    }
  } catch (e) {
    lspMessage.value = String(e);
  } finally {
    lspBusy.value = null;
    window.setTimeout(() => { lspMessage.value = ''; }, 3500);
  }
};

const applyCodeAction = async (action: LspCodeAction) => {
  lspBusy.value = 'actions';
  try {
    if (action.edit) await applyWorkspaceEdit(action.edit);
    if (action.command?.command) {
      await lspClient.executeCommand(action.command.command, action.command.arguments ?? []);
    }
    lspPanel.value = null;
    lspMessage.value = 'Code action applied.';
  } catch (e) {
    lspMessage.value = String(e);
  } finally {
    lspBusy.value = null;
    window.setTimeout(() => { lspMessage.value = ''; }, 3500);
  }
};

const saveFile = async () => {
  if (!activeTabPath.value || !view) return;
  const content = view.state.doc.toString();
  try {
    await invoke('save_file', { path: activeTabPath.value, content });
    const t = tabs.value.find(t => t.path === activeTabPath.value);
    if (t) { t.content = content; t.isDirty = false; }
    lspClient.didSave(activeTabPath.value, content);
  } catch (e) { console.error('Save:', e); }
};

const syncLspOpen = async (tab: Tab) => {
  try {
    await lspClient.ensureForFile(tab.path, tab.name, tab.content, store.currentProject);
  } catch {}
};

const refreshActiveFileFromDisk = async () => {
  const path = activeTabPath.value;
  if (!path || !view) return;
  const tab = tabs.value.find(t => t.path === path);
  if (!tab || tab.isDirty) return;
  try {
    const content = await invoke<string>('read_file', { path });
    if (content === tab.content) return;
    tab.content = content;
    initEditor(content, tab.name);
  } catch {}
};

const handleKeys = (e: KeyboardEvent) => {
  if (store.activeWindowId !== props.windowId) return;
  const previousFileShortcut = matchesShortcut(e, store.settings.keybindings['prev-file'] ?? 'Ctrl+Shift+Tab');
  if (matchesShortcut(e, store.settings.keybindings['next-file'] ?? 'Ctrl+Tab') || previousFileShortcut) {
    e.preventDefault();
    e.stopPropagation();
    store.switchTab(props.windowId, previousFileShortcut ? -1 : 1);
  }
  if (matchesShortcut(e, store.settings.keybindings['toggle-terminal'] ?? 'Ctrl+J')) { e.preventDefault(); store.toggleTerminal(); }
  if (matchesShortcut(e, store.settings.keybindings['save-file'] ?? 'Ctrl+S')) { e.preventDefault(); saveFile(); }
  if (matchesShortcut(e, store.settings.keybindings['lsp-definition'] ?? 'F12')) { e.preventDefault(); runLspAction('definition'); }
  if (matchesShortcut(e, store.settings.keybindings['lsp-references'] ?? 'Shift+F12')) { e.preventDefault(); runLspAction('references'); }
  if (matchesShortcut(e, store.settings.keybindings['lsp-rename'] ?? 'F2')) { e.preventDefault(); runLspAction('rename'); }
  if (matchesShortcut(e, store.settings.keybindings['lsp-actions'] ?? 'Ctrl+.')) { e.preventDefault(); runLspAction('actions'); }
  if (matchesShortcut(e, store.settings.keybindings['lsp-format'] ?? 'Shift+Alt+F')) { e.preventDefault(); runLspAction('format'); }
  if (matchesShortcut(e, store.settings.keybindings['go-to-line'] ?? 'Ctrl+G')) { e.preventDefault(); openGoToLine(); }
  if (isAltKey(e, 'KeyZ')) {
    e.preventDefault();
    store.settings.wordWrap = !store.settings.wordWrap;
  }
};

const handleGlobalSave = () => {
  if (store.activeWindowId === props.windowId) saveFile();
};

const handleMaximizeEvent = () => {
  if (store.activeWindowId === props.windowId) toggleWindowMaximize();
};

const handleLspActionEvent = (event: Event) => {
  if (store.activeWindowId !== props.windowId) return;
  const action = (event as CustomEvent<{ action: Parameters<typeof runLspAction>[0] }>).detail?.action;
  if (action) runLspAction(action);
};

const handleExternalContentUpdate = (event: Event) => {
  const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
  if (!detail || detail.path !== activeTabPath.value || !view) return;
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: detail.content,
    },
  });
  const tab = activeTab.value;
  if (tab) {
    tab.content = detail.content;
    tab.isDirty = true;
    lspClient.didChange(tab.path, tab.content);
  }
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
  window.addEventListener('keydown', handleKeys);
  window.addEventListener('aida:save-active-file', handleGlobalSave);
  window.addEventListener('aida:lsp-action', handleLspActionEvent);
  window.addEventListener('aida:tab-content-updated', handleExternalContentUpdate);
  window.addEventListener('aida:maximize-active-window', handleMaximizeEvent);
  window.addEventListener('focus', refreshActiveFileFromDisk);
  filePoll = window.setInterval(refreshActiveFileFromDisk, 5000);

  await nextTick();

  const restoredPos = win.value?.savedPos ?? win.value?.initPos;
  if (restoredPos) {
    applyWindowPos(restoredPos);
    if (win.value?.initPos) win.value.initPos = undefined;
  } else {
    initFromCanvas(0, 0.68);
  }

  // Persist the position we just applied
  if (win.value) win.value.savedPos = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };

  // RAF: browser finishes layout before CodeMirror measures
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  const path = activeTabPath.value;
  const tab = path ? tabs.value.find(t => t.path === path) : null;
  initEditor(tab?.content ?? WELCOME, tab?.name ?? 'welcome.js');
  if (tab) syncLspOpen(tab);

  if (editorWrap.value) {
    ro = new ResizeObserver(() => view?.requestMeasure());
    ro.observe(editorWrap.value);
  }
});

// React to initPos set AFTER mount (e.g. session restore sets initPos on already-mounted w1)
watch(() => win.value?.initPos, (ip) => {
  if (!ip) return;
  applyWindowPos(ip);
  if (win.value) { win.value.initPos = undefined; win.value.savedPos = ip; }
});

watch(activeTabPath, (newPath) => {
  if (!newPath) { initEditor(WELCOME, 'welcome.js'); return; }
  const tab = tabs.value.find(t => t.path === newPath);
  if (!tab) return;
  initEditor(tab.content, tab.name);
  syncLspOpen(tab);
  const nav = store.navigationRequest;
  if (nav?.path === newPath) requestAnimationFrame(() => revealLine(nav.line, nav.column));
});

watch(() => store.navigationRequest, (nav) => {
  if (!nav || nav.path !== activeTabPath.value) return;
  requestAnimationFrame(() => revealLine(nav.line, nav.column));
});

watch(() => [
  store.settings.vimEnabled,
  store.settings.wordWrap,
  store.settings.fontSize,
  store.settings.fontFamily,
  store.settings.tabSize,
], () => {
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
  window.removeEventListener('aida:save-active-file', handleGlobalSave);
  window.removeEventListener('aida:lsp-action', handleLspActionEvent);
  window.removeEventListener('aida:tab-content-updated', handleExternalContentUpdate);
  window.removeEventListener('aida:maximize-active-window', handleMaximizeEvent);
  window.removeEventListener('focus', refreshActiveFileFromDisk);
  if (filePoll !== null) window.clearInterval(filePoll);
  ro?.disconnect();
  view?.destroy();
});
</script>

<template>
  <!-- Floating editor panel -->
  <div
    data-floating-window
    class="absolute flex flex-col rounded-xl border shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden transition-[border-color] duration-150"
    :class="[
      dropTarget ? 'border-blue-500/60' : 'border-white/8',
      dragging || resizing ? 'select-none' : '',
    ]"
    :style="panelStyle"
    @mousedown.capture="bringToFront(); store.activeWindowId = windowId; store.activeBrowserWindowId = null"
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
      class="h-10 flex items-stretch bg-[rgba(13,13,19,0.6)] border-b border-white/6 overflow-x-auto shrink-0 cursor-move"
      style="scrollbar-width:none"
      @mousedown="startDrag"
    >
      <!-- Tabs -->
      <div
        v-for="tab in tabs"
        :key="tab.path"
        class="tab-item group flex items-center gap-2 px-4 rounded-lg border-r border-white/5 cursor-pointer transition-all shrink-0 relative"
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
        <div v-if="activeTabPath" class="flex items-center gap-1 border-r border-white/7 pr-3">
          <button
            v-if="canPreviewHtml"
            @click="previewActiveHtml"
            class="p-1 rounded text-white/25 hover:text-emerald-300 hover:bg-white/6 transition-colors"
            title="Preview HTML in browser window"
          >
            <MonitorPlay :size="16" />
          </button>
          <button
            v-if="canPreviewMarkdown"
            @click="previewActiveMarkdown"
            class="p-1 rounded text-white/25 hover:text-sky-300 hover:bg-white/6 transition-colors"
            title="Preview Markdown"
          >
            <BookOpen :size="16" />
          </button>
          <button
            @click="toggleWindowMaximize"
            class="p-1 rounded text-white/25 hover:text-white/70 hover:bg-white/6 transition-colors"
            title="Maximize window"
          >
            <Minimize2 v-if="maximized" :size="16" />
            <Maximize2 v-else :size="16" />
          </button>
        </div>
        <div v-if="activeTabPath" class="flex items-center gap-1 border-r border-white/7 pr-3">
          <button
            @click="runLspAction('hover')"
            class="p-1 rounded text-white/25 hover:text-sky-300 hover:bg-white/6 transition-colors disabled:opacity-30"
            :disabled="!!lspBusy"
            title="Hover"
          >
            <Loader2 v-if="lspBusy === 'hover'" :size="16" class="animate-spin" />
            <Info v-else :size="16" />
          </button>
          <button
            @click="runLspAction('definition')"
            class="p-1 rounded text-white/25 hover:text-emerald-300 hover:bg-white/6 transition-colors disabled:opacity-30"
            :disabled="!!lspBusy"
            title="Go to Definition (F12)"
          >
            <LocateFixed :size="16" />
          </button>
          <button
            @click="runLspAction('references')"
            class="p-1 rounded text-white/25 hover:text-violet-300 hover:bg-white/6 transition-colors disabled:opacity-30"
            :disabled="!!lspBusy"
            title="References (Shift+F12)"
          >
            <ListTree :size="16" />
          </button>
          <button
            @click="runLspAction('rename')"
            class="p-1 rounded text-white/25 hover:text-amber-300 hover:bg-white/6 transition-colors disabled:opacity-30"
            :disabled="!!lspBusy"
            title="Rename Symbol (F2)"
          >
            <Pencil :size="16" />
          </button>
          <button
            @click="runLspAction('actions')"
            class="p-1 rounded text-white/25 hover:text-yellow-300 hover:bg-white/6 transition-colors disabled:opacity-30"
            :disabled="!!lspBusy"
            title="Code Actions (Ctrl+.)"
          >
            <Lightbulb :size="16" />
          </button>
          <button
            @click="runLspAction('format')"
            class="p-1 rounded text-white/25 hover:text-blue-300 hover:bg-white/6 transition-colors disabled:opacity-30"
            :disabled="!!lspBusy"
            title="Format Document (Shift+Alt+F)"
          >
            <AlignLeft :size="16" />
          </button>
        </div>
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
          @click="store.closeAllTabs(windowId)"
          class="hover:text-white/70 transition-colors"
          title="Закрити всі"
        ><X :size="13" /></button>
      </div>
    </div>

    <!-- Breadcrumbs -->
    <div
      v-if="activeTabPath && breadcrumbs.length"
      class="h-6 flex items-center gap-0.5 px-3 border-b border-white/4 bg-black/14 overflow-hidden shrink-0"
      style="scrollbar-width:none"
    >
      <template v-for="(seg, i) in breadcrumbs" :key="i">
        <span
          class="text-[10px] whitespace-nowrap"
          :class="i === breadcrumbs.length - 1 ? 'text-white/52 font-medium' : 'text-white/22 hover:text-white/45 cursor-default'"
        >{{ seg }}</span>
        <ChevronRight v-if="i < breadcrumbs.length - 1" :size="9" class="text-white/15 shrink-0" />
      </template>
    </div>

    <!-- LSP action popup -->
    <div
      v-if="lspPanel || lspMessage"
      class="absolute top-12 right-3 z-40 w-[380px] max-w-[calc(100%-24px)] rounded-lg border border-white/9 bg-[#121217] shadow-[0_18px_48px_rgba(0,0,0,0.75)] overflow-hidden"
      @mousedown.stop
    >
      <div v-if="lspPanel" class="h-9 flex items-center justify-between px-3 border-b border-white/6 bg-black/20">
        <div class="flex items-center gap-2 min-w-0">
          <Lightbulb v-if="lspPanel.type === 'actions'" :size="13" class="text-yellow-300/80 shrink-0" />
          <ListTree v-else-if="lspPanel.type === 'references'" :size="13" class="text-violet-300/80 shrink-0" />
          <Info v-else :size="13" class="text-sky-300/80 shrink-0" />
          <span class="text-[11px] font-bold uppercase tracking-widest text-white/55 truncate">{{ lspPanel.title }}</span>
        </div>
        <button
          @click="lspPanel = null"
          class="p-1 rounded text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors"
          title="Close"
        >
          <X :size="13" />
        </button>
      </div>

      <pre
        v-if="lspPanel?.type === 'hover'"
        class="max-h-[260px] overflow-auto whitespace-pre-wrap break-words p-3 text-[11px] leading-5 text-white/68 font-mono"
      >{{ lspPanel.content }}</pre>

      <div
        v-else-if="lspPanel?.type === 'references'"
        class="max-h-[280px] overflow-y-auto py-1"
        style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent"
      >
        <button
          v-for="item in lspPanel.items"
          :key="`${item.path}:${item.line}:${item.column}`"
          @click="openLspLocation(item.location)"
          class="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
        >
          <span class="block text-[12px] text-white/70 truncate">{{ item.label }}</span>
          <span class="block text-[10px] text-white/28 font-mono truncate">{{ item.path }}</span>
        </button>
        <div v-if="!lspPanel.items.length" class="px-3 py-5 text-center text-[12px] text-white/25 italic">
          No references found
        </div>
      </div>

      <div
        v-else-if="lspPanel?.type === 'actions'"
        class="max-h-[280px] overflow-y-auto py-1"
        style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent"
      >
        <button
          v-for="item in lspPanel.items"
          :key="item.title"
          @click="applyCodeAction(item.action)"
          class="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
        >
          <span class="block text-[12px] text-white/72 truncate">{{ item.title }}</span>
          <span v-if="item.action.kind" class="block text-[10px] text-white/28 font-mono truncate">{{ item.action.kind }}</span>
        </button>
        <div v-if="!lspPanel.items.length" class="px-3 py-5 text-center text-[12px] text-white/25 italic">
          No code actions available
        </div>
      </div>

      <div v-if="lspMessage && !lspPanel" class="px-3 py-2 text-[11px] text-white/55">
        {{ lspMessage }}
      </div>
      <div v-else-if="lspMessage" class="px-3 py-2 border-t border-white/6 text-[11px] text-white/45">
        {{ lspMessage }}
      </div>
    </div>

    <!-- Editor area -->
    <div class="relative flex-1 bg-[rgb(14,14,17)]/10 backdrop-blur-lg border border-white/20 rounded-lg shadow-lg" style="min-height:0">
      <div ref="editorWrap" class="absolute inset-0"></div>

      <!-- Go-to-line overlay -->
      <div
        v-if="goToLineOpen"
        class="absolute inset-0 z-40 flex items-start justify-center pt-10"
        @mousedown.self="goToLineOpen = false"
      >
        <div class="bg-[#16171c] border border-white/12 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.8)] p-4 w-56" @mousedown.stop>
          <div class="flex items-center gap-1.5 mb-2.5">
            <Hash :size="11" class="text-white/35" />
            <span class="text-[10px] font-bold uppercase tracking-widest text-white/35">Go to line</span>
          </div>
          <input
            ref="goToLineInputEl"
            v-model="goToLineValue"
            type="number"
            min="1"
            :max="totalLines"
            class="w-full bg-black/35 border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-white/80 outline-none focus:border-emerald-300/40"
            @keydown.enter.prevent="confirmGoToLine"
            @keydown.escape.prevent="goToLineOpen = false"
          />
          <div class="mt-1.5 text-[10px] text-white/22">of {{ totalLines }} lines</div>
        </div>
      </div>
    </div>

    <!-- Status strip -->
    <div class="h-6 bg-[#0d0d10] border-t border-white/5 flex items-center justify-between px-4 text-[10px] text-white/25 shrink-0 select-none">
      <div class="flex items-center gap-3">
        <span v-if="activeTabPath" :class="getExtColor(tabs.find(t=>t.path===activeTabPath)?.name ?? '')">
          {{ getLangLabel(tabs.find(t=>t.path===activeTabPath)?.name ?? '') }}
        </span>
        <span>UTF-8</span>
        <span>{{ store.settings.tabSize }} spaces</span>
        <span v-if="selectionInfo" class="text-sky-400/60">{{ selectionInfo }}</span>
        <span v-if="activeTabPath && totalLines" class="hover:text-white/50 cursor-pointer" @click="openGoToLine" :title="'Ctrl+G — go to line'">
          {{ totalLines }} lines
        </span>
        <span
          v-if="store.activeLsp && store.activeLsp.path === activeTabPath"
          :class="store.activeLsp.available ? 'text-emerald-400/60' : 'text-rose-400/60'"
          :title="store.activeLsp.command"
        >
          LSP: {{ store.activeLsp.label }}
        </span>
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
