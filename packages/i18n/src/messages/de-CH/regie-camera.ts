import type { Translation } from '../../types';
import type { regieCamera as en } from '../en/regie-camera';

export const regieCamera: Translation<typeof en> = {
  'regie.camera.brightness.auto': 'Zurücksetzen',
  'regie.camera.brightness.autoLabel': 'Helligkeit auf 0 zurücksetzen',
  'regie.camera.brightness.label': 'Helligkeit',
  'regie.camera.brightness.value': '{value} EV',

  'regie.camera.focus.auto': 'Automatisch',
  'regie.camera.focus.distance': 'Fokusdistanz',
  'regie.camera.focus.distanceValue': '{value} m',
  'regie.camera.focus.label': 'Fokus',
  'regie.camera.focus.lock': 'Fixieren',

  'regie.camera.lens.confirmMessage':
    '{label} ist live. Das Bild friert kurz ein, während das Handy das Objektiv wechselt.',
  'regie.camera.lens.confirmNow': 'Objektiv wechseln',
  'regie.camera.lens.label': 'Objektiv',
  'regie.camera.lens.numbered': 'Kamera {number}',
  'regie.camera.lens.front': 'Frontkamera',
  'regie.camera.lens.standard': 'Standard',
  'regie.camera.lens.tele': 'Tele',
  'regie.camera.lens.ultraWide': 'Weitwinkel',

  'regie.camera.live': 'Jede Änderung ist sofort auf Sendung zu sehen.',

  'regie.camera.panel.label': 'Kamerasteuerung von {name}',
  'regie.camera.panel.open': 'Kameraeinstellungen',

  'regie.camera.problem.failed': 'Das Handy konnte die Änderung nicht übernehmen.',
  'regie.camera.problem.overconstrained': 'Die Kamera unterstützt diese Einstellung nicht.',

  'regie.camera.reset': 'Auf automatisch zurücksetzen',
  'regie.camera.resetConfirm':
    '{label} ist live. Zoom, Fokus, Helligkeit und Licht gehen sofort auf automatisch zurück.',
  'regie.camera.resetNow': 'Jetzt zurücksetzen',

  'regie.camera.status.notReported': 'Das Handy hat seine Kamera noch nicht gemeldet.',
  'regie.camera.status.offline': 'Das Handy ist offline. Änderungen werden nicht gesendet.',
  'regie.camera.status.unavailable': 'Auf diesem Gerät nicht verfügbar.',

  'regie.camera.torch.label': 'Licht',
  'regie.camera.torch.off': 'Aus',
  'regie.camera.torch.on': 'An',

  'regie.camera.zoom.label': 'Zoom',
  'regie.camera.zoom.value': '{value}×',
};
