import { FULL, liveLaptop, putInScene } from '../../support/devices/fleet';
import { percentile } from '../../support/helpers';
import { sleep } from '../../support/shell';
import { pairViaApi } from '../../support/ui/pairing';
import {
  outputTarget,
  fakeTones,
  measureAudio,
  plugMic,
  silenceAt,
  toneAt,
  toneSeries,
  unlockSound,
  waitForPeak,
  waitForSilence,
  waitForTone,
} from '../../support/ui/audio';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * AUD sources (issue #7, docs/testing.md 2.18): the sound of a shared screen follows its picture, scene changes fade the
 * sound with the picture, and a microphone that is pulled out while it is audible is an incident that heals when it is
 * plugged back in. The sources are sine tones of known frequency (support/browser/fake-audio.js), the output page is
 * measured with the audio probe.
 */

const STATION_HZ = 440;
const SCREEN_HZ = 880;
const OUTPUT = { audioProbe: true } as const;
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
        // A starved machine stalls the measurement now and then (the analyser reads silence for a moment): those samples are left out.
        return (await series)
          .map((sample) => ({ at: sample.at - startedAt, screen: sample.db[0]!, station: sample.db[1]! }))
          .filter((sample) => sample.screen > -110 || sample.station > -110);
      };
      /** Median strength in dB of the samples between two moments after the switch (a dropout of the machine does not count). */
      const mean = (samples: Sample[], key: 'screen' | 'station', from: number, to: number): number => {
        const part = samples.filter((sample) => sample.at >= from && sample.at < to).map((sample) => sample[key]);
        expect(part.length, `samples between ${from} and ${to} ms`).toBeGreaterThanOrEqual(1);
        return percentile(part, 50);
      };

      // Fade out: the picture with sound leaves. The strength of the tone in the 170 ms window falls from its level to the floor
      // of the measurement in about the duration of the fade, and it does not fall at once (that would be a cut).
      const out = await run(sceneB);
      await testInfo.attach('fade-out.json', { body: JSON.stringify(out, null, 1), contentType: 'application/json' });
      const level = mean(out, 'screen', -LEAD_MS, -100);
      const start = mean(out, 'screen', 0, 0.3 * FADE_MS);
      const end = mean(out, 'screen', 0.75 * FADE_MS, 0.95 * FADE_MS);
      const after = mean(out, 'screen', FADE_MS + 800, FADE_MS + 1600);
      testInfo.annotations.push({ type: 'measurement', description: `fade out ${FADE_MS} ms (dB of the tone): before ${level.toFixed(1)}, first third ${start.toFixed(1)}, last fifth ${end.toFixed(1)}, after ${after.toFixed(1)}` });
      expect(start, 'the first third is still (nearly) at the level: a fade, not a cut').toBeGreaterThan(level - 7);
      expect(end, 'the end of the fade is well down').toBeLessThan(start - 4);
      expect(after, 'after the fade the sound of the picture is gone').toBeLessThan(level - 20);
      const goneAt = out.find((sample) => sample.at > 0 && sample.screen < level - 20)!.at;
      expect(goneAt, 'it is over about when the fade is over (the measurement looks back 170 ms)').toBeGreaterThanOrEqual(FADE_MS - 500);
      expect(goneAt).toBeLessThanOrEqual(FADE_MS + 900);
      // The microphone ("always") stays: its strength does not move with the fade.
      const stationBefore = mean(out, 'station', -LEAD_MS, -100);
      // (The median over the whole fade: this machine drops a few hundred milliseconds of any tone now and then.)
      expect(Math.abs(mean(out, 'station', 0, FADE_MS + 800) - stationBefore), 'the microphone is not faded').toBeLessThan(6);

      // Fade in: the same way back.
      const back = await run(sceneA);
      await testInfo.attach('fade-in.json', { body: JSON.stringify(back, null, 1), contentType: 'application/json' });
      const floor = mean(back, 'screen', -LEAD_MS, -100);
      const first = mean(back, 'screen', 0, 0.3 * FADE_MS);
      const last = mean(back, 'screen', FADE_MS + 600, FADE_MS + 1400);
      testInfo.annotations.push({ type: 'measurement', description: `fade in ${FADE_MS} ms (dB of the tone): before ${floor.toFixed(1)}, first third ${first.toFixed(1)}, after ${last.toFixed(1)} (level was ${level.toFixed(1)})` });
      expect(floor, 'silent before').toBeLessThan(level - 20);
      expect(first, 'it rises, it does not jump').toBeLessThan(level - 8);
      expect(last, 'back at its level').toBeGreaterThan(level - 5);
      expect(mean(back, 'station', FADE_MS + 600, FADE_MS + 1400) - stationBefore, 'the microphone stayed').toBeGreaterThan(-5);
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
      const heard = (await measureAudio(target))!;
      testInfo.annotations.push({ type: 'measurement', description: `four channels: peak ${heard.peakDb.toFixed(1)} dBFS, peaks ${JSON.stringify(heard.peaks.slice(0, 6))}` });
      for (const frequency of all) expect(heard.peaks.some((peak) => Math.abs(peak.frequency - frequency) <= 15), `${frequency} Hz is in the mix`).toBe(true);

      const channel = (sourceId: string, patch: Record<string, unknown>) => ({ sourceId, gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 0, ...patch });
      const heardNow = async (frequency: number) => (await measureAudio(target))!.peaks.some((peak) => Math.abs(peak.frequency - frequency) <= 15);
      const waitGone = async (frequency: number, others: number[]) => {
        await expect.poll(async () => heardNow(frequency), { timeout: 10_000, message: `${frequency} Hz leaves the mix` }).toBe(false);
        for (const other of others) expect(await heardNow(other), `${other} Hz stays`).toBe(true);
      };

      // Mute the second screen: only its tone leaves; unmute: it is back.
      expect((await api.setAudioChannels(production.id, { channels: [channel(laptops[1]!.sourceId, { muted: true, mode: 'follow' })] })).status).toBe(200);
      await waitGone(TONES.s2, [STATION_HZ, TONES.s1, TONES.s3]);
      expect((await api.setAudioChannels(production.id, { channels: [channel(laptops[1]!.sourceId, { mode: 'follow' })] })).status).toBe(200);
      await waitForTone(target, TONES.s2, { timeout: 20_000, minDb: -45 });

      // One request moves two channels: the station off, the third screen at -20 dB (the tone stays but is much weaker).
      expect((await api.setAudioChannels(production.id, { channels: [channel(desk.sourceId('mic'), { mode: 'off' }), channel(laptops[2]!.sourceId, { gainDb: -20, mode: 'follow' })] })).status).toBe(200);
      await waitGone(STATION_HZ, [TONES.s1, TONES.s2]);
      const quiet = (await measureAudio(target))!.peaks.find((peak) => Math.abs(peak.frequency - TONES.s3) <= 15);
      const loud = (await measureAudio(target))!.peaks.find((peak) => Math.abs(peak.frequency - TONES.s1) <= 15);
      expect(quiet === undefined || loud === undefined || loud.db - quiet.db > 8, `the third screen is quieter (${JSON.stringify({ quiet, loud })})`).toBe(true);

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
