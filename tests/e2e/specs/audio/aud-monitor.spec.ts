import type { Locator, Page } from '@playwright/test';
import { sleep } from '../../support/shell';
import { pairViaApi } from '../../support/ui/pairing';
import {
  measureAudio,
  outputTarget,
  unlockSound,
  waitForPeak,
  waitForSilence,
  waitForTone,
} from '../../support/ui/audio';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * AUD monitoring (issue #7, docs/testing.md 2.21): the Regie plays nothing unless the operator listens. PFL plays one
 * channel before its fader and mute (also while the broadcast is not live and while the channel is muted); "Program"
 * plays the mix as the output page does. The Regie page is measured with the audio probe (`uiInit: {audioProbe: true}`).
 */

const STATION_HZ = 440;
const OUTPUT = { audioProbe: true } as const;

test.use({
  locale: 'en-US',
  viewport: { width: 1440, height: 900 },
  uiInit: { audioProbe: true },
});

const audioDock = (page: Page): Locator => page.locator('sf-dock-slot[data-dock="audio"]');
const row = (page: Page, sourceId: string): Locator =>
  audioDock(page).locator(`.c-audio[data-source="${sourceId}"]`);

test.describe('AUD monitoring', () => {
  test(
    'E2E-AUD-14 [regie] monitoring is off after a reload; PFL plays one channel before its fader and mute, even off air; “Program” plays the mix of the output; a reload turns it all off again',
    t.p1,
    async ({ regie, openAudioStation, openOutput, pairContext, production, api }) => {
      test.setTimeout(240_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const device = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const sourceId = device.sourceId('mic');
      const page = regie.page;
      const channel = row(page, sourceId);
      await expect(channel).toBeVisible({ timeout: 15_000 });
      // The first click lets the Regie's audio context start; nothing is played yet.
      await page.mouse.click(3, 3);
      await expect(channel.getByTestId('audio-pfl')).toHaveAttribute('aria-pressed', 'false');
      await sleep(2_000);
      const idle = await measureAudio(page);
      expect(idle === null || idle.peakDb < -60, `the Regie plays nothing by default (${JSON.stringify(idle)})`).toBe(true);

      // PFL: the channel is heard before the broadcast is live (it is not audible on air), at its own level.
      await channel.getByTestId('audio-pfl').click();
      await expect(channel.getByTestId('audio-pfl')).toHaveAttribute('aria-pressed', 'true');
      await waitForTone(page, STATION_HZ);
      await waitForPeak(page, -6);
      await expect(audioDock(page).getByTestId('audio-monitor'), 'the Headphones button shows that something is being listened to').toHaveClass(/is-active/);
      // Muted and with the fader down it is still heard in PFL: the operator checks the source, not the mix.
      expect((await api.setAudioChannels(production.id, { channels: [{ sourceId, gainDb: -30, muted: true, mode: 'always', syncOffsetMs: 0 }] })).status).toBe(200);
      await sleep(600);
      await waitForPeak(page, -6);
      // Only one channel at a time; the same button stops it.
      await channel.getByTestId('audio-pfl').click();
      await expect(channel.getByTestId('audio-pfl')).toHaveAttribute('aria-pressed', 'false');
      await waitForSilence(page);

      // "Program" plays the mix of the output: silent while the broadcast is not live or the channel is muted ...
      await audioDock(page).getByTestId('audio-monitor').click();
      await page.getByTestId('monitor-program').click();
      await expect(page.getByTestId('monitor-program')).toHaveAttribute('aria-pressed', 'true');
      await sleep(1_000);
      await waitForSilence(page);
      expect((await api.setAudioChannels(production.id, { channels: [{ sourceId, gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 0 }] })).status).toBe(200);
      await api.startBroadcast(production.id);
      // ... and the same as the output page when the broadcast is live.
      await waitForTone(page, STATION_HZ);
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await waitForTone(target, STATION_HZ);
      const [monitored, played] = [await waitForPeak(page, -6), await waitForPeak(target, -6)];
      expect(Math.abs(monitored.peakDb - played.peakDb), 'the monitor is the program').toBeLessThan(3);
      // A mute on air is heard in the monitor as well.
      expect((await api.setAudioChannels(production.id, { channels: [{ sourceId, gainDb: 0, muted: true, mode: 'always', syncOffsetMs: 0 }] })).status).toBe(200);
      await waitForSilence(page);

      // Listening is a thing of this page only: a reload turns it off (headphones are for the person at the desk).
      await page.getByTestId('monitor-off').click();
      await expect(page.getByTestId('monitor-off')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
      await channel.getByTestId('audio-pfl').click();
      await waitForTone(page, STATION_HZ);
      await page.reload();
      await regie.waitReady();
      await page.mouse.click(3, 3);
      await expect(row(page, sourceId).getByTestId('audio-pfl')).toHaveAttribute('aria-pressed', 'false');
      await sleep(1_500);
      const after = await measureAudio(page);
      expect(after === null || after.peakDb < -60, 'after a reload nothing is played').toBe(true);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
