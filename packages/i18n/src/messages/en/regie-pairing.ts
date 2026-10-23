import type { Namespace } from '../../types';

/** The "Pair device" dock: tabs, knock cards, invite links and the toasts of the pairing commands. */
export const regiePairing = {
  'regie.pairing.dock.close': 'Close pair device',
  'regie.pairing.dock.tabs': 'Type of device',
  'regie.pairing.dock.tipsText':
    'Connect it to the charging cable and mount it in landscape. StudioFlow keeps the screen awake by itself and restarts with the last settings after a reload.',
  'regie.pairing.dock.tipsTitle': 'Tips for permanently mounted phones',

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
  'regie.pairing.knock.question': 'Does the laptop show the same check code? Then allow.',
  'regie.pairing.knock.title': '{name} wants to join',

  'regie.pairing.laptop.enterName':
    'Enter a name there. The request appears on the right with a check code.',
  'regie.pairing.laptop.miniBar': 'This is what the laptop shows',
  'regie.pairing.laptop.miniCode': 'Check code for the control room',
  'regie.pairing.laptop.miniName': 'Laptop name',
  'regie.pairing.laptop.open': 'Open this address in the browser on the laptop:',
  'regie.pairing.laptop.title': 'Laptop without a QR code',

  'regie.pairing.link.create': 'Create link',
  'regie.pairing.link.createAnother': 'Create another link',
  'regie.pairing.link.gone': 'This link is no longer valid.',
  'regie.pairing.link.open': 'Open invites',
  'regie.pairing.link.revoke': 'Revoke link',
  'regie.pairing.link.revokeInvite': 'Revoke invite: {url}',
  'regie.pairing.link.revokeShort': 'Revoke',
  'regie.pairing.link.text':
    'For laptops that should be paired before the webinar. Send the link by Teams or email.',
  'regie.pairing.link.title': 'Invite link',
  'regie.pairing.link.toastCreated': 'Invite link created',
  'regie.pairing.link.toastRevoked': 'Invite link revoked',
  'regie.pairing.link.validity':
    'Valid once and {expiry}. Whoever opens it is paired straight away.',

  'regie.pairing.phone.generating': 'Generating QR code…',
  'regie.pairing.phone.qrLabel': 'QR code for pairing a phone',
  'regie.pairing.phone.renew': 'Generate new code',
  'regie.pairing.phone.text':
    'Scan with the camera app. The phone opens StudioFlow and then appears under Stations.',
  'regie.pairing.phone.title': 'Phone as a camera',
  'regie.pairing.phone.toastRenewed': 'New QR code, the old one is no longer valid',
  'regie.pairing.phone.valid': 'Valid once, {time} min left.',

  'regie.pairing.requests.empty':
    'No request yet. As soon as someone opens the address and enters a name, it appears here with a check code.',
  'regie.pairing.requests.title': 'Waiting requests',

  'regie.pairing.tab.laptop': 'Laptop',
  'regie.pairing.tab.link': 'Link',
  'regie.pairing.tab.phone': 'Phone',

  'regie.pairing.toast.denied': 'Request from {name} denied',
  'regie.pairing.toast.gone': 'This request has expired or was already answered.',
  'regie.pairing.toast.paired': '{name} is paired',
  'regie.pairing.toast.pairedAs': '{name} is paired and arrives as {code}',
} as const satisfies Namespace<'regie.pairing'>;
