import type { Namespace } from '../../types';

/**
 * The paired station of a phone or laptop: the connection line, the blocked and replaced screens, banners, the phone
 * and laptop pages, the tally frame, the message from the Regie and the errors of a refused action.
 */
export const senderStation = {
  'sender.station.banner.offline':
    'Offline: no network connection. StudioFlow reconnects by itself as soon as the network is back.',
  'sender.station.banner.paired':
    'Paired. The camera is starting and the control room can see the picture now.',
  'sender.station.banner.pairedAs':
    'Paired as {code}. The camera is starting and the control room can see the picture now.',
  'sender.station.banner.reload': 'Reload now',
  'sender.station.banner.unreachable': 'The server is not reachable. StudioFlow keeps trying.',
  'sender.station.banner.update': 'New version ready – reload after the broadcast',

  'sender.station.blocked.hint':
    'StudioFlow checks every 15 seconds whether the device has been unblocked.',
  'sender.station.blocked.text':
    'The control room has blocked this device. Camera and screen are off. As soon as the control room unblocks it, this page carries on by itself.',
  'sender.station.blocked.title': 'This device is blocked',

  'sender.station.connection.blocked': 'Blocked',
  'sender.station.connection.connected': 'Connected',
  'sender.station.connection.connecting': 'Connecting…',
  'sender.station.connection.offline': 'Offline',
  'sender.station.connection.reconnecting': 'Reconnecting…',
  'sender.station.connection.removed': 'No longer paired',
  'sender.station.connection.replaced': 'Opened in another tab',

  'sender.station.error.cameraLimit': 'This device already has a camera.',
  'sender.station.error.phoneCamera':
    'The camera of a phone cannot be removed. The control room can remove the whole device.',
  'sender.station.error.phoneScreen':
    'A phone cannot share a screen. Please pair a laptop for that.',
  'sender.station.error.screenLimit': 'At most {max} screens are possible per device.',
  'sender.station.error.screenMoved': 'Please click “Share screen” again for “Screen {number}”.',

  'sender.station.laptop.addCamera': 'Add camera',
  'sender.station.laptop.addScreen': '+ Another screen',
  'sender.station.laptop.later': 'Later',
  'sender.station.laptop.noScreenShare':
    'Sharing the screen only works on laptops and desktop browsers. On this device you can send the camera.',
  'sender.station.laptop.paired': 'Paired',
  'sender.station.laptop.pairedLead':
    '“{name}” is connected to the control room. Next time StudioFlow will recognise this laptop.',
  'sender.station.laptop.pairedWith': 'Paired with “{production}”.',
  'sender.station.laptop.reshare': 'The control room asks you to share the screen again',
  'sender.station.laptop.shareAgain': 'Share again',
  'sender.station.laptop.shareScreen': 'Share screen',
  'sender.station.laptop.sources': 'Sources of this laptop',
  'sender.station.laptop.startCamera': 'Start camera',
  'sender.station.laptop.stopCamera': 'Stop camera',
  'sender.station.laptop.stopSharing': 'Stop sharing',
  'sender.station.laptop.tryAgain': 'Try again',

  'sender.station.message.title': 'Message from the control room',

  'sender.station.remote.adjusted': 'The control room adjusted the camera',
  'sender.station.remote.lens': 'The control room switched the lens',
  'sender.station.remote.refused': 'The camera could not apply the change from the control room',
  'sender.station.remote.reset': 'The control room set the camera back to automatic',
  'sender.station.remote.zoom': 'The control room zoomed: {zoom}×',

  'sender.station.phone.back': 'Back',
  'sender.station.phone.cameraLegend': 'Camera',
  'sender.station.phone.controls': 'Camera controls',
  'sender.station.phone.dark': 'Dark',
  'sender.station.phone.front': 'Front',
  'sender.station.phone.off': 'The camera is off.',
  'sender.station.phone.previewLabel': 'Camera preview',
  'sender.station.phone.resolutionLegend': 'Resolution',
  'sender.station.phone.start': 'Start camera',
  'sender.station.phone.starting': 'Camera starting…',
  'sender.station.phone.stop': 'Stop camera',
  'sender.station.phone.tapHint': 'Tap for controls',
  'sender.station.phone.tryAgain': 'Try again',

  'sender.station.replaced.takeOver': 'Continue here',
  'sender.station.replaced.text':
    'This station is now running in another tab or window. This tab stays off so the two do not disconnect each other.',
  'sender.station.replaced.title': 'Opened in another tab',

  'sender.station.slot.camera': 'Camera',
  'sender.station.slot.ended': 'Sharing stopped',
  'sender.station.slot.failedCamera': 'Camera failed',
  'sender.station.slot.failedScreen': 'Sharing failed',
  'sender.station.slot.idleCamera': 'Camera is off',
  'sender.station.slot.idleScreen': 'Ready to share',
  'sender.station.slot.liveCamera': 'Camera sending',
  'sender.station.slot.liveScreen': 'Being shared',
  'sender.station.slot.paused': 'Paused, the picture returns shortly',
  'sender.station.slot.screen': 'Screen {number}',
  'sender.station.slot.startingCamera': 'Camera starting…',
  'sender.station.slot.startingScreen': 'Sharing starting…',
  'sender.station.slot.tagNext': 'Up next',

  'sender.station.starting': 'Station starting',

  'sender.station.tally.preview': 'Up next',
  'sender.station.tally.spokenOff': 'Not live.',
  'sender.station.tally.spokenPreview': 'Up next: this device is in Preview.',
  'sender.station.tally.spokenProgram': 'Live: this device is now on Program.',
} as const satisfies Namespace<'sender.station'>;
