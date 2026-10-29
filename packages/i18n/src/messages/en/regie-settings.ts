import type { Namespace } from '../../types';

/**
 * The settings window of the Regie: its sidebar, the scope line of each page, the settings of this browser (appearance,
 * language, dock layout), the account page and the about page.
 */
export const regieSettings = {
  'regie.settings.open': 'Open settings',
  'regie.settings.title': 'Settings',
  'regie.settings.theme.label': 'Appearance',
  'regie.settings.theme.dark': 'Dark',
  'regie.settings.theme.light': 'Light',
  'regie.settings.theme.system': 'System',
  'regie.settings.theme.systemDark': 'Follows the system, which is dark right now.',
  'regie.settings.theme.systemLight': 'Follows the system, which is light right now.',
  'regie.settings.version.label': 'Version',
  'regie.settings.nav.label': 'Settings',
  'regie.settings.nav.back': 'Control room',
  'regie.settings.group.production': 'Production',
  'regie.settings.group.browser': 'This browser',
  'regie.settings.group.server': 'Server',
  'regie.settings.group.insights': 'Diagnostics',
  'regie.settings.group.account': 'Account',
  'regie.settings.nav.general': 'General',
  'regie.settings.nav.slates': 'Slates',
  'regie.settings.nav.textStyle': 'Text style',
  'regie.settings.nav.output': 'Output links',
  'regie.settings.nav.productions': 'All productions',
  'regie.settings.nav.appearance': 'Appearance and language',
  'regie.settings.nav.media': 'Media server',
  'regie.settings.nav.network': 'Address and certificate',
  'regie.settings.nav.embedding': 'Embedding',
  'regie.settings.nav.backups': 'Backups',
  'regie.settings.nav.monitoring': 'Monitoring',
  'regie.settings.nav.audit': 'Activity log',
  'regie.settings.nav.account': 'Account',
  'regie.settings.nav.about': 'About StudioFlow',
  'regie.settings.scope.production': 'Applies to the production “{name}”.',
  'regie.settings.scope.productionNone': 'Applies to the active production.',
  'regie.settings.scope.browser':
    'Saved in this browser only. Senders and the output keep their own look.',
  'regie.settings.scope.server': 'Applies to the whole server and every production.',
  'regie.settings.page.loading': 'Loading…',

  // --- appearance and language
  'regie.settings.look.heading': 'Look',
  'regie.settings.look.languageSub': 'Automatic follows the language of this browser.',
  'regie.settings.layout.heading': 'Control room layout',
  'regie.settings.layout.reset': 'Reset dock layout…',
  'regie.settings.layout.resetLabel': 'Dock layout',
  'regie.settings.layout.resetSub':
    'Puts every dock back in its default place and size and shows the hidden ones.',
  'regie.settings.layout.confirm':
    'Every dock goes back to its default place and size in this browser. Docks you hid are shown again.',
  'regie.settings.layout.confirmAction': 'Reset layout',

  // --- account
  'regie.settings.account.heading': 'Signed in',
  'regie.settings.account.user': 'Username',
  'regie.settings.account.userSub': 'The one account of this installation.',
  'regie.settings.account.signOut': 'Sign out',
  'regie.settings.account.signOutLive':
    'The broadcast is on air. It keeps running, but this control room cannot switch until you sign in again.',
  'regie.settings.account.signOutConfirm': 'Sign out anyway',
  'regie.settings.account.signOutFailed': 'Signing out failed. {reason}',

  // --- about
  'regie.settings.about.version': 'Version',
  'regie.settings.about.versionSub': 'Name it when you report a problem.',
  'regie.settings.about.copy': 'Copy version',
  'regie.settings.about.sponsor': 'Sponsored by OPTEN',
  'regie.settings.about.sponsorSub': 'StudioFlow is developed with the support of OPTEN.',
  'regie.settings.about.sponsorLink': 'opten.ch',
} as const satisfies Namespace<'regie.settings'>;
