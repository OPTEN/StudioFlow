/** Colours and fonts of the rendered picture (DESIGN.md tokens and the prototype's drawing code). */
export const PALETTE = {
  /** Letterbox and stage background in `black` mode. */
  stage: '#000000',
  /** Bars around a `contain` picture. */
  containBars: '#0a0d12',
  /** Item without a picture (pending or missing source). */
  placeholder: '#121821',
  /** Scrim over a held (lost for longer than the hold time) picture. */
  heldScrim: 'rgba(13, 17, 23, 0.72)',
  /** Text on dark grounds (hold message). */
  text: '#e6edf3',
  /** Secondary text («Quelle fehlt»). */
  muted: '#8b949e',
  /** Slate ground and text on amber/red fills. */
  ground: '#0d1117',
  /** Slate text. */
  slateText: '#ffffff',
  /** «verbindet neu». */
  amber: '#e3b341',
  /** Every other outage. */
  red: '#f85149',
} as const;

/** UI font stack; the font files are self-hosted by the apps (spec section 3). */
export const UI_FONT = '"Sofia Sans Semi Condensed", "Arial Narrow", system-ui, sans-serif';
