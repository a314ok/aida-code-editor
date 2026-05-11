<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  Code2,
  Copy,
  FileCode2,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  MoveDown,
  MoveUp,
  Plus,
  Rows3,
  Smartphone,
  Square,
  Tablet,
  Trash2,
  Type,
  Wand2,
  X,
} from 'lucide-vue-next';
import { useFloating } from '../composables/useFloating';
import { useEditorStore, type Tab } from '../stores/editor';

type DeviceKey = 'mobile' | 'tablet' | 'desktop';
type BuilderMode = 'design' | 'source';
type BlockKind = 'hero' | 'heading' | 'text' | 'button' | 'input' | 'card' | 'grid';

type VisualBlock = {
  id: string;
  kind: BlockKind;
  label: string;
  text: string;
  tag: string;
  classes: string;
};

const emit = defineEmits(['close']);
const store = useEditorStore();
const { pos, maximized, startDrag, startResize, toggleMaximize, bringToFront } =
  useFloating({ x: 120, y: 88, w: 1160, h: 720 });

const devices: Record<DeviceKey, { label: string; width: number; icon: any }> = {
  mobile: { label: 'Mobile', width: 390, icon: Smartphone },
  tablet: { label: 'Tablet', width: 768, icon: Tablet },
  desktop: { label: 'Desktop', width: 1180, icon: Monitor },
};

const palette: Array<{ kind: BlockKind; label: string; icon: any }> = [
  { kind: 'hero', label: 'Hero', icon: LayoutTemplate },
  { kind: 'heading', label: 'Heading', icon: Type },
  { kind: 'text', label: 'Text', icon: Rows3 },
  { kind: 'button', label: 'Button', icon: MousePointerClick },
  { kind: 'input', label: 'Input', icon: Square },
  { kind: 'card', label: 'Card', icon: LayoutTemplate },
  { kind: 'grid', label: 'Grid', icon: Rows3 },
];

const tailwindTokens = [
  'flex', 'grid', 'items-center', 'justify-between', 'gap-2', 'gap-4',
  'p-4', 'px-4', 'py-2', 'rounded-md', 'rounded-lg', 'border', 'border-white/10',
  'bg-white/5', 'bg-black/20', 'text-white/70', 'text-sm', 'font-bold',
  'hover:bg-white/10', 'transition-colors', 'md:grid-cols-2', 'lg:grid-cols-3',
];

const device = ref<DeviceKey>('mobile');
const mode = ref<BuilderMode>('design');
const selectedId = ref<string | null>(null);
const sourceText = ref('');
const sourceStatus = ref('');
const copied = ref(false);
const blocks = ref<VisualBlock[]>([]);

const panelStyle = computed(() => ({
  left: `${pos.x}px`,
  top: `${pos.y}px`,
  width: `${pos.w}px`,
  height: `${pos.h}px`,
  zIndex: pos.z,
}));

const activeWindow = computed(() => store.getActiveWindow());
const activeTab = computed<Tab | null>(() => activeWindow.value?.tabs.find(tab => tab.path === activeWindow.value?.activeTabPath) ?? null);
const activeExt = computed(() => activeTab.value?.name.split('.').pop()?.toLowerCase() ?? '');
const isVisualFile = computed(() => ['vue', 'tsx', 'jsx', 'html', 'htm', 'htmx', 'css', 'scss', 'sass'].includes(activeExt.value));
const selectedBlock = computed(() => blocks.value.find(block => block.id === selectedId.value) ?? blocks.value[0] ?? null);
const canvasWidth = computed(() => Math.min(devices[device.value].width, Math.max(340, pos.w - 500)));
const deviceItems = computed(() => Object.entries(devices).map(([key, config]) => ({ key: key as DeviceKey, ...config })));
const classTokens = computed(() => {
  const matches = sourceText.value.matchAll(/\bclass(?:Name)?=(["'`])([^"'`]*?)\1/g);
  return [...new Set([...matches].flatMap(match => match[2].split(/\s+/).filter(Boolean)))].slice(0, 80);
});

const defaultBlocks = (): VisualBlock[] => [
  {
    id: 'block-hero',
    kind: 'hero',
    label: 'Hero',
    tag: 'section',
    text: 'Build visual UI directly into the active file',
    classes: 'rounded-lg border border-white/10 bg-white/5 p-6 grid gap-4',
  },
  {
    id: 'block-card',
    kind: 'card',
    label: 'Card',
    tag: 'article',
    text: 'Tune Tailwind classes here, then apply the generated markup back to your open file.',
    classes: 'rounded-lg border border-white/10 bg-black/20 p-4',
  },
];

blocks.value = defaultBlocks();

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const getIndent = () => (activeExt.value === 'vue' ? '  ' : '');

const extractVueBlock = (content: string, tag: 'template' | 'style') => {
  const match = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? '';
};

const findReturnRange = (content: string) => {
  const returnIndex = content.search(/\breturn\s*\(/);
  if (returnIndex === -1) return null;
  const openIndex = content.indexOf('(', returnIndex);
  if (openIndex === -1) return null;
  let depth = 0;
  let quote = '';
  for (let index = openIndex; index < content.length; index++) {
    const char = content[index];
    const prev = content[index - 1];
    if (quote) {
      if (char === quote && prev !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth === 0) return { from: openIndex + 1, to: index };
  }
  return null;
};

const extractActiveSource = () => {
  const tab = activeTab.value;
  if (!tab) {
    sourceText.value = '';
    sourceStatus.value = 'No active file.';
    return;
  }
  const content = tab.content;
  if (activeExt.value === 'vue') {
    sourceText.value = extractVueBlock(content, 'template') || '<div class="p-4">Vue template</div>';
  } else if (['html', 'htm', 'htmx'].includes(activeExt.value)) {
    sourceText.value = content.trim();
  } else if (['tsx', 'jsx'].includes(activeExt.value)) {
    const range = findReturnRange(content);
    sourceText.value = range ? content.slice(range.from, range.to).trim() : '<div className="p-4">JSX view</div>';
  } else if (['css', 'scss', 'sass'].includes(activeExt.value)) {
    sourceText.value = content.trim();
  } else {
    sourceText.value = content.trim();
  }
  sourceStatus.value = isVisualFile.value
    ? `Loaded ${tab.name}`
    : `${tab.name} is not a visual file type.`;
};

const inferBlocksFromSource = () => {
  const source = sourceText.value.trim();
  if (!source) {
    blocks.value = defaultBlocks();
    selectedId.value = blocks.value[0]?.id ?? null;
    return;
  }

  const tags = [...source.matchAll(/<([a-zA-Z][\w:-]*)([^>]*)>([\s\S]*?)<\/\1>/g)].slice(0, 16);
  if (!tags.length) {
    blocks.value = [{
      id: `block-${Date.now()}`,
      kind: ['css', 'scss', 'sass'].includes(activeExt.value) ? 'text' : 'card',
      label: activeTab.value?.name ?? 'Source',
      tag: 'div',
      text: source.slice(0, 160),
      classes: 'rounded-lg border border-white/10 bg-white/5 p-4',
    }];
    selectedId.value = blocks.value[0]?.id ?? null;
    return;
  }

  blocks.value = tags.map((match, index) => {
    const tag = match[1];
    const attrs = match[2] ?? '';
    const text = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || tag;
    const classMatch = attrs.match(/\bclass(?:Name)?=(["'`])([^"'`]*?)\1/);
    const kind: BlockKind = tag === 'button' ? 'button' : /^h[1-6]$/.test(tag) ? 'heading' : tag === 'input' ? 'input' : index === 0 ? 'hero' : 'card';
    return {
      id: `block-${Date.now()}-${index}`,
      kind,
      label: tag,
      tag,
      text,
      classes: classMatch?.[2] ?? 'rounded-lg border border-white/10 bg-white/5 p-4',
    };
  });
  selectedId.value = blocks.value[0]?.id ?? null;
};

const loadFromActiveFile = () => {
  extractActiveSource();
  inferBlocksFromSource();
};

const renderBlock = (block: VisualBlock) => {
  const safeText = escapeHtml(block.text);
  const classAttr = activeExt.value === 'tsx' || activeExt.value === 'jsx'
    ? `className="${block.classes}"`
    : `class="${block.classes}"`;
  if (block.kind === 'hero') return `<${block.tag || 'section'} ${classAttr}>\n${getIndent()}  <h1 class="${activeExt.value.includes('x') ? '' : ''}text-4xl font-black tracking-tight">${safeText}</h1>\n${getIndent()}  <button class="rounded-md bg-emerald-300 px-4 py-2 text-sm font-bold text-black">Get started</button>\n${getIndent()}</${block.tag || 'section'}>`;
  if (block.kind === 'heading') return `<${block.tag || 'h2'} ${classAttr}>${safeText}</${block.tag || 'h2'}>`;
  if (block.kind === 'text') return `<${block.tag || 'p'} ${classAttr}>${safeText}</${block.tag || 'p'}>`;
  if (block.kind === 'button') return `<button ${classAttr}>${safeText}</button>`;
  if (block.kind === 'input') return `<input ${classAttr} placeholder="${safeText}" />`;
  if (block.kind === 'grid') return `<${block.tag || 'section'} ${classAttr}>\n${getIndent()}  <div>${safeText}</div>\n${getIndent()}  <div>Second column</div>\n${getIndent()}</${block.tag || 'section'}>`;
  return `<${block.tag || 'article'} ${classAttr}>${safeText}</${block.tag || 'article'}>`;
};

const exportCode = computed(() => blocks.value.map(renderBlock).join('\n'));

const replaceVueTemplate = (content: string, nextTemplate: string) => {
  if (/<template[\s\S]*?>[\s\S]*?<\/template>/i.test(content)) {
    return content.replace(/<template([\s\S]*?)>[\s\S]*?<\/template>/i, `<template$1>\n${nextTemplate}\n</template>`);
  }
  return `<template>\n${nextTemplate}\n</template>\n\n${content}`;
};

const replaceJsxReturn = (content: string, nextMarkup: string) => {
  const range = findReturnRange(content);
  if (!range) return `${content.trimEnd()}\n\n// Aida visual block\n${nextMarkup}\n`;
  return `${content.slice(0, range.from)}\n${nextMarkup}\n${content.slice(range.to)}`;
};

const applyToActiveFile = (useGenerated = false) => {
  const tab = activeTab.value;
  if (!tab || !isVisualFile.value) {
    sourceStatus.value = 'Open a .vue, .tsx, .jsx, .html, .css, .scss, .sass or .htmx file first.';
    return;
  }
  const nextSource = useGenerated ? exportCode.value : sourceText.value;
  let nextContent = tab.content;
  if (activeExt.value === 'vue') {
    nextContent = replaceVueTemplate(tab.content, nextSource);
  } else if (['tsx', 'jsx'].includes(activeExt.value)) {
    nextContent = replaceJsxReturn(tab.content, nextSource);
  } else {
    nextContent = nextSource;
  }
  store.updateTabContent(tab.path, nextContent, true);
  sourceStatus.value = `Applied to ${tab.name}. Save when ready.`;
};

const makeBlock = (kind: BlockKind): VisualBlock => {
  const defaults: Record<BlockKind, VisualBlock> = {
    hero: { id: '', kind, label: 'Hero', tag: 'section', text: 'Ship a polished first screen', classes: 'rounded-lg border border-white/10 bg-white/5 p-6 grid gap-4' },
    heading: { id: '', kind, label: 'Heading', tag: 'h2', text: 'Section heading', classes: 'text-2xl font-black tracking-tight text-white/90' },
    text: { id: '', kind, label: 'Text', tag: 'p', text: 'Readable supporting copy for this section.', classes: 'text-sm leading-6 text-white/55' },
    button: { id: '', kind, label: 'Button', tag: 'button', text: 'Primary action', classes: 'rounded-md bg-emerald-300 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-200 transition-colors' },
    input: { id: '', kind, label: 'Input', tag: 'input', text: 'Email address', classes: 'rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80 outline-none' },
    card: { id: '', kind, label: 'Card', tag: 'article', text: 'A reusable content block.', classes: 'rounded-lg border border-white/10 bg-black/20 p-4' },
    grid: { id: '', kind, label: 'Grid', tag: 'section', text: 'Responsive grid item', classes: 'grid gap-4 md:grid-cols-2 rounded-lg border border-white/10 bg-white/5 p-4' },
  };
  return { ...defaults[kind], id: `block-${Date.now()}-${Math.floor(Math.random() * 1000)}` };
};

const addBlock = (kind: BlockKind) => {
  const block = makeBlock(kind);
  blocks.value = [...blocks.value, block];
  selectedId.value = block.id;
  sourceText.value = exportCode.value;
};

const removeBlock = () => {
  if (!selectedBlock.value) return;
  const index = blocks.value.findIndex(block => block.id === selectedBlock.value?.id);
  blocks.value = blocks.value.filter(block => block.id !== selectedBlock.value?.id);
  selectedId.value = blocks.value[Math.max(0, index - 1)]?.id ?? null;
  sourceText.value = exportCode.value;
};

const moveBlock = (direction: -1 | 1) => {
  const block = selectedBlock.value;
  if (!block) return;
  const index = blocks.value.findIndex(item => item.id === block.id);
  const next = index + direction;
  if (next < 0 || next >= blocks.value.length) return;
  const copy = [...blocks.value];
  [copy[index], copy[next]] = [copy[next], copy[index]];
  blocks.value = copy;
  sourceText.value = exportCode.value;
};

const addClassToken = (token: string) => {
  if (!selectedBlock.value) return;
  const classes = new Set(selectedBlock.value.classes.split(/\s+/).filter(Boolean));
  classes.add(token);
  selectedBlock.value.classes = [...classes].join(' ');
  sourceText.value = exportCode.value;
};

const copyExport = async () => {
  await navigator.clipboard?.writeText(mode.value === 'source' ? sourceText.value : exportCode.value);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1200);
};

watch(activeTab, () => nextTick(loadFromActiveFile), { immediate: true });
watch(blocks, () => {
  if (mode.value === 'design') sourceText.value = exportCode.value;
}, { deep: true });
</script>

<template>
  <div
    data-floating-window
    class="absolute flex flex-col rounded-xl border border-white/8 bg-[#0d0d11] shadow-[0_8px_40px_rgba(0,0,0,0.62)] overflow-hidden"
    :style="panelStyle"
    @mousedown="bringToFront"
  >
    <div
      class="h-10 flex items-center justify-between gap-3 border-b border-white/6 bg-[#111116] px-3 cursor-move shrink-0"
      @mousedown="startDrag"
    >
      <div class="flex items-center gap-2 min-w-0">
        <LayoutTemplate :size="14" class="text-emerald-200/70 shrink-0" />
        <span class="text-[11px] font-bold uppercase tracking-widest text-white/42">Visual Builder</span>
        <span class="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/28 truncate">{{ activeTab?.name ?? 'no file' }}</span>
      </div>
      <div class="flex items-center gap-1" @mousedown.stop>
        <button class="p-1 rounded text-white/30 hover:text-white/70 hover:bg-white/6" title="Maximize" @click="toggleMaximize">
          <Minimize2 v-if="maximized" :size="13" />
          <Maximize2 v-else :size="13" />
        </button>
        <button class="p-1 rounded text-white/30 hover:text-white/70 hover:bg-white/6" title="Close" @click="emit('close')">
          <X :size="13" />
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 grid grid-cols-[230px_minmax(0,1fr)_300px]">
      <aside class="min-h-0 border-r border-white/6 bg-black/12 p-3 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
        <div class="rounded-lg border border-white/7 bg-white/4 p-2 mb-3">
          <div class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-white/35">
            <FileCode2 :size="12" />
            Active file
          </div>
          <div class="mt-2 text-[12px] text-white/72 truncate">{{ activeTab?.name ?? 'Open a file' }}</div>
          <div class="mt-1 text-[10px] text-white/25 truncate">{{ activeTab?.path ?? 'No active editor tab' }}</div>
          <div class="mt-2 flex gap-1">
            <button
              class="flex-1 rounded bg-white/6 px-2 py-1 text-[10px] text-white/50 hover:text-white/75 hover:bg-white/9 disabled:opacity-30"
              :disabled="!activeTab"
              @click="loadFromActiveFile"
            >
              pull
            </button>
            <button
              class="flex-1 rounded bg-emerald-300 px-2 py-1 text-[10px] font-bold text-black hover:bg-emerald-200 disabled:opacity-30"
              :disabled="!isVisualFile"
              @click="applyToActiveFile(false)"
            >
              apply
            </button>
          </div>
          <div class="mt-2 text-[10px]" :class="isVisualFile ? 'text-emerald-200/55' : 'text-amber-200/55'">{{ sourceStatus }}</div>
        </div>

        <div class="mb-3 text-[10px] font-bold uppercase tracking-wide text-white/28">Blocks</div>
        <div class="grid gap-1.5">
          <button
            v-for="item in palette"
            :key="item.kind"
            class="flex items-center gap-2 rounded-lg border border-white/6 bg-white/4 px-2.5 py-2 text-left text-[12px] text-white/52 hover:bg-white/8 hover:text-white/78 transition-colors"
            @click="addBlock(item.kind)"
          >
            <component :is="item.icon" :size="13" class="text-white/35" />
            <span>{{ item.label }}</span>
            <Plus :size="12" class="ml-auto text-white/25" />
          </button>
        </div>

        <div class="mt-4 border-t border-white/6 pt-3">
          <div class="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/28">Device</div>
          <div class="grid gap-1.5">
            <button
              v-for="item in deviceItems"
              :key="item.key"
              class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] transition-colors"
              :class="device === item.key ? 'bg-emerald-400/10 text-emerald-100/75' : 'bg-white/4 text-white/42 hover:text-white/70 hover:bg-white/7'"
              @click="device = item.key"
            >
              <component :is="item.icon" :size="13" />
              <span>{{ item.label }}</span>
              <span class="ml-auto font-mono text-[10px] text-white/25">{{ item.width }}</span>
            </button>
          </div>
        </div>
      </aside>

      <main class="min-w-0 min-h-0 flex flex-col bg-[#09090c]">
        <div class="h-10 flex items-center justify-between gap-2 border-b border-white/6 px-3 shrink-0">
          <div class="flex items-center gap-1">
            <button class="rounded px-2 py-1 text-[10px]" :class="mode === 'design' ? 'bg-white/10 text-white/70' : 'text-white/28 hover:text-white/55'" @click="mode = 'design'">Design</button>
            <button class="rounded px-2 py-1 text-[10px]" :class="mode === 'source' ? 'bg-white/10 text-white/70' : 'text-white/28 hover:text-white/55'" @click="mode = 'source'">Source</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-mono text-[10px] text-white/25">{{ canvasWidth }}px</span>
            <button class="rounded bg-white/6 px-2 py-1 text-[10px] text-white/45 hover:text-white/70" @click="applyToActiveFile(true)">apply generated</button>
          </div>
        </div>

        <div v-if="mode === 'design'" class="flex-1 overflow-auto p-5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
          <div
            class="mx-auto min-h-full rounded-lg border border-white/8 bg-[#101217] p-4 text-white shadow-[0_18px_50px_rgba(0,0,0,0.24)]"
            :style="{ width: `${canvasWidth}px` }"
          >
            <button
              v-for="block in blocks"
              :key="block.id"
              class="mb-3 w-full text-left transition-all border"
              :class="[block.classes, selectedId === block.id ? 'ring-1 ring-emerald-300/45' : '']"
              @click="selectedId = block.id"
            >
              <div v-if="block.kind === 'hero'" class="grid gap-3">
                <h1 class="text-4xl font-black leading-[1.05]">{{ block.text }}</h1>
                <span class="inline-flex w-fit rounded-md bg-emerald-300 px-3 py-2 text-[12px] font-bold text-black">Get started</span>
              </div>
              <h2 v-else-if="block.kind === 'heading'" class="text-2xl font-black leading-tight">{{ block.text }}</h2>
              <p v-else-if="block.kind === 'text'" class="text-sm leading-6">{{ block.text }}</p>
              <span v-else-if="block.kind === 'button'" class="inline-flex">{{ block.text }}</span>
              <input v-else-if="block.kind === 'input'" class="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm" :placeholder="block.text" />
              <div v-else-if="block.kind === 'grid'" class="grid gap-3" :class="device === 'mobile' ? 'grid-cols-1' : 'grid-cols-2'">
                <div class="rounded-md bg-white/8 p-3">{{ block.text }}</div>
                <div class="rounded-md bg-white/8 p-3">Second column</div>
              </div>
              <div v-else>
                <div class="text-sm font-bold">{{ block.label }}</div>
                <div class="mt-1 text-sm opacity-75">{{ block.text }}</div>
              </div>
            </button>
          </div>
        </div>

        <textarea
          v-else
          v-model="sourceText"
          class="min-h-0 flex-1 resize-none bg-black/24 p-4 text-[12px] leading-5 text-white/70 font-mono outline-none"
          spellcheck="false"
        ></textarea>
      </main>

      <aside class="min-h-0 border-l border-white/6 bg-black/12 p-3 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Properties</span>
          <div class="flex gap-1">
            <button class="p-1 rounded bg-white/5 text-white/30 hover:text-white/65 hover:bg-white/8" title="Move up" @click="moveBlock(-1)">
              <MoveUp :size="12" />
            </button>
            <button class="p-1 rounded bg-white/5 text-white/30 hover:text-white/65 hover:bg-white/8" title="Move down" @click="moveBlock(1)">
              <MoveDown :size="12" />
            </button>
            <button class="p-1 rounded bg-rose-500/8 text-rose-200/45 hover:text-rose-200 hover:bg-rose-500/12" title="Remove" @click="removeBlock">
              <Trash2 :size="12" />
            </button>
          </div>
        </div>

        <div v-if="selectedBlock" class="grid gap-3">
          <label class="grid gap-1.5">
            <span class="text-[11px] text-white/45">Tag</span>
            <input v-model="selectedBlock.tag" class="rounded-md border border-white/8 bg-black/25 px-2 py-1.5 text-[12px] text-white/70 outline-none focus:border-white/18" />
          </label>
          <label class="grid gap-1.5">
            <span class="text-[11px] text-white/45">Label</span>
            <input v-model="selectedBlock.label" class="rounded-md border border-white/8 bg-black/25 px-2 py-1.5 text-[12px] text-white/70 outline-none focus:border-white/18" />
          </label>
          <label class="grid gap-1.5">
            <span class="text-[11px] text-white/45">Text</span>
            <textarea v-model="selectedBlock.text" class="h-20 resize-none rounded-md border border-white/8 bg-black/25 px-2 py-1.5 text-[12px] leading-5 text-white/70 outline-none focus:border-white/18"></textarea>
          </label>
          <label class="grid gap-1.5">
            <span class="text-[11px] text-white/45">Tailwind classes</span>
            <textarea v-model="selectedBlock.classes" class="h-20 resize-none rounded-md border border-white/8 bg-black/25 px-2 py-1.5 text-[11px] leading-5 text-white/70 font-mono outline-none focus:border-white/18"></textarea>
          </label>
        </div>

        <div class="mt-4 border-t border-white/6 pt-3">
          <div class="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-white/28">
            <Wand2 :size="12" />
            Tailwind tokens
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="token in tailwindTokens"
              :key="token"
              class="rounded border border-white/7 bg-white/4 px-1.5 py-1 text-[10px] text-white/42 hover:text-white/70 hover:bg-white/8"
              @click="addClassToken(token)"
            >
              {{ token }}
            </button>
          </div>
          <div v-if="classTokens.length" class="mt-3 border-t border-white/6 pt-3">
            <div class="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/28">From file</div>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="token in classTokens"
                :key="token"
                class="rounded bg-emerald-400/8 px-1.5 py-1 text-[10px] text-emerald-100/48 hover:text-emerald-100/80"
                @click="addClassToken(token)"
              >
                {{ token }}
              </button>
            </div>
          </div>
        </div>

        <div class="mt-4 border-t border-white/6 pt-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-white/28"><Code2 :size="12" /> Generated</span>
            <button class="flex items-center gap-1 rounded bg-white/6 px-2 py-1 text-[10px] text-white/45 hover:text-white/70 hover:bg-white/9" @click="copyExport">
              <Copy :size="11" />
              {{ copied ? 'copied' : 'copy' }}
            </button>
          </div>
          <pre class="max-h-44 overflow-auto rounded-lg border border-white/6 bg-black/28 p-2 text-[10px] leading-4 text-white/45 whitespace-pre-wrap" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">{{ exportCode }}</pre>
        </div>
      </aside>
    </div>

    <div class="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'s')"></div>
    <div class="absolute top-3 right-0 bottom-3 w-1.5 cursor-e-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'e')"></div>
    <div class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-20" @mousedown="startResize($event,'se')"></div>
  </div>
</template>
