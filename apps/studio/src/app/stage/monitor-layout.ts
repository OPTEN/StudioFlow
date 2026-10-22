/**
 * Sizing of the Preview and Program monitors on the stage (prototype `.mon { --mon-w: … }`, DESIGN.md «Stage»).
 *
 * The stage holds the monitors on the left and the fixed control column (172 px, 20 px gap) on the right. Monitors
 * are always 16:9 and are sized from the stage's width AND height, so they never overflow:
 * - Studio-Modus off: Program = min(width − 192, (height − 56) × 16/9), right-aligned against the control column.
 * - Studio-Modus on: the width minus 212 px (column, gap and the 20 px split) is shared by the split value
 *   (Preview share 0.3–0.7); each monitor is additionally limited by the height.
 * - ≤ 1180 px (stacked): the stage grows with its content, so only the width counts.
 * - ≤ 900 px (narrow): monitors take the full width (priority stack).
 *
 * 56 px of vertical chrome = 12 px padding above and below, the 24 px monitor header and its 8 px gap.
 */

/** Width of the control column (DESIGN.md: 172 px). */
export const CONTROL_COLUMN_PX = 172;
/** Gap between the monitors and the control column. */
export const STAGE_GAP_PX = 20;
/** Width of the resizable split between Preview and Program. */
export const MONITOR_SPLIT_PX = 20;
/** Stage padding, monitor header and header gap above and below the 16:9 picture. */
export const MONITOR_VERTICAL_CHROME_PX = 56;

/** Input of {@link monitorWidths}. */
export interface MonitorLayoutInput {
  /** Content width of the stage in CSS px. */
  readonly width: number;
  /** Content height of the stage in CSS px (ignored when `heightBound` is false). */
  readonly height: number;
  /** Studio-Modus: Preview and Program side by side. */
  readonly studio: boolean;
  /** Share of the Preview in Studio-Modus (0.3–0.7). */
  readonly split: number;
  /** The stage has a fixed height (false at ≤ 1180 px, where the stage grows with its content). */
  readonly heightBound: boolean;
  /** ≤ 900 px: every monitor takes the full width. */
  readonly fullWidth: boolean;
}

/** Monitor widths in CSS px; the preview is 0 without Studio-Modus. */
export interface MonitorWidths {
  readonly preview: number;
  readonly program: number;
}

function usable(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Widths of the monitors for a stage size (pure; see the module comment for the rules). */
export function monitorWidths(input: MonitorLayoutInput): MonitorWidths {
  const width = usable(input.width);
  if (input.fullWidth) {
    return { preview: input.studio ? Math.floor(width) : 0, program: Math.floor(width) };
  }
  const byHeight = input.heightBound
    ? (usable(input.height - MONITOR_VERTICAL_CHROME_PX) * 16) / 9
    : Number.POSITIVE_INFINITY;
  const fit = (value: number): number => Math.floor(Math.max(0, Math.min(value, byHeight)));
  if (!input.studio) {
    return { preview: 0, program: fit(width - CONTROL_COLUMN_PX - STAGE_GAP_PX) };
  }
  const split = Number.isFinite(input.split) ? Math.min(0.7, Math.max(0.3, input.split)) : 0.5;
  const shared = usable(width - CONTROL_COLUMN_PX - STAGE_GAP_PX - MONITOR_SPLIT_PX);
  return { preview: fit(shared * split), program: fit(shared * (1 - split)) };
}
