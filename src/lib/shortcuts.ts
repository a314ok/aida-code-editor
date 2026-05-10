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
