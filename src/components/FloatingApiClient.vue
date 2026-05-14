<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '../lib/ipc';
import { BookMarked, Check, Clock3, Copy, FolderOpen, Maximize2, Minimize2, Plus, Play, Star, Trash2, X } from 'lucide-vue-next';
import { useFloating } from '../composables/useFloating';
import { useEditorStore } from '../stores/editor';
import { isPrimaryKey } from '../lib/shortcuts';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
type RequestTab = 'params' | 'auth' | 'headers' | 'body';
type BodyMode = 'none' | 'json' | 'raw' | 'form' | 'urlencoded';
type AuthType = 'none' | 'bearer' | 'basic' | 'api-key';
type KeyValueRow = { id: string; enabled: boolean; key: string; value: string };
type ApiHistoryItem = {
  method: HttpMethod;
  url: string;
  headersText?: string;
  bodyText?: string;
  at: number;
};

const emit = defineEmits(['close']);
const store = useEditorStore();

const { pos, maximized, startDrag, startResize, toggleMaximize, bringToFront } =
  useFloating({ x: 96, y: 96, w: 920, h: 640 });

const method = ref<HttpMethod>('GET');
const url = ref('http://127.0.0.1:3000/api');
const requestTab = ref<RequestTab>('params');
const authType = ref<AuthType>('none');
const bearerToken = ref('');
const basicUser = ref('');
const basicPassword = ref('');
const apiKeyName = ref('X-API-Key');
const apiKeyValue = ref('');
const apiKeyIn = ref<'header' | 'query'>('header');
const bodyMode = ref<BodyMode>('json');
const requestTabs: RequestTab[] = ['params', 'auth', 'headers', 'body'];
const bodyModes: BodyMode[] = ['none', 'json', 'raw', 'form', 'urlencoded'];
const headersText = ref('Accept: application/json');
const bodyText = ref('{\n  \n}');
const paramsRows = ref<KeyValueRow[]>([]);
const headerRows = ref<KeyValueRow[]>([
  { id: 'accept', enabled: true, key: 'Accept', value: 'application/json' },
]);
const formRows = ref<KeyValueRow[]>([]);
const urlEncodedRows = ref<KeyValueRow[]>([]);
const loading = ref(false);
const error = ref('');
const responseStatus = ref<number | null>(null);
const responseStatusText = ref('');
const responseTime = ref<number | null>(null);
const responseSize = ref<number | null>(null);
const responseHeaders = ref('');
const responseBody = ref('');
const responseMode = ref<'body' | 'headers'>('body');
const history = ref<ApiHistoryItem[]>([]);
const urlInputRef = ref<HTMLInputElement | null>(null);
let aborter: AbortController | null = null;

type ApiCollection = {
  id: string;
  name: string;
  requests: ApiHistoryItem[];
};
type SidebarTab = 'history' | 'collections';
const sidebarTab = ref<SidebarTab>('history');
const collections = ref<ApiCollection[]>([]);
const showSaveDialog = ref(false);
const saveCollectionId = ref('__new__');
const saveRequestName = ref('');
const saveInputEl = ref<HTMLInputElement | null>(null);
const expandedCollections = ref<Set<string>>(new Set());

const panelStyle = computed(() => ({
  left: `${pos.x}px`,
  top: `${pos.y}px`,
  width: `${pos.w}px`,
  height: `${pos.h}px`,
  zIndex: pos.z,
}));

const canSendBody = computed(() => !['GET', 'HEAD'].includes(method.value));
const enabledParams = computed(() => paramsRows.value.filter(row => row.enabled && row.key.trim()));
const enabledHeaders = computed(() => headerRows.value.filter(row => row.enabled && row.key.trim()));
const enabledFormRows = computed(() => formRows.value.filter(row => row.enabled && row.key.trim()));
const enabledUrlEncodedRows = computed(() => urlEncodedRows.value.filter(row => row.enabled && row.key.trim()));
const statusClass = computed(() => {
  const status = responseStatus.value ?? 0;
  if (status >= 200 && status < 300) return 'text-emerald-300 bg-emerald-500/10';
  if (status >= 300 && status < 400) return 'text-sky-300 bg-sky-500/10';
  if (status >= 400) return 'text-rose-300 bg-rose-500/10';
  return 'text-white/35 bg-white/5';
});

const makeRow = (key = '', value = ''): KeyValueRow => ({
  id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  enabled: true,
  key,
  value,
});

const addRow = (rows: KeyValueRow[]) => {
  rows.push(makeRow());
};

const removeRow = (rows: KeyValueRow[], rowId: string) => {
  const index = rows.findIndex(row => row.id === rowId);
  if (index !== -1) rows.splice(index, 1);
};

const preparedUrl = computed(() => {
  const raw = url.value.trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    for (const row of enabledParams.value) parsed.searchParams.set(row.key.trim(), row.value);
    if (authType.value === 'api-key' && apiKeyIn.value === 'query' && apiKeyName.value.trim()) {
      parsed.searchParams.set(apiKeyName.value.trim(), apiKeyValue.value);
    }
    return parsed.toString();
  } catch {
    return raw;
  }
});

const parseHeaders = () => {
  const headers = new Headers();
  for (const rawLine of headersText.value.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    headers.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  for (const row of enabledHeaders.value) headers.set(row.key.trim(), row.value);
  if (authType.value === 'bearer' && bearerToken.value.trim()) {
    headers.set('Authorization', `Bearer ${bearerToken.value.trim()}`);
  }
  if (authType.value === 'basic') {
    headers.set('Authorization', `Basic ${btoa(`${basicUser.value}:${basicPassword.value}`)}`);
  }
  if (authType.value === 'api-key' && apiKeyIn.value === 'header' && apiKeyName.value.trim()) {
    headers.set(apiKeyName.value.trim(), apiKeyValue.value);
  }
  return headers;
};

const buildRequestBody = (headers: Headers) => {
  if (!canSendBody.value || bodyMode.value === 'none') return undefined;
  if (bodyMode.value === 'json') {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return bodyText.value;
  }
  if (bodyMode.value === 'raw') return bodyText.value;
  if (bodyMode.value === 'urlencoded') {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const params = new URLSearchParams();
    for (const row of enabledUrlEncodedRows.value) params.set(row.key.trim(), row.value);
    return params.toString();
  }
  const form = new FormData();
  for (const row of enabledFormRows.value) form.set(row.key.trim(), row.value);
  return form;
};

const formatBody = (text: string, contentType: string | null) => {
  const looksJson = contentType?.includes('application/json') || /^[\s\n]*[{[]/.test(text);
  if (!looksJson) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const saveHistory = () => {
  const item = { method: method.value, url: url.value.trim(), headersText: headersText.value, bodyText: bodyText.value, at: Date.now() };
  history.value = [item, ...history.value.filter(entry => entry.url !== item.url || entry.method !== item.method)].slice(0, 20);
  localStorage.setItem('aida:api-history', JSON.stringify(history.value));
};

const sendRequest = async () => {
  if (!preparedUrl.value || loading.value) return;
  loading.value = true;
  error.value = '';
  responseStatus.value = null;
  responseStatusText.value = '';
  responseHeaders.value = '';
  responseBody.value = '';
  responseTime.value = null;
  responseSize.value = null;
  aborter = new AbortController();
  const started = performance.now();

  try {
    const headers = parseHeaders();
    const init: RequestInit = {
      method: method.value,
      headers,
      signal: aborter.signal,
    };
    const requestBody = buildRequestBody(headers);
    if (requestBody !== undefined) init.body = requestBody;
    const response = await fetch(preparedUrl.value, init);
    const text = await response.text();
    responseStatus.value = response.status;
    responseStatusText.value = response.statusText;
    responseTime.value = Math.round(performance.now() - started);
    responseSize.value = new TextEncoder().encode(text).length;
    responseHeaders.value = Array.from(response.headers.entries())
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    responseBody.value = formatBody(text, response.headers.get('content-type'));
    saveHistory();
  } catch (e: any) {
    error.value = e?.name === 'AbortError' ? 'Request aborted' : String(e);
  } finally {
    loading.value = false;
    aborter = null;
  }
};

const abortRequest = () => {
  aborter?.abort();
};

const loadHistory = (item: ApiHistoryItem) => {
  method.value = item.method;
  url.value = item.url;
  headersText.value = item.headersText ?? headersText.value;
  bodyText.value = item.bodyText ?? bodyText.value;
};

const clearHistory = () => {
  history.value = [];
  localStorage.removeItem('aida:api-history');
};

const methodColor = (m: string) => {
  const map: Record<string, string> = {
    GET: 'text-emerald-300', POST: 'text-sky-300', PUT: 'text-amber-300',
    PATCH: 'text-violet-300', DELETE: 'text-rose-300', HEAD: 'text-slate-300', OPTIONS: 'text-slate-300',
  };
  return map[m] ?? 'text-white/50';
};

const formatTimeAgo = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const persistCollections = () => {
  localStorage.setItem('aida:api-collections', JSON.stringify(collections.value));
};

const loadCollectionsFromStorage = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('aida:api-collections') ?? '[]');
    if (Array.isArray(saved)) collections.value = saved;
  } catch {}
};

const openSaveDialog = () => {
  saveRequestName.value = `${method.value} ${url.value.replace(/^https?:\/\/[^/]+/, '') || '/'}`.slice(0, 48);
  saveCollectionId.value = collections.value[0]?.id ?? '__new__';
  showSaveDialog.value = true;
  nextTick(() => saveInputEl.value?.select());
};

const confirmSaveRequest = () => {
  const name = saveRequestName.value.trim();
  if (!name) return;
  const item: ApiHistoryItem = { method: method.value, url: url.value.trim(), headersText: headersText.value, bodyText: bodyText.value, at: Date.now() };
  if (saveCollectionId.value === '__new__') {
    const col: ApiCollection = { id: `col-${Date.now()}`, name: name, requests: [item] };
    collections.value = [col, ...collections.value];
  } else {
    const col = collections.value.find(c => c.id === saveCollectionId.value);
    if (col) col.requests = [{ ...item, at: Date.now() }, ...col.requests];
  }
  persistCollections();
  showSaveDialog.value = false;
  sidebarTab.value = 'collections';
  expandedCollections.value.add(saveCollectionId.value === '__new__' ? collections.value[0]?.id ?? '' : saveCollectionId.value);
};

const deleteCollection = (id: string) => {
  collections.value = collections.value.filter(c => c.id !== id);
  persistCollections();
};

const deleteCollectionRequest = (colId: string, idx: number) => {
  const col = collections.value.find(c => c.id === colId);
  if (col) { col.requests.splice(idx, 1); persistCollections(); }
};

const toggleCollection = (id: string) => {
  if (expandedCollections.value.has(id)) expandedCollections.value.delete(id);
  else expandedCollections.value.add(id);
};

const autoDetectUrl = async () => {
  const project = store.currentProject;
  if (!project) return;
  try {
    const pkgRaw = await invoke<string>('read_file', { path: `${project}/package.json` }).catch(() => '{}');
    const pkg = JSON.parse(pkgRaw);
    const proxyTarget = pkg?.proxy;
    if (typeof proxyTarget === 'string') { url.value = proxyTarget; return; }
    const envRaw = await invoke<string>('read_file', { path: `${project}/.env` }).catch(() => '');
    const portMatch = envRaw.match(/(?:PORT|VITE_PORT|SERVER_PORT)\s*=\s*(\d+)/);
    if (portMatch) { url.value = `http://localhost:${portMatch[1]}`; return; }
    const viteRaw = await invoke<string>('read_file', { path: `${project}/vite.config.ts` }).catch(() => '');
    const vitePort = viteRaw.match(/port\s*:\s*(\d+)/);
    if (vitePort) { url.value = `http://localhost:${vitePort[1]}`; return; }
    url.value = 'http://localhost:3000';
  } catch {}
};

const copyResponse = async () => {
  await navigator.clipboard?.writeText(responseMode.value === 'body' ? responseBody.value : responseHeaders.value);
};

const handleKeys = (event: KeyboardEvent) => {
  if (isPrimaryKey(event, 'Enter')) {
    event.preventDefault();
    void sendRequest();
  }
  if (isPrimaryKey(event, 'KeyL')) {
    event.preventDefault();
    urlInputRef.value?.focus();
  }
};

onMounted(async () => {
  window.addEventListener('keydown', handleKeys);
  try {
    const saved = JSON.parse(localStorage.getItem('aida:api-history') ?? '[]');
    if (Array.isArray(saved)) history.value = saved.slice(0, 20);
  } catch {}
  loadCollectionsFromStorage();
  await nextTick();
  urlInputRef.value?.focus();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeys);
  aborter?.abort();
});
</script>

<template>
  <div
    data-floating-window
    class="absolute flex flex-col rounded-xl border border-white/8 bg-[#0d0d11] shadow-[0_8px_40px_rgba(0,0,0,0.62)] overflow-hidden"
    :style="panelStyle"
    @mousedown="bringToFront(); store.activeBrowserWindowId = null"
  >
    <div class="h-10 flex items-center justify-between gap-2 px-3 border-b border-white/6 bg-[#111116] cursor-move shrink-0" @mousedown="startDrag">
      <div class="flex items-center gap-2 min-w-0">
        <Play :size="14" class="text-emerald-300/75 shrink-0" />
        <span class="text-[11px] font-bold uppercase tracking-widest text-white/45">API Client</span>
        <span v-if="responseStatus" class="rounded px-1.5 py-0.5 text-[10px] font-bold" :class="statusClass">
          {{ responseStatus }} {{ responseStatusText }}
        </span>
      </div>
      <div class="flex items-center gap-1 mr-1" @mousedown.stop>
        <button class="flex items-center gap-1 h-7 px-2 rounded text-[10px] text-amber-300/60 hover:text-amber-200 hover:bg-white/6 transition-colors" title="Save request to collection" @click="openSaveDialog">
          <Star :size="12" />
          Save
        </button>
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

    <div class="grid grid-cols-[minmax(0,1fr)_260px] min-h-0 flex-1">
      <div class="min-w-0 min-h-0 flex flex-col">
        <div class="flex items-center gap-2 p-3 border-b border-white/6 bg-black/12">
          <select v-model="method" class="h-8 rounded-md border border-white/8 bg-black/35 px-2 text-[12px] font-bold text-white/70 outline-none">
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
            <option>HEAD</option>
            <option>OPTIONS</option>
          </select>
          <input
            ref="urlInputRef"
            v-model="url"
            class="h-8 min-w-0 flex-1 rounded-md border border-white/8 bg-black/30 px-3 text-[12px] text-white/72 outline-none focus:border-emerald-300/35"
            placeholder="https://api.example.com/resource"
            @keydown.enter.prevent="sendRequest"
          />
          <button
            class="h-8 px-2 rounded-md border border-white/8 bg-black/20 text-[10px] text-white/35 hover:text-white/65 hover:bg-white/6 transition-colors whitespace-nowrap"
            title="Auto-detect backend URL from project config"
            @click="autoDetectUrl"
          >
            <FolderOpen :size="13" />
          </button>
          <button
            v-if="loading"
            class="h-8 rounded-md border border-rose-300/20 bg-rose-500/10 px-3 text-[11px] font-bold text-rose-200/70"
            @click="abortRequest"
          >
            Abort
          </button>
          <button
            v-else
            class="h-8 rounded-md bg-emerald-300 px-4 text-[11px] font-bold text-black hover:bg-emerald-200 transition-colors"
            @click="sendRequest"
          >
            Send
          </button>
        </div>

        <div class="min-h-0 flex-1 flex flex-col">
          <div class="h-9 flex items-center gap-1 px-3 border-b border-white/6 bg-black/12 shrink-0">
            <button
              v-for="tabName in requestTabs"
              :key="tabName"
              class="rounded px-2 py-1 text-[10px] capitalize"
              :class="requestTab === tabName ? 'bg-white/10 text-white/70' : 'text-white/28 hover:text-white/55'"
              @click="requestTab = tabName"
            >
              {{ tabName }}
            </button>
            <span class="ml-auto truncate text-[10px] text-white/20">{{ preparedUrl }}</span>
          </div>

          <div v-if="requestTab === 'params'" class="min-h-0 flex-1 overflow-auto p-3" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Query Params</span>
              <button class="flex items-center gap-1 rounded bg-white/6 px-2 py-1 text-[10px] text-white/45 hover:text-white/70" @click="addRow(paramsRows)">
                <Plus :size="11" /> add
              </button>
            </div>
            <div class="grid gap-1">
              <div v-for="row in paramsRows" :key="row.id" class="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_28px] gap-1">
                <input v-model="row.enabled" type="checkbox" class="accent-emerald-300" />
                <input v-model="row.key" placeholder="key" class="rounded bg-black/28 border border-white/7 px-2 py-1 text-[11px] text-white/65 outline-none" />
                <input v-model="row.value" placeholder="value" class="rounded bg-black/28 border border-white/7 px-2 py-1 text-[11px] text-white/65 outline-none" />
                <button class="rounded text-white/25 hover:text-rose-300 hover:bg-rose-500/10" @click="removeRow(paramsRows, row.id)"><Trash2 :size="11" /></button>
              </div>
              <div v-if="!paramsRows.length" class="rounded border border-white/5 bg-black/18 px-3 py-6 text-center text-[11px] text-white/20">No query params</div>
            </div>
          </div>

          <div v-else-if="requestTab === 'auth'" class="min-h-0 flex-1 overflow-auto p-3 grid gap-3 content-start" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
            <label class="grid gap-1.5">
              <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Auth Type</span>
              <select v-model="authType" class="rounded bg-black/28 border border-white/7 px-2 py-1.5 text-[12px] text-white/70 outline-none">
                <option value="none">No auth</option>
                <option value="bearer">Bearer token</option>
                <option value="basic">Basic auth</option>
                <option value="api-key">API key</option>
              </select>
            </label>
            <input v-if="authType === 'bearer'" v-model="bearerToken" placeholder="Bearer token" class="rounded bg-black/28 border border-white/7 px-2 py-1.5 text-[12px] text-white/70 outline-none" />
            <div v-if="authType === 'basic'" class="grid grid-cols-2 gap-2">
              <input v-model="basicUser" placeholder="username" class="rounded bg-black/28 border border-white/7 px-2 py-1.5 text-[12px] text-white/70 outline-none" />
              <input v-model="basicPassword" placeholder="password" type="password" class="rounded bg-black/28 border border-white/7 px-2 py-1.5 text-[12px] text-white/70 outline-none" />
            </div>
            <div v-if="authType === 'api-key'" class="grid grid-cols-[1fr_1fr_92px] gap-2">
              <input v-model="apiKeyName" placeholder="key name" class="rounded bg-black/28 border border-white/7 px-2 py-1.5 text-[12px] text-white/70 outline-none" />
              <input v-model="apiKeyValue" placeholder="value" class="rounded bg-black/28 border border-white/7 px-2 py-1.5 text-[12px] text-white/70 outline-none" />
              <select v-model="apiKeyIn" class="rounded bg-black/28 border border-white/7 px-2 py-1.5 text-[12px] text-white/70 outline-none">
                <option value="header">header</option>
                <option value="query">query</option>
              </select>
            </div>
          </div>

          <div v-else-if="requestTab === 'headers'" class="min-h-0 flex-1 grid grid-cols-[minmax(0,1fr)_260px]">
            <div class="min-h-0 overflow-auto p-3" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">Header Table</span>
                <button class="flex items-center gap-1 rounded bg-white/6 px-2 py-1 text-[10px] text-white/45 hover:text-white/70" @click="addRow(headerRows)">
                  <Plus :size="11" /> add
                </button>
              </div>
              <div class="grid gap-1">
                <div v-for="row in headerRows" :key="row.id" class="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_28px] gap-1">
                  <input v-model="row.enabled" type="checkbox" class="accent-emerald-300" />
                  <input v-model="row.key" placeholder="Header" class="rounded bg-black/28 border border-white/7 px-2 py-1 text-[11px] text-white/65 outline-none" />
                  <input v-model="row.value" placeholder="Value" class="rounded bg-black/28 border border-white/7 px-2 py-1 text-[11px] text-white/65 outline-none" />
                  <button class="rounded text-white/25 hover:text-rose-300 hover:bg-rose-500/10" @click="removeRow(headerRows, row.id)"><Trash2 :size="11" /></button>
                </div>
              </div>
            </div>
            <textarea v-model="headersText" class="min-h-0 resize-none border-l border-white/6 bg-black/18 p-3 text-[11px] leading-5 text-white/55 font-mono outline-none" placeholder="Raw headers"></textarea>
          </div>

          <div v-else class="min-h-0 flex-1 flex flex-col">
            <div class="h-9 flex items-center gap-1 px-3 border-b border-white/6 shrink-0">
              <button v-for="bodyTab in bodyModes" :key="bodyTab" class="rounded px-2 py-1 text-[10px]" :class="bodyMode === bodyTab ? 'bg-white/10 text-white/70' : 'text-white/28 hover:text-white/55'" @click="bodyMode = bodyTab">{{ bodyTab }}</button>
            </div>
            <textarea
              v-if="bodyMode === 'json' || bodyMode === 'raw'"
              v-model="bodyText"
              :disabled="!canSendBody"
              class="min-h-0 flex-1 resize-none bg-black/18 p-3 text-[11px] leading-5 text-white/65 font-mono outline-none disabled:opacity-25"
            ></textarea>
            <div v-else-if="bodyMode === 'form' || bodyMode === 'urlencoded'" class="min-h-0 flex-1 overflow-auto p-3" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wide text-white/28">{{ bodyMode === 'form' ? 'Form Data' : 'URL Encoded' }}</span>
                <button class="flex items-center gap-1 rounded bg-white/6 px-2 py-1 text-[10px] text-white/45 hover:text-white/70" @click="addRow(bodyMode === 'form' ? formRows : urlEncodedRows)">
                  <Plus :size="11" /> add
                </button>
              </div>
              <div class="grid gap-1">
                <div v-for="row in (bodyMode === 'form' ? formRows : urlEncodedRows)" :key="row.id" class="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_28px] gap-1">
                  <input v-model="row.enabled" type="checkbox" class="accent-emerald-300" />
                  <input v-model="row.key" placeholder="key" class="rounded bg-black/28 border border-white/7 px-2 py-1 text-[11px] text-white/65 outline-none" />
                  <input v-model="row.value" placeholder="value" class="rounded bg-black/28 border border-white/7 px-2 py-1 text-[11px] text-white/65 outline-none" />
                  <button class="rounded text-white/25 hover:text-rose-300 hover:bg-rose-500/10" @click="removeRow(bodyMode === 'form' ? formRows : urlEncodedRows, row.id)"><Trash2 :size="11" /></button>
                </div>
              </div>
            </div>
            <div v-else class="flex-1 flex items-center justify-center text-[12px] text-white/22">Request body disabled</div>
          </div>
        </div>

        <div class="h-[45%] min-h-[180px] border-t border-white/6 flex flex-col">
          <div class="h-9 flex items-center justify-between px-3 border-b border-white/6 bg-black/12">
            <div class="flex items-center gap-2 text-[10px] text-white/30">
              <span v-if="responseTime !== null" class="flex items-center gap-1"><Clock3 :size="11" />{{ responseTime }} ms</span>
              <span>{{ formatBytes(responseSize) }}</span>
              <span v-if="error" class="text-rose-300/70">{{ error }}</span>
            </div>
            <div class="flex items-center gap-1">
              <button class="rounded px-2 py-1 text-[10px]" :class="responseMode === 'body' ? 'bg-white/10 text-white/70' : 'text-white/28 hover:text-white/55'" @click="responseMode = 'body'">Body</button>
              <button class="rounded px-2 py-1 text-[10px]" :class="responseMode === 'headers' ? 'bg-white/10 text-white/70' : 'text-white/28 hover:text-white/55'" @click="responseMode = 'headers'">Headers</button>
              <button class="p-1 rounded text-white/28 hover:text-white/65 hover:bg-white/6" title="Copy" @click="copyResponse"><Copy :size="12" /></button>
            </div>
          </div>
          <pre class="min-h-0 flex-1 overflow-auto bg-black/22 p-3 text-[11px] leading-5 text-white/62 font-mono whitespace-pre-wrap">{{ responseMode === 'body' ? responseBody : responseHeaders }}</pre>
        </div>
      </div>

      <aside class="min-w-0 border-l border-white/6 bg-black/12 flex flex-col relative">
        <!-- Sidebar tabs -->
        <div class="h-9 flex items-center border-b border-white/6 shrink-0">
          <button
            class="flex-1 h-full flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide transition-colors"
            :class="sidebarTab === 'history' ? 'text-white/55 bg-white/5' : 'text-white/25 hover:text-white/45'"
            @click="sidebarTab = 'history'"
          >
            <Clock3 :size="11" /> History
          </button>
          <button
            class="flex-1 h-full flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide transition-colors"
            :class="sidebarTab === 'collections' ? 'text-white/55 bg-white/5' : 'text-white/25 hover:text-white/45'"
            @click="sidebarTab = 'collections'"
          >
            <BookMarked :size="11" /> Saved
          </button>
          <button
            v-if="sidebarTab === 'history'"
            class="px-2 py-2 text-white/25 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
            title="Clear history"
            @click="clearHistory"
          >
            <Trash2 :size="11" />
          </button>
        </div>

        <!-- History tab -->
        <div v-if="sidebarTab === 'history'" class="flex-1 overflow-auto p-2 space-y-0.5" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
          <button
            v-for="item in history"
            :key="`${item.method}:${item.url}:${item.at}`"
            class="w-full rounded px-2 py-1.5 text-left hover:bg-white/5 transition-colors group"
            @click="loadHistory(item)"
          >
            <div class="flex items-center gap-1.5 mb-0.5">
              <span class="text-[10px] font-bold" :class="methodColor(item.method)">{{ item.method }}</span>
              <span class="ml-auto text-[9px] text-white/20">{{ formatTimeAgo(item.at) }}</span>
            </div>
            <span class="block truncate text-[11px] text-white/48">{{ item.url }}</span>
          </button>
          <div v-if="!history.length" class="px-2 py-8 text-center text-[11px] text-white/20 italic">No requests yet</div>
        </div>

        <!-- Collections tab -->
        <div v-else class="flex-1 overflow-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.07) transparent">
          <div v-if="!collections.length" class="px-3 py-8 text-center text-[11px] text-white/20 italic">
            <Star :size="18" class="mx-auto mb-2 opacity-25" />
            No saved collections.<br/>Click <strong class="text-white/35">Save</strong> to save a request.
          </div>
          <div v-for="col in collections" :key="col.id" class="border-b border-white/5">
            <div
              class="flex items-center gap-2 px-2 py-2 hover:bg-white/4 cursor-pointer select-none"
              @click="toggleCollection(col.id)"
            >
              <FolderOpen :size="11" class="text-amber-300/50 shrink-0" />
              <span class="text-[11px] text-white/55 flex-1 truncate">{{ col.name }}</span>
              <span class="text-[9px] text-white/22 shrink-0">{{ col.requests.length }}</span>
              <button class="p-0.5 rounded text-white/20 hover:text-rose-300 hover:bg-rose-500/10 transition-colors" @click.stop="deleteCollection(col.id)" title="Delete collection">
                <Trash2 :size="10" />
              </button>
            </div>
            <div v-if="expandedCollections.has(col.id)" class="bg-black/10">
              <div
                v-for="(req, ri) in col.requests"
                :key="`${col.id}:${ri}`"
                class="flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/5 cursor-pointer group"
                @click="loadHistory(req)"
              >
                <span class="text-[9px] font-bold w-12 shrink-0" :class="methodColor(req.method)">{{ req.method }}</span>
                <span class="text-[10px] text-white/42 truncate flex-1">{{ req.url }}</span>
                <button class="hidden group-hover:block p-0.5 rounded text-white/20 hover:text-rose-300" @click.stop="deleteCollectionRequest(col.id, ri)">
                  <X :size="9" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Save to collection dialog -->
        <div
          v-if="showSaveDialog"
          class="absolute inset-0 z-20 bg-black/70 flex items-center justify-center p-3"
          @mousedown.self="showSaveDialog = false"
        >
          <div class="bg-[#16171c] border border-white/12 rounded-xl p-4 w-full shadow-xl" @mousedown.stop>
            <div class="flex items-center gap-1.5 mb-3">
              <Star :size="12" class="text-amber-300/70" />
              <span class="text-[11px] font-bold text-white/55 uppercase tracking-widest">Save Request</span>
            </div>
            <input
              ref="saveInputEl"
              v-model="saveRequestName"
              class="w-full bg-black/35 border border-white/10 rounded-lg px-3 py-1.5 text-[12px] text-white/75 outline-none focus:border-amber-300/35 mb-2"
              placeholder="Request name"
              @keydown.enter.prevent="confirmSaveRequest"
              @keydown.escape.prevent="showSaveDialog = false"
            />
            <select
              v-model="saveCollectionId"
              class="w-full bg-black/35 border border-white/10 rounded-lg px-2 py-1.5 text-[12px] text-white/55 outline-none mb-3"
            >
              <option value="__new__">+ New collection named above</option>
              <option v-for="col in collections" :key="col.id" :value="col.id">{{ col.name }}</option>
            </select>
            <div class="flex gap-2">
              <button class="flex-1 h-8 rounded-lg bg-amber-300/90 text-black text-[11px] font-bold hover:bg-amber-200 flex items-center justify-center gap-1.5" @click="confirmSaveRequest">
                <Check :size="12" /> Save
              </button>
              <button class="h-8 px-3 rounded-lg bg-white/6 text-white/45 text-[11px] hover:bg-white/10" @click="showSaveDialog = false">Cancel</button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <div class="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'s')"></div>
    <div class="absolute top-3 right-0 bottom-3 w-1.5 cursor-e-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'e')"></div>
    <div class="absolute top-3 left-0 bottom-3 w-1.5 cursor-w-resize z-10 hover:bg-blue-500/30 transition-colors rounded-full" @mousedown="startResize($event,'w')"></div>
    <div class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-20" @mousedown="startResize($event,'se')"></div>
    <div class="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize z-20" @mousedown="startResize($event,'sw')"></div>
  </div>
</template>
