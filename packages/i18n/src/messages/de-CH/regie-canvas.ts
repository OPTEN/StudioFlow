import type { Translation } from '../../types';
import type { regieCanvas as en } from '../en/regie-canvas';

export const regieCanvas: Translation<typeof en> = {
  'regie.canvas.confirm': {
    '=0': 'Das Format ändert sich. Keine Szene hat Elemente, es ändert sich also nichts weiter.',
    one: 'Der Rückgängig-Verlauf der Szenen wird gelöscht, und die Elemente von {count} Szene werden in die neue Leinwand eingepasst und zentriert. Die Szene danach prüfen; «Vorlage anwenden» ordnet sie neu an.',
    other:
      'Der Rückgängig-Verlauf der Szenen wird gelöscht, und die Elemente von {count} Szenen werden in die neue Leinwand eingepasst und zentriert. Die Szenen danach prüfen; «Vorlage anwenden» ordnet sie neu an.',
  },
  'regie.canvas.confirmButton': 'Format ändern',
  'regie.canvas.currentSize': 'Leinwand {size}',
  'regie.canvas.format': 'Format',
  'regie.canvas.formatName.portrait': 'Hochformat, für Handys und Social Media',
  'regie.canvas.formatName.square': 'Quadrat',
  'regie.canvas.formatName.standard': 'Klassisch 4:3',
  'regie.canvas.formatName.widescreen': 'Breitbild',
  'regie.canvas.liveLocked':
    'Format und Auflösung sind gesperrt, solange die Sendung live ist. Du kannst sie nach dem Ende ändern.',
  'regie.canvas.note':
    'Deine Szenen werden auf dieser Leinwand angeordnet. Die Output-Seite skaliert sie auf ihr Fenster, so füllt sie einen Proxy oder eine Kamera jeder Grösse.',
  'regie.canvas.resolution': 'Auflösung',
  'regie.canvas.resolutionOnly':
    'Gleiches Format: Alle Elemente werden im gleichen Verhältnis skaliert, nichts verschiebt sich.',
  'regie.canvas.save': 'Format speichern',
  'regie.canvas.saved': 'Ausgabe ist jetzt {size} ({ratio})',
  'regie.canvas.title': 'Format und Auflösung',
};
