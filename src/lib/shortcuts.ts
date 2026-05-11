type ShortcutOptions = {
  shift?: boolean;
  alt?: boolean;
};

const keyFallbacks: Record<string, string[]> = {
  Comma: [','],
  Period: ['.'],
  F2: ['f2'],
  F5: ['f5'],
  F12: ['f12'],
  ArrowDown: ['arrowdown'],
  ArrowUp: ['arrowup'],
  Enter: ['enter'],
  Escape: ['escape'],
  Tab: ['tab'],
};

function expectedFallbacks(code: string) {
  if (code.startsWith('Key') && code.length === 4) {
    return [code.slice(3).toLowerCase()];
  }
  return keyFallbacks[code] ?? [];
}

export function primaryPressed(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey;
}

export function isCode(event: KeyboardEvent, code: string) {
  if (event.code === code) return true;
  const key = event.key.toLowerCase();
  return expectedFallbacks(code).includes(key);
}

export function isPlainKey(event: KeyboardEvent, code: string, options: ShortcutOptions = {}) {
  return isCode(event, code)
    && event.shiftKey === Boolean(options.shift)
    && event.altKey === Boolean(options.alt)
    && !event.ctrlKey
    && !event.metaKey;
}

export function isPrimaryKey(event: KeyboardEvent, code: string, options: ShortcutOptions = {}) {
  return primaryPressed(event)
    && isCode(event, code)
    && event.shiftKey === Boolean(options.shift)
    && event.altKey === Boolean(options.alt);
}

export function isAltKey(event: KeyboardEvent, code: string, options: Pick<ShortcutOptions, 'shift'> = {}) {
  return !event.ctrlKey
    && !event.metaKey
    && event.altKey
    && isCode(event, code)
    && event.shiftKey === Boolean(options.shift);
}

export function consumeShortcut(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function matchesShortcut(event: KeyboardEvent, shortcut?: string | null) {
  if (!shortcut?.trim()) return false;
  const parts = shortcut
    .split('+')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
  let key = '';
  for (let index = parts.length - 1; index >= 0; index--) {
    if (!['ctrl', 'cmd', 'meta', 'shift', 'alt'].includes(parts[index])) {
      key = parts[index];
      break;
    }
  }
  if (!key) return false;

  const wantsPrimary = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta');
  const wantsShift = parts.includes('shift');
  const wantsAlt = parts.includes('alt');

  if (wantsPrimary !== primaryPressed(event)) return false;
  if (wantsShift !== event.shiftKey) return false;
  if (wantsAlt !== event.altKey) return false;

  const eventKey = event.key.toLowerCase();
  const eventCode = event.code.toLowerCase();
  if (key === ',') return isCode(event, 'Comma');
  if (key === '.') return isCode(event, 'Period');
  if (key === 'tab') return isCode(event, 'Tab');
  if (key === 'enter') return isCode(event, 'Enter');
  if (key === 'escape' || key === 'esc') return isCode(event, 'Escape');
  if (/^f\d{1,2}$/.test(key)) return eventKey === key || eventCode === key;
  if (key.length === 1 && /[a-z]/.test(key)) return eventKey === key || isCode(event, `Key${key.toUpperCase()}`);
  return eventKey === key || eventCode === key;
}
