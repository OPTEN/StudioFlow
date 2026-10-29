import type { Namespace } from '../../types';

/**
 * The audio mixer of the Regie (issue #7): the Audio dock with one row per channel (meter, fader, mute, mode, sync
 * offset, listen), the headphones popover, the program level next to Take, the history of mixer changes and the warning
 * that the output page cannot play sound.
 */
export const regieAudio = {
  'regie.audio.dock.emptyText':
    'Add the audio station of the mixing desk with “Add device”, share a screen with sound or upload a video with sound.',
  'regie.audio.dock.emptyTitle': 'No sound sources yet',
  'regie.audio.dock.headphones': 'Headphones',
  'regie.audio.dock.headphonesOn': 'Headphones: {what}',
  'regie.audio.dock.loadingTitle': 'Loading audio…',
  'regie.audio.dock.redo': 'Redo mixer change',
  'regie.audio.dock.shortcut': 'Select a channel and press M to mute it.',
  'regie.audio.dock.suspended': 'The meters start with your first click on this page.',
  'regie.audio.dock.undo': 'Undo mixer change',
  'regie.audio.dock.unavailable': 'This browser has no Web Audio, so there are no meters.',

  'regie.audio.history.nothingToRedo': 'Nothing to redo in the mixer',
  'regie.audio.history.nothingToUndo': 'Nothing to undo in the mixer',
  'regie.audio.history.redone': 'Mixer change redone',
  'regie.audio.history.undone': 'Mixer change undone',

  'regie.audio.mode.always': 'Always',
  'regie.audio.mode.alwaysHint': 'Audible whenever the broadcast is live',
  'regie.audio.mode.follow': 'Follows the picture',
  'regie.audio.mode.followHint': 'Audible while its picture is in the Program',
  'regie.audio.mode.off': 'Off',
  'regie.audio.mode.offHint': 'Never audible',

  'regie.audio.menu.listen': 'Listen',
  'regie.audio.menu.mode': 'Mode: {mode}',
  'regie.audio.menu.mute': 'Mute',

  'regie.audio.monitor.channel': 'Listening to {name}',
  'regie.audio.monitor.choice': 'What you hear',
  'regie.audio.monitor.device': 'Output device',
  'regie.audio.monitor.deviceDefault': 'Default output',
  'regie.audio.monitor.deviceFailed': 'The output device could not be used.',
  'regie.audio.monitor.deviceNamed': 'Output {number}',
  'regie.audio.monitor.deviceUnsupported':
    'This browser plays the headphones on the default output only.',
  'regie.audio.monitor.hint':
    'Use headphones: the program on speakers feeds back into the microphones.',
  'regie.audio.monitor.off': 'Off',
  'regie.audio.monitor.offNote': 'Nothing plays in this browser now.',
  'regie.audio.monitor.program': 'Program',
  'regie.audio.monitor.stop': 'Stop listening',
  'regie.audio.monitor.title': 'Headphones',

  'regie.audio.output.blocked': 'Audio blocked',
  'regie.audio.output.blockedHint':
    'The output page cannot play sound yet. Click the output page once, or allow autoplay for it.',

  'regie.audio.program.label': 'Audio',
  'regie.audio.program.title': 'Level of the program sound',

  'regie.audio.role.microphone': 'Microphone',
  'regie.audio.role.screen': 'Screen sound',
  'regie.audio.role.station': 'Audio station',
  'regie.audio.role.video': 'Video sound',

  'regie.audio.row.details': 'Mode and sync offset of {name}',
  'regie.audio.row.fader': 'Level of {name}',
  'regie.audio.row.faderText': '{value} dB',
  'regie.audio.row.group': 'Audio channel {name}',
  'regie.audio.row.listen': 'Listen to {name}',
  'regie.audio.row.listenHint':
    'Listen to {name} in your headphones, before the fader and mute. Nothing changes on air.',
  'regie.audio.row.live': 'Live',
  'regie.audio.row.liveHint': 'Audible on air now',
  'regie.audio.row.mode': 'Mode',
  'regie.audio.row.muteHint': 'Mute {name} (key M)',
  'regie.audio.row.muteName': 'Mute {name}',
  'regie.audio.row.reset': 'Reset level to 0 dB',
  'regie.audio.row.resetHint': 'Double-click for 0 dB',
  'regie.audio.row.sync': 'Sync offset',
  'regie.audio.row.syncHint': 'Delays the sound to match a picture that arrives later (0–500 ms).',
  'regie.audio.row.syncUnit': 'ms',
  'regie.audio.row.unmuteHint': 'Unmute {name} (key M)',

  'regie.audio.state.muted': 'muted',
  'regie.audio.state.noSound': 'not sending',
  'regie.audio.state.silent': 'silent for 10 s',
} as const satisfies Namespace<'regie.audio'>;
