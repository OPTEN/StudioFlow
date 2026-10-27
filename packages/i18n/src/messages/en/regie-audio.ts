import type { Namespace } from '../../types';

/**
 * The audio mixer of the Regie (issue #7): the Audio dock with one row per channel (meter, fader, mute, mode, sync
 * offset, PFL), the monitoring popover, the program level next to Take, the history of mixer changes and the warning
 * that the output page cannot play sound.
 */
export const regieAudio = {
  'regie.audio.dock.emptyText':
    'Pair an audio station or a microphone, share a screen with sound or upload a video with sound.',
  'regie.audio.dock.emptyTitle': 'No sound sources yet.',
  'regie.audio.dock.loadingTitle': 'Loading audio…',
  'regie.audio.dock.monitor': 'Monitor',
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
  'regie.audio.mode.follow': 'With picture',
  'regie.audio.mode.followHint': 'Audible while its picture is in the Program',
  'regie.audio.mode.off': 'Off',
  'regie.audio.mode.offHint': 'Never audible',

  'regie.audio.monitor.channel': 'PFL: {name}',
  'regie.audio.monitor.device': 'Output device',
  'regie.audio.monitor.deviceDefault': 'Default output',
  'regie.audio.monitor.deviceFailed': 'The output device could not be used.',
  'regie.audio.monitor.deviceNamed': 'Output {number}',
  'regie.audio.monitor.deviceUnsupported':
    'This browser plays the monitor on the default output only.',
  'regie.audio.monitor.hint':
    'Monitoring is off. Use headphones: the program on speakers feeds back into microphones.',
  'regie.audio.monitor.off': 'Off',
  'regie.audio.monitor.program': 'Program',
  'regie.audio.monitor.title': 'Monitoring',

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
  'regie.audio.row.mode': 'Mode',
  'regie.audio.row.mute': 'M',
  'regie.audio.row.muteName': 'Mute {name}',
  'regie.audio.row.pfl': 'PFL',
  'regie.audio.row.pflStop': 'Stop listening to {name}',
  'regie.audio.row.pflStart': 'Listen to {name} before the fader',
  'regie.audio.row.resetHint': 'Double-click for 0 dB',
  'regie.audio.row.sync': 'Sync offset',
  'regie.audio.row.syncHint': 'Delays the sound to match a picture that arrives later (0–500 ms).',
  'regie.audio.row.syncUnit': 'ms',
  'regie.audio.row.unmuteName': 'Unmute {name}',

  'regie.audio.state.muted': 'muted',
  'regie.audio.state.noSound': 'no sound',
  'regie.audio.state.silent': 'no signal for 10 s',
} as const satisfies Namespace<'regie.audio'>;
