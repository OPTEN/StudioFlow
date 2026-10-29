import type { Namespace } from '../../types';

/** The camera control panel of a station in the Stations dock (remote zoom, lens, focus, brightness, light). */
export const regieCamera = {
  'regie.camera.brightness.auto': 'Reset',
  'regie.camera.brightness.autoLabel': 'Reset the brightness to 0',
  'regie.camera.brightness.label': 'Brightness',
  'regie.camera.brightness.value': '{value} EV',

  'regie.camera.focus.auto': 'Auto',
  'regie.camera.focus.distance': 'Focus distance',
  'regie.camera.focus.distanceValue': '{value} m',
  'regie.camera.focus.label': 'Focus',
  'regie.camera.focus.lock': 'Lock',

  'regie.camera.lens.confirmMessage':
    '{label} is live. The picture freezes briefly while the phone switches the lens.',
  'regie.camera.lens.confirmNow': 'Switch lens',
  'regie.camera.lens.label': 'Lens',
  'regie.camera.lens.numbered': 'Camera {number}',
  'regie.camera.lens.front': 'Front',
  'regie.camera.lens.standard': 'Standard',
  'regie.camera.lens.tele': 'Tele',
  'regie.camera.lens.ultraWide': 'Wide-angle',

  'regie.camera.live': 'Every change shows on air right away.',

  'regie.camera.panel.label': 'Camera controls of {name}',
  'regie.camera.panel.open': 'Camera settings',

  'regie.camera.problem.failed': 'The phone could not apply the change.',
  'regie.camera.problem.overconstrained': 'The camera does not support this setting.',

  'regie.camera.reset': 'Reset to auto',
  'regie.camera.resetConfirm':
    '{label} is live. Zoom, focus, brightness and light go back to automatic at once.',
  'regie.camera.resetNow': 'Reset now',

  'regie.camera.status.notReported': 'The phone has not reported its camera yet.',
  'regie.camera.status.offline': 'The phone is offline. Changes are not sent.',
  'regie.camera.status.unavailable': 'Not available on this device.',

  'regie.camera.torch.label': 'Light',
  'regie.camera.torch.off': 'Off',
  'regie.camera.torch.on': 'On',

  'regie.camera.zoom.label': 'Zoom',
  'regie.camera.zoom.value': '{value}×',
} as const satisfies Namespace<'regie.camera'>;
