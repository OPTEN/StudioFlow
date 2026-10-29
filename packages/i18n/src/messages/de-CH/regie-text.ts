import type { Translation } from '../../types';
import type { regieText as en } from '../en/regie-text';

export const regieText: Translation<typeof en> = {
  'regie.text.align.center': 'Zentriert',
  'regie.text.align.label': 'Ausrichtung',
  'regie.text.align.left': 'Links',
  'regie.text.align.right': 'Rechts',

  'regie.text.counter': '{count} von {max}',

  'regie.text.delete.button': 'Text löschen …',
  'regie.text.delete.confirm': 'Diesen Text löschen',
  'regie.text.delete.hint': 'Der Text wird aus allen Szenen entfernt.',
  'regie.text.delete.message': {
    '=0': '{code} wird gelöscht. Der Text ist in keiner Szene.',
    one: '{code} wird gelöscht und aus {count} Szene entfernt.',
    other: '{code} wird gelöscht und aus {count} Szenen entfernt.',
  },
  'regie.text.delete.toast': '{code} gelöscht',

  'regie.text.editor.hintLive': 'Änderungen erscheinen beim Tippen im Ausgang.',
  'regie.text.editor.label': 'Text',
  'regie.text.editor.line1': 'Zeile 1',
  'regie.text.editor.line1Placeholder': 'Name oder Titel',
  'regie.text.editor.line2': 'Zeile 2 (optional)',
  'regie.text.editor.line2Placeholder': 'Funktion oder Untertitel',
  'regie.text.editor.line1Required': 'Gib die erste Zeile ein.',
  'regie.text.editor.offline':
    'Keine Verbindung zum Server. Bearbeiten geht wieder, sobald er zurück ist.',
  'regie.text.editor.sharedHint': 'In {count} Szenen sichtbar. Eine Änderung gilt für alle.',
  'regie.text.editor.style': 'Stil',

  'regie.text.placeholder.name': 'Name',
  'regie.text.placeholder.note': 'Notiz',
  'regie.text.placeholder.role': 'Funktion',
  'regie.text.placeholder.title': 'Titel',

  'regie.text.preview.label': 'Vorschau des Textes',
  'regie.text.preview.title': 'Vorschau',

  'regie.text.style.lowerThird': 'Bauchbinde',
  'regie.text.style.note': 'Notiz',
  'regie.text.style.title': 'Titel',

  'regie.text.visibility.hint': 'Geht auch, während die Szene live ist.',
  'regie.text.visibility.label': 'Im Ausgang zeigen',
};
