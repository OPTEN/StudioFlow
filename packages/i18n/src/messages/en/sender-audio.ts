import type { Namespace } from '../../types';

/**
 * Sound on the sender: the microphone of a phone or laptop, the audio station for the mixing desk, and the sound of a
 * shared screen.
 */
export const senderAudio = {
  'sender.audio.add': 'Add microphone',

  'sender.audio.error.micLimit': 'This device already has a microphone.',

  'sender.audio.input': 'Audio input',
  'sender.audio.input.default': 'Default input',
  'sender.audio.input.unnamed': 'Input {number}',

  'sender.audio.level': 'Input level',
  'sender.audio.level.silent': '−∞ dB',
  'sender.audio.level.value': '{db} dB',

  'sender.audio.live': 'Mic live',
  'sender.audio.liveSpoken': 'The microphone is live in the program.',

  'sender.audio.note.station':
    'Stereo, sent as it comes: echo cancellation, noise suppression and automatic gain are off.',
  'sender.audio.note.voice': 'The browser reduces echo and background noise.',

  'sender.audio.phone.off': 'Microphone off',
  'sender.audio.phone.on': 'Microphone on',

  'sender.audio.silent':
    'No signal for a while. Check the cable and the output of the mixing desk, or the chosen input.',
  'sender.audio.silentVoice':
    'No sound for a while. Is the microphone muted or the wrong input chosen?',

  'sender.audio.start': 'Switch microphone on',
  'sender.audio.stop': 'Switch microphone off',

  'sender.audio.state.ended': 'Switched off',
  'sender.audio.state.failed': 'Not working',
  'sender.audio.state.idle': 'Off',
  'sender.audio.state.live': 'Sending',
  'sender.audio.state.paused': 'Paused',
  'sender.audio.state.starting': 'Starting …',

  'sender.audio.station.hint':
    'Connect the output of the mixing desk to an input of this computer and choose that input below. The sound starts by itself whenever this page is open and the control room lets it through.',
  'sender.audio.station.lead': '“{name}” sends the sound of the mixing desk to the control room.',
  'sender.audio.station.title': 'Sound from the mixing desk',

  'sender.audio.title': 'Microphone',

  'sender.audio.screen.explain':
    'Chrome and Edge on Windows can share the sound of the whole computer when you share the entire screen. Elsewhere only the sound of a shared browser tab can be shared: tick “Also share tab audio” in the dialog. Firefox and Safari share no sound.',
  'sender.audio.screen.label': 'Share audio',
  'sender.audio.screen.noSound':
    'No sound is shared with this screen. Share again and tick the sound option in the browser dialog. It is offered for a browser tab, and for an entire screen on Windows.',
  'sender.audio.screen.withSound': 'with sound',
} as const satisfies Namespace<'sender.audio'>;
