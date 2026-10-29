import type { PlainMessageKey } from '@studioflow/i18n';
import type { IconName } from '../core/ui/icon.component';

/** Hue of a section tile in the sidebar (DESIGN.md "Settings": identity, not state). */
export type SettingsTile =
  'blue' | 'indigo' | 'purple' | 'pink' | 'orange' | 'green' | 'teal' | 'gray';

/** One page of the settings window. */
export interface SettingsNavItem {
  readonly id: string;
  /** Absolute route of the page. */
  readonly path: string;
  readonly labelKey: PlainMessageKey;
  readonly icon: IconName;
  readonly tile: SettingsTile;
}

/** A group of pages under one scope heading. */
export interface SettingsNavGroup {
  readonly id: 'production' | 'browser' | 'server' | 'insights' | 'account';
  readonly labelKey: PlainMessageKey;
  readonly items: readonly SettingsNavItem[];
}

/** Where `/settings` lands while this browser has not opened a settings page yet. */
export const SETTINGS_HOME = '/settings/production';

/**
 * The sidebar of the settings window, grouped by scope so every page says where its choices apply: the active
 * production, this browser, the whole server, diagnostics, and the account. The order is the reading order of the
 * sidebar; `/settings` opens the page visited last ({@link SETTINGS_HOME} the first time).
 */
export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    id: 'production',
    labelKey: 'regie.settings.group.production',
    items: [
      {
        id: 'general',
        path: '/settings/production',
        labelKey: 'regie.settings.nav.general',
        icon: 'film',
        tile: 'blue',
      },
      {
        id: 'slates',
        path: '/settings/slates',
        labelKey: 'regie.settings.nav.slates',
        icon: 'slate',
        tile: 'indigo',
      },
      {
        id: 'text-style',
        path: '/settings/text-style',
        labelKey: 'regie.settings.nav.textStyle',
        icon: 'type',
        tile: 'purple',
      },
      {
        id: 'output',
        path: '/settings/output',
        labelKey: 'regie.settings.nav.output',
        icon: 'output',
        tile: 'green',
      },
      {
        id: 'productions',
        path: '/settings/productions',
        labelKey: 'regie.settings.nav.productions',
        icon: 'stack',
        tile: 'gray',
      },
    ],
  },
  {
    id: 'browser',
    labelKey: 'regie.settings.group.browser',
    items: [
      {
        id: 'appearance',
        path: '/settings/appearance',
        labelKey: 'regie.settings.nav.appearance',
        icon: 'appearance',
        tile: 'gray',
      },
    ],
  },
  {
    id: 'server',
    labelKey: 'regie.settings.group.server',
    items: [
      {
        id: 'media',
        path: '/settings/media',
        labelKey: 'regie.settings.nav.media',
        icon: 'server',
        tile: 'teal',
      },
      {
        id: 'network',
        path: '/settings/network',
        labelKey: 'regie.settings.nav.network',
        icon: 'globe',
        tile: 'blue',
      },
      {
        id: 'embedding',
        path: '/settings/embedding',
        labelKey: 'regie.settings.nav.embedding',
        icon: 'shield',
        tile: 'orange',
      },
      {
        id: 'backups',
        path: '/settings/backups',
        labelKey: 'regie.settings.nav.backups',
        icon: 'archive',
        tile: 'green',
      },
    ],
  },
  {
    id: 'insights',
    labelKey: 'regie.settings.group.insights',
    items: [
      {
        id: 'monitoring',
        path: '/monitoring',
        labelKey: 'regie.settings.nav.monitoring',
        icon: 'pulse',
        tile: 'pink',
      },
      {
        id: 'audit',
        path: '/audit',
        labelKey: 'regie.settings.nav.audit',
        icon: 'clock',
        tile: 'orange',
      },
    ],
  },
  {
    id: 'account',
    labelKey: 'regie.settings.group.account',
    items: [
      {
        id: 'account',
        path: '/settings/account',
        labelKey: 'regie.settings.nav.account',
        icon: 'user',
        tile: 'gray',
      },
      {
        id: 'about',
        path: '/settings/about',
        labelKey: 'regie.settings.nav.about',
        icon: 'info',
        tile: 'gray',
      },
    ],
  },
];
