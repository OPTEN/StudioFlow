import type { Namespace } from '../../types';

/** Pairing of a phone or laptop with the Regie: the start form, the waiting screen with the check code and the redeem page. */
export const senderPairing = {
  'sender.pairing.redeem.alreadyAgain': 'Pair again…',
  'sender.pairing.redeem.alreadyConfirm':
    'Pairing again removes this device from the control room, with its sources and their places in the scenes. The new invite then pairs it as a new device.',
  'sender.pairing.redeem.alreadyConfirmAction': 'Pair again',
  'sender.pairing.redeem.alreadyStation': 'Go to the station',
  'sender.pairing.redeem.alreadyText':
    'This device is already paired with the control room. Carry on with it, or pair it again with the new invite.',
  'sender.pairing.redeem.alreadyTitle': 'Already paired',
  'sender.pairing.redeem.expiredLink':
    'This link has expired or was already used. Ask the control room for a new link, or pair with a check code.',
  'sender.pairing.redeem.expiredQr':
    'This QR code has expired or was already used. Ask the control room to show a new one, then scan it with the camera app.',
  'sender.pairing.redeem.expiredTitle': 'Invite expired',
  'sender.pairing.redeem.failedTitle': 'Pairing did not work',
  'sender.pairing.redeem.pairWithCode': 'Pair with a check code',
  'sender.pairing.redeem.pairingSlow':
    'The server does not answer yet. StudioFlow keeps trying for about a minute.',
  'sender.pairing.redeem.pairingStatus':
    'One moment, the device is signing in to the control room.',
  'sender.pairing.redeem.pairingTitle': 'Pairing…',
  'sender.pairing.redeem.retry': 'Try again',

  'sender.pairing.start.codeTitle': 'No QR code? Pair with a check code',
  'sender.pairing.start.insecure':
    'This page was not opened over a secure connection, so the browser blocks camera, microphone and screen sharing. Open the address that starts with https.',
  'sender.pairing.start.kindAudioStation': 'Audio station',
  'sender.pairing.start.kindAudioStationHint': 'Sends the sound of the mixing desk.',
  'sender.pairing.start.kindLaptop': 'Laptop screen',
  'sender.pairing.start.kindLaptopHint': 'Shares screens, and a camera or microphone if you like.',
  'sender.pairing.start.kindLegend': 'What does this device send?',
  'sender.pairing.start.kindPhone': 'Phone camera',
  'sender.pairing.start.kindPhoneHint': 'Films with its camera, for a phone on a stand.',
  'sender.pairing.start.lead':
    'Name this device and choose what it sends. Someone in the control room then approves it with a check code.',
  'sender.pairing.start.nameExample': 'For example “Laptop Anna” or “Phone stage left”.',
  'sender.pairing.start.nameLabel': 'Device name',
  'sender.pairing.start.nameRequired': 'Please enter a name.',
  'sender.pairing.start.nameTooLong': 'At most {max} characters.',
  'sender.pairing.start.noScreenShare':
    'This browser cannot share a screen. Open this page in Chrome, Edge or Firefox on a laptop, or send the camera of this device.',
  'sender.pairing.start.qrText':
    'Open the camera app of this phone and point it at the code in the Devices panel. The phone then starts as a camera by itself.',
  'sender.pairing.start.qrTitle': 'Scan the QR code shown in the control room',
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
  'sender.pairing.waiting.expiresIn': 'Expires in {time}',
  'sender.pairing.waiting.lead':
    'Tell the control room this code, or check that it matches the one on their screen. They then approve “{name}”.',
  'sender.pairing.waiting.statusTrouble': 'No connection to the server – trying again…',
  'sender.pairing.waiting.statusWaiting': 'Waiting for the control room…',
  'sender.pairing.waiting.title': 'Waiting for approval',
  'sender.pairing.waiting.validUntil': 'Valid until {time}',
} as const satisfies Namespace<'sender.pairing'>;
