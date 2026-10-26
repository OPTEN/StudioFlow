import type { Translation } from '../../types';
import type { regieHeader as en } from '../en/regie-header';

export const regieHeader: Translation<typeof en> = {
  'regie.header.broadcast.end': 'Sendung beenden',
  'regie.header.broadcast.endConfirm':
    'Die Sendung wird beendet. Der Output zeigt danach «{title}».',
  'regie.header.broadcast.endConfirmNoTitle':
    'Die Sendung wird beendet. Der Output zeigt danach die Schluss-Slate.',
  'regie.header.broadcast.endDone': 'Sendung beendet',
  'regie.header.broadcast.ended': 'BEENDET',
  'regie.header.broadcast.endedTitle':
    'Die Sendung ist beendet; der Output zeigt die Schluss-Slate',
  'regie.header.broadcast.live': 'LIVE',
  'regie.header.broadcast.ready': 'BEREIT',
  'regie.header.broadcast.readyTitle': 'Der Output zeigt die Slate vor der Sendung',
  'regie.header.broadcast.reset': 'Zurück auf Bereit',
  'regie.header.broadcast.sinceStart': 'Seit Start der Sendung',
  'regie.header.broadcast.start': 'Sendung starten',
  'regie.header.broadcast.startDone': 'Die Sendung läuft',

  'regie.header.health.allSending': 'Alle Stationen senden',
  'regie.header.health.noStations': 'Noch keine Stationen gekoppelt',

  'regie.header.layout.docks': 'Docks',
  'regie.header.layout.note':
    'Ein Dock an der Kopfzeile nach unten, links oder rechts ziehen. Trennlinien ziehen ändert die Grösse, ein Doppelklick setzt sie zurück.',
  'regie.header.layout.open': 'Docks und Layout',
  'regie.header.layout.title': 'Docks und Layout',

  'regie.header.output.access': 'Zugriff',
  'regie.header.output.accessNoRestriction':
    'Jede Adresse darf den Output öffnen. Für mehr Sicherheit die Adresse des Proxys eintragen.',
  'regie.header.output.accessRestricted': 'Nur diese Adressen dürfen den Output öffnen.',
  'regie.header.output.accessSaved': 'Zugriff gespeichert',
  'regie.header.output.accessSavedOpen': 'Zugriff gespeichert: jede Adresse darf den Output öffnen',
  'regie.header.output.addressesLabel': 'Abnehmer',
  'regie.header.output.dangerHint': 'Bei Verdacht auf Weitergabe',
  'regie.header.output.dialog': 'Output',
  'regie.header.output.discard': 'Verwerfen',
  'regie.header.output.embedAllowed': 'Einbetten erlaubt für',
  'regie.header.output.formatLabel': 'Format',
  'regie.header.output.ipInvalid':
    'Bitte eine IP-Adresse wie 10.0.0.42 oder ein Netz wie 10.0.0.0/24 eingeben.',
  'regie.header.output.ipLabel': 'IP-Adresse oder Netz (CIDR)',
  'regie.header.output.ipPlaceholder': '10.0.0.42 oder 10.0.0.0/24',
  'regie.header.output.label': 'Output an Proxy',
  'regie.header.output.latencyLabel': 'Latenz',
  'regie.header.output.latencyMeasured': 'gemessen',
  'regie.header.output.latencyNone': 'noch nicht gemessen',
  'regie.header.output.linkLoading': 'Link wird geladen …',
  'regie.header.output.linkNew': 'Neuer Output-Link erzeugt. Der alte ist ungültig.',
  'regie.header.output.regenerate': 'Link neu erzeugen',
  'regie.header.output.regenerateConfirm': 'Neu erzeugen',
  'regie.header.output.regenerateMessage':
    'Der alte Link hört sofort auf. Der Proxy braucht danach den neuen.',
  'regie.header.output.removeIp': '{ip} entfernen',
  'regie.header.output.retry': 'Nochmals',
  'regie.header.output.stateConnected': {
    one: 'verbunden, {count} Abnehmer',
    other: 'verbunden, {count} Abnehmer',
  },
  'regie.header.output.stateLabel': 'Zustand',
  'regie.header.output.stateNone': 'nicht verbunden',
  'regie.header.output.stateStale': 'verbunden, kein aktuelles Bild',

  'regie.header.presence.long': {
    one: 'Eine Person in der Regie',
    other: '{count} Personen in der Regie',
  },
  'regie.header.presence.short': '{count} in der Regie',

  'regie.header.production.afterBroadcast': 'Nach der Sendung',
  'regie.header.production.background': 'Hintergrund',
  'regie.header.production.backgroundNone': 'Kein Bild',
  'regie.header.production.beforeBroadcast': 'Vor der Sendung',
  'regie.header.production.created': 'Produktion «{name}» erstellt und aktiv',
  'regie.header.production.createdSwitchLater':
    'Produktion «{name}» erstellt. Wechseln geht nach der Sendung.',
  'regie.header.production.createSubmit': 'Erstellen',
  'regie.header.production.dialog': 'Produktion',
  'regie.header.production.editSlates': 'Slates bearbeiten',
  'regie.header.production.listError': 'Die Produktionen konnten nicht geladen werden.',
  'regie.header.production.listLoading': 'Wird geladen …',
  'regie.header.production.menu': 'Produktion {name}, Menü',
  'regie.header.production.name': 'Name',
  'regie.header.production.nameInvalid': 'Bitte einen Namen mit höchstens 80 Zeichen eingeben.',
  'regie.header.production.namePlaceholder': 'z. B. Webinar «Headless mit Umbraco»',
  'regie.header.production.new': 'Neue Produktion',
  'regie.header.production.newMenu': 'Neue Produktion …',
  'regie.header.production.noSwitchWhileLive':
    'Während der Sendung lässt sich die Produktion nicht wechseln.',
  'regie.header.production.renameTitle': 'Produktion umbenennen',
  'regie.header.production.renamed': 'Produktion heisst jetzt «{name}»',
  'regie.header.production.signOut': 'Abmelden',
  'regie.header.production.signOutFailed': 'Abmelden hat nicht geklappt. {reason}',
  'regie.header.production.slatesHint':
    'Der Output zeigt die Slate vor dem Start und nach dem Ende der Sendung.',
  'regie.header.production.slatesInvalid': 'Beide Slates brauchen einen Titel.',
  'regie.header.production.slatesSaved': 'Slates gespeichert',
  'regie.header.production.subtitle': 'Untertitel',
  'regie.header.production.switchTitle': 'Produktion wechseln',
  'regie.header.production.switched': 'Gewechselt zu «{name}»',
  'regie.header.production.textAccent': 'Akzent',
  'regie.header.production.textBackground': 'Hintergrund',
  'regie.header.production.textColors': 'Textfarben …',
  'regie.header.production.textColorsHint':
    'Farben aller Bauchbinden, Titel und Notizen dieser Produktion. Speichern wendet sie sofort im Ausgang an.',
  'regie.header.production.textColorsInvalid':
    'Gib jede Farbe als #rrggbb ein, zum Beispiel #1f6feb.',
  'regie.header.production.textColorsReset': 'Auf Standard zurücksetzen',
  'regie.header.production.textColorsSaved': 'Textfarben gespeichert',
  'regie.header.production.textColorsTitle': 'Textfarben',
  'regie.header.production.textContrastLow':
    'Kontrast {ratio} : 1. Der Text ist auf diesem Hintergrund schlecht lesbar; mindestens 4,5 : 1 sind gut.',
  'regie.header.production.textForeground': 'Text',
  'regie.header.production.textHex': '{colour}, Hex-Wert',
  'regie.header.production.textPick': '{colour}, Farbwähler',
  'regie.header.production.textSample': 'Beispiel einer Bauchbinde',
  'regie.header.production.title': 'Titel',
};
