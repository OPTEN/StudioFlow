import type { Translation } from '../../types';
import type { regieCanvas as en } from '../en/regie-canvas';

export const regieCanvas: Translation<typeof en> = {
  'regie.canvas.confirm': {
    '=0': 'Das Format ändert sich. Keine Szene hat Elemente, es ändert sich also nichts weiter.',
    one: 'Das Format ändert sich. Die Elemente von {count} Szene werden in die neue Leinwand eingepasst und zentriert; die Szene danach prüfen, «Vorlage anwenden» ordnet sie neu an. Der Rückgängig-Verlauf der Szenen wird gelöscht.',
    other:
      'Das Format ändert sich. Die Elemente von {count} Szenen werden in die neue Leinwand eingepasst und zentriert; die Szenen danach prüfen, «Vorlage anwenden» ordnet sie neu an. Der Rückgängig-Verlauf der Szenen wird gelöscht.',
  },
  'regie.canvas.confirmButton': 'Format ändern',
  'regie.canvas.currentSize': 'Leinwand {size}',
  'regie.canvas.format': 'Format',
  'regie.canvas.formatName.portrait': 'Hochformat, für Handys und Social Media',
  'regie.canvas.formatName.square': 'Quadrat',
  'regie.canvas.formatName.standard': 'Klassisch 4:3',
  'regie.canvas.formatName.widescreen': 'Breitbild',
  'regie.canvas.liveLocked':
    'Format und Auflösung lassen sich nicht ändern, solange die Sendung live ist. Zuerst die Sendung beenden.',
  'regie.canvas.menu': 'Format und Auflösung…',
  'regie.canvas.note':
    'Die Ausgabeseite skaliert das Bild auf das Fenster des Proxys. Format und Zielauflösung legen die Leinwand der Layouts fest, nicht die Pixel, die beim Proxy ankommen.',
  'regie.canvas.resolution': 'Zielauflösung',
  'regie.canvas.resolutionOnly':
    'Gleiches Format: Alle Elemente werden im gleichen Verhältnis skaliert, nichts verschiebt sich.',
  'regie.canvas.saved': 'Ausgabe ist jetzt {size} ({ratio})',
  'regie.canvas.title': 'Format und Auflösung',
};
