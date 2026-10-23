import type { Namespace } from '../../types';

/** Pairing of a phone or laptop with the Regie. The start screen is seeded by the foundation; the sender work continues here. */
export const senderPairing = {
  'sender.pairing.start.foot':
    'Scanning the QR code from the control room is even faster: just use the camera app of your phone.',
  'sender.pairing.start.kindLaptop': 'Laptop (screen)',
  'sender.pairing.start.kindLegend': 'What does this device send?',
  'sender.pairing.start.kindPhone': 'Phone (camera)',
  'sender.pairing.start.lead':
    'Give this device a name. The control room sees it together with a check code and approves the device.',
  'sender.pairing.start.nameExample': 'For example “Laptop Anna” or “Phone stage left”.',
  'sender.pairing.start.nameLabel': 'Device name',
  'sender.pairing.start.nameRequired': 'Please enter a name.',
  'sender.pairing.start.nameTooLong': 'At most {max} characters.',
  'sender.pairing.start.noScreenShare':
    'Sharing the screen only works on laptops and desktop browsers. On this device you can send the camera.',
  'sender.pairing.start.submit': 'Continue',
  'sender.pairing.start.submitting': 'Sending…',
  'sender.pairing.start.title': 'Pair device',
} as const satisfies Namespace<'sender.pairing'>;
