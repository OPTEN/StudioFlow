/**
 * ←/→ (Home/End) on a tab bar of the production pages, like a native tab bar: the tab to select and focus, or null for
 * any other key. The caller prevents the default only when a tab comes back.
 */
export function tabFromKey<T>(event: KeyboardEvent, tabs: readonly T[], current: T): T | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  const index = Math.max(0, tabs.indexOf(current));
  const target: Record<string, number> = {
    ArrowLeft: (index - 1 + tabs.length) % tabs.length,
    ArrowRight: (index + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  };
  const next = target[event.key];
  return next === undefined ? null : tabs[next];
}

/**
 * ↑/↓ in a list of rows: moves the focus to the same kind of control (`selector`) in the previous or next row of the
 * list (`rows`). Returns true when it handled the key.
 */
export function moveRowFocus(event: KeyboardEvent, rows: string, selector: string): boolean {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
    return false;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }
  const current = (event.target as HTMLElement).closest<HTMLElement>(rows);
  const list = current?.parentElement;
  if (!current || !list) {
    return false;
  }
  const siblings = [...list.querySelectorAll<HTMLElement>(`:scope > ${rows}`)];
  const index = siblings.indexOf(current) + (event.key === 'ArrowUp' ? -1 : 1);
  const target = siblings[index]?.querySelector<HTMLElement>(selector);
  if (!target) {
    return false;
  }
  event.preventDefault();
  target.focus();
  return true;
}
