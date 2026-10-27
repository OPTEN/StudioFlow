import { livePhone, putInScene, FULL } from '../../support/devices/fleet';
import { pairViaApi } from '../../support/ui/pairing';
import {
  outputTarget,
  unlockSound,
  waitForPeak,
  waitForSilence,
  waitForTone,
} from '../../support/ui/audio';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * AUD on the senders (issue #7, docs/testing.md 2.18): the audio station is paired through the pairing form like any
 * laptop and starts the sound of the mixing desk by itself; a phone has a microphone that is off until its person
 * switches it on, and the mixer keeps it muted until the Regie lets it through (decision #7).
 */

const STATION_HZ = 440;
const PHONE_HZ = 550;
const OUTPUT = { audioProbe: true } as const;

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

test.describe('AUD senders', () => {
  test(
    'E2E-AUD-12 [station + regie] the audio station is paired with the check code, starts the desk by itself, shows input and level, switches off on purpose and stays off after a reload',
    t.p1,
    async ({ regie, openAudioStation, pairContext, production }) => {
      test.setTimeout(240_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      await station.gotoStart();
      // The pairing form offers the audio station and names it.
      await station.submitPairingForm('Mixing desk', 'audioStation');
      const checkCode = await station.checkCode();
      await regie.openPairing('laptop');
      expect(await regie.knockCheckCode('Mixing desk')).toBe(checkCode);
      await regie.approveKnock('Mixing desk');
      await station.waitConnected();
      const stored = await station.waitForStoredDevice();

      // The page of the station: the desk, the input, the level, the honest note about what is sent. No screen, no camera.
      await expect(station.page.locator('h1')).toHaveText('Mixing desk');
      await expect(station.panel().locator('#mic-title')).toHaveText('Sound from the mixing desk');
      await expect(station.panel().locator('.c-code')).toHaveText('A1');
      await station.waitForMic('live', 45_000);
      await expect(station.page.getByText('Stereo, sent as it comes: echo cancellation, noise suppression and automatic gain are off.')).toBeVisible();
      await expect(station.page.getByRole('button', { name: /Share screen|Add camera/ })).toHaveCount(0);
      await expect(station.levelText()).not.toHaveText('−∞ dB', { timeout: 15_000 });
      // The Regie knows a station with one audio source (no picture in its row).
      const row = await regie.waitForStation('Mixing desk');
      await expect(row).toContainText('A1');
      const snapshot = await production.snapshot();
      const device = snapshot.devices.find((entry) => entry.id === stored.deviceId)!;
      expect(device.kind).toBe('audioStation');
      expect(snapshot.sources.filter((source) => source.deviceId === stored.deviceId).map((source) => [source.kind, source.code])).toEqual([['audio', 'A1']]);

      // The inputs of the computer are listed; choosing one starts the microphone again on that input.
      const options = await station.inputSelect().locator('option').evaluateAll((list) => list.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent?.trim() ?? '' })));
      expect(options[0]).toEqual({ value: '', text: 'Default input' });
      expect(options.length, 'the fake devices of Chromium are listed too').toBeGreaterThan(1);
      const chosen = options[1]!;
      await station.inputSelect().selectOption(chosen.value);
      await expect
        .poll(async () =>
          station.page.evaluate(
            () =>
              (window as unknown as { __sfMedia: { userMediaCalls: Array<{ audio?: { deviceId?: { exact?: string } } }> } }).__sfMedia.userMediaCalls
                .map((call) => call.audio?.deviceId?.exact ?? null)
                .filter((id) => id !== null),
          ),
        )
        .toContain(chosen.value);
      await station.waitForMic('live', 30_000);

      // "Switch microphone off": stopped on purpose, the button changes, a reload does not start it again.
      await station.micToggle().click();
      await expect(station.micToggle()).toHaveText('Switch microphone on');
      await expect(station.panel().getByTestId('mic-state')).toHaveText('Off');
      const callsBefore = await station.page.evaluate(() => (window as unknown as { __sfMedia: { userMediaCalls: unknown[] } }).__sfMedia.userMediaCalls.length);
      await station.page.reload();
      await station.waitConnected();
      await expect(station.panel().getByTestId('mic-state')).toHaveText('Off');
      await expect(station.inputSelect()).toHaveValue(chosen.value);
      await station.page.waitForTimeout(2_000);
      const callsAfter = await station.page.evaluate(() => (window as unknown as { __sfMedia: { userMediaCalls: unknown[] } }).__sfMedia.userMediaCalls.length);
      expect(callsAfter, 'the page did not ask for the microphone again').toBeLessThanOrEqual(callsBefore);
      // On again: the station is live and keeps the chosen input.
      await station.micToggle().click();
      await station.waitForMic('live', 30_000);
      await expect(station.inputSelect()).toHaveValue(chosen.value);
      // Another reload with the microphone on: it starts by itself.
      await station.page.reload();
      await station.waitConnected();
      await station.waitForMic('live', 45_000);
      void pairContext;
      expect(station.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUD-13 [phone + output] the microphone of a phone is off until its person switches it on and then muted in the mixer; the Regie lets it through, and it is heard with the picture of the phone',
    t.p1,
    async ({ regie, openPhone, openOutput, pairContext, production, api }) => {
      test.setTimeout(240_000);
      const phone = await livePhone({ openPhone }, pairContext, regie, 'Phone stage', { mic: { frequency: PHONE_HZ } });
      const camera = phone.sourceId;
      const mic = phone.sourceId.replace(/\/camera$/, '/mic');
      expect((await production.snapshot()).sources.some((source) => source.kind === 'audio'), 'no microphone before it is switched on').toBe(false);
      // The microphone button is there and says it is off; nothing was asked of the browser.
      const button = phone.phone.page.getByTestId('slot-mic');
      await expect(button).toHaveText('Microphone off');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      expect((await phone.phone.page.evaluate(() => (window as unknown as { __sfMedia: { userMediaCalls: Array<{ audio?: unknown }> } }).__sfMedia.userMediaCalls.filter((call) => call.audio).length))).toBe(0);

      await button.click();
      await phone.phone.waitForSlot('mic', 'live', 45_000);
      await expect(button).toHaveText('Microphone on');
      await expect(phone.phone.page.getByTestId('mic-live'), 'not on air').toBeHidden();
      // A new audio source with a channel that starts muted and follows the picture of its device.
      await expect
        .poll(async () => (await production.snapshot()).audioChannels.find((channel) => channel.sourceId === mic))
        .toEqual({ sourceId: mic, gainDb: 0, muted: true, mode: 'follow', syncOffsetMs: 0 });
      const source = (await production.snapshot()).sources.find((entry) => entry.id === mic)!;
      expect(source.kind).toBe('audio');
      expect(source.code).toMatch(/^A\\d+$/);

      // The phone's picture is on air: its microphone is still muted, so the output stays silent.
      await putInScene(api, production, 0, camera, FULL);
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      await waitForSilence(target);
      await expect(phone.phone.page.getByTestId('mic-live')).toBeHidden();

      // The Regie lets it through: it is heard, and the phone says "Mic live".
      expect((await api.setAudioChannels(production.id, { channels: [{ sourceId: mic, gainDb: 0, muted: false, mode: 'follow', syncOffsetMs: 0 }] })).status).toBe(200);
      await waitForTone(target, PHONE_HZ);
      await waitForPeak(target, -6, { toleranceDb: 4 });
      await expect(phone.phone.page.getByTestId('mic-live')).toBeVisible({ timeout: 10_000 });
      // It follows the picture of the phone: a scene without the camera silences it, and the tag goes.
      expect((await api.switchProgram(production.id, { sceneId: production.sceneIds[1]!, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      await waitForSilence(target);
      await expect(phone.phone.page.getByTestId('mic-live')).toBeHidden({ timeout: 10_000 });

      // Switching it off on the phone: stopped on purpose, the sound is gone and a reload does not start it again.
      await button.click();
      await expect(button).toHaveText('Microphone off');
      await phone.phone.page.reload();
      await phone.phone.waitConnected();
      await expect(phone.phone.page.getByTestId('slot-mic')).toHaveText('Microphone off');
      expect(phone.phone.problems.pageErrors).toEqual([]);
    },
  );
});
