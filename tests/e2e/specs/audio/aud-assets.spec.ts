import { makeToneClip } from '../../support/media-samples';
import { FULL, putInScene } from '../../support/devices/fleet';
import { outputTarget, silenceAt, unlockSound, waitForPeak, waitForSilence, waitForTone } from '../../support/ui/audio';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * AUD video assets (issue #7, docs/testing.md 2.18): a video with an audio track gets a channel of the mixer (follows its
 * picture), the output page plays the sound of the clip while the clip is in the program and the mixer moves it like any
 * other channel; a video without sound, and an image, have none. The clip is a WebM (VP8 + Opus) with a 1000 Hz tone.
 */

const CLIP_HZ = 1000;
const OUTPUT = { audioProbe: true } as const;

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

test.describe('AUD assets', () => {
  test(
    'E2E-AUD-15 [assets + output] a video with sound is a channel of the mixer that follows its picture; the output plays it while the clip is in the program and the mixer moves it; a video without sound has no channel',
    t.p1,
    async ({ regie, openOutput, production, api }) => {
      test.setTimeout(240_000);
      const clip = await makeToneClip(CLIP_HZ);
      test.skip(clip === null, 'ffmpeg is needed to make a clip with sound');
      const loud = await api.uploadAsset(production.id, { fileName: 'Tone.webm', contentType: 'video/webm', data: clip! });
      expect(loud.status, loud.raw.text().slice(0, 300)).toBe(201);
      expect(loud.body.hasAudio, 'the server finds the audio track').toBe(true);
      const quiet = await api.uploadAsset(production.id, { fileName: 'Silent.webm', contentType: 'video/webm', data: (await (await import('../../support/media-samples')).generateSamples()).clipWebm });
      expect(quiet.status, quiet.raw.text().slice(0, 300)).toBe(201);
      expect(quiet.body.hasAudio, 'a clip without audio track').toBe(false);

      // Only the clip with sound has a channel, which starts audible and follows its picture.
      const channels = (await production.snapshot()).audioChannels;
      expect(channels.map((channel) => channel.sourceId)).toEqual([loud.body.id]);
      expect(channels[0]).toEqual({ sourceId: loud.body.id, gainDb: 0, muted: false, mode: 'follow', syncOffsetMs: 0 });
      await expect(regie.page.locator(`sf-dock-slot[data-dock="audio"] .c-audio[data-source="${loud.body.id}"]`)).toBeVisible({ timeout: 15_000 });
      await expect(regie.page.locator(`sf-dock-slot[data-dock="audio"] .c-audio[data-source="${quiet.body.id}"]`)).toHaveCount(0);

      // The clip is in the live scene: its sound comes out of the output page, and only while the broadcast is live.
      await putInScene(api, production, 0, loud.body.id, { ...FULL, fit: 'contain' });
      await putInScene(api, production, 0, quiet.body.id, { x: 0, y: 0, w: 480, h: 270, fit: 'cover' });
      const output = await openOutput(production, {}, { context: OUTPUT });
      await output.stage();
      await unlockSound(output);
      const target = await outputTarget(output);
      await waitForSilence(target);
      await api.startBroadcast(production.id);
      await waitForTone(target, CLIP_HZ, { timeout: 30_000 });
      const heard = await waitForPeak(target, -6, { toleranceDb: 3.5 });
      expect(heard.peaks.some((peak) => Math.abs(peak.frequency - CLIP_HZ) <= 15), 'the tone of the clip').toBe(true);

      // A scene without the clip is silent; the mixer moves the clip like any other channel.
      const empty = production.sceneIds[1]!;
      const silent = silenceAt(target);
      expect((await api.switchProgram(production.id, { sceneId: empty, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      await silent;
      expect((await api.switchProgram(production.id, { sceneId: production.sceneIds[0]!, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      await waitForTone(target, CLIP_HZ, { timeout: 15_000 });
      const set = (patch: Record<string, unknown>) =>
        api.setAudioChannels(production.id, { channels: [{ sourceId: loud.body.id, gainDb: 0, muted: false, mode: 'follow', syncOffsetMs: 0, ...patch }] });
      expect((await set({ gainDb: -12 })).status).toBe(200);
      await waitForPeak(target, -18, { toleranceDb: 4 });
      expect((await set({ muted: true })).status).toBe(200);
      await waitForSilence(target);
      expect((await set({})).status).toBe(200);
      await waitForTone(target, CLIP_HZ, { timeout: 15_000 });

      // Deleting the asset takes its channel with it.
      expect((await api.switchProgram(production.id, { sceneId: empty, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      const items = (await production.snapshot()).scenes[0]!.items;
      expect((await api.replaceSceneItems(production.id, production.sceneIds[0]!, { items: items.filter((item) => item.source !== loud.body.id) })).status).toBe(200);
      expect((await api.deleteAsset(production.id, loud.body.id)).status).toBe(204);
      await expect.poll(async () => (await production.snapshot()).audioChannels.length).toBe(0);
      expect(output.problems.pageErrors).toEqual([]);
    },
  );
});
