import { ref, reactive } from 'vue';

export interface WPos { x: number; y: number; w: number; h: number; z: number; }

let zCounter = 10;

export function useFloating(init: Omit<WPos, 'z'>) {
  const pos = reactive<WPos>({ ...init, z: 10 });
  const dragging = ref(false);
  const resizing = ref(false);
  const maximized = ref(false);
  let restorePos: Omit<WPos, 'z'> | null = null;

  function bringToFront() {
    pos.z = ++zCounter;
  }

  function startDrag(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('button, input, select, .tab-item')) return;
    e.preventDefault();
    bringToFront();
    dragging.value = true;

    const canvas = document.getElementById('main-canvas');
    const cr = canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const ox = (e.clientX - cr.left + (canvas?.scrollLeft ?? 0)) - pos.x;
    const oy = (e.clientY - cr.top  + (canvas?.scrollTop  ?? 0)) - pos.y;

    const onMove = (ev: MouseEvent) => {
      pos.x = Math.max(0, (ev.clientX - cr.left + (canvas?.scrollLeft ?? 0)) - ox);
      pos.y = Math.max(0, (ev.clientY - cr.top  + (canvas?.scrollTop  ?? 0)) - oy);
    };
    const onUp = () => {
      dragging.value = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startResize(e: MouseEvent, dir: string) {
    e.preventDefault();
    e.stopPropagation();
    bringToFront();
    resizing.value = true;

    const sx = e.clientX, sy = e.clientY;
    const sw = pos.w, sh = pos.h, px = pos.x, py = pos.y;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (dir.includes('e')) pos.w = Math.max(280, sw + dx);
      if (dir.includes('s')) pos.h = Math.max(80, sh + dy);
      if (dir.includes('w')) { pos.w = Math.max(280, sw - dx); pos.x = px + sw - pos.w; }
      if (dir.includes('n')) { pos.h = Math.max(80, sh - dy); pos.y = py + sh - pos.h; }
    };
    const onUp = () => {
      resizing.value = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function initFromCanvas(yFrac: number, hFrac: number) {
    const c = document.getElementById('main-canvas');
    if (!c) return;
    const cw = c.clientWidth, ch = c.clientHeight;
    pos.w = cw - 16;
    if (yFrac === 0) {
      pos.x = 8; pos.y = 8;
      pos.h = Math.round(ch * hFrac) - 16;
    } else {
      pos.x = 8; pos.y = Math.round(ch * yFrac);
      pos.h = Math.round(ch * hFrac) - 8;
    }
  }

  function toggleMaximize() {
    const c = document.getElementById('main-canvas');
    if (!c) return false;

    if (maximized.value && restorePos) {
      pos.x = restorePos.x;
      pos.y = restorePos.y;
      pos.w = restorePos.w;
      pos.h = restorePos.h;
      restorePos = null;
      maximized.value = false;
      bringToFront();
      return false;
    }

    restorePos = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };
    pos.x = c.scrollLeft + 12;
    pos.y = c.scrollTop + 12;
    pos.w = Math.max(320, c.clientWidth - 24);
    pos.h = Math.max(220, c.clientHeight - 24);
    maximized.value = true;
    bringToFront();
    return true;
  }

  return { pos, dragging, resizing, maximized, startDrag, startResize, initFromCanvas, bringToFront, toggleMaximize };
}
