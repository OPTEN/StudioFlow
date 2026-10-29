import { t, type PlainMessageKey } from '@studioflow/i18n';

/**
 * The keyboard shortcuts of the control room in one place: the sheet ("?" and "Layout" › "Keyboard shortcuts") renders
 * this list, and menus use {@link keyHint} for their hints, so a new shortcut is added here once. The keys themselves
 * are handled by the {@link KeyboardService} (global ones) or by the row, item or divider that has the focus.
 */

/** One keycap; `mod` is Ctrl (⌘ on Apple), `space` the localised word for the space bar. */
export type Keycap = 'mod' | 'space' | string;

/** One shortcut: alternative key combinations (each a list of keycaps) and what it does. */
export interface ShortcutEntry {
  readonly combos: readonly (readonly Keycap[])[];
  readonly textKey: PlainMessageKey;
}

/** A group of shortcuts under a heading. */
export interface ShortcutGroup {
  readonly labelKey: PlainMessageKey;
  readonly shortcuts: readonly ShortcutEntry[];
}

/** The shortcuts of the control room, grouped as the sheet shows them. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    labelKey: 'regie.header.keys.switching',
    shortcuts: [
      { combos: [['1–9']], textKey: 'regie.header.keys.scenes' },
      { combos: [['space']], textKey: 'regie.header.keys.take' },
      { combos: [['M']], textKey: 'regie.header.keys.mute' },
    ],
  },
  {
    labelKey: 'regie.header.keys.editing',
    shortcuts: [
      { combos: [['mod', 'Z']], textKey: 'regie.header.keys.undo' },
      {
        combos: [
          ['mod', 'Shift', 'Z'],
          ['mod', 'Y'],
        ],
        textKey: 'regie.header.keys.redo',
      },
      { combos: [['←', '↑', '→', '↓']], textKey: 'regie.header.keys.nudge' },
      { combos: [['Shift', '←', '↑', '→', '↓']], textKey: 'regie.header.keys.nudgeLarge' },
      { combos: [['Esc']], textKey: 'regie.header.keys.escape' },
    ],
  },
  {
    labelKey: 'regie.header.keys.lists',
    shortcuts: [
      { combos: [['F2']], textKey: 'regie.header.keys.rename' },
      { combos: [['Del']], textKey: 'regie.header.keys.remove' },
      { combos: [['mod', 'D']], textKey: 'regie.header.keys.duplicate' },
      {
        combos: [['Shift', 'F10'], ['Menu']],
        textKey: 'regie.header.keys.menu',
      },
    ],
  },
  {
    labelKey: 'regie.header.keys.layout',
    shortcuts: [
      { combos: [['←', '↑', '→', '↓']], textKey: 'regie.header.keys.arrows' },
      { combos: [['Shift', '←', '→']], textKey: 'regie.header.keys.arrowsShift' },
      { combos: [['Enter']], textKey: 'regie.header.keys.enter' },
    ],
  },
  {
    labelKey: 'regie.header.keys.general',
    shortcuts: [
      { combos: [['mod', ',']], textKey: 'regie.header.keys.settings' },
      { combos: [['?']], textKey: 'regie.header.keys.help' },
    ],
  },
];

/** True on Apple platforms, where the command key replaces Ctrl. */
export function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** The text on one keycap ("Ctrl" or "⌘", "Space" or "Leertaste", else the cap itself). */
export function keycapText(cap: Keycap): string {
  if (cap === 'mod') {
    return isApplePlatform() ? '⌘' : 'Ctrl';
  }
  return cap === 'space' ? t('regie.header.keys.space') : cap;
}

/** A combination as a one-line hint for tooltips and menus: "Ctrl+D", "⌘D", "Ctrl+,". */
export function keyHint(...caps: readonly Keycap[]): string {
  const texts = caps.map(keycapText);
  return isApplePlatform() && caps[0] === 'mod' ? texts.join('') : texts.join('+');
}
