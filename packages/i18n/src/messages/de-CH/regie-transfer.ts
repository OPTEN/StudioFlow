import type { Translation } from '../../types';
import type { regieTransfer as en } from '../en/regie-transfer';

export const regieTransfer: Translation<typeof en> = {
  'regie.transfer.duplicate.busy': 'Wird dupliziert …',
  'regie.transfer.duplicate.defaultName': '{name} (Kopie)',
  'regie.transfer.duplicate.done':
    'Produktion «{name}» erstellt. Sie ist nicht aktiv; wechsle zu ihr, wenn du bereit bist.',
  'regie.transfer.duplicate.details':
    'Kopiert: Szenen, Texte, Medien und Einstellungen. Nicht kopiert: Kopplungen, Einladungen, Output-Links und das Protokoll. Die Kopie wird nicht zur aktiven Produktion.',
  'regie.transfer.duplicate.hint':
    'Kameras und Bildschirme werden zu Platzhaltern für die Geräte, die du als Nächstes koppelst.',
  'regie.transfer.duplicate.media': {
    '=0': 'Es gibt keine Mediendateien zu kopieren.',
    one: '{count} Mediendatei ({size}) wird kopiert.',
    other: '{count} Mediendateien ({size}) werden kopiert.',
  },
  'regie.transfer.duplicate.name': 'Name der Kopie',
  'regie.transfer.duplicate.open': 'Duplizieren …',
  'regie.transfer.duplicate.sub':
    'Eine neue Produktion mit den Szenen, Texten, Medien und Einstellungen dieser. Geht auch während der Sendung.',
  'regie.transfer.duplicate.submit': 'Duplizieren',
  'regie.transfer.duplicate.title': 'Produktion duplizieren',

  'regie.transfer.export.started':
    'Export von «{name}» gestartet. Dein Browser speichert die Datei.',
  'regie.transfer.export.sub':
    'Eine Datei zum Aufbewahren oder zum Importieren auf einem anderen Server.',
  'regie.transfer.export.title': 'Produktion exportieren',

  'regie.transfer.import.another': 'Andere Datei wählen',
  'regie.transfer.import.busy': 'Wird importiert …',
  'regie.transfer.import.checking': '«{file}» wird geprüft …',
  'regie.transfer.import.choose': 'Datei wählen …',
  'regie.transfer.import.done':
    'Produktion «{name}» importiert. Sie ist nicht aktiv; wechsle zu ihr, wenn du bereit bist.',
  'regie.transfer.import.hint':
    'Wähle eine aus StudioFlow exportierte Datei (.studioflow.zip). Du siehst, was sie enthält, bevor etwas angelegt wird.',
  'regie.transfer.import.media': {
    '=0': 'Keine Mediendateien',
    one: '{count} Mediendatei · {size}',
    other: '{count} Mediendateien · {size}',
  },
  'regie.transfer.import.name': 'Name',
  'regie.transfer.import.placeholders': 'Kameras und Bildschirme',
  'regie.transfer.import.previewTitle': 'Diese Datei enthält',
  'regie.transfer.import.progress': '{percent} hochgeladen',
  'regie.transfer.import.scenes': { one: '{count} Szene', other: '{count} Szenen' },
  'regie.transfer.import.sub':
    'Aus einer Datei, die aus StudioFlow exportiert wurde (.studioflow.zip).',
  'regie.transfer.import.submit': 'Importieren',
  'regie.transfer.import.texts': {
    '=0': 'Keine Texte',
    one: '{count} Text',
    other: '{count} Texte',
  },
  'regie.transfer.import.title': 'Produktion importieren',
  'regie.transfer.import.unnamed': 'entfernte Quelle',
  'regie.transfer.import.version': 'Exportiert mit StudioFlow {version}',
  'regie.transfer.import.warning.nameChanged':
    'Eine Produktion mit diesem Namen gibt es schon. Sie wird als «{name}» importiert.',
  'regie.transfer.import.warning.placeholders': {
    one: '{count} Kamera oder ein Bildschirm des Originals wird zum Platzhalter. Koppel ein Gerät und weise es zu, damit das Bild zurückkommt.',
    other:
      '{count} Kameras und Bildschirme des Originals werden zu Platzhaltern. Koppel Geräte und weise sie zu, damit die Bilder zurückkommen.',
  },

  'regie.transfer.menu.duplicate': 'Produktion duplizieren …',
  'regie.transfer.menu.export': 'Exportieren',
  'regie.transfer.menu.import': 'Importieren …',
};
