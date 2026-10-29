import { DOCUMENT } from '@angular/common';
import { Injector, afterNextRender, effect, inject } from '@angular/core';
import { ContextMenuService } from '../../core/ui/context-menu';
import { PopoverService } from '../../core/ui/popover.directive';

/**
 * For a popover that offers right-click menus on its rows (the media library): while a context menu is open, it counts
 * as part of the popover, so choosing one of its commands does not close the popover as a click outside. Call it in
 * the injection context of the popover's component.
 */
export function keepPopoverOpenWithContextMenu(popoverId: string): void {
  const menus = inject(ContextMenuService);
  const popovers = inject(PopoverService);
  const document = inject(DOCUMENT);
  const injector = inject(Injector);
  effect((onCleanup) => {
    if (!menus.current()) {
      return;
    }
    let unregister: (() => void) | null = null;
    afterNextRender(
      () => {
        const menu = document.querySelector<HTMLElement>('.c-ctx');
        if (menu) {
          unregister = popovers.registerScope(popoverId, menu, false);
        }
      },
      { injector },
    );
    onCleanup(() => unregister?.());
  });
}
