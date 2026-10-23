import type { Namespace } from '../../types';

/** The tech check sheet of the sender: camera, network and upload as lamps with a verdict. */
export const senderTechcheck = {
  'sender.techcheck.again': 'Check again',
  'sender.techcheck.busy': 'Checking…',
  'sender.techcheck.checkedAt': 'Checked at {time}',
  'sender.techcheck.close': 'Close tech check',
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
  'sender.techcheck.title': 'Tech check',
} as const satisfies Namespace<'sender.techcheck'>;
