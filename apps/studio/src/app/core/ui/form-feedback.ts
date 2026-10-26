import { afterNextRender, signal, type ElementRef, type Injector } from '@angular/core';
import type { Msg } from '@studioflow/i18n';

/**
 * What the API refused, per field of a form ("the setup code is wrong"). A message stays until its field is edited, so
 * it never contradicts what is typed; the form shows it before its own validation messages.
 */
export class RefusedFields<Field extends string> {
  private readonly refused = signal<Partial<Record<Field, Msg>>>({});

  /** The message for a field, or undefined. */
  get(field: Field): Msg | undefined {
    return this.refused()[field];
  }

  /** Replaces all messages. */
  set(messages: Partial<Record<Field, Msg>>): void {
    this.refused.set(messages);
  }

  /** Forgets the message of a field, when it has one. */
  clear(field: Field): void {
    if (this.refused()[field]) {
      this.refused.update((messages) => ({ ...messages, [field]: undefined }));
    }
  }
}

/** Moves the focus to the first field marked `aria-invalid` in `host`, once the error markup is rendered. */
export function focusFirstInvalid(host: ElementRef<HTMLElement>, injector: Injector): void {
  afterNextRender(
    () => host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    { injector },
  );
}
