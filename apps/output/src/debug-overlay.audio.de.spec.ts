import { resetLocaleForTests } from '@studioflow/i18n';
import { canvasDto } from '@studioflow/scene-model';
import { formatDebugLines, type DebugAudio, type DebugInfo } from './debug-overlay';

const BASE: DebugInfo = {
  productionName: 'Webinar',
  sceneName: 'Welcome',
  broadcast: 'live',
  revision: 100,
  canvas: canvasDto('widescreen', 'p1080'),
  hubState: 'connected',
  syncStatus: 'live',
  mediaState: 'connected',
  latencyMs: 61.6,
  rendererFps: 60,
  version: '0.1.0',
  audio: null,
  sources: [],
};

const AUDIO: DebugAudio = {
  state: 'running',
  programDb: -18,
  channels: [
    {
      code: 'A1',
      label: 'Mixing desk',
      audible: true,
      hasSound: true,
      levelDb: -20,
      stats: {
        packetLossPct: 0.2,
        jitterMs: 3.4,
        jitterBufferDelayMs: 41,
        codec: 'opus',
        bitrateKbps: 128,
      },
    },
    { code: 'S1', label: 'Screen', audible: false, hasSound: true, levelDb: null, stats: null },
    { code: 'M1', label: null, audible: true, hasSound: false, levelDb: null, stats: null },
  ],
};

/** The lines after the sources (this info has none), without the version line that comes last. */
function audioLines(audio: DebugAudio | null): string[] {
  return formatDebugLines({ ...BASE, audio }).slice(7, -1);
}

describe('debug panel: audio in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('writes the words and the decimal comma of de-CH', () => {
    expect(audioLines(AUDIO)).toEqual([
      'Ton läuft · Programm −18,0 dBFS',
      'A1 Mixing desk · −20,0 dBFS · hörbar · Verlust 0,2 % · Jitter 3 ms · Puffer 41 ms · opus',
      'S1 Screen · – · still',
      'M1 · – · kein Ton',
    ]);
  });
});
