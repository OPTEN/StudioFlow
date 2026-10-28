import { percentile } from '../../support/helpers';
import { sleep } from '../../support/shell';
import { pairViaApi } from '../../support/ui/pairing';
import {
  fakeTones,
  measureAudio,
  outputTarget,
  setFakeTone,
  silenceAt,
  toneAt,
  unlockSound,
  waitForPeak,
  waitForSilence,
  waitForTone,
} from '../../support/ui/audio';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * AUD, the whole chain (issue #7, docs/testing.md 2.21): the audio station sends the sound of the mixing desk, the output
 * page plays it only while the broadcast is live and the channel is audible. The microphone is a sine tone of known
 * frequency (support/browser/fake-audio.js) and the output page is measured with the audio probe, so a frequency in the
 * spectrum proves that the sound went through LiveKit, the output page and the mixer – and silence that it did not.
 */

const STATION_HZ = 440;
const OUTPUT = { audioProbe: true } as const;
/** The broadcast ends with a 300 ms ramp (decision #7); the event needs a few tens of milliseconds more. */
const BROADCAST_STOP_HARD_MS = 800;

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

test.describe('AUD audio chain', () => {
  test(
    'E2E-AUD-01 [station + output] the sound of the audio station reaches the output page while the broadcast is live, stereo and unprocessed, and stops with it',
    t.smoke,
    async ({ regie, openAudioStation, openOutput, pairContext, production, api }, testInfo) => {
      test.setTimeout(180_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const device = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);

      // The station is paired as an audio station with one source A1; its channel is audible while the broadcast is live.
      expect(device.kind).toBe('audioStation');
      expect(device.codes['mic']).toBe('A1');
      const snapshot = await production.snapshot();
      const source = snapshot.sources.find((entry) => entry.id === device.sourceId('mic'));
      expect(source, 'the microphone is a source').toMatchObject({ kind: 'audio', code: 'A1' });
      expect(snapshot.audioChannels).toEqual([
        { sourceId: device.sourceId('mic'), gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 0 },
      ]);

      // What the page asked the microphone for: stereo, nothing the browser would change.
      const calls = (await station.page.evaluate(
        () => (window as unknown as { __sfMedia: { userMediaCalls: Array<{ audio: unknown }> } }).__sfMedia.userMediaCalls,
      )) as Array<{ audio: Record<string, unknown> }>;
      const audioRequest = calls.find((call) => typeof call.audio === 'object')?.audio ?? {};
      expect(audioRequest).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
      expect(JSON.stringify(audioRequest)).toMatch(/channelCount":(\{"ideal":)?2/);

      // The station page shows the level of the desk and that it is not on air yet.
      await expect(station.levelText()).not.toHaveText('−∞ dB', { timeout: 15_000 });
      await expect(station.micLive()).toBeHidden();

      // Before the broadcast the output page is silent, although the source is there.
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await sleep(1500);
      expect((await measureAudio(target))?.state, 'the output page may play sound').toBe('running');
      await waitForSilence(target);

      // Live: the tone of the station comes out of the output page and the station says "Mic live".
      await api.startBroadcast(production.id);
      await waitForTone(target, STATION_HZ);
      // Unity gain: the tone arrives at its own level (-6 dBFS) once the 300 ms ramp of the broadcast start is over.
      const heard = await waitForPeak(target, -6);
      expect(heard.peaks.some((peak) => Math.abs(peak.frequency - STATION_HZ) <= 8), 'the frequency of the station').toBe(true);
      testInfo.annotations.push({
        type: 'measurement',
        description: `output page: ${heard.peakDb.toFixed(1)} dBFS, strongest peak ${JSON.stringify(heard.peaks[0])} (played: ${STATION_HZ} Hz at -6 dBFS)`,
      });
      await expect(station.micLive()).toBeVisible({ timeout: 10_000 });
      await station.waitForTally('program').catch(() => undefined);
      expect(await station.tally(), 'the tally frame of the audio station is the microphone').toBe('program');

      // The end of the broadcast silences the output page within the hard limit for broadcast end.
      const silent = silenceAt(target);
      const endedAt = Date.now();
      await api.endBroadcast(production.id);
      const elapsed = (await silent) - endedAt;
      testInfo.annotations.push({ type: 'measurement', description: `end of broadcast -> silent output: ${elapsed} ms` });
      expect(elapsed, 'the sound stops with the broadcast').toBeLessThanOrEqual(BROADCAST_STOP_HARD_MS);
      await expect(station.micLive()).toBeHidden({ timeout: 10_000 });
      expect((await fakeTones(station.page)).filter((tone) => tone.live)).toHaveLength(1);
      void regie;
    },
  );

  test(
    'E2E-AUD-16 [station + output] the delay of the sound from the microphone of the station to the output page is measured (a tone that starts after silence, five times)',
    t.p2,
    async ({ openAudioStation, openOutput, pairContext, production, api }, testInfo) => {
      test.setTimeout(180_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      await waitForTone(target, STATION_HZ);

      // The source is silent, then the tone starts at a known moment of this machine's clock. The fake microphone writes its
      // samples about 60 ms ahead of the clock, which is part of the number.
      const delays: number[] = [];
      for (let round = 0; round < 5; round += 1) {
        await setFakeTone(station.page, 'mic', { level: 0 });
        await waitForSilence(target, { timeout: 15_000 });
        await sleep(300);
        const heard = toneAt(target, STATION_HZ, 15_000);
        const startedAt = await station.page.evaluate(() => {
          (window as unknown as { __sfAudioFake: { setTone(kind: string, patch: object): void } }).__sfAudioFake.setTone('mic', { level: 0.5 });
          return Date.now();
        });
        delays.push((await heard) - startedAt);
      }
      const median = percentile(delays, 50);
      testInfo.annotations.push({
        type: 'measurement',
        description: `audio delay microphone -> output page (tone after silence, 5 rounds): ${delays.join(' / ')} ms, median ${median} ms; includes about 60 ms of the fake source's write-ahead and the 21 ms window of the probe`,
      });
      expect(median, 'T-AUDIO-DELAY: the sound is not seconds behind').toBeLessThanOrEqual(1_000);
    },
  );
});
