import type { Translation } from '../../types';
import type { regieProduction as en } from '../en/regie-production';

export const regieProduction: Translation<typeof en> = {
  'regie.production.switcher.offline':
    'Keine Verbindung zum Server. Wechseln geht wieder, sobald sie zurück ist.',
  'regie.production.switcher.settings': 'Produktionseinstellungen …',
  'regie.production.switcher.title': 'Produktionen',

  'regie.production.switch.confirm':
    '«{live}» ist auf Sendung. Ihr Output läuft weiter, aber ihre Szenen kannst du erst wieder schalten, wenn du zu ihr zurückkehrst.',
  'regie.production.switch.to': 'Wechseln',
  'regie.production.switch.toLabel': 'Zu «{name}» wechseln',
  'regie.production.switch.now': 'Jetzt wechseln',

  'regie.production.state.active': 'Aktiv',
  'regie.production.state.created': 'Erstellt am {date}',
  'regie.production.state.onAir': 'Auf Sendung',

  'regie.production.form.clean': 'Keine Änderungen',
  'regie.production.form.discard': 'Änderungen verwerfen',
  'regie.production.form.saving': 'Wird gespeichert …',
  'regie.production.form.unsaved': 'Ungespeicherte Änderungen',

  'regie.production.name.hint':
    'Erscheint in der Werkzeugleiste der Regie und in der Liste der Produktionen.',
  'regie.production.name.invalid': 'Bitte einen Namen mit 1 bis {max} Zeichen eingeben.',
  'regie.production.name.save': 'Namen speichern',

  'regie.production.slates.endHint':
    'Erscheint, wenn du die Sendung beendest, bis du wieder zum Slate vor der Sendung zurückkehrst.',
  'regie.production.slates.lead': 'Was das Publikum vor und nach der Sendung sieht.',
  'regie.production.slates.noImages':
    'Für ein Bild hinter dem Text zuerst ein Bild im Dock «Quellen» hochladen.',
  'regie.production.slates.optional': 'Freiwillig',
  'regie.production.slates.preview': 'Vorschau des Slates «{title}»',
  'regie.production.slates.save': 'Slates speichern',
  'regie.production.slates.showing': 'Jetzt im Output',
  'regie.production.slates.tabs': 'Zu bearbeitender Slate',
  'regie.production.slates.standbyHint':
    'Erscheint, sobald der Output öffnet, bis du die Sendung startest.',
  'regie.production.slates.titleInvalid': 'Bitte einen Titel mit höchstens {max} Zeichen eingeben.',

  'regie.production.text.accentSub': 'Balken oder Linie neben dem Text',
  'regie.production.text.backgroundSub': 'Fläche hinter dem Text',
  'regie.production.text.colours': 'Farben',
  'regie.production.text.defaults': 'Standardfarben verwenden',
  'regie.production.text.defaultsHint':
    'Setzt die Standardfarben in die Felder. Zum Übernehmen speichern.',
  'regie.production.text.foregroundSub': 'Buchstaben',
  'regie.production.text.hexInvalid': 'Die Farbe als #rrggbb eingeben, zum Beispiel #1f6feb.',
  'regie.production.text.lead':
    'Farben aller Bauchbinden, Titel und Notizen dieser Produktion. Speichern ändert den Output sofort.',
  'regie.production.text.preview': 'Vorschau',
  'regie.production.text.previewLabel':
    'Beispiel einer Bauchbinde, eines Titels und einer Notiz in diesen Farben',
  'regie.production.text.save': 'Farben speichern',

  'regie.production.list.footer':
    'Die aktive Produktion zeigt die Regie, und neue Geräte werden mit ihr gekoppelt.',
  'regie.production.list.loading': 'Produktionen werden geladen …',
  'regie.production.list.offline':
    'Keine Verbindung zum Server. Wechseln und Erstellen gehen wieder, sobald sie zurück ist.',

  'regie.production.menu.keys':
    'Rechtsklick auf eine Produktion zeigt ihre Befehle. F2 benennt sie um, Ctrl+D (⌘D auf dem Mac) dupliziert sie.',
  'regie.production.menu.more': 'Weitere Aktionen für «{name}»',
  'regie.production.menu.rename': 'Umbenennen',
  'regie.production.menu.renameLabel': 'Neuer Name von «{name}»',
  'regie.production.menu.all': 'Alle Produktionen …',

  'regie.production.add.create': 'Produktion erstellen',
  'regie.production.add.liveHint':
    'Solange «{name}» auf Sendung ist, wird die neue Produktion erstellt, aber nicht geöffnet. Wechsle nach der Sendung zu ihr.',
  'regie.production.add.newSub': 'Leer beginnen, im Format deiner Wahl.',
  'regie.production.add.placeholder': 'z. B. Frühlings-Webinar',
  'regie.production.add.title': 'Produktion hinzufügen',

  'regie.production.this.title': 'Diese Produktion',
};
