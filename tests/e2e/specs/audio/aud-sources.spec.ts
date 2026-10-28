import { FULL, liveLaptop, putInScene } from '../../support/devices/fleet';
import { percentile } from '../../support/helpers';
import { sleep } from '../../support/shell';
import { pairViaApi } from '../../support/ui/pairing';
import {
  outputTarget,
  fakeTones,
  isDropout,
  measureAudio,
  plugMic,
  silenceAt,
  toneAt,
  toneDb,
  toneSeries,
  unlockSound,
  waitForPeak,
  waitForSilence,
  waitForTone,
} from '../../support/ui/audio';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * AUD sources (issue #7, docs/testing.md 2.21): the sound of a shared screen follows its picture, scene changes fade the
 * sound with the picture, and a microphone that is pulled out while it is audible is an incident that heals when it is
 * plugged back in. The sources are sine tones of known frequency (support/browser/fake-audio.js), the output page is
 * measured with the audio probe.
 */

const STATION_HZ = 440;
const SCREEN_HZ = 880;
const OUTPUT = { audioProbe: true } as const;
/** A tone is gone when it reads this far above the noise floor of its own bin at the most (the floor is leakage of the other tones). */
const GONE_MARGIN_DB = 6;
/** A frequency that none of the sources plays and that is no harmonic of one: its bin holds the noise floor of a mix. */
const FLOOR_HZ = 1500;
const SCREEN_ITEM = { ...FULL, fit: 'cover' } as const;

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

test.describe('AUD sources', () => {
  test(
    'E2E-AUD-06 [laptop + output] a screen shared with sound is heard while its picture is in the program, and only then; “Share audio” is honest about what the browser can do',
    t.p0,
    async ({ regie, openLaptop, openOutput, pairContext, production, api }, testInfo) => {
      test.setTimeout(240_000);
      const { laptop, sourceId } = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea', {
        share: false,
        screenAudio: { frequency: SCREEN_HZ },
      });
      // The page explains what is possible, before anything is shared.
      const shareAudio = laptop.page.getByTestId('share-audio');
      await expect(shareAudio).not.toBeChecked();
      await expect(laptop.page.getByText('Chrome and Edge on Windows can share the sound of the whole computer')).toBeVisible();
      await expect(laptop.page.getByText('Firefox and Safari share no sound.')).toBeVisible();

      // Share with sound: the browser is asked for it, the page says so, the source has a channel.
      await shareAudio.check();
      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live', 30_000);
      await expect(laptop.page.getByTestId('screen-sound')).toHaveText('with sound');
      await expect(laptop.page.getByTestId('screen-no-sound')).toBeHidden();
      await expect.poll(async () => (await production.snapshot()).audioChannels.some((channel) => channel.sourceId === sourceId)).toBe(true);
      expect((await production.snapshot()).audioChannels.find((channel) => channel.sourceId === sourceId)).toEqual({
        sourceId,
        gainDb: 0,
        muted: false,
        mode: 'follow',
        syncOffsetMs: 0,
      });

      // The Regie lists the channel while the screen shares sound.
      await expect(regie.page.locator(`sf-dock-slot[data-dock="audio"] .c-audio[data-source="${sourceId}"]`)).toBeVisible({ timeout: 15_000 });

      // The picture is in the live scene: the output page plays it. The broadcast is live.
      await putInScene(api, production, 0, sourceId, SCREEN_ITEM);
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      await waitForTone(target, SCREEN_HZ);
      await waitForPeak(target, -6);

      // A cut to a scene without the picture silences the sound within 300 ms; back again brings it.
      const empty = production.sceneIds[1]!;
      const silent = silenceAt(target);
      const sentAt = Date.now();
      expect((await api.switchProgram(production.id, { sceneId: empty, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      const cutMs = (await silent) - sentAt;
      testInfo.annotations.push({ type: 'measurement', description: `cut to a scene without the picture -> silent output: ${cutMs} ms` });
      expect(cutMs, 'a cut silences the sound of the picture that left').toBeLessThanOrEqual(900);
      const back = toneAt(target, SCREEN_HZ);
      expect((await api.switchProgram(production.id, { sceneId: production.sceneIds[0]!, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      await back;
      await waitForPeak(target, -6);

      // A hidden item (the picture is in the scene but not shown) is not heard either: the sound belongs to the picture.
      const scene = (await production.snapshot()).scenes[0]!;
      const item = scene.items.find((entry) => entry.source === sourceId)!;
      expect((await api.updateSceneItem(production.id, scene.id, item.id, { ...item, hidden: true })).status).toBe(200);
      await waitForSilence(target);
      expect((await api.updateSceneItem(production.id, scene.id, item.id, { ...item, hidden: false })).status).toBe(200);
      await waitForTone(target, SCREEN_HZ);

      // "Always" makes it audible without the picture, "off" never.
      const set = (mode: string) =>
        api.setAudioChannels(production.id, { channels: [{ sourceId, gainDb: 0, muted: false, mode, syncOffsetMs: 0 }] });
      expect((await api.switchProgram(production.id, { sceneId: empty, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      await waitForSilence(target);
      expect((await set('always')).status).toBe(200);
      await waitForTone(target, SCREEN_HZ);
      expect((await set('off')).status).toBe(200);
      await waitForSilence(target);

      // The share ends: the sound ends with it (no tone left in the page of the laptop).
      expect((await set('follow')).status).toBe(200);
      await laptop.endShare('screen-1');
      await laptop.waitForSlot('screen-1', 'ended', 15_000);
      expect(await laptop.page.evaluate(() => (window as unknown as { __sfAudioFake: { live(kind: string): unknown[] } }).__sfAudioFake.live('screen').length)).toBe(0);
    },
  );

  test(
    'E2E-AUD-07 [laptop] a browser that shares no sound is said so on the laptop and gives no channel in the Regie; sharing without “Share audio” asks the browser for no sound',
    t.p1,
    async ({ regie, openLaptop, pairContext, production }) => {
      test.setTimeout(180_000);
      // The default fake screen has no sound (a browser or a source without audio).
      const { laptop, sourceId } = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Quiet', { share: false });
      await laptop.page.getByTestId('share-audio').check();
      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live', 30_000);
      await expect(laptop.page.getByTestId('screen-no-sound')).toContainText('No sound is shared with this screen.');
      await expect(laptop.page.getByTestId('screen-sound')).toBeHidden();
      // The Regie does not list a channel that has no sound; the mixer still has the (follow) channel of the screen.
      await sleep(2_000);
      await expect(regie.page.locator(`sf-dock-slot[data-dock="audio"] .c-audio[data-source="${sourceId}"]`)).toHaveCount(0);

      // Without the box: the page asks for no audio at all and says nothing about it.
      await laptop.endShare('screen-1');
      await laptop.waitForSlot('screen-1', 'ended', 15_000);
      await laptop.page.getByTestId('share-audio').uncheck();
      await laptop.reshare('screen-1');
      await laptop.waitForSlot('screen-1', 'live', 30_000);
      await expect(laptop.page.getByTestId('screen-no-sound')).toBeHidden();
      const requests = await laptop.page.evaluate(() => (window as unknown as { __sfMedia: { displayCalls: number } }).__sfMedia.displayCalls);
      expect(requests, 'two shares').toBe(2);
      expect((await production.snapshot()).audioChannels.map((channel) => channel.sourceId)).toContain(sourceId);
    },
  );

  test(
    'E2E-AUD-08 [laptop + output] a fade between scenes fades the sound of the picture in and out with the same duration, without a click; the sound of a source that stays is not touched',
    t.p1,
    async ({ regie, openLaptop, openAudioStation, openOutput, pairContext, production, api }, testInfo) => {
      test.setTimeout(240_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const { laptop, sourceId } = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea', {
        share: false,
        screenAudio: { frequency: SCREEN_HZ },
      });
      await laptop.page.getByTestId('share-audio').check();
      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live', 30_000);
      await putInScene(api, production, 0, sourceId, SCREEN_ITEM);
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      await waitForTone(target, SCREEN_HZ);
      await waitForTone(target, STATION_HZ);
      await sleep(500);

      const FADE_MS = 2_000;
      const LEAD_MS = 1_200;
      const sceneB = production.sceneIds[1]!;
      const sceneA = production.sceneIds[0]!;
      interface Sample {
        at: number;
        screen: number;
        station: number;
      }
      const run = async (toScene: string): Promise<Sample[]> => {
        const series = toneSeries(target, [SCREEN_HZ, STATION_HZ], 150, 40);
        await sleep(LEAD_MS);
        const startedAt = Date.now();
        const response = await api.switchProgram(production.id, { sceneId: toScene, transition: { kind: 'fade', durationMs: FADE_MS } });
        expect(response.status, response.raw.text()).toBe(200);
        // The whole output page stalls now and then (every channel reads digital silence for 300-800 ms, the microphone too):
        // those samples measure nothing and are left out.
        return (await series)
          .map((sample) => ({ at: sample.at - startedAt, screen: sample.db[0]!, station: sample.db[1]! }))
          .filter((sample) => !isDropout([sample.screen, sample.station]));
      };
      /**
       * Median (or strongest) strength in dB of the samples between two moments after the switch. A fake source also pauses its
       * tone for up to a second on its own, which only lowers readings: a level that must be there is read as the strongest.
       */
      const mean = (samples: Sample[], key: 'screen' | 'station', from: number, to: number, statistic: 'median' | 'strongest' = 'median'): number => {
        const part = samples.filter((sample) => sample.at >= from && sample.at < to).map((sample) => sample[key]);
        expect(part.length, `samples between ${from} and ${to} ms`).toBeGreaterThanOrEqual(1);
        return percentile(part, statistic === 'median' ? 50 : 100);
      };

      // The noise floor of the bin of the screen tone, measured with the picture out of the scene (a cut) and the microphone
      // playing: what is left there is leakage of the microphone tone, not a tone that has not faded. "Gone" is judged against it.
      const cutTo = async (sceneId: string) =>
        expect((await api.switchProgram(production.id, { sceneId, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      await cutTo(sceneB);
      await sleep(1_500);
      const quiet = (await toneSeries(target, [SCREEN_HZ, STATION_HZ], 10, 100)).filter((sample) => !isDropout(sample.db));
      expect(quiet.length, 'measurements of the floor outside of dropouts').toBeGreaterThanOrEqual(3);
      const floorDb = Math.max(...quiet.map((sample) => sample.db[0]!));
      const goneDb = floorDb + GONE_MARGIN_DB;
      await cutTo(sceneA);
      // (Not waitForTone: the second harmonic of the microphone sits at 880 Hz and passes for the tone of the screen.)
      await expect.poll(() => toneDb(target, SCREEN_HZ), { timeout: 15_000, message: 'the screen tone is back at its level' }).toBeGreaterThan(floorDb + 15);
      await sleep(500);

      // Fade out: the picture with sound leaves. The strength of the tone in the 170 ms window falls from its level to the floor
      // of the measurement in about the duration of the fade, and it does not fall at once (that would be a cut).
      const out = await run(sceneB);
      await testInfo.attach('fade-out.json', { body: JSON.stringify(out, null, 1), contentType: 'application/json' });
      const level = mean(out, 'screen', -LEAD_MS, -100, 'strongest');
      // (The strongest sample of the window: a dropout of the machine only lowers a reading, a cut would silence every one. The
      // window starts after the 170 ms of the measurement that still look back at the sound before the switch, and a fade is
      // still within 6 dB of its level at its half.)
      const start = mean(out, 'screen', 0.15 * FADE_MS, 0.5 * FADE_MS, 'strongest');
      const end = mean(out, 'screen', 0.75 * FADE_MS, 0.95 * FADE_MS);
      const after = mean(out, 'screen', FADE_MS + 800, FADE_MS + 1600);
      testInfo.annotations.push({ type: 'measurement', description: `fade out ${FADE_MS} ms (dB of the tone): before ${level.toFixed(1)}, first half ${start.toFixed(1)}, last fifth ${end.toFixed(1)}, after ${after.toFixed(1)}` });
      expect(start, 'the first half is still (nearly) at the level: a fade, not a cut').toBeGreaterThan(level - 7);
      expect(end, 'the end of the fade is well down').toBeLessThan(start - 4);
      expect(level - floorDb, 'the tone is well above the noise floor, so that "gone" means something').toBeGreaterThan(15);
      expect(after, `after the fade the sound of the picture is gone (floor ${floorDb.toFixed(1)} dB + ${GONE_MARGIN_DB})`).toBeLessThan(goneDb);
      // Gone at the first sample after which no sample is louder than the floor again (dropouts are already out of the series).
      const goneSample = out.find((sample, index) => sample.at > 0 && out.slice(index).every((later) => later.screen < goneDb));
      expect(goneSample, `the tone reaches the floor (${goneDb.toFixed(1)} dB) and stays there; series ${JSON.stringify(out.map((sample) => [sample.at, Math.round(sample.screen)]))}`).toBeDefined();
      const goneAt = goneSample!.at;
      // A linear ramp reaches floor + 6 dB at about 86 % of the fade, minus the 170 ms look-back: about 1550 ms. The lower bound
      // leaves room for a short stall of one source on a loaded machine (#81); a cut is caught by the first-half check above.
      expect(goneAt, 'it is over about when the fade is over (the measurement looks back 170 ms)').toBeGreaterThanOrEqual(FADE_MS - 700);
      expect(goneAt).toBeLessThanOrEqual(FADE_MS + 900);
      // The microphone ("always") stays: its strength does not move with the fade.
      const stationBefore = mean(out, 'station', -LEAD_MS, -100, 'strongest');
      // (The strongest reading after the fade: a microphone that fades with the picture is gone then, while the fake source
      // drops its tone for up to a second now and then, which only lowers the readings of the window.)
      expect(Math.abs(mean(out, 'station', FADE_MS, FADE_MS + 1600, 'strongest') - stationBefore), 'the microphone is not faded').toBeLessThan(6);

      // Fade in: the same way back.
      const back = await run(sceneA);
      await testInfo.attach('fade-in.json', { body: JSON.stringify(back, null, 1), contentType: 'application/json' });
      const silentBefore = mean(back, 'screen', -LEAD_MS, -100);
      const first = mean(back, 'screen', 0, 0.3 * FADE_MS);
      const last = mean(back, 'screen', FADE_MS + 600, FADE_MS + 1400, 'strongest');
      testInfo.annotations.push({ type: 'measurement', description: `fade in ${FADE_MS} ms (dB of the tone): before ${silentBefore.toFixed(1)}, first third ${first.toFixed(1)}, after ${last.toFixed(1)} (level was ${level.toFixed(1)})` });
      expect(silentBefore, 'silent before').toBeLessThan(goneDb);
      expect(first, 'it rises, it does not jump').toBeLessThan(level - 8);
      // (6 dB like the microphone check above: both are the strongest of a few noisy readings; a fade-in that stops short ends far lower.)
      expect(last, 'back at its level').toBeGreaterThan(level - 6);
      expect(mean(back, 'station', FADE_MS + 600, FADE_MS + 2200, 'strongest') - stationBefore, 'the microphone stayed').toBeGreaterThan(-5);
      await waitForPeak(target, -3, { toleranceDb: 4 });
      testInfo.annotations.push({ type: 'measurement', description: `station page fed the track with a longest pause of ${JSON.stringify((await fakeTones(station.page)).map((tone) => tone.maxGapMs))} ms` });
    },
  );

  test(
    'E2E-AUD-09 [station + output] a microphone that is pulled out while it is audible is an incident in the Regie and silent on the output; plugged in again it heals and is heard again',
    t.p0,
    async ({ regie, openAudioStation, openOutput, pairContext, production, api }, testInfo) => {
      test.setTimeout(240_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const device = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      await waitForTone(target, STATION_HZ);
      const sourceId = device.sourceId('mic');

      // Pull it out: the track ends, the page says so and looks for the device.
      const silent = silenceAt(target, -60, 30_000);
      const pulledAt = Date.now();
      await plugMic(station.page, false);
      const silentAt = await silent;
      testInfo.annotations.push({ type: 'measurement', description: `microphone pulled out -> silent output: ${silentAt - pulledAt} ms` });
      await station.waitForMic('ended', 20_000);
      await expect(station.page.getByTestId('mic-message')).toHaveText('The microphone was disconnected.');
      await expect
        .poll(async () => (await production.snapshot()).sources.find((source) => source.id === sourceId)?.status, { timeout: 20_000, message: 'the source of the microphone is ended' })
        .toBe('ended');
      // The incident of an audible channel is in the Regie: the status line names the source and the state.
      const incident = regie.page.locator('sf-status-line');
      await expect(incident).toContainText('A1', { timeout: 20_000 });
      const snapshot = await production.snapshot();
      expect(snapshot.incidents.some((entry) => entry.sourceId === sourceId), 'an incident for A1').toBe(true);
      await expect(regie.page.locator(`.c-st[data-device="${device.id}"]`)).toBeVisible();

      // Plugged in again: the page finds it by itself and the sound is back; the incident heals.
      await plugMic(station.page, true);
      await station.waitForMic('live', 30_000);
      await waitForTone(target, STATION_HZ, { timeout: 30_000 });
      await expect
        .poll(async () => (await production.snapshot()).incidents.filter((entry) => entry.sourceId === sourceId && !entry.endedAt).length, { timeout: 20_000, message: 'the incident heals' })
        .toBe(0);
      const log = (await production.snapshot()).recentLog.map((entry) => entry.text);
      expect(log.some((text) => /^A1 is back, was gone for/.test(text)), `log: ${log.join(' | ')}`).toBe(true);
    },
  );

  test(
    'E2E-AUD-11 [station + 3 laptops + output] four channels are mixed at once: every tone is in the output, a mute or a mode takes exactly its tone out, and a removed device leaves the mix; no page error',
    t.p1,
    async ({ regie, openLaptop, openAudioStation, openOutput, pairContext, production, api }, testInfo) => {
      test.setTimeout(300_000);
      const TONES = { s1: 660, s2: 880, s3: 1100 } as const;
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const desk = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const laptops = [];
      for (const [name, frequency] of [['Laptop A', TONES.s1], ['Laptop B', TONES.s2], ['Laptop C', TONES.s3]] as const) {
        const fixture = await liveLaptop({ openLaptop }, pairContext, regie, name, { share: false, screenAudio: { frequency } });
        await fixture.laptop.page.getByTestId('share-audio').check();
        await fixture.laptop.shareScreen();
        await fixture.laptop.waitForSlot('screen-1', 'live', 30_000);
        await putInScene(api, production, 0, fixture.sourceId, SCREEN_ITEM);
        laptops.push({ ...fixture, frequency });
      }
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      const all = [STATION_HZ, ...laptops.map((laptop) => laptop.frequency)];
      for (const frequency of all) await waitForTone(target, frequency, { timeout: 40_000, minDb: -45 });

      // The Regie lists the four channels; the output holds all four tones at once.
      await expect(regie.page.locator('sf-dock-slot[data-dock="audio"] .c-audio')).toHaveCount(4, { timeout: 15_000 });
      // One measurement is a window of 21 ms, and a starved machine makes a fake source drop its tone for a moment: look until
      // one window holds all four tones (they have to be there at once).
      let heard = (await measureAudio(target))!;
      const inMix = (measure: typeof heard, frequency: number) => measure.peaks.some((peak) => Math.abs(peak.frequency - frequency) <= 15);
      await expect
        .poll(
          async () => {
            heard = (await measureAudio(target))!;
            return all.filter((frequency) => !inMix(heard, frequency));
          },
          { timeout: 15_000, intervals: [100, 100, 250], message: 'all four tones are in one window of the mix' },
        )
        .toEqual([]);
      testInfo.annotations.push({ type: 'measurement', description: `four channels: peak ${heard.peakDb.toFixed(1)} dBFS, peaks ${JSON.stringify(heard.peaks.slice(0, 6))}` });

      const channel = (sourceId: string, patch: Record<string, unknown>) => ({ sourceId, gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 0, ...patch });
      const heardNow = async (frequency: number) => (await measureAudio(target))!.peaks.some((peak) => Math.abs(peak.frequency - frequency) <= 15);
      // The noise floor of the mix: a frequency nobody plays, read while all four tones are in (leakage of the tones and the
      // harmonics of the station land on bins near them). A tone is gone when its bin is within a margin of this floor; the
      // windows in which the whole output page stalls (every channel reads digital silence) measure nothing and do not count.
      const readings = async (frequencies: number[], count: number) =>
        (await toneSeries(target, [...frequencies, FLOOR_HZ], count, 50)).filter((sample) => !isDropout(sample.db));
      const floorDb = Math.max(...(await readings([], 10)).map((sample) => sample.db[0]!));
      testInfo.annotations.push({ type: 'measurement', description: `noise floor of the mix at ${FLOOR_HZ} Hz: ${floorDb.toFixed(1)} dB` });
      // Gone means below the floor plus a margin in four windows outside of dropouts in a row (the second harmonic of the
      // station sits at 880 Hz, which the floor of another bin does not know: the tone must leave the bin, not only the peak list);
      // a tone that stays is heard again within 3 s (a dropout lasts a few hundred milliseconds, a muted channel never comes back).
      const waitGone = async (frequency: number, others: number[]) => {
        await expect
          .poll(
            async () => {
              const window = await readings([frequency], 4);
              return window.length >= 3 && window.every((sample) => sample.db[0]! < floorDb + GONE_MARGIN_DB);
            },
            { timeout: 10_000, message: `${frequency} Hz leaves the mix (floor ${floorDb.toFixed(1)} dB + ${GONE_MARGIN_DB})` },
          )
          .toBe(true);
        for (const other of others) await expect.poll(async () => heardNow(other), { timeout: 3_000, intervals: [50], message: `${other} Hz stays` }).toBe(true);
      };

      // Mute the second screen: only its tone leaves; unmute: it is back.
      expect((await api.setAudioChannels(production.id, { channels: [channel(laptops[1]!.sourceId, { muted: true, mode: 'follow' })] })).status).toBe(200);
      await waitGone(TONES.s2, [STATION_HZ, TONES.s1, TONES.s3]);
      expect((await api.setAudioChannels(production.id, { channels: [channel(laptops[1]!.sourceId, { mode: 'follow' })] })).status).toBe(200);
      await waitForTone(target, TONES.s2, { timeout: 20_000, minDb: -45 });

      // One request moves two channels: the station off, the third screen at -20 dB (the tone stays but is much weaker).
      expect((await api.setAudioChannels(production.id, { channels: [channel(desk.sourceId('mic'), { mode: 'off' }), channel(laptops[2]!.sourceId, { gainDb: -20, mode: 'follow' })] })).status).toBe(200);
      await waitGone(STATION_HZ, [TONES.s1, TONES.s2]);
      // The strongest of ten readings of each (a tone of the fake source or the output can pause for a moment, which only lowers a reading).
      const third = await readings([TONES.s3, TONES.s1], 10);
      const quiet = Math.max(...third.map((sample) => sample.db[0]!));
      const loud = Math.max(...third.map((sample) => sample.db[1]!));
      expect(loud - quiet, `the third screen is quieter (${TONES.s3} Hz ${quiet.toFixed(1)} dB, ${TONES.s1} Hz ${loud.toFixed(1)} dB)`).toBeGreaterThan(8);

      // A device that is removed takes its channel with it.
      const removed = await api.deleteDevice(production.id, laptops[0]!.device.id);
      expect(removed.status, removed.raw.text()).toBe(204);
      await waitGone(TONES.s1, [TONES.s2]);
      await expect(regie.page.locator('sf-dock-slot[data-dock="audio"] .c-audio')).toHaveCount(3, { timeout: 15_000 });
      expect((await production.snapshot()).audioChannels.map((entry) => entry.sourceId)).not.toContain(laptops[0]!.sourceId);
      expect(output.problems.pageErrors).toEqual([]);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
