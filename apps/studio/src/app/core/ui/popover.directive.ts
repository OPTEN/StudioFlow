import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { KeyboardService } from './keyboard.service';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Anchored popovers like the prototype ("Popovers in general"): at most one is open; a click outside, Escape (layer
 * `popover` of the KeyboardService) or opening another one closes it; Escape returns the focus to the trigger.
 * Popovers are identified by a string id that is unique on the page (e.g. `output`, `layout`, `add-source`).
 */
@Injectable({ providedIn: 'root' })
export class PopoverService {
  private readonly document = inject(DOCUMENT);
  private readonly openPopover = signal<string | null>(null);
  private readonly scopes = new Map<string, Set<HTMLElement>>();
  private readonly triggers = new Map<string, HTMLElement>();
  private readonly onDocumentClick = (event: Event): void => this.handleDocumentClick(event);

  /** Id of the open popover, or null. */
  readonly openId = this.openPopover.asReadonly();

  constructor() {
    const keyboard = inject(KeyboardService);
    const unregister = keyboard.registerEscape('popover', () => {
      const id = this.openPopover();
      if (!id) {
        return false;
      }
      this.close(id);
      this.triggers.get(id)?.focus();
      return true;
    });
    // Capture phase: closes before the click reaches its target, like the prototype's document listener.
    this.document.addEventListener('click', this.onDocumentClick, true);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.document.removeEventListener('click', this.onDocumentClick, true);
    });
  }

  /** True while the popover is open (reactive). */
  isOpen(id: string): boolean {
    return this.openPopover() === id;
  }

  /** Opens a popover and closes any other. */
  open(id: string): void {
    this.openPopover.set(id);
  }

  /** Closes the popover (or the open one when no id is given). */
  close(id?: string): void {
    if (id === undefined || this.openPopover() === id) {
      this.openPopover.set(null);
    }
  }

  /** Opens or closes a popover. */
  toggle(id: string): void {
    this.openPopover.set(this.openPopover() === id ? null : id);
  }

  /** Closes every popover (e.g. when a dock drag starts). */
  closeAll(): void {
    this.openPopover.set(null);
  }

  /** DOM id of a popover panel, used for `aria-controls`. */
  domId(id: string): string {
    return `sf-pop-${id}`;
  }

  /** @internal Registers an element that belongs to a popover (trigger or panel); clicks inside keep it open. */
  registerScope(id: string, element: HTMLElement, isTrigger: boolean): () => void {
    const set = this.scopes.get(id) ?? new Set<HTMLElement>();
    set.add(element);
    this.scopes.set(id, set);
    if (isTrigger) {
      this.triggers.set(id, element);
    }
    return () => {
      set.delete(element);
      if (this.triggers.get(id) === element) {
        this.triggers.delete(id);
      }
    };
  }

  private handleDocumentClick(event: Event): void {
    const id = this.openPopover();
    if (!id) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node) || !target.isConnected) {
      // A click that re-rendered its own target (e.g. a menu item replacing itself) stays inside.
      return;
    }
    const inside = [...(this.scopes.get(id) ?? [])].some((element) => element.contains(target));
    if (!inside) {
      this.close(id);
    }
  }
}

/**
 * Trigger of a popover: `<button sfPopoverTrigger="output" aria-haspopup="dialog">`. Toggles the popover on click and
 * keeps `aria-expanded` and `aria-controls` in sync.
 */
@Directive({
  selector: '[sfPopoverTrigger]',
  host: {
    '[attr.aria-expanded]': 'expanded()',
    '[attr.aria-controls]': 'controls()',
    '(click)': 'toggle()',
  },
})
export class PopoverTriggerDirective {
  /** Id of the popover this element opens. */
  readonly sfPopoverTrigger = input.required<string>();

  private readonly popovers = inject(PopoverService);
  protected readonly expanded = computed(() => this.popovers.openId() === this.sfPopoverTrigger());
  protected readonly controls = computed(() => this.popovers.domId(this.sfPopoverTrigger()));

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let unregister: (() => void) | null = null;
    afterNextRender(() => {
      unregister = this.popovers.registerScope(this.sfPopoverTrigger(), element, true);
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }

  protected toggle(): void {
    this.popovers.toggle(this.sfPopoverTrigger());
  }
}

/**
 * Panel of a popover: render it only while open (`@if (popovers.isOpen('output'))`) and mark it with
 * `<div class="c-pop" sfPopover="output" role="dialog" aria-label="Output">`. Sets the DOM id for `aria-controls`
 * and moves the focus to the first focusable element after opening (`[popoverFocus]="false"` keeps it on the trigger,
 * like the prototype's Output popover).
 */
@Directive({
  selector: '[sfPopover]',
  host: {
    '[id]': 'domId()',
  },
})
export class PopoverDirective {
  /** Id of the popover. */
  readonly sfPopover = input.required<string>();
  /** Focus the first focusable element when the panel appears (default true). */
  readonly popoverFocus = input(true);

  private readonly popovers = inject(PopoverService);
  protected readonly domId = computed(() => this.popovers.domId(this.sfPopover()));

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let unregister: (() => void) | null = null;
    afterNextRender(() => {
      unregister = this.popovers.registerScope(this.sfPopover(), element, false);
      if (this.popoverFocus()) {
        element.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      }
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }
}
