import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The StudioFlow mark and word, as in the Regie header. */
@Component({
  selector: 'sf-brand-mark',
  template: `
    <svg class="c-brand__mark" viewBox="3 11 58 42" aria-hidden="true" focusable="false">
      <rect
        x="6"
        y="14"
        width="52"
        height="36"
        rx="6"
        fill="none"
        stroke="currentColor"
        stroke-width="4.5"
      />
      <path
        d="M21 24l8 8-8 8M33 24l8 8-8 8"
        fill="none"
        stroke="currentColor"
        stroke-width="4.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle class="c-brand__tally" cx="49" cy="23" r="3.5" />
    </svg>
    <span class="c-brand__word">StudioFlow</span>
  `,
  styles: `
    :host {
      align-items: center;
      display: inline-flex;
      font-size: 17px;
      font-weight: 700;
      gap: 9px;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }

    .c-brand__mark {
      flex: none;
      height: 20px;
      width: 28px;
    }

    .c-brand__tally {
      fill: var(--red);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandMarkComponent {}
