import type { Namespace } from '../../types';

/**
 * The paired station of a phone or laptop: the connection line, the blocked and replaced screens, banners, the phone
 * and laptop pages, the tally frame, the message from the Regie and the errors of a refused action.
 */
export const senderStation = {
  'sender.station.banner.broken': 'This version has a problem. Reload the page to carry on.',
  'sender.station.banner.offline':
    'Offline: no network connection. StudioFlow reconnects by itself as soon as the network is back.',
  'sender.station.banner.paired':
    'Paired. The control room sees the picture as soon as the camera runs.',
  'sender.station.banner.pairedAs':
    'Paired as {code}. The control room sees the picture as soon as the camera runs.',
  'sender.station.banner.pairedComputer':
    'Paired. Next time StudioFlow recognises this computer by itself.',
  'sender.station.banner.reload': 'Reload now…',
  'sender.station.banner.reloadConfirm':
    'Reloading interrupts the camera, the sound and screen sharing for a few seconds.',
  'sender.station.banner.reloadNow': 'Reload',
  'sender.station.banner.unreachable': 'The server is not reachable. StudioFlow keeps trying.',
  'sender.station.banner.update':
    'A new version is ready. It installs by itself after the broadcast.',

  'sender.station.blocked.next':
    'Ask the person in the control room to unblock it. This page carries on by itself as soon as they do.',
  'sender.station.blocked.text':
    'The control room has blocked this device. Camera, screen and sound are off.',
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
  'sender.station.laptop.addScreen': 'Share another screen',
  'sender.station.laptop.addScreenWait': 'Share the screen that is ready first.',
  'sender.station.laptop.later': 'Not now',
  'sender.station.laptop.more': 'More for {name}',
  'sender.station.laptop.noScreenShare':
    'This browser cannot share a screen. Open this page in Chrome, Edge or Firefox on a laptop.',
  'sender.station.laptop.pairedWith': 'Paired with “{production}”.',
  'sender.station.laptop.remove': 'Remove from the control room…',
  'sender.station.laptop.removeConfirm':
    '{name} disappears from the control room and from every scene that shows it.',
  'sender.station.laptop.removeTitle': 'Remove {name}?',
  'sender.station.laptop.reshare': 'The control room asks you to share this screen again',
  'sender.station.laptop.shareAgain': 'Share again',
  'sender.station.laptop.shareScreen': 'Share screen',
  'sender.station.laptop.smooth': 'Smooth motion',
  'sender.station.laptop.smoothHint': 'For videos: 30 instead of 15 frames per second.',
  'sender.station.laptop.sources': 'What this laptop sends',
  'sender.station.laptop.startCamera': 'Start camera',
  'sender.station.laptop.stopCamera': 'Stop camera',
  'sender.station.laptop.stopLive':
    '{name} is live. Stopping it cuts its picture in the broadcast.',
  'sender.station.laptop.stopSharing': 'Stop sharing',
  'sender.station.laptop.stopTitle': 'Stop {name} while live?',
  'sender.station.laptop.tryAgain': 'Try again',
  'sender.station.laptop.videoHint':
    'Smooth motion: 30 frames per second for a video in this screen. This needs more computing power.',

  'sender.station.message.dismiss': 'Dismiss',
  'sender.station.message.title': 'Message from the control room',

  'sender.station.remote.adjusted': 'The control room adjusted the camera',
  'sender.station.remote.lens': 'The control room switched the lens',
  'sender.station.remote.refused': 'The camera could not apply the change from the control room',
  'sender.station.remote.reset': 'The control room set the camera back to automatic',
  'sender.station.remote.zoom': 'The control room zoomed: {zoom}×',

  'sender.station.phone.back': 'Back camera',
  'sender.station.phone.controls': 'Camera controls',
  'sender.station.phone.done': 'Done',
  'sender.station.phone.front': 'Front camera',
  'sender.station.phone.off': 'The camera is off.',
  'sender.station.phone.offHint': 'Start it once the phone is in place.',
  'sender.station.phone.previewLabel': 'Camera preview',
  'sender.station.phone.quality': 'Quality',
  'sender.station.phone.qualityHigh': 'High',
  'sender.station.phone.qualityHighHint': '1080p. Sharper; needs a good Wi-Fi and more battery.',
  'sender.station.phone.qualityLive':
    'You are live: the picture pauses for a moment when the quality changes.',
  'sender.station.phone.qualityName': 'Picture quality: {quality}',
  'sender.station.phone.qualityStandard': 'Standard',
  'sender.station.phone.qualityStandardHint': '720p. Works well on most Wi-Fi networks.',
  'sender.station.phone.qualityTitle': 'Picture quality',
  'sender.station.phone.screenOff': 'Screen off',
  'sender.station.phone.screenOffHint': 'The camera keeps sending.',
  'sender.station.phone.start': 'Start camera',
  'sender.station.phone.starting': 'Camera starting…',
  'sender.station.phone.stop': 'Stop camera',
  'sender.station.phone.stopConfirm':
    'The control room is showing this camera right now. Stopping it cuts the picture in the broadcast.',
  'sender.station.phone.stopTitle': 'Stop the camera while live?',
  'sender.station.phone.switch': 'Switch camera',
  'sender.station.phone.switchConfirm':
    'The broadcast shows the other camera at once. A zoom set by the control room is reset.',
  'sender.station.phone.switchTitle': 'Switch the camera while live?',
  'sender.station.phone.tapHint': 'Tap to show the controls',
  'sender.station.phone.tryAgain': 'Try again',

  'sender.station.replaced.takeOver': 'Continue here',
  'sender.station.replaced.takeOverHint': 'The other tab then stops sending.',
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

  'sender.station.starting': 'Station starting',
  'sender.station.startingSlow':
    'This takes longer than usual. Check the Wi-Fi; StudioFlow keeps trying.',

  'sender.station.tab.message': 'Message',

  'sender.station.tally.live': 'Live',
  'sender.station.tally.preview': 'Preview',
  'sender.station.tally.previewHint': 'The control room has this picture ready to go live next.',
  'sender.station.tally.spokenOff': 'Not live.',
  'sender.station.tally.spokenPreview': 'Preview: this device is ready to go live next.',
  'sender.station.tally.spokenProgram': 'Live: this device is now on Program.',
} as const satisfies Namespace<'sender.station'>;
