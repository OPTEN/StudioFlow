import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Every icon of the prototype sprite (prototype/regie.html `<symbol id="i-…">`) plus a few additions. */
export type IconName =
  | 'video'
  | 'text'
  | 'eye'
  | 'camera'
  | 'screen'
  | 'image'
  | 'video'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'minus'
  | 'close'
  | 'alert'
  | 'check'
  | 'link'
  | 'laptop'
  | 'phone'
  | 'copy'
  | 'up'
  | 'down'
  | 'users'
  | 'undo'
  | 'output'
  | 'chev'
  | 'refresh'
  | 'flask'
  | 'layout'
  | 'grip'
  | 'send'
  // Additions in the same style (24 px grid, 1.6 px stroke)
  | 'redo'
  | 'logout'
  | 'more'
  | 'pencil'
  | 'trash'
  | 'upload'
  | 'download'
  | 'gear'
  | 'list'
  | 'mic'
  | 'headphones'
  // The StudioFlow brand mark "Programm": program frame, two flow chevrons, tally dot (cropped 58 × 42)
  | 'mark';

/**
 * Inline SVG icon: `<svg sfIcon="camera" [size]="14"></svg>`. The host element is the `<svg class="c-icon">`
 * itself (16 px, 1.6 px stroke, `currentColor`), always `aria-hidden`; give the surrounding control an accessible
 * name. The paths are inlined instead of `<use href="#…">` because fragment references break under `<base href>`
 * on deep routes such as /monitoring.
 */
@Component({
  selector: 'svg[sfIcon]',
  template: `
    @switch (sfIcon()) {
      @case ('camera') {
        <svg:path
          d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"
        />
        <svg:circle cx="12" cy="13.2" r="3.6" />
      }
      @case ('screen') {
        <svg:rect x="3" y="4.5" width="18" height="12" rx="1.5" />
        <svg:path d="M9 20h6M12 16.5V20" />
      }
      @case ('image') {
        <svg:rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
        <svg:circle cx="9" cy="10" r="1.6" />
        <svg:path d="m4 18 5-5 3.5 3.5L15 14l5 4.5" />
      }
      @case ('video') {
        <svg:rect x="3" y="6" width="13" height="12" rx="1.5" />
        <svg:path d="m16 10.5 5-3v9l-5-3" />
      }
      @case ('text') {
        <svg:path d="M5 6.5h14M12 6.5v12M9 18.5h6" />
      }
      @case ('eye') {
        <svg:path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <svg:circle cx="12" cy="12" r="2.8" />
      }
      @case ('eye-off') {
        <svg:path
          d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6M6.3 7.4A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"
        />
      }
      @case ('lock') {
        <svg:rect x="5" y="10.5" width="14" height="10" rx="1.5" />
        <svg:path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      }
      @case ('unlock') {
        <svg:rect x="5" y="10.5" width="14" height="10" rx="1.5" />
        <svg:path d="M8 10.5V8a4 4 0 0 1 7.6-1.7" />
      }
      @case ('plus') {
        <svg:path d="M12 5v14M5 12h14" />
      }
      @case ('minus') {
        <svg:path d="M5 12h14" />
      }
      @case ('close') {
        <svg:path d="M6 6l12 12M18 6 6 18" />
      }
      @case ('alert') {
        <svg:path d="M12 4 2.8 19.5h18.4L12 4Z" />
        <svg:path d="M12 10v4.2M12 17v.1" />
      }
      @case ('check') {
        <svg:path d="m5 12.5 4.5 4.5L19 7.5" />
      }
      @case ('link') {
        <svg:path
          d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
        />
      }
      @case ('laptop') {
        <svg:rect x="5" y="5" width="14" height="10" rx="1.2" />
        <svg:path d="M2.5 18.5h19" />
      }
      @case ('phone') {
        <svg:rect x="7" y="2.5" width="10" height="19" rx="2" />
        <svg:path d="M11 18.5h2" />
      }
      @case ('copy') {
        <svg:rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
        <svg:path
          d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"
        />
      }
      @case ('up') {
        <svg:path d="M12 19V5M6 11l6-6 6 6" />
      }
      @case ('down') {
        <svg:path d="M12 5v14M6 13l6 6 6-6" />
      }
      @case ('users') {
        <svg:circle cx="9" cy="8.5" r="3" />
        <svg:path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <svg:path d="M16 5.8a3 3 0 0 1 0 5.4M17.5 14.2a5.5 5.5 0 0 1 3 4.8" />
      }
      @case ('undo') {
        <svg:path d="M9 7 4.5 11.5 9 16" />
        <svg:path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2" />
      }
      @case ('output') {
        <svg:circle cx="12" cy="12" r="2" />
        <svg:path
          d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"
        />
      }
      @case ('chev') {
        <svg:path d="m6 9 6 6 6-6" />
      }
      @case ('refresh') {
        <svg:path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
        <svg:path d="M19.5 4.5v4h-4" />
      }
      @case ('flask') {
        <svg:path
          d="M9.5 3.5h5M10.5 3.5v6L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5.5-9.5v-6"
        />
        <svg:path d="M7.5 15h9" />
      }
      @case ('gear') {
        <svg:circle cx="12" cy="12" r="3.2" />
        <svg:circle cx="12" cy="12" r="6.6" />
        <svg:path
          d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"
        />
      }
      @case ('mic') {
        <svg:rect x="9" y="3.5" width="6" height="11" rx="3" />
        <svg:path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
      }
      @case ('headphones') {
        <svg:path d="M4 15v-3a8 8 0 0 1 16 0v3" />
        <svg:rect x="3.5" y="14.5" width="4" height="6" rx="1.5" />
        <svg:rect x="16.5" y="14.5" width="4" height="6" rx="1.5" />
      }
      @case ('list') {
        <svg:path d="M4 6.5h16M4 12h16M4 17.5h10" />
      }
      @case ('layout') {
        <svg:rect x="3" y="4" width="18" height="16" rx="1.5" />
        <svg:path d="M3 13.5h18M9.5 13.5V20M15 13.5V20" />
      }
      @case ('grip') {
        <svg:circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none" />
        <svg:circle cx="15" cy="6" r="1.6" fill="currentColor" stroke="none" />
        <svg:circle cx="9" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <svg:circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <svg:circle cx="9" cy="18" r="1.6" fill="currentColor" stroke="none" />
        <svg:circle cx="15" cy="18" r="1.6" fill="currentColor" stroke="none" />
      }
      @case ('send') {
        <svg:path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z" />
      }
      @case ('redo') {
        <svg:path d="M15 7l4.5 4.5L15 16" />
        <svg:path d="M19.5 11.5H9a4.5 4.5 0 0 0 0 9h2" />
      }
      @case ('logout') {
        <svg:path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
        <svg:path d="M10 8l-4 4 4 4M6 12h9" />
      }
      @case ('more') {
        <svg:circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <svg:circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <svg:circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
      }
      @case ('pencil') {
        <svg:path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4Z" />
        <svg:path d="m13.5 6.5 4 4" />
      }
      @case ('trash') {
        <svg:path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
        <svg:path d="M10.5 11v5M13.5 11v5" />
      }
      @case ('upload') {
        <svg:path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
        <svg:path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />
      }
      @case ('download') {
        <svg:path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
        <svg:path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />
      }
      @case ('mark') {
        <svg:rect
          x="6"
          y="14"
          width="52"
          height="36"
          rx="6"
          fill="none"
          stroke="currentColor"
          stroke-width="4.5"
        />
        <svg:path
          d="M21 24l8 8-8 8M33 24l8 8-8 8"
          fill="none"
          stroke="currentColor"
          stroke-width="4.5"
        />
        <svg:circle cx="49" cy="23" r="3.5" class="c-icon__tally" stroke="none" />
      }
    }
  `,
  host: {
    class: 'c-icon',
    '[class.c-icon--mark]': "sfIcon() === 'mark'",
    '[attr.viewBox]': 'viewBox()',
    'aria-hidden': 'true',
    focusable: 'false',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  /** Icon name. */
  readonly sfIcon = input.required<IconName>();
  /** Edge length in px; default 16 (CSS). */
  readonly size = input<number | null>(null);

  protected readonly viewBox = computed(() =>
    this.sfIcon() === 'mark' ? '3 11 58 42' : '0 0 24 24',
  );
}
