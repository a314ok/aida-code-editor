<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { type FileEntry, useEditorStore } from '../stores/editor';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Trash2, Edit2 } from 'lucide-vue-next';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps<{
  item: FileEntry;
  depth: number;
  expandedDirs: Set<string>;
}>();

const emit = defineEmits<{
  click: [file: FileEntry, event: MouseEvent];
  refresh: [];
}>();

const store = useEditorStore();
const showCtx = ref(false);
const ctxPos = ref({ x: 0, y: 0 });

const isExpanded = computed(() => props.expandedDirs.has(props.item.path));

const relativePath = computed(() => {
  if (!store.currentProject) return props.item.path;
  const p = props.item.path.replace(/\\/g, '/');
  const root = store.currentProject.replace(/\\/g, '/');
  return p.startsWith(root) ? p.slice(root.length).replace(/^\//, '') : p;
});

const gitStatus = computed(() => store.gitStatuses[relativePath.value]);

const statusColor = computed(() => {
  switch (gitStatus.value) {
    case 'M': return 'text-amber-400';
    case 'U': case 'A': return 'text-emerald-400';
    case 'D': return 'text-rose-400';
    case 'R': return 'text-blue-400';
    default: return '';
  }
});

const ext = computed(() => props.item.name.split('.').pop()?.toLowerCase() ?? '');

const iconColor = computed(() => {
  const m: Record<string, string> = {
    ts: 'text-blue-400', tsx: 'text-blue-400',
    js: 'text-yellow-400', jsx: 'text-yellow-400',
    rs: 'text-orange-400', go: 'text-cyan-400', py: 'text-yellow-300',
    vue: 'text-emerald-400', html: 'text-red-400', htm: 'text-red-400',
    css: 'text-sky-300', scss: 'text-pink-400', sass: 'text-pink-400',
    json: 'text-yellow-200', jsonc: 'text-yellow-200',
    md: 'text-white/50', mdx: 'text-white/50',
    xml: 'text-orange-300', svg: 'text-orange-300',
    toml: 'text-orange-200', yaml: 'text-red-300', yml: 'text-red-300',
    sh: 'text-green-300', bash: 'text-green-300', zsh: 'text-green-300', dockerfile: 'text-blue-300', sql: 'text-blue-200',
  };
  return m[ext.value] ?? 'text-white/35';
});

const extBadge = computed(() => {
  const m: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx',
    rs: 'rs', go: 'go', py: 'py', vue: 'vue',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass',
    json: 'json', jsonc: 'json', md: 'md', mdx: 'mdx',
    xml: 'xml', svg: 'svg', toml: 'toml', yaml: 'yaml', yml: 'yml',
    sh: 'sh', bash: 'sh', zsh: 'zsh', dockerfile: 'dock',
  };
  return m[ext.value] ?? '';
});

const openCtx = (e: MouseEvent) => {
  e.preventDefault();
  ctxPos.value = { x: e.clientX, y: e.clientY };
  showCtx.value = true;
};
const closeCtx = () => { showCtx.value = false; };

const deleteItem = async () => {
  if (confirm(`Видалити "${props.item.name}"?`)) {
    try { await invoke('delete_file', { path: props.item.path }); emit('refresh'); }
    catch (e) { alert('Помилка: ' + e); }
  }
  closeCtx();
};

const renameItem = async () => {
  const newName = prompt('Нова назва:', props.item.name);
  if (newName && newName !== props.item.name) {
    try {
      const sep = props.item.path.includes('/') ? '/' : '\\';
      const dir = props.item.path.substring(0, props.item.path.lastIndexOf(sep) + 1);
      await invoke('rename_file', { path: props.item.path, newPath: dir + newName });
      emit('refresh');
    } catch (e) { alert('Помилка: ' + e); }
  }
  closeCtx();
};

onMounted(() => window.addEventListener('click', closeCtx));
onUnmounted(() => window.removeEventListener('click', closeCtx));
</script>

<template>
  <div class="relative">
    <div
      @click="emit('click', item, $event)"
      @contextmenu="openCtx"
      class="flex items-center gap-1.5 py-0.5 mx-1 rounded cursor-pointer hover:bg-white/5 group transition-colors"
      :style="{ paddingLeft: (depth * 12 + 8) + 'px', paddingRight: '8px' }"
    >
      <!-- Chevron -->
      <div class="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-white/20">
        <ChevronDown  v-if="item.kind === 'directory' && isExpanded"  :size="11" />
        <ChevronRight v-else-if="item.kind === 'directory'"           :size="11" />
      </div>

      <!-- Icon -->
      <template v-if="item.kind === 'directory'">
        <FolderOpen v-if="isExpanded" :size="13" class="text-blue-300/60 shrink-0" />
        <Folder     v-else            :size="13" class="text-blue-300/40 shrink-0" />
      </template>
      <template v-else>
        <span
          class="text-[8px] font-bold font-mono shrink-0 min-w-[18px] text-center leading-none"
          :class="gitStatus ? statusColor : iconColor"
        >{{ extBadge || ext.slice(0, 3) || '·' }}</span>
      </template>

      <!-- Name -->
      <span
        class="text-[12px] truncate flex-1 transition-colors"
        :class="gitStatus ? statusColor : 'text-white/55 group-hover:text-white/85'"
      >{{ item.name }}</span>

      <!-- Git status badge -->
      <span
        v-if="gitStatus"
        class="text-[9px] font-bold ml-1 shrink-0 opacity-60"
        :class="statusColor"
      >{{ gitStatus }}</span>
    </div>

    <!-- Children -->
    <div v-if="item.kind === 'directory' && isExpanded && item.children">
      <FileTreeItem
        v-for="child in item.children"
        :key="child.path"
        :item="child"
        :depth="depth + 1"
        :expanded-dirs="expandedDirs"
        @click="(f: FileEntry, event: MouseEvent) => emit('click', f, event)"
        @refresh="emit('refresh')"
      />
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="showCtx"
        class="fixed z-[10001] bg-[#1a1a20] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.7)] rounded-lg py-1 w-40"
        :style="{ left: ctxPos.x + 'px', top: ctxPos.y + 'px' }"
        @click.stop
      >
        <button
          @click="renameItem"
          class="w-full text-left px-3 py-1.5 text-[11px] text-white/60 hover:bg-white/7 hover:text-white/85 flex items-center gap-2 transition-colors"
        >
          <Edit2 :size="11" /> Перейменувати
        </button>
        <div class="h-px bg-white/7 my-0.5 mx-2"></div>
        <button
          @click="deleteItem"
          class="w-full text-left px-3 py-1.5 text-[11px] text-rose-400 hover:bg-rose-500/8 flex items-center gap-2 transition-colors"
        >
          <Trash2 :size="11" /> Видалити
        </button>
      </div>
    </Teleport>
  </div>
</template>
