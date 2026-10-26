import type { Translation } from '../../types';
import type { outputAudio as en } from '../en/output-audio';

export const outputAudio: Translation<typeof en> = {
  'output.audio.soundOn': 'Ton ein',
  'output.audio.soundOnHint': 'Der Browser sperrt den Ton, bis die Seite angeklickt wird.',
};
