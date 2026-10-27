import type { Translation } from '../../types';
import type { regieLoad as en } from '../en/regie-load';

export const regieLoad: Translation<typeof en> = {
  'regie.load.cpuLimit': 'CPU am Limit',
  'regie.load.cpuLimitCodes': 'CPU am Limit {codes}',
  'regie.load.cpuLimitHint':
    'Der Rechner kommt mit dem Codieren nicht nach und senkt die Bildqualität. Andere Programme schliessen oder einen kleineren Bereich teilen.',

  'regie.load.decoding.hardware': 'Hardware-Decodierung',
  'regie.load.decoding.software': 'Software-Decodierung',

  'regie.load.detail.decoding': 'Decodierung hier',
  'regie.load.detail.decodingCode': 'Decodierung {code} hier',
  'regie.load.detail.encoding': 'Codierung',
  'regie.load.detail.encodingCode': 'Codierung {code}',

  'regie.load.encoding.hardware': '{codec} · Hardware',
  'regie.load.encoding.software': '{codec} · Software-Codierung',

  'regie.load.output.decodingLabel': 'Decodierung',
  'regie.load.output.droppedLabel': 'Verworfene Bilder',
  'regie.load.output.dropping': 'verwirft Bilder',
  'regie.load.output.droppingHint':
    'Der Rechner der Ausgabeseite kommt nicht nach: {percent} der Bilder werden verworfen. Die Auflösung der Produktion senken oder einen schnelleren Rechner nehmen.',
  'regie.load.output.inSoftware': '{count} in Software',
  'regie.load.output.streams': {
    '=0': 'kein Videostrom',
    one: '{count} Videostrom',
    other: '{count} Videoströme',
  },
};
