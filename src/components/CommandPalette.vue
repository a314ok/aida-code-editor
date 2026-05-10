<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Search } from 'lucide-vue-next';
import { useEditorStore } from '../stores/editor';
import { getExtensionCommands, runExtensionCommand } from '../lib/extensions';
import { isCode, isPrimaryKey } from '../lib/shortcuts';

const store = useEditorStore();
const isVisible = ref(false);
const searchQuery = ref('');
const selectedIndex = ref(0);
const extensionVersion = ref(0);

const emit = defineEmits(['openSettings', 'openSearch', 'openProblems', 'openTasks', 'openDebug']);

const coreCommands = [
  { id: 'toggle-terminal', label: 'View: Toggle Terminal',      shortcut: 'Ctrl+J' },
  { id: 'open-settings',   label: 'Preferences: Open Settings', shortcut: 'Ctrl+,' },
  { id: 'open-search',     label: 'Search: Find in Files',      shortcut: 'Ctrl+Shift+F' },
  { id: 'open-problems',   label: 'View: Problems',             shortcut: 'Ctrl+Shift+M' },
  { id: 'open-tasks',      label: 'Tasks: Run Task',             shortcut: 'Ctrl+Shift+B' },
  { id: 'open-debug',      label: 'Debug: Open Debugger',        shortcut: 'Ctrl+Shift+D' },
  { id: 'save-file',       label: 'File: Save',                 shortcut: 'Ctrl+S' },
  { id: 'lsp-hover',       label: 'LSP: Hover',                 shortcut: '' },
  { id: 'lsp-definition',  label: 'LSP: Go to Definition',      shortcut: 'F12' },
  { id: 'lsp-references',  label: 'LSP: Find References',       shortcut: 'Shift+F12' },
  { id: 'lsp-rename',      label: 'LSP: Rename Symbol',         shortcut: 'F2' },
  { id: 'lsp-actions',     label: 'LSP: Code Actions',          shortcut: 'Ctrl+.' },
  { id: 'lsp-format',      label: 'LSP: Format Document',       shortcut: 'Shift+Alt+F' },
  { id: 'vim-toggle',      label: 'Editor: Toggle Vim Mode',    shortcut: '' },
  { id: 'word-wrap',       label: 'Editor: Toggle Word Wrap',   shortcut: 'Alt+Z' },
];

const allCommands = computed(() => [
  ...coreCommands,
  ...getExtensionCommands().map(command => ({
    id: command.id,
    label: command.title,
    shortcut: command.shortcut ?? '',
    extension: true,
  })),
]);

const filtered = computed(() => {
  extensionVersion.value;
  if (!searchQuery.value) return allCommands.value;
  const q = searchQuery.value.toLowerCase();
  return allCommands.value.filter(c => c.label.toLowerCase().includes(q));
});

const executeCommand = (id: string) => {
  switch (id) {
    case 'toggle-terminal': store.toggleTerminal(); break;
    case 'open-settings':   emit('openSettings'); break;
    case 'open-search':     emit('openSearch'); break;
    case 'open-problems':   emit('openProblems'); break;
    case 'open-tasks':      emit('openTasks'); break;
    case 'open-debug':      emit('openDebug'); break;
    case 'save-file':       window.dispatchEvent(new CustomEvent('aida:save-active-file')); break;
    case 'lsp-hover':       window.dispatchEvent(new CustomEvent('aida:lsp-action', { detail: { action: 'hover' } })); break;
    case 'lsp-definition':  window.dispatchEvent(new CustomEvent('aida:lsp-action', { detail: { action: 'definition' } })); break;
    case 'lsp-references':  window.dispatchEvent(new CustomEvent('aida:lsp-action', { detail: { action: 'references' } })); break;
    case 'lsp-rename':      window.dispatchEvent(new CustomEvent('aida:lsp-action', { detail: { action: 'rename' } })); break;
    case 'lsp-actions':     window.dispatchEvent(new CustomEvent('aida:lsp-action', { detail: { action: 'actions' } })); break;
    case 'lsp-format':      window.dispatchEvent(new CustomEvent('aida:lsp-action', { detail: { action: 'format' } })); break;
    case 'vim-toggle':      store.settings.vimEnabled = !store.settings.vimEnabled; break;
    case 'word-wrap':       store.settings.wordWrap = !store.settings.wordWrap; break;
    default:                runExtensionCommand(id); break;
  }
  isVisible.value = false;
  searchQuery.value = '';
  selectedIndex.value = 0;
};

const refreshExtensions = () => { extensionVersion.value++; };

const handleKeydown = (e: KeyboardEvent) => {
  if (isPrimaryKey(e, 'KeyP')) {
    e.preventDefault();
    isVisible.value = !isVisible.value;
    if (isVisible.value) searchQuery.value = '';
  }
  if (isPrimaryKey(e, 'Comma')) {
    e.preventDefault();
    emit('openSettings');
  }
  if (isPrimaryKey(e, 'KeyF', { shift: true })) {
    e.preventDefault();
    isVisible.value = false;
    emit('openSearch');
  }
  if (isPrimaryKey(e, 'KeyM', { shift: true })) {
    e.preventDefault();
    isVisible.value = false;
    emit('openProblems');
  }
  if (isPrimaryKey(e, 'KeyB', { shift: true })) {
    e.preventDefault();
    isVisible.value = false;
    emit('openTasks');
  }
  if (isPrimaryKey(e, 'KeyD', { shift: true })) {
    e.preventDefault();
    isVisible.value = false;
    emit('openDebug');
  }

  if (!isVisible.value) return;
  if (isCode(e, 'Escape')) { isVisible.value = false; return; }
  if (isCode(e, 'Enter') && filtered.value[selectedIndex.value]) {
    executeCommand(filtered.value[selectedIndex.value].id);
    return;
  }
  if (isCode(e, 'ArrowDown')) { e.preventDefault(); selectedIndex.value = (selectedIndex.value + 1) % filtered.value.length; }
  if (isCode(e, 'ArrowUp'))   { e.preventDefault(); selectedIndex.value = (selectedIndex.value - 1 + filtered.value.length) % filtered.value.length; }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('aida:extensions-changed', refreshExtensions);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('aida:extensions-changed', refreshExtensions);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isVisible"
      class="fixed inset-0 z-[10000] flex justify-center pt-20 bg-black/45"
      @mousedown.self="isVisible = false"
    >
      <div class="w-[560px] h-fit bg-[#141418] border border-white/9 shadow-2xl rounded-xl overflow-hidden">
        <div class="flex items-center px-4 py-3 border-b border-white/7 gap-3">
          <Search :size="14" class="text-white/30 shrink-0" />
          <input
            v-model="searchQuery"
            @input="selectedIndex = 0"
            type="text"
            placeholder="Введіть команду…"
            class="bg-transparent border-none outline-none flex-1 text-[13px] text-white/80 placeholder:text-white/25"
            autofocus
          />
          <kbd class="text-[10px] text-white/20 border border-white/10 rounded px-1">Esc</kbd>
        </div>

        <div class="max-h-[320px] overflow-y-auto py-1">
          <div
            v-for="(cmd, index) in filtered"
            :key="cmd.id"
            class="px-3 py-2 flex items-center justify-between cursor-pointer mx-1 rounded-lg transition-colors"
            :class="selectedIndex === index ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5'"
            @mouseenter="selectedIndex = index"
            @click="executeCommand(cmd.id)"
          >
            <span class="text-[13px]">{{ cmd.label }}</span>
            <span v-if="cmd.shortcut" class="text-[10px] font-mono text-white/25">{{ cmd.shortcut }}</span>
          </div>
          <div v-if="!filtered.length" class="px-4 py-5 text-center text-[12px] text-white/25 italic">
            Команд не знайдено
          </div>
        </div>

        <div class="px-4 py-2 border-t border-white/6 flex items-center gap-4 bg-black/20">
          <span class="text-[10px] text-white/20"><kbd class="border border-white/10 rounded px-1">↑↓</kbd> навігація</span>
          <span class="text-[10px] text-white/20"><kbd class="border border-white/10 rounded px-1">Enter</kbd> виконати</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
