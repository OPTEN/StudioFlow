import type { Namespace } from '../../types';

/** The Devices dock: rows, details, actions, the message composer and the toasts of the device commands. */
export const regieStations = {
  'regie.stations.ack.dismiss': 'Dismiss',
  'regie.stations.ack.text': 'The device is back.',

  'regie.stations.action.block': 'Block device',
  'regie.stations.action.manage': 'Manage device',
  'regie.stations.action.message': 'Send message',
  'regie.stations.action.reshare': 'Ask to share again',
  'regie.stations.action.reshareCode': 'Ask {code} to share again',
  'regie.stations.action.switchCamera': 'Switch camera',
  'regie.stations.action.technical': 'Technical details',
  'regie.stations.action.unblock': 'Unblock',

  'regie.stations.composer.count': 'Up to {max} characters. The device shows the message as a banner.',
  'regie.stations.composer.label': 'Message to {name}',
  'regie.stations.composer.placeholder': 'Short message to the device',
  'regie.stations.composer.quick': 'Quick send: {text}',
  'regie.stations.composer.quickGroup': 'Quick messages, sent at once',
  'regie.stations.composer.send': 'Send',

  'regie.stations.confirm.blockMessage':
    '{label} will be disconnected immediately and cannot connect again until you unblock it.',
  'regie.stations.confirm.blockNow': 'Block now',
  'regie.stations.confirm.removeLabel': 'Remove device',
  'regie.stations.confirm.removeMessage':
    '“{name}” will be removed. Items with its sources then show “Source missing”. You can pair it again at any time.',

  'regie.stations.detail.battery': 'Battery',
  'regie.stations.detail.charging': '{battery} · charging',
  'regie.stations.detail.device': 'Device',
  'regie.stations.detail.lastSeen': 'Last seen',
  'regie.stations.detail.loss': 'Packet loss',
  'regie.stations.detail.network': 'Network',
  'regie.stations.detail.paired': 'Paired',
  'regie.stations.detail.resolution': 'Resolution',
  'regie.stations.detail.tech': 'Tech check',
  'regie.stations.detail.techNotRun': 'not run yet',

  'regie.stations.dock.add': 'Add device',
  'regie.stations.dock.addFirst': 'Add the first device',
  'regie.stations.dock.emptyText':
    'Add a phone as a camera, a laptop that shares its screen, or the audio station of the mixing desk.',
  'regie.stations.dock.emptyTitle': 'No devices yet',
  'regie.stations.dock.loadingTitle': 'Loading devices…',
  'regie.stations.dock.offline': 'No connection to the server. The buttons work again once it is back.',

  'regie.stations.kind.audioStation': 'Audio station',
  'regie.stations.kind.laptop': 'Laptop',
  'regie.stations.kind.phone': 'Phone',

  'regie.stations.line.back': 'back',
  'regie.stations.line.battery': 'Battery {percent}',
  'regie.stations.line.cannotConnect': 'cannot connect',
  'regie.stations.line.freezeFrame': 'freeze frame',
  'regie.stations.line.lastSeen': 'last seen {time}',
  'regie.stations.line.rateTitle': 'Upload rate',
  'regie.stations.line.rttTitle': 'Delay to the server and back',
  'regie.stations.line.sending': 'sending',
  'regie.stations.line.wasGone': 'was gone {seconds} s',

  'regie.stations.nameHint': 'Enter saves, Esc cancels.',
  'regie.stations.nameLabel': 'Device name',

  'regie.stations.network.cellular': 'Cellular',
  'regie.stations.network.wifi': 'Wi-Fi',

  'regie.stations.offer.text': 'This device can take the place of a missing source:',

  'regie.stations.paired.otherDay': '{day}/{month} {time}',
  'regie.stations.paired.today': 'today {time}',

  'regie.stations.quick.break': 'Break',
  'regie.stations.quick.live': 'Live in 10 s',
  'regie.stations.quick.smile': 'Please smile',

  'regie.stations.tag.live': 'Live',
  'regie.stations.tag.preview': 'Preview',

  'regie.stations.tech.bad': 'poor',
  'regie.stations.tech.camera': 'Camera',
  'regie.stations.tech.network': 'Network',
  'regie.stations.tech.ok': 'ok',
  'regie.stations.tech.upload': 'Upload',
  'regie.stations.tech.warn': 'borderline',

  'regie.stations.toast.blocked': '{label} blocked and disconnected',
  'regie.stations.toast.cameraOffline': '{name} is not connected. The camera stays as it is.',
  'regie.stations.toast.cameraSwitching': '{label}: switching camera',
  'regie.stations.toast.messageLength': 'A message has 1 to {max} characters.',
  'regie.stations.toast.messageOffline': '{name} is not connected. The message will not arrive.',
  'regie.stations.toast.messageSent': 'Message sent to {name}: “{message}”',
  'regie.stations.toast.nameLength': 'The name needs 1 to {max} characters.',
  'regie.stations.toast.removed': '“{name}” removed',
  'regie.stations.toast.reshareOffline':
    '{label} is not connected. Please share again on the device itself.',
  'regie.stations.toast.reshareSent': 'Request sent to {label}: “Share screen again”',
  'regie.stations.toast.unblocked': '{label} unblocked',
} as const satisfies Namespace<'regie.stations'>;
