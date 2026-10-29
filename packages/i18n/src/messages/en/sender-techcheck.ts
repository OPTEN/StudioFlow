import type { Namespace } from '../../types';

/**
 * The tech check sheet of the sender: camera, network and upload as lamps with a verdict and advice, and what this
 * device is (name, production, version, language).
 */
export const senderTechcheck = {
  'sender.techcheck.advice.bandwidth': 'Stop other uploads and video calls on this network.',
  'sender.techcheck.advice.camera': 'Check the camera: the station says what is wrong.',
  'sender.techcheck.advice.network': 'Move closer to the Wi-Fi router, or use a cable.',
  'sender.techcheck.again': 'Check again',
  'sender.techcheck.busy': 'Checking…',
  'sender.techcheck.checkedAt': 'Checked at {time}',
  'sender.techcheck.close': 'Close tech check',
  'sender.techcheck.device': 'This device',
  'sender.techcheck.device.name': 'Name',
  'sender.techcheck.device.production': 'Production',
  'sender.techcheck.device.version': 'App version',
  'sender.techcheck.level.bad': 'insufficient',
  'sender.techcheck.level.ok': 'good',
  'sender.techcheck.level.unknown': 'not checked',
  'sender.techcheck.level.warn': 'limited',
  'sender.techcheck.open': 'Tech check',
  'sender.techcheck.row.bandwidth': 'Upload',
  'sender.techcheck.row.camera': 'Camera',
  'sender.techcheck.row.network': 'Network',
  'sender.techcheck.run': 'Check now',
  'sender.techcheck.running': 'Checking camera, network and upload…',
  'sender.techcheck.summary.bad': 'This will cause problems in the broadcast.',
  'sender.techcheck.summary.ok': 'Everything is ready for the broadcast.',
  'sender.techcheck.summary.unknown': 'Not checked yet.',
  'sender.techcheck.summary.warn': 'It works, but with limitations.',
  'sender.techcheck.tab.check': 'Check',
  'sender.techcheck.tab.label': 'Parts of the tech check',
  'sender.techcheck.title': 'Tech check',
} as const satisfies Namespace<'sender.techcheck'>;
