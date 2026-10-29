import type { Translation } from '../../types';
import type { regieSettings as en } from '../en/regie-settings';

export const regieSettings: Translation<typeof en> = {
  'regie.settings.open': 'Einstellungen öffnen',
  'regie.settings.title': 'Einstellungen',
  'regie.settings.theme.label': 'Darstellung',
  'regie.settings.theme.dark': 'Dunkel',
  'regie.settings.theme.light': 'Hell',
  'regie.settings.theme.system': 'System',
  'regie.settings.theme.systemDark': 'Folgt dem System, das gerade dunkel ist.',
  'regie.settings.theme.systemLight': 'Folgt dem System, das gerade hell ist.',
  'regie.settings.version.label': 'Version',
  'regie.settings.nav.label': 'Einstellungen',
  'regie.settings.nav.back': 'Regie',
  'regie.settings.group.production': 'Produktion',
  'regie.settings.group.browser': 'Dieser Browser',
  'regie.settings.group.server': 'Server',
  'regie.settings.group.insights': 'Diagnose',
  'regie.settings.group.account': 'Konto',
  'regie.settings.nav.general': 'Allgemein',
  'regie.settings.nav.slates': 'Slates',
  'regie.settings.nav.textStyle': 'Textstil',
  'regie.settings.nav.output': 'Output-Links',
  'regie.settings.nav.productions': 'Alle Produktionen',
  'regie.settings.nav.appearance': 'Darstellung und Sprache',
  'regie.settings.nav.media': 'Medienserver',
  'regie.settings.nav.network': 'Adresse und Zertifikat',
  'regie.settings.nav.embedding': 'Einbettung',
  'regie.settings.nav.backups': 'Backups',
  'regie.settings.nav.monitoring': 'Monitoring',
  'regie.settings.nav.audit': 'Protokoll',
  'regie.settings.nav.account': 'Konto',
  'regie.settings.nav.about': 'Über StudioFlow',
  'regie.settings.scope.production': 'Gilt für die Produktion «{name}».',
  'regie.settings.scope.productionNone': 'Gilt für die aktive Produktion.',
  'regie.settings.scope.browser':
    'Nur in diesem Browser gespeichert. Sender und Output behalten ihr eigenes Aussehen.',
  'regie.settings.scope.server': 'Gilt für den ganzen Server und jede Produktion.',
  'regie.settings.page.loading': 'Wird geladen …',

  // --- Darstellung und Sprache
  'regie.settings.look.heading': 'Aussehen',
  'regie.settings.look.languageSub': 'Automatisch folgt der Sprache dieses Browsers.',
  'regie.settings.layout.heading': 'Anordnung der Regie',
  'regie.settings.layout.reset': 'Dock-Anordnung zurücksetzen …',
  'regie.settings.layout.resetLabel': 'Dock-Anordnung',
  'regie.settings.layout.resetSub':
    'Stellt jedes Dock an seinen Standardplatz in Standardgrösse und zeigt die ausgeblendeten wieder.',
  'regie.settings.layout.confirm':
    'Jedes Dock kommt in diesem Browser an seinen Standardplatz in Standardgrösse zurück. Ausgeblendete Docks erscheinen wieder.',
  'regie.settings.layout.confirmAction': 'Anordnung zurücksetzen',

  // --- Konto
  'regie.settings.account.heading': 'Angemeldet',
  'regie.settings.account.user': 'Benutzername',
  'regie.settings.account.userSub': 'Das eine Konto dieser Installation.',
  'regie.settings.account.signOut': 'Abmelden',
  'regie.settings.account.signOutLive':
    'Die Sendung läuft. Sie läuft weiter, aber diese Regie kann erst nach einer neuen Anmeldung wieder schalten.',
  'regie.settings.account.signOutConfirm': 'Trotzdem abmelden',
  'regie.settings.account.signOutFailed': 'Abmelden fehlgeschlagen. {reason}',

  // --- Über
  'regie.settings.about.version': 'Version',
  'regie.settings.about.versionSub': 'Bei einer Problemmeldung bitte angeben.',
  'regie.settings.about.copy': 'Version kopieren',
  'regie.settings.about.sponsor': 'Gesponsert von OPTEN',
  'regie.settings.about.sponsorSub': 'StudioFlow wird mit Unterstützung von OPTEN entwickelt.',
  'regie.settings.about.sponsorLink': 'opten.ch',
};
