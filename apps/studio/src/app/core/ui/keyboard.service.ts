import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';

/** Global shortcuts of the Regie (prototype "Keyboard"). */
export type ShortcutId =
  /** Keys 1–9: the handler receives the 0-based scene index. */
  | 'scene'
  /** Space (not on a button, link or switch): Take in Studio Mode. */
  | 'take'
  /** Ctrl/Cmd+Z. */
  | 'undo'
  /** Ctrl/Cmd+Shift+Z and Ctrl+Y. */
  | 'redo'
  /** M: mutes (or unmutes) the selected channel of the audio mixer. */
  | 'mute';

/**
 * A shortcut handler. Returns true when it acted; only then the browser default (scrolling on Space, the browser's
 * own undo) is prevented. `index` is set for `scene`.
 */
export type ShortcutHandler = (index: number) => boolean;

/**
 * Escape is handled by the first layer that is open, in this order (prototype): a running list drag (reordering
 * rows), a running dock drag, open popovers, the pairing dock, the element selection.
 */
export type EscapeLayer = 'listDrag' | 'dockDrag' | 'popover' | 'pairing' | 'selection';

/** Returns true when the layer consumed Escape. */
export type EscapeHandler = () => boolean;

const ESCAPE_ORDER: readonly EscapeLayer[] = [
  'listDrag',
  'dockDrag',
  'popover',
  'pairing',
  'selection',
];
const TYPING_TAGS: ReadonlySet<string> = new Set(['SELECT', 'TEXTAREA']);
const CONTROL_TAGS: ReadonlySet<string> = new Set(['BUTTON', 'A']);
/** Input types that take no typed text: switches, checkboxes, radios, sliders and buttons (and file/colour pickers). */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'color',
]);

/** True for an input element that takes no typed text (a switch, checkbox, radio, slider or button). */
function isNonTextInput(element: Element): boolean {
  return element instanceof HTMLInputElement && NON_TEXT_INPUT_TYPES.has(element.type);
}

/** True while the focus is in a text field, select or editable element (shortcuts must not fire then). */
export function isTypingTarget(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  if (element.tagName === 'INPUT') {
    return !isNonTextInput(element);
  }
  if (TYPING_TAGS.has(element.tagName)) {
    return true;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * The single global keydown listener of the Regie. Features register handlers for {@link ShortcutId}s and
 * {@link EscapeLayer}s; the service applies the prototype rules:
 * - Escape first, through the layers in priority order (also while typing);
 * - nothing else while typing in an input, select, textarea or editable element;
 * - Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo;
 * - other combinations with Ctrl, Cmd or Alt are left to the browser;
 * - Space triggers `take` unless the focus is on a button, link, switch or checkbox (Space activates those);
 * - M triggers `mute` (the selected audio channel);
 * - 1–9 trigger `scene`. Auto-repeat of Space and digits is ignored, so holding a key never fires twice.
 *
 * Several handlers per id are allowed; the most recently registered one runs first and the first that returns true
 * wins.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private readonly document = inject(DOCUMENT);
  private readonly shortcuts = new Map<ShortcutId, ShortcutHandler[]>();
  private readonly escapes = new Map<EscapeLayer, EscapeHandler[]>();
  private readonly listener = (event: KeyboardEvent): void => this.handle(event);

  constructor() {
    this.document.addEventListener('keydown', this.listener);
    inject(DestroyRef).onDestroy(() => this.document.removeEventListener('keydown', this.listener));
  }

  /** Registers a shortcut handler; returns the unregister function (call it on destroy). */
  register(id: ShortcutId, handler: ShortcutHandler): () => void {
    return this.add(this.shortcuts, id, handler);
  }

  /** Registers an Escape handler for a layer; returns the unregister function. */
  registerEscape(layer: EscapeLayer, handler: EscapeHandler): () => void {
    return this.add(this.escapes, layer, handler);
  }

  /** Processes one keydown (public for tests and for keydown events that are re-dispatched). */
  handle(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    const active = this.document.activeElement;
    if (event.key === 'Escape') {
      if (this.runEscape()) {
        event.preventDefault();
      }
      return;
    }
    if (isTypingTarget(active)) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey) {
      if (key === 'z') {
        event.preventDefault();
        this.run(event.shiftKey ? 'redo' : 'undo', -1);
        return;
      }
      if (key === 'y' && event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        this.run('redo', -1);
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.code === 'Space' || event.key === ' ') {
      if (
        event.repeat ||
        (active && (CONTROL_TAGS.has(active.tagName) || isNonTextInput(active)))
      ) {
        return;
      }
      if (this.run('take', -1)) {
        event.preventDefault();
      }
      return;
    }
    if (key === 'm') {
      if (!event.repeat && this.run('mute', -1)) {
        event.preventDefault();
      }
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      if (!event.repeat && this.run('scene', Number(event.key) - 1)) {
        event.preventDefault();
      }
    }
  }

  private runEscape(): boolean {
    for (const layer of ESCAPE_ORDER) {
      const handlers = this.escapes.get(layer) ?? [];
      for (let index = handlers.length - 1; index >= 0; index -= 1) {
        if (this.safely(() => handlers[index]())) {
          return true;
        }
      }
    }
    return false;
  }

  private run(id: ShortcutId, index: number): boolean {
    const handlers = this.shortcuts.get(id) ?? [];
    for (let position = handlers.length - 1; position >= 0; position -= 1) {
      if (this.safely(() => handlers[position](index))) {
        return true;
      }
    }
    return false;
  }

  private safely(callback: () => boolean): boolean {
    try {
      return callback();
    } catch (error) {
      console.warn('[StudioFlow] keyboard handler failed', error);
      return false;
    }
  }

  private add<K, H>(map: Map<K, H[]>, key: K, handler: H): () => void {
    const list = map.get(key) ?? [];
    list.push(handler);
    map.set(key, list);
    return () => {
      const current = map.get(key);
      if (!current) {
        return;
      }
      const index = current.indexOf(handler);
      if (index >= 0) {
        current.splice(index, 1);
      }
    };
  }
}
