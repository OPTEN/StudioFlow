import type { Locator, Page } from '@playwright/test';
import { sleep } from '../../support/shell';
import { pairViaApi } from '../../support/ui/pairing';
import {
  measureAudio,
  outputTarget,
  setFakeTone,
  silenceAt,
  unlockSound,
  waitForPeak,
  waitForSilence,
  waitForTone,
} from '../../support/ui/audio';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * AUD in the Regie (issue #7, docs/testing.md 2.21): the Audio dock with a row per channel (meter, fader, mute, mode, sync
 * offset, PFL), the program level above Take, undo and redo of the mixer, the M key, two Regie seats that converge and the
 * silence warning. The output page and the Regie are measured/read; the station is a sine tone (fake-audio.js).
 */

const STATION_HZ = 440;
const OUTPUT = { audioProbe: true } as const;
/** The output page of a person's browser: the audio context waits for the first click. */
const GATED = { audioProbe: true, audioGate: true } as const;

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

const audioDock = (page: Page): Locator => page.locator('sf-dock-slot[data-dock="audio"]');
const row = (page: Page, sourceId: string): Locator =>
  audioDock(page).locator(`.c-audio[data-source="${sourceId}"]`);

/** A click on a quiet spot of the page: the browser lets the Regie's audio context start (a user gesture). */
async function touch(page: Page): Promise<void> {
  await page.mouse.click(3, 3);
}

test.describe('AUD Regie', () => {
  test(
    'E2E-AUD-04 [regie + output] the Audio dock mutes, moves the fader and sets the mode with the mouse and the keyboard; undo and redo, two Regie seats converge, the log says what changed',
    t.p0,
    async ({ regie, openRegie, openAudioStation, openOutput, pairContext, production, api }) => {
      test.setTimeout(240_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const device = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const sourceId = device.sourceId('mic');
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      await waitForTone(target, STATION_HZ);
      await waitForPeak(target, -6);

      const page = regie.page;
      await expect(audioDock(page), 'the Audio dock is in the default arrangement').toBeVisible();
      await expect(audioDock(page).locator('.c-dock-frame__title')).toContainText('Audio');
      const channel = row(page, sourceId);
      await expect(channel).toBeVisible({ timeout: 15_000 });
      await expect(channel.locator('.c-code')).toHaveText('A1');
      await expect(channel.locator('.c-audio__name')).toContainText('Mixing desk');
      await expect(channel.locator('.c-tag--pgm'), 'on air: the channel is audible in the program').toBeVisible();
      await expect(channel.getByTestId('audio-db')).toHaveText('0.0 dB');

      // The meters start with the first click on the page (the browser keeps the audio context suspended until then).
      await touch(page);
      await expect
        .poll(async () => channel.getByTestId('audio-meter').evaluate((el) => (el as HTMLElement).style.transform), {
          message: 'the meter of the station moves',
          timeout: 15_000,
        })
        .not.toMatch(/scaleX\(0(\.0+)?\)/);
      await expect(page.getByTestId('program-meter'), 'the level of the program above Take').toBeVisible();
      await expect(page.getByTestId('program-db')).not.toHaveText('−∞ dB', { timeout: 15_000 });

      // Mute with the mouse: silent on the output, pressed state, the other seat follows.
      const second = await openRegie();
      await expect(row(second.page, sourceId)).toBeVisible({ timeout: 15_000 });
      let silent = silenceAt(target);
      await channel.getByTestId('audio-mute').click();
      await silent;
      await expect(channel.getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'true');
      await expect(
        row(second.page, sourceId).getByTestId('audio-mute'),
        'the second Regie shows the mute without a reload',
      ).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
      await expect(channel.locator('.c-tag--pgm'), 'a muted channel is not on air').toBeHidden();

      // Undo (button) brings the sound back, redo mutes again; the other seat follows both.
      await audioDock(page).getByTestId('audio-undo').click();
      await waitForTone(target, STATION_HZ);
      await expect(channel.getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'false');
      await expect(row(second.page, sourceId).getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
      silent = silenceAt(target);
      await audioDock(page).getByTestId('audio-redo').click();
      await silent;
      await expect(channel.getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'true');

      // The M key mutes the selected channel and unmutes it again (the focus is not in a text field).
      await channel.locator('.c-audio__main').click();
      await page.keyboard.press('m');
      await waitForTone(target, STATION_HZ);
      await expect(channel.getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('m');
      await waitForSilence(target);
      await page.keyboard.press('m');
      await waitForTone(target, STATION_HZ);

      // Fader by keyboard: arrows move it in steps, Home goes to the end of the scale; the dB value follows; double click resets.
      const fader = channel.getByTestId('audio-fader');
      await fader.focus();
      await page.keyboard.press('Home');
      await expect(channel.getByTestId('audio-db')).toHaveText('−∞ dB', { timeout: 5_000 });
      await waitForSilence(target);
      await page.keyboard.press('End');
      await expect(channel.getByTestId('audio-db')).toHaveText(/^\+10\.0 dB$/);
      await waitForPeak(target, 4);
      await fader.dblclick();
      await expect(channel.getByTestId('audio-db')).toHaveText('0.0 dB');
      await waitForPeak(target, -6);
      expect((await production.snapshot()).audioChannels[0], 'the double click reset the fader').toMatchObject({ gainDb: 0, muted: false });

      // Details: the mode and the sync offset. "Off" is never audible; the offset is stored and the other seat sees it.
      await channel.getByTestId('audio-more').click();
      await channel.getByTestId('audio-mode-off').click();
      await waitForSilence(target);
      await expect(channel.getByTestId('audio-mode-off')).toHaveAttribute('aria-pressed', 'true');
      await channel.getByTestId('audio-mode-always').click();
      await waitForTone(target, STATION_HZ);
      await channel.getByTestId('audio-sync').fill('120');
      await channel.getByTestId('audio-sync').press('Enter');
      await expect
        .poll(async () => (await production.snapshot()).audioChannels[0]?.syncOffsetMs, { message: 'the offset reached the server' })
        .toBe(120);
      await row(second.page, sourceId).getByTestId('audio-more').click();
      await expect(row(second.page, sourceId).getByTestId('audio-sync')).toHaveValue('120', { timeout: 10_000 });

      // The audit log says what changed (one entry per change; a fader drag is one entry, not hundreds).
      const audit = await api.call<{ entries: Array<{ action: string; text: string }> }>('GET', '/api/audit/', {
        query: { limit: 200 },
      });
      const texts = audit.body.entries.filter((entry) => entry.action === 'audio.changed').map((entry) => entry.text);
      expect(texts, `audit: ${JSON.stringify(texts)}`).toEqual(
        expect.arrayContaining(['A1 muted', 'A1 unmuted', 'A1 mode off', 'A1 mode always audible', 'A1 sync offset 120 ms']),
      );
      expect(regie.problems.pageErrors).toEqual([]);
      expect(second.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUD-05 [regie + output] a page that the browser does not let play sound is called “Audio blocked” in the Regie and shows “Sound on”; one click starts it; ?audio=off is silent and not a problem',
    t.p0,
    async ({ regie, openAudioStation, openOutput, pairContext, production, api }) => {
      test.setTimeout(180_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const blocked = () => regie.page.getByTestId('audio-blocked');

      // No page, no warning: nobody is expected to play the sound.
      await expect(blocked()).toBeHidden();

      // A page that was never clicked: the browser keeps its audio context suspended (the gate of the audio probe makes
      // Chromium behave like a window that a person opened; Playwright's evaluations would count as user activation).
      const output = await openOutput(production, {}, { context: GATED });
      await api.startBroadcast(production.id);
      await expect(blocked(), 'the Regie says what the browser does').toHaveText('Audio blocked', { timeout: 20_000 });
      await expect(output.page.locator('.c-sound-on'), 'the page asks for a click').toBeVisible();
      await expect(output.page.locator('.c-sound-on')).toHaveText('Sound on');
      // The chip says it in its tooltip as well.
      await expect(regie.page.getByRole('button', { name: /^Output/ })).toHaveAttribute('title', /Click the output page once/);

      // One click on the page: the sound starts, the button and the warning go away.
      await unlockSound(output);
      await waitForTone(output.page, STATION_HZ);
      await expect(output.page.locator('.c-sound-on')).toBeHidden();
      await expect(blocked(), 'the Regie sees the next report').toBeHidden({ timeout: 20_000 });

      // ?audio=off: the page plays nothing on purpose, which is not blocked.
      await output.page.close();
      const quiet = await openOutput(production, { audio: 'off' }, { context: OUTPUT });
      await quiet.stage();
      await unlockSound(quiet);
      await sleep(3_000);
      await expect(blocked()).toBeHidden();
      await expect(quiet.page.locator('.c-sound-on')).toBeHidden();
      expect(await measureAudio(quiet.page), 'no audio context at all').toBeNull();
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUD-10 [regie] an audible channel without signal for 10 s is a warning in its row and in the status line, not an incident; the warning goes with the signal and while the channel is not audible',
    t.p1,
    async ({ regie, openAudioStation, openOutput, pairContext, production, api }) => {
      test.setTimeout(180_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const device = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const sourceId = device.sourceId('mic');
      const page = regie.page;
      const channel = row(page, sourceId);
      await expect(channel).toBeVisible({ timeout: 15_000 });
      await touch(page);
      await api.startBroadcast(production.id);
      const word = channel.getByTestId('audio-state');
      await expect(word, 'there is sound: nothing to warn about').toBeHidden();
      await expect
        .poll(async () => channel.getByTestId('audio-meter').evaluate((el) => (el as HTMLElement).style.transform), { timeout: 15_000 })
        .not.toMatch(/scaleX\(0(\.0+)?\)/);

      // The desk goes quiet (the track stays: a cable that fell out, a muted channel strip).
      await setFakeTone(station.page, 'mic', { level: 0 });
      const quietAt = Date.now();
      await expect(word).toHaveText('silent for 10 s', { timeout: 30_000 });
      const waited = Date.now() - quietAt;
      expect(waited, 'not before 10 s of silence').toBeGreaterThanOrEqual(9_000);
      expect(waited, 'and not much later').toBeLessThanOrEqual(25_000);
      await expect(channel).toHaveClass(/is-silent/);
      await expect(page.locator('sf-status-line'), 'the warning is announced').toContainText('A1');
      // A warning is not an incident: no incident, the station is "ok", the header lamp is not red.
      const snapshot = await production.snapshot();
      expect(snapshot.incidents, 'no incident').toEqual([]);
      await expect(page.getByText('1 device OK')).toBeVisible();

      // The signal comes back: the warning goes.
      await setFakeTone(station.page, 'mic', { level: 0.5 });
      await expect(word).toBeHidden({ timeout: 15_000 });

      // A channel that is not audible is not watched: muted, the quiet desk gives no warning.
      await setFakeTone(station.page, 'mic', { level: 0 });
      expect((await api.setAudioChannels(production.id, { channels: [{ sourceId, gainDb: 0, muted: true, mode: 'always', syncOffsetMs: 0 }] })).status).toBe(200);
      await sleep(13_000);
      await expect(word, 'only "muted"').toHaveText('muted');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
