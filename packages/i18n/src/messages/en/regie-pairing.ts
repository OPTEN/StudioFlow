import type { Namespace } from '../../types';

/** The "Add device" dock: tabs, steps, knock cards, invite links and the toasts of the pairing commands. */
export const regiePairing = {
  'regie.pairing.dock.close': 'Close add device',
  'regie.pairing.dock.tabs': 'Type of device',
  'regie.pairing.dock.tipsText':
    'Plug it into the charger and mount it in landscape. StudioFlow keeps the screen awake and comes back with the last settings after a reload.',
  'regie.pairing.dock.tipsTitle': 'Tips for permanently mounted phones',
  'regie.pairing.dock.title': 'Add device',

  'regie.pairing.expiry.expired': 'expired',
  'regie.pairing.expiry.minutes': {
    one: 'expires in {count} minute',
    other: 'expires in {count} minutes',
  },
  'regie.pairing.expiry.soon': 'expires shortly',

  'regie.pairing.knock.allow': 'Allow',
  'regie.pairing.knock.codeLabel': 'Check code {digits}',
  'regie.pairing.knock.deny': 'Deny',
  'regie.pairing.knock.label': 'Pairing request',
  'regie.pairing.knock.question': 'Same code on the device?',
  'regie.pairing.knock.title': '{name} wants to join',

  'regie.pairing.laptop.step1': 'On the laptop, open this address in the browser:',
  'regie.pairing.laptop.step2':
    'Enter a name there. For the sound of the mixing desk, choose “Audio station”.',
  'regie.pairing.laptop.step3':
    'The request appears here with a check code. Allow it when the device shows the same code.',
  'regie.pairing.laptop.title': 'Laptop or audio station',

  'regie.pairing.link.create': 'Create link',
  'regie.pairing.link.createAnother': 'Create another link',
  'regie.pairing.link.gone': 'This link is no longer valid.',
  'regie.pairing.link.open': 'Open invites',
  'regie.pairing.link.revoke': 'Revoke link',
  'regie.pairing.link.revokeInvite': 'Revoke invite: {url}',
  'regie.pairing.link.revokeShort': 'Revoke',
  'regie.pairing.link.show': 'Show link',
  'regie.pairing.link.showHint':
    'The links are hidden so that nobody copies them off a shared screen.',
  'regie.pairing.link.text':
    'For laptops that are paired before the webinar. Send the link by Teams or email.',
  'regie.pairing.link.title': 'Invite link',
  'regie.pairing.link.toastCreated': 'Invite link created',
  'regie.pairing.link.toastRevoked': 'Invite link revoked',
  'regie.pairing.link.validity':
    'Valid once and {expiry}. Whoever opens it is paired straight away.',

  'regie.pairing.phone.generating': 'Generating QR code…',
  'regie.pairing.phone.qrLabel': 'QR code for pairing a phone',
  'regie.pairing.phone.renew': 'Generate new code',
  'regie.pairing.phone.step1': 'Open the camera app on the phone.',
  'regie.pairing.phone.step2': 'Scan this code. StudioFlow opens in the browser.',
  'regie.pairing.phone.step3': 'Allow the camera. The phone then appears under Devices.',
  'regie.pairing.phone.title': 'Phone as a camera',
  'regie.pairing.phone.toastRenewed': 'New QR code, the old one is no longer valid',
  'regie.pairing.phone.valid': 'Valid once, {time} left.',

  'regie.pairing.requests.empty':
    'No request yet. When someone opens the address and enters a name, the request appears here with a check code.',
  'regie.pairing.requests.title': 'Waiting requests',

  'regie.pairing.tab.laptop': 'Laptop',
  'regie.pairing.tab.link': 'Link',
  'regie.pairing.tab.phone': 'Phone',

  'regie.pairing.toast.denied': 'Request from {name} denied',
  'regie.pairing.toast.gone': 'This request has expired or was already answered.',
  'regie.pairing.toast.paired': '{name} is paired',
  'regie.pairing.toast.pairedAs': '{name} is paired and arrives as {code}',
} as const satisfies Namespace<'regie.pairing'>;
