import { resetLocaleForTests } from '@studioflow/i18n';
import { canvasDto } from '@studioflow/scene-model';
import { formatDebugLines, formatDebugSections, type DebugInfo } from './debug-overlay';

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
  version: '0.1.0+1a2b3c4',
  audio: null,
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
      'Server verbindet neu · Daten offline, letzter bekannter Stand',
      'Medienserver lädt …',
      'Latenz ≈ 62 ms · Bild 60 fps',
      'K1 Handy Lea · 1920×1080 · 30 fps · 2,8 Mbit/s · Verlust 0,3 % · Puffer 48 ms · kein Bild',
      'StudioFlow 0.1.0+1a2b3c4',
    ]);
  });

  it('names the decoder', () => {
    const [software, hardware] = formatDebugLines({
      ...INFO,
      sources: [
        {
          code: 'K1',
          label: null,
          availability: 'live',
          stats: { width: 1280, height: 720, decoder: 'software' },
        },
        {
          code: 'S1',
          label: null,
          availability: 'live',
          stats: { width: 1280, height: 720, decoder: 'hardware' },
        },
      ],
    }).slice(6);
    expect(software).toContain('Software-Decodierung');
    expect(hardware).toContain('Hardware-Decodierung');
  });

  it('writes the headings of the sections', () => {
    expect(formatDebugSections(INFO).map((section) => section.heading)).toEqual([
      'Program',
      'Verbindungen',
      'Quellen',
      null,
    ]);
  });

  it('names a missing scene and production', () => {
    const lines = formatDebugLines({ ...INFO, productionName: null, sceneName: null, sources: [] });
    expect(lines[0]).toBe('Produktion unbekannt · keine Szene');
    expect(lines.at(-2)).toBe('Keine Kamera- oder Screen-Quelle im Bild');
    expect(lines.at(-1)).toBe('StudioFlow 0.1.0+1a2b3c4');
  });
});
