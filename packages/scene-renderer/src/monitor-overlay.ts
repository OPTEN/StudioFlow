import { t } from '@studioflow/i18n';

import { createElement, FILL, px, setStyle, setStyles, setText, setVisible } from './dom';
import type { AlertPresentation } from './monitor-alert';
import { PALETTE, UI_FONT } from './palette';

/** What the overlay shows for one item. */
export interface MonitorOverlayState {
  /** “Source missing” (`renderer.sourceMissing`) in the centre, for an item whose source does not exist (any more). */
  readonly missing: boolean;
  /** Solid outline and label tab, or null. */
  readonly alert: AlertPresentation | null;
  /** Corner radius of the item (canvas pixels). */
  readonly radius: number;
  /** Stage scale; overlay lengths are fixed in screen pixels. */
  readonly scale: number;
}

/**
 * Regie-only decorations of an item: “Source missing”, the solid alert outline in the state hue and the filled label tab
 * (“K2 · Freeze frame 00:12”). They keep a fixed size on screen although the stage is scaled: lengths are given in screen
 * pixels and converted with the current scale on every render (resizes re-render).
 */
export class MonitorOverlay {
  /** Elements to append to the item root, in paint order. */
  readonly elements: readonly HTMLElement[];
  private readonly missingEl: HTMLDivElement;
  private readonly outlineEl: HTMLDivElement;
  private readonly labelEl: HTMLDivElement;

  constructor(doc: Document) {
    this.missingEl = createElement(doc, 'div', 'sf-r-missing', {
      ...FILL,
      display: 'none',
      'align-items': 'center',
      'justify-content': 'center',
      overflow: 'hidden',
      'white-space': 'nowrap',
      color: PALETTE.muted,
      'font-family': UI_FONT,
      'font-weight': '600',
    });
    this.outlineEl = createElement(doc, 'div', 'sf-r-alert', {
      position: 'absolute',
      'border-style': 'solid',
      'box-sizing': 'border-box',
      display: 'none',
    });
    this.labelEl = createElement(doc, 'div', 'sf-r-alert-label', {
      position: 'absolute',
      color: PALETTE.ground,
      'font-family': UI_FONT,
      'font-weight': '700',
      'white-space': 'nowrap',
      display: 'none',
    });
    this.elements = [this.missingEl, this.outlineEl, this.labelEl];
  }

  /** Shows the given state (everything hidden for output and thumbnails). */
  render(state: MonitorOverlayState): void {
    // One screen pixel in canvas pixels.
    const unit = 1 / (state.scale > 0 ? state.scale : 1);
    const screen = (value: number): string => px(value * unit);

    setVisible(this.missingEl, state.missing, 'flex');
    if (state.missing) {
      setText(this.missingEl, t('renderer.sourceMissing'));
      setStyle(this.missingEl, 'font-size', screen(12.5));
    }

    const alert = state.alert;
    setVisible(this.outlineEl, alert !== null);
    setVisible(this.labelEl, alert !== null);
    if (!alert) {
      return;
    }
    const inset = screen(1);
    setStyles(this.outlineEl, {
      left: inset,
      top: inset,
      right: inset,
      bottom: inset,
      'border-width': screen(1.5),
      'border-color': alert.color,
      'border-radius': px(Math.max(0, state.radius - unit)),
    });
    setStyles(this.labelEl, {
      left: screen(6),
      top: screen(6),
      height: screen(18),
      'padding-left': screen(6),
      'padding-right': screen(6),
      'border-radius': screen(3),
      'font-size': screen(11.5),
      'line-height': screen(18),
      'background-color': alert.color,
    });
    setText(this.labelEl, alert.text);
  }
}
