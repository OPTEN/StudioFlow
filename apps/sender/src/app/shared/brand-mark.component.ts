import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The StudioFlow mark and word, as in the Regie header. */
@Component({
  selector: 'sf-brand-mark',
  template: `
    <svg class="c-brand__mark" viewBox="0 0 22 18" aria-hidden="true" focusable="false">
      <rect
        x="1"
        y="1"
        width="14"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <rect x="7" y="7" width="14" height="10" rx="1.5" fill="currentColor" />
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
      height: 18px;
      width: 22px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandMarkComponent {}
