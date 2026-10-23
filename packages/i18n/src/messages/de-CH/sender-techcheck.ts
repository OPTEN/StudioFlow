import type { Translation } from '../../types';
import type { senderTechcheck as en } from '../en/sender-techcheck';

export const senderTechcheck: Translation<typeof en> = {
  'sender.techcheck.again': 'Erneut prüfen',
  'sender.techcheck.busy': 'Prüft …',
  'sender.techcheck.checkedAt': 'Geprüft um {time}',
  'sender.techcheck.close': 'Technik-Check schliessen',
  'sender.techcheck.level.bad': 'ungenügend',
  'sender.techcheck.level.ok': 'gut',
  'sender.techcheck.level.unknown': 'nicht geprüft',
  'sender.techcheck.level.warn': 'eingeschränkt',
  'sender.techcheck.open': 'Technik-Check',
  'sender.techcheck.row.bandwidth': 'Upload',
  'sender.techcheck.row.camera': 'Kamera',
  'sender.techcheck.row.network': 'Netzwerk',
  'sender.techcheck.run': 'Jetzt prüfen',
  'sender.techcheck.running': 'Prüft Kamera, Netzwerk und Upload …',
  'sender.techcheck.summary.bad': 'So gibt es Probleme in der Sendung.',
  'sender.techcheck.summary.ok': 'Alles bereit für die Sendung.',
  'sender.techcheck.summary.unknown': 'Noch nicht geprüft.',
  'sender.techcheck.summary.warn': 'Es geht, aber mit Einschränkungen.',
  'sender.techcheck.title': 'Technik-Check',
};
