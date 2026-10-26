import { resetLocaleForTests } from '@studioflow/i18n';
import { canvasDto } from '@studioflow/scene-model';
import { formatDebugLines, type DebugInfo } from './debug-overlay';

beforeEach(() => resetLocaleForTests('de-CH'));

const INFO: DebugInfo = {
  productionName: 'Webinar',
  sceneName: 'Begrüssung',
  broadcast: 'live',
  revision: 100,
  canvas: canvasDto('square', 'p720'),
  hubState: 'reconnecting',
  syncStatus: 'offline',
  mediaState: null,
  latencyMs: 61.6,
  rendererFps: 60,
  sources: [
    {
      code: 'K1',
      label: 'Handy Lea',
      availability: 'pending',
      stats: {
        width: 1920,
        height: 1080,
        fps: 30,
        bitrateKbps: 2800,
        packetLossPct: 0.25,
        jitterBufferDelayMs: 48.4,
      },
    },
  ],
};

describe('formatDebugLines in German', () => {
  it('writes the words and the decimal comma of de-CH', () => {
    expect(formatDebugLines(INFO)).toEqual([
      'Webinar · Szene «Begrüssung»',
      'Revision 100 · Sendung live',
      'Leinwand 720 × 720 · 1:1 · 720p',
      'Hub verbindet neu · Sync offline, letzter Stand',
      'LiveKit lädt …',
      'Latenz ≈ 62 ms · Renderer 60 fps',
      'K1 Handy Lea · 1920×1080 · 30 fps · 2,8 Mbit/s · Verlust 0,3 % · Puffer 48 ms · kein Bild',
    ]);
  });

  it('names a missing scene and production', () => {
    const lines = formatDebugLines({ ...INFO, productionName: null, sceneName: null, sources: [] });
    expect(lines[0]).toBe('Produktion unbekannt · keine Szene');
    expect(lines.at(-1)).toBe('Keine Kamera- oder Screen-Quelle im Bild');
  });
});
