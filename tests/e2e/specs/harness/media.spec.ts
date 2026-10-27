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
  duration?: string;
}

async function streamsOf(name: string): Promise<Stream[]> {
  const probe = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', path.join(ASSET_DIR, name)], { check: true });
  return (JSON.parse(probe.stdout) as { streams: Stream[] }).streams;
}

/**
 * The tests on media (MEDIA-01, MEDIA-10, OUT-19 ...) are only worth something with real pictures and clips. A runner
 * without ffmpeg once ran them on a 1x1 JPEG and a clip without frames, and three tests failed for the wrong reason.
 */
test('H-MEDIA-01 the sample media are real pictures and clips made by ffmpeg, not byte-level stubs @smoke @harness', async () => {
  const samples = await generateSamples();
  const [jpeg] = await streamsOf('photo.jpg');
  expect([jpeg!.codec_name, jpeg!.width, jpeg!.height], 'photo.jpg').toEqual(['mjpeg', 640, 360]);
  const [webp] = await streamsOf('photo.webp');
  expect([webp!.codec_name, webp!.width, webp!.height], 'photo.webp').toEqual(['webp', 640, 360]);
  const [mp4] = await streamsOf('clip.mp4');
  expect([mp4!.codec_name, mp4!.width, mp4!.height], 'clip.mp4 is H.264').toEqual(['h264', 320, 180]);
  expect(Number(mp4!.duration), 'clip.mp4 runs about 3 s').toBeGreaterThan(2.5);
  const [webm] = await streamsOf('clip.webm');
  expect([webm!.codec_name, webm!.width, webm!.height], 'clip.webm is VP8').toEqual(['vp8', 320, 180]);
  expect(Number(webm!.duration), 'clip.webm runs about 3 s').toBeGreaterThan(2.5);
  // The set the tests upload is what was probed.
  for (const [name, buffer] of [['photo.jpg', samples.photoJpg], ['photo.webp', samples.photoWebp], ['clip.mp4', samples.clipMp4], ['clip.webm', samples.clipWebm]] as const) {
    expect(fs.readFileSync(path.join(ASSET_DIR, name)).equals(buffer), `${name} is the sample the tests use`).toBe(true);
  }
});

test('H-MEDIA-02 the preflight names a missing ffmpeg instead of letting the samples fall back to stubs @smoke @harness', async () => {
  await assertFfmpeg();
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
