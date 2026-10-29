import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Stroke icons of the Regie's set (apps/studio/src/app/core/ui/icon.component.ts: 24 × 24 grid, 1.6 stroke), as path
 * data. Small dots (the ⋯ of a menu) are tiny circles that the stroke fills.
 */
const ICONS = {
  camera:
    'M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z M8.4 13.2a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0-7.2 0',
  flip: 'M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z M15.3 11.8a3.4 3.4 0 0 0-6.2-1.2 M8.7 14.6a3.4 3.4 0 0 0 6.2 1.2 M8.9 8.8v1.9h1.9 M15.1 17.4v-1.9h-1.9',
  screen:
    'M4.5 4.5h15A1.5 1.5 0 0 1 21 6v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15V6a1.5 1.5 0 0 1 1.5-1.5Z M9 20h6M12 16.5V20',
  phone: 'M9 2.5h6a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z M11 18.5h2',
  laptop:
    'M6.2 5h11.6A1.2 1.2 0 0 1 19 6.2v7.6a1.2 1.2 0 0 1-1.2 1.2H6.2A1.2 1.2 0 0 1 5 13.8V6.2A1.2 1.2 0 0 1 6.2 5Z M2.5 18.5h19',
  mixer: 'M6 4v16 M12 4v16 M18 4v16 M4 14h4 M10 8h4 M16 16h4',
  mic: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Z M5.5 11.5a6.5 6.5 0 0 0 13 0 M12 18v3 M8.5 21h7',
  micOff:
    'M15 10.8V6.5a3 3 0 0 0-5.6-1.5 M9 9v2.5a3 3 0 0 0 4.6 2.5 M5.5 11.5a6.5 6.5 0 0 0 10.6 5 M18.3 13.6a6.5 6.5 0 0 0 .2-2.1 M12 18v3 M8.5 21h7 M4 4l16 16',
  speaker: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4Z M15.5 9a4 4 0 0 1 0 6 M18 6.5a7.5 7.5 0 0 1 0 11',
  quality:
    'M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9Z M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  stop: 'M8.1 6.5h7.8a1.6 1.6 0 0 1 1.6 1.6v7.8a1.6 1.6 0 0 1-1.6 1.6H8.1a1.6 1.6 0 0 1-1.6-1.6V8.1a1.6 1.6 0 0 1 1.6-1.6Z',
  qr: 'M5 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z M15 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z M5 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z M14 14h2.5v2.5H14Z M18.5 18.5H20V20h-1.5Z M14 18.5h2.5 M18.5 14H20',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4 2.8 19.5h18.4L12 4Z M12 10v4.2M12 17v.1',
  info: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M12 11v5.5 M12 7.6v.1',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  circleCheck: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M8.5 12.3l2.4 2.4 4.6-4.9',
  chevDown: 'm6 9 6 6 6-6',
  more: 'M5.2 12a.8.8 0 1 0 1.6 0a.8.8 0 1 0-1.6 0 M11.2 12a.8.8 0 1 0 1.6 0a.8.8 0 1 0-1.6 0 M17.2 12a.8.8 0 1 0 1.6 0a.8.8 0 1 0-1.6 0',
  trash: 'M4.5 7h15 M9.5 7V4.5h5V7 M6.5 7l1 13h9l1-13 M10.5 11v5 M13.5 11v5',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4.5v4h-4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  gauge: 'M4.5 16a7.5 7.5 0 1 1 15 0 M12 16l4-5 M3 19.5h18',
  message:
    'M4.5 5h15A1.5 1.5 0 0 1 21 6.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 3.5V17h-.5A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5Z',
  wifiOff:
    'M3 3l18 18 M8.5 16.4a5 5 0 0 1 7 0 M5.2 12.9a9.8 9.8 0 0 1 4.3-2.4 M2 9.6a14.6 14.6 0 0 1 4.2-2.7 M14.5 10.5a9.8 9.8 0 0 1 4.3 2.4 M11 6a14.6 14.6 0 0 1 11 3.6 M12 20h.01',
  lock: 'M6.5 10.5h11A1.5 1.5 0 0 1 19 12v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5Z M8 10.5V8a4 4 0 0 1 8 0v2.5',
  tabs: 'M4.5 7h11A1.5 1.5 0 0 1 17 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 18.5v-10A1.5 1.5 0 0 1 4.5 7Z M7 4h12.5A1.5 1.5 0 0 1 21 5.5V16',
} as const;

/** Name of an icon of {@link ICONS}. */
export type IconName = keyof typeof ICONS;

/** Inline stroke icon; decorative (aria-hidden) – the button or text next to it carries the meaning. */
@Component({
  selector: 'sf-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path [attr.d]="path()" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      height: var(--icon-size, 18px);
      width: var(--icon-size, 18px);
    }

    svg {
      fill: none;
      height: 100%;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.6;
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  readonly name = input.required<IconName>();

  protected readonly path = computed(() => ICONS[this.name()]);
}
