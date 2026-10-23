import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { encode } from 'uqr';

/** Quiet zone around the code in modules (ISO/IEC 18004). */
export const QR_QUIET_ZONE = 4;

/** Error correction level of the pairing codes (spec 3: `ecc: 'M'`). */
export type QrEcc = 'L' | 'M' | 'Q' | 'H';

/**
 * One SVG path for a QR matrix: one rectangle per horizontal run of dark modules, in module units
 * (`M{x} {y}h{w}v1h-{w}z`). Empty for an empty matrix.
 */
export function qrPath(matrix: readonly (readonly boolean[])[]): string {
  let path = '';
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x += 1;
      }
      const width = x - start;
      path += `M${start} ${y}h${width}v1h-${width}z`;
    }
  });
  return path;
}

/** The module matrix of a text (no border; the quiet zone is drawn by the component). */
export function qrMatrix(value: string, ecc: QrEcc = 'M'): boolean[][] {
  return encode(value, { ecc, border: 0 }).data;
}

/**
 * QR code as inline SVG (spec 3, research "QR code"): `uqr` encodes the URL, the modules become one `<path>`, dark
 * on white with a 4-module quiet zone, never inverted in the dark theme. No `[innerHTML]` (Angular strips SVG).
 * The size comes from CSS (`width` of the host, default 168 px).
 */
@Component({
  selector: 'sf-qr-code',
  template: `
    <svg
      class="c-qr__svg"
      role="img"
      shape-rendering="crispEdges"
      [attr.viewBox]="viewBox()"
      [attr.aria-label]="label()"
    >
      <rect
        fill="#ffffff"
        [attr.x]="-quiet"
        [attr.y]="-quiet"
        [attr.width]="size() + quiet * 2"
        [attr.height]="size() + quiet * 2"
      />
      <path fill="#0d1117" [attr.d]="path()" />
    </svg>
  `,
  styles: `
    :host {
      background: #ffffff;
      border-radius: var(--radius-md);
      display: block;
      flex: none;
      overflow: hidden;
      width: 168px;
    }

    .c-qr__svg {
      display: block;
      height: auto;
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrCodeComponent {
  /** The encoded text (the invite URL). */
  readonly value = input.required<string>();
  /** Accessible name. */
  readonly label = input('QR-Code');
  /** Error correction level. */
  readonly ecc = input<QrEcc>('M');

  protected readonly quiet = QR_QUIET_ZONE;
  private readonly matrix = computed(() => qrMatrix(this.value(), this.ecc()));
  protected readonly size = computed(() => this.matrix().length);
  protected readonly path = computed(() => qrPath(this.matrix()));
  protected readonly viewBox = computed(() => {
    const total = this.size() + QR_QUIET_ZONE * 2;
    return `${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${total} ${total}`;
  });
}
