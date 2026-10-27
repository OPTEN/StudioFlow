import type { Namespace } from '../../types';

/** Pairing of a phone or laptop with the Regie: the start form, the waiting screen with the check code and the redeem page. */
export const senderPairing = {
  'sender.pairing.redeem.alreadyAgain': 'Pair again',
  'sender.pairing.redeem.alreadyStation': 'Go to the station',
  'sender.pairing.redeem.alreadyText':
    'This device is already paired with the control room. With the new invite it will be paired as a new station.',
  'sender.pairing.redeem.alreadyTitle': 'Already paired',
  'sender.pairing.redeem.expiredLink':
    'This link has expired or was already used. Please have a new one created in the control room.',
  'sender.pairing.redeem.expiredQr':
    'This QR code has expired or was already used. Please have a new one created in the control room.',
  'sender.pairing.redeem.expiredTitle': 'Invite expired',
  'sender.pairing.redeem.failedTitle': 'Pairing did not work',
  'sender.pairing.redeem.pairWithCode': 'Pair with a check code',
  'sender.pairing.redeem.pairingStatus':
    'One moment, the device is signing in to the control room.',
  'sender.pairing.redeem.pairingTitle': 'Pairing…',
  'sender.pairing.redeem.retry': 'Try again',

  'sender.pairing.start.foot':
    'Scanning the QR code from the control room is even faster: just use the camera app of your phone.',
  'sender.pairing.start.kindAudioStation': 'Audio station (mixing desk)',
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

  'sender.pairing.waiting.again': 'New request',
  'sender.pairing.waiting.approvedLead': 'The station is starting…',
  'sender.pairing.waiting.approvedTitle': 'Paired',
  'sender.pairing.waiting.codeCaption': 'Check code for the control room',
  'sender.pairing.waiting.deniedText':
    'The control room denied the request from “{name}”. Ask in the control room and try again.',
  'sender.pairing.waiting.deniedTitle': 'Request denied',
  'sender.pairing.waiting.expiredText':
    'The control room did not approve the request in time. A new request gets a new check code.',
  'sender.pairing.waiting.expiredTitle': 'Request expired',
  'sender.pairing.waiting.expiry': 'Valid for another {time} min.',
  'sender.pairing.waiting.lead':
    'The control room sees “{name}” with this code. If it matches on both screens, it approves the device.',
  'sender.pairing.waiting.statusTrouble': 'No connection to the server – trying again…',
  'sender.pairing.waiting.statusWaiting': 'Waiting for the control room…',
  'sender.pairing.waiting.title': 'Waiting for approval',
} as const satisfies Namespace<'sender.pairing'>;
