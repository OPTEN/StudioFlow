import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ASSET_DIR } from '../../support/env';
import { generateSamples } from '../../support/media-samples';
import { assertFfmpeg } from '../../support/preflight';
import { exec } from '../../support/shell';

interface Stream {
  codec_name: string;
  width: number;
  height: number;
}

/** Whether a tool of ffmpeg runs on this machine. */
async function runs(tool: 'ffmpeg' | 'ffprobe'): Promise<boolean> {
  try {
    return (await exec(tool, ['-hide_banner', '-version'], { timeoutMs: 30_000 })).code === 0;
  } catch {
    return false;
  }
}

/** The streams of a sample and its duration in seconds (a WebM carries it in the container, not in the stream). */
async function probe(name: string): Promise<{ streams: Stream[]; seconds: number }> {
  const result = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path.join(ASSET_DIR, name)], { check: true });
  const parsed = JSON.parse(result.stdout) as { streams: Stream[]; format: { duration?: string } };
  return { streams: parsed.streams, seconds: Number(parsed.format.duration) };
}

/**
 * The tests on media (MEDIA-01, MEDIA-10, OUT-19 ...) are only worth something with real pictures and clips. A runner
 * without ffmpeg once ran them on a 1x1 JPEG and a clip without frames, and three tests failed for the wrong reason.
 */
test('H-MEDIA-01 the sample media are real pictures and clips made by ffmpeg, not byte-level stubs @smoke @harness', async () => {
  // CI restores the samples from its cache and then installs no ffmpeg. The cache is only saved by a run whose smoke tests
  // passed, so the files it holds went through this probe when they were made (the key is the hash of the generator).
  test.skip(!(await runs('ffprobe')), 'ffprobe is not installed: the samples came from the CI cache and were probed when they were made');
  const samples = await generateSamples();
  const [jpeg] = (await probe('photo.jpg')).streams;
  expect([jpeg!.codec_name, jpeg!.width, jpeg!.height], 'photo.jpg').toEqual(['mjpeg', 640, 360]);
  const [webp] = (await probe('photo.webp')).streams;
  expect([webp!.codec_name, webp!.width, webp!.height], 'photo.webp').toEqual(['webp', 640, 360]);
  const mp4 = await probe('clip.mp4');
  expect([mp4.streams[0]!.codec_name, mp4.streams[0]!.width, mp4.streams[0]!.height], 'clip.mp4 is H.264').toEqual(['h264', 320, 180]);
  expect(mp4.seconds, 'clip.mp4 runs about 3 s').toBeGreaterThan(2.5);
  const webm = await probe('clip.webm');
  expect([webm.streams[0]!.codec_name, webm.streams[0]!.width, webm.streams[0]!.height], 'clip.webm is VP8').toEqual(['vp8', 320, 180]);
  expect(webm.seconds, 'clip.webm runs about 3 s').toBeGreaterThan(2.5);
  // The set the tests upload is what was probed.
  for (const [name, buffer] of [['photo.jpg', samples.photoJpg], ['photo.webp', samples.photoWebp], ['clip.mp4', samples.clipMp4], ['clip.webm', samples.clipWebm]] as const) {
    expect(fs.readFileSync(path.join(ASSET_DIR, name)).equals(buffer), `${name} is the sample the tests use`).toBe(true);
  }
});

test('H-MEDIA-02 the preflight names a missing ffmpeg instead of letting the samples fall back to stubs @smoke @harness', async () => {
  // With ffmpeg installed the preflight passes; without it (CI with cached samples) only the refusal below is checked.
  if (await runs('ffmpeg')) await assertFfmpeg();
  const search = process.env['PATH'];
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-no-ffmpeg-'));
  process.env['PATH'] = empty;
  try {
    await expect(assertFfmpeg()).rejects.toThrow(/needs ffmpeg for its sample media.*Install ffmpeg/s);
  } finally {
    process.env['PATH'] = search;
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
