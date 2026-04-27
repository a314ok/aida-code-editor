<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown, Settings2 } from 'lucide-vue-next';
import { useEditorStore } from '../stores/editor';

const store = useEditorStore();

const emit = defineEmits<{
  toggleMenu: [];
  openSettings: [];
}>();

const dirtyCount = computed(() =>
  store.editorWindows.flatMap(w => w.tabs).filter(t => t.isDirty).length
);
</script>

<template>
  <div class="h-12 bg-[#0d0d10] border-b border-white/5 flex items-center px-4 gap-3 shrink-0 select-none">

    <!-- Left: Brand + Badge + Menu -->
    <div class="flex items-center gap-3 flex-1 min-w-0">

      <!-- Status dot + name -->
      <div class="flex items-center gap-2 shrink-0">
        <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"></div>
        <span class="text-[13px] font-semibold text-white/85 tracking-tight">Aida Studio</span>
      </div>

      <!-- Menu button -->
      <button
        class="flex items-center gap-1.5 bg-white/4 border border-white/7 rounded-md px-3 py-1 text-[12px] font-semibold text-white/45 hover:bg-white/8 hover:text-white/65 transition-colors shrink-0"
        @click="emit('toggleMenu')"
      >
        <span class="tracking-wide">МЕНЮ</span>
        <ChevronDown :size="13" />
      </button>

      <!-- Unsaved indicator -->
      <div v-if="dirtyCount > 0" class="flex items-center gap-1.5 text-amber-400/70 text-[11px] shrink-0">
        <div class="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></div>
        <span>{{ dirtyCount }} не збережено</span>
      </div>
    </div>

    <!-- Right: Settings only -->
    <button
      @click="emit('openSettings')"
      class="p-1.5 rounded text-white/25 hover:text-white/55 hover:bg-white/5 transition-colors"
      title="Налаштування (Ctrl+,)"
    >
      <Settings2 :size="15" />
    </button>

  </div>
</template>
