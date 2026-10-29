import type { Translation } from '../../types';
import type { regiePlaceholders as en } from '../en/regie-placeholders';

export const regiePlaceholders: Translation<typeof en> = {
  'regie.placeholders.assign.button': 'Zuweisen …',
  'regie.placeholders.assign.empty':
    'Noch nichts zum Zuweisen. Füge zuerst unter Geräte ein Gerät hinzu.',
  'regie.placeholders.assign.label': '{name} zuweisen',
  'regie.placeholders.assign.remove': 'Aus allen Szenen entfernen …',
  'regie.placeholders.assign.title': '{name} zeigen als',

  'regie.placeholders.dock.hint':
    'Diese Kameras und Screens kamen mit der kopierten Produktion. Weise jeder ein Gerät zu: Sein Bild erscheint dann überall, wo die alte Quelle verwendet wurde.',
  'regie.placeholders.dock.title': 'Fehlende Quellen',
  'regie.placeholders.dock.usedIn': {
    '=0': 'in keiner Szene',
    one: 'in {count} Szene',
    other: 'in {count} Szenen',
  },

  'regie.placeholders.offer.more': {
    one: '{count} weitere unter «Fehlende Quellen»',
    other: '{count} weitere unter «Fehlende Quellen»',
  },
  'regie.placeholders.offer.text': 'Diese Station kann den Platz einer fehlenden Quelle einnehmen:',
  'regie.placeholders.offer.useAs': 'Verwenden als {name}',

  'regie.placeholders.remove.confirmLabel': '{name} entfernen',
  'regie.placeholders.remove.message': {
    '=0': '{name} wird in keiner Szene verwendet und einfach entfernt.',
    one: 'Die eine Stelle in einer Szene, die {name} zeigt, wird entfernt.',
    other: 'Die {count} Stellen in den Szenen, die {name} zeigen, werden entfernt.',
  },

  'regie.placeholders.toast.assigned': 'Die Szenen zeigen jetzt {target} anstelle von {name}.',
  'regie.placeholders.toast.removed': '{name} aus den Szenen entfernt.',
  'regie.placeholders.unnamed': 'entfernte Quelle',
};
