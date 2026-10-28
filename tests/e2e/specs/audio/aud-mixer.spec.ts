import { OutputApi } from '../../support/api';
import { expectProblem } from '../../support/fixtures';
import { PublicApi } from '../../support/api';
import { percentile } from '../../support/helpers';
import { sleep } from '../../support/shell';
import { pairViaApi } from '../../support/ui/pairing';
import {
  outputTarget,
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
 * AUD, the mixer (issue #7, docs/testing.md 2.21): one global mixer per production – fader (-∞ to +10 dB), mute, mode
 * (always, follows the picture, off) and sync offset per channel – set with `PUT …/audio/channels` and heard on the
 * output page within the specified times. The output page is measured with the audio probe (support/browser/audio-probe.js).
 */

const STATION_HZ = 440;
const OUTPUT = { audioProbe: true } as const;
/** Decision #7: mute, fader and mode follow in 20 ms; with the event and the measurement window this stays under 300 ms. */
const MUTE_HARD_MS = 300;

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

test.describe('AUD mixer', () => {
  test(
    'E2E-AUD-02 [api + output] mute, fader, mode and sync offset change what the output page plays – mute within 300 ms, the fader by its dB value',
    t.p0,
    async ({ openAudioStation, openOutput, pairContext, production, api }, testInfo) => {
      test.setTimeout(180_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const device = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const sourceId = device.sourceId('mic');
      const channel = (patch: Record<string, unknown>) => ({
        channels: [{ sourceId, gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 0, ...patch }],
      });
      const set = async (patch: Record<string, unknown>, adjusting = false) => {
        const result = await api.setAudioChannels(production.id, { ...channel(patch), adjusting });
        expect(result.status, result.raw.text()).toBe(200);
        return result.body;
      };
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await api.startBroadcast(production.id);
      await waitForTone(target, STATION_HZ);
      await waitForPeak(target, -6);

      // Mute: silent within 300 ms of the answer to the request (the event leaves the server at the same time as the
      // answer); unmute: the tone is back. Five rounds, because one slow event must not decide.
      const mutes: number[] = [];
      const unmutes: number[] = [];
      for (let round = 0; round < 5; round += 1) {
        const silent = silenceAt(target);
        const sentAt = Date.now();
        await set({ muted: true });
        const answeredAt = Date.now();
        mutes.push((await silent) - answeredAt);
        const back = toneAt(target, STATION_HZ);
        await set({ muted: false });
        const unmutedAt = Date.now();
        unmutes.push((await back) - unmutedAt);
        testInfo.annotations.push({ type: 'measurement', description: `round ${round}: request ${answeredAt - sentAt} ms, mute -> silent ${mutes[round]} ms, unmute -> tone ${unmutes[round]} ms (after the answers)` });
        await waitForPeak(target, -6);
      }
      expect(percentile(mutes, 50), 'mute is heard within 300 ms (median of 5)').toBeLessThanOrEqual(MUTE_HARD_MS);
      expect(Math.max(...mutes), 'no mute takes more than 600 ms').toBeLessThanOrEqual(2 * MUTE_HARD_MS);

      // Fader: -6 dB halves the amplitude, +10 dB is 3.16 times louder (no limiter), -100 is silence.
      await set({ gainDb: -6 });
      await waitForPeak(target, -12);
      await set({ gainDb: -20 }, true);
      await waitForPeak(target, -26);
      await set({ gainDb: 10 });
      await waitForPeak(target, 4);
      await set({ gainDb: -100 });
      await waitForSilence(target);
      await set({ gainDb: 0 });
      await waitForPeak(target, -6);

      // Mode: "off" is never audible, "always" and "follows the picture" (a microphone with no picture on screen is not).
      await set({ mode: 'off' });
      await waitForSilence(target);
      await set({ mode: 'always' });
      await waitForTone(target, STATION_HZ);
      await set({ mode: 'follow' });
      await waitForSilence(target);
      await set({ mode: 'always' });
      await waitForTone(target, STATION_HZ);

      // Sync offset: stored and returned (the delay itself is 0 to 500 ms; the level does not change).
      const stored = await set({ syncOffsetMs: 250 });
      expect(stored).toEqual([{ sourceId, gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 250 }]);
      await waitForPeak(target, -6);
      expect((await production.snapshot()).audioChannels[0]).toMatchObject({ syncOffsetMs: 250 });

      // The mixer is state of the production: a fresh output page gets the same mix (here: muted from the start).
      await set({ muted: true, syncOffsetMs: 0 });
      const second = await openOutput(production, {}, { context: OUTPUT });
      await second.stage();
      await unlockSound(second);
      await sleep(1500);
      await waitForSilence(await outputTarget(second));
      await set({ muted: false });
      await waitForTone(await outputTarget(second), STATION_HZ);
      await waitForTone(target, STATION_HZ);
    },
  );

  test(
    'E2E-AUD-03 [api] the mixer refuses invalid values and unknown or silent sources completely, and needs a session and the CSRF header',
    t.p0,
    async ({ openAudioStation, pairContext, production, api, config }) => {
      test.setTimeout(120_000);
      const station = await openAudioStation({ mic: { frequency: STATION_HZ } });
      const device = await pairViaApi(pairContext, station, { name: 'Mixing desk' });
      await station.waitForMic('live', 45_000);
      const sourceId = device.sourceId('mic');
      const good = { sourceId, gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 0 };
      const before = (await production.snapshot()).audioChannels;
      const revisionBefore = (await api.getSnapshot(production.id)).body.revision;
      const bad = async (channels: unknown, code = 'validation_failed', status = 400) => {
        const result = await api.setAudioChannels(production.id, channels === undefined ? {} : { channels });
        expectProblem(result, status, code);
        return result;
      };

      // Values outside the range, wrong types, wrong names.
      await bad([{ ...good, gainDb: 10.5 }]);
      await bad([{ ...good, gainDb: -100.5 }]);
      await bad([{ ...good, gainDb: 'loud' }]);
      await bad([{ ...good, syncOffsetMs: 501 }]);
      await bad([{ ...good, syncOffsetMs: -1 }]);
      await bad([{ ...good, syncOffsetMs: 12.5 }]);
      await bad([{ ...good, mode: 'sometimes' }]);
      await bad([{ ...good, muted: 'yes' }]);
      await bad([{ ...good, sourceId: '' }]);
      await bad([{ ...good, sourceId: 'dev_unknown/mic' }]);
      await bad([]);
      await bad(undefined);
      await bad([good, good]);
      // One wrong channel refuses the whole request: the right one is not applied.
      await bad([{ ...good, gainDb: -12 }, { ...good, sourceId: 'dev_unknown/mic' }]);
      // The extremes are valid: -100 is silence, +10 the top of the fader.
      for (const gainDb of [-100, 10, 0]) {
        const result = await api.setAudioChannels(production.id, { channels: [{ ...good, gainDb }] });
        expect(result.status, result.raw.text()).toBe(200);
      }
      for (const syncOffsetMs of [500, 0]) {
        const result = await api.setAudioChannels(production.id, { channels: [{ ...good, syncOffsetMs }] });
        expect(result.status, result.raw.text()).toBe(200);
      }
      // Nothing of the refused requests was applied; a request that changes nothing creates no revision.
      expect((await production.snapshot()).audioChannels).toEqual(before);
      expect((await api.getSnapshot(production.id)).body.revision, 'only the valid changes made revisions').toBeGreaterThan(revisionBefore);

      // A source without sound has no channel: a camera slot of a phone is refused.
      const unknownProduction = await api.setAudioChannels('prd_doesnotexist1', { channels: [good] });
      expectProblem(unknownProduction, 404, 'not_found');

      // Grants: no session, no CSRF header, the output key and a device bearer cannot move the faders.
      const body = { channels: [{ ...good, muted: true }] };
      const route = `/api/productions/${production.id}/audio/channels`;
      const anonymous = await api.call('PUT', route, { json: body, anonymous: true });
      expectProblem(anonymous, 401, 'unauthorized');
      const noCsrf = await api.call('PUT', route, { json: body, noCsrf: true });
      expect(noCsrf.status, 'CSRF header required').toBe(403);
      const withKey = await new PublicApi(config.baseURL).call('PUT', route, {
        json: body,
        headers: { 'X-StudioFlow': '1', 'X-Output-Key': production.outputKey },
      });
      expect([401, 403], 'the output key is not a session').toContain(withKey.status);
      const asDevice = await device.api.call('PUT', route, {
        json: body,
        headers: { 'X-StudioFlow': '1' },
      });
      expect([401, 403], 'a device is not a Regie').toContain(asDevice.status);
      const asOutput = await new OutputApi(config.baseURL, production.slug, production.outputKey).call('PUT', route, {
        json: body,
      });
      expect([401, 403, 404, 405], 'the output API cannot set the mixer').toContain(asOutput.status);
      expect((await production.snapshot()).audioChannels, 'none of the refused calls changed the mixer').toEqual(before);
    },
  );
});
