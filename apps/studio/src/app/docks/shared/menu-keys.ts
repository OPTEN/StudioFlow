/**
 * Roving focus for `role="menu"` popovers: ↓/↑ move between the enabled menu items (wrapping), Home/End jump to
 * the first/last one. Escape is handled by the PopoverService. Returns true when the key was used.
 */
export function handleMenuKeys(event: KeyboardEvent, menu: HTMLElement): boolean {
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
  if (items.length === 0) {
    return false;
  }
  const index = items.indexOf(menu.ownerDocument.activeElement as HTMLElement);
  let next: number | null = null;
  switch (event.key) {
    case 'ArrowDown':
      next = (index + 1) % items.length;
      break;
    case 'ArrowUp':
      next = index <= 0 ? items.length - 1 : index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
  }
  if (next === null) {
    return false;
  }
  event.preventDefault();
  items[next].focus();
  return true;
}
