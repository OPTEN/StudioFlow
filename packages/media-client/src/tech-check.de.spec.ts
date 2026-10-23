import { msg, resetLocaleForTests } from '@studioflow/i18n';
import { platformLabel } from './device-info';
import { runTechCheck, techProblemText } from './tech-check';

beforeEach(() => resetLocaleForTests('de-CH'));

describe('media-client texts in German', () => {
  it('writes the tech check problems with the decimal comma', () => {
    expect(techProblemText(msg('media.techcheck.upload.slow', { rate: 2.8, recommended: 6 }))).toBe(
      'Upload: nur 2,8 Mbit/s (empfohlen ab 6 Mbit/s).',
    );
    expect(techProblemText(msg('media.techcheck.network.unreachable'))).toBe(
      'Netzwerk: Server nicht zuverlässig erreichbar.',
    );
    expect(
      techProblemText(
        msg('media.techcheck.camera.lowResFps', { width: 640, height: 360, fps: 30 }),
      ),
    ).toBe('Kamera: nur 640 × 360 bei 30 fps.');
  });

  it('writes the wire note in English whatever the language of the page', async () => {
    const result = await runTechCheck({
      ping: () => Promise.resolve(200),
      uploadTest: () => Promise.resolve({ serverMs: 1 }),
    });
    expect(result.note).toContain('Network: high latency (200 ms).');
    expect(result.problems.map((problem) => techProblemText(problem))).toContain(
      'Netzwerk: hohe Latenz (200 ms).',
    );
  });

  it('labels an unknown platform in German', () => {
    expect(platformLabel('curl/8.0')).toBe('Unbekannte Plattform');
  });
});
