// Cuts the frames each scene needs out of the captures, as JPEG sequences in work/frames/<scene>/0001.jpg ... at 30 fps.
// The composition shows frame k of a scene at film time start + (k - 1) / 30, so the picture is a pure function of time.
// Usage: node video/extract.mjs        (needs ffmpeg on PATH and the captures in video/captures/)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS, scenes } from './scenes.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const captures = join(root, 'captures');
const frames = join(root, 'work', 'frames');

for (const scene of scenes) {
  if (!scene.clip) continue;
  const input = join(captures, `${scene.clip}.mp4`);
  if (!existsSync(input))
    throw new Error(`Missing capture ${input}; run the E2E spec ui-product-video first (README).`);
  const out = join(frames, scene.id);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const duration = scene.end - scene.start + 0.2;
  // -ss after -i: frame-exact on these constant 30 fps captures.
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-ss',
    String(scene.src),
    '-t',
    String(duration),
    '-r',
    String(FPS),
    '-q:v',
    '2',
    join(out, '%04d.jpg'),
  ]);
  console.log(`${scene.id}: ${scene.clip} ${scene.src}s + ${duration.toFixed(1)}s`);
}

// The still behind the phone scene.
mkdirSync(join(root, 'work'), { recursive: true });
copyFileSync(join(captures, 'still-regie-studio-dark.png'), join(root, 'work', 'regie.png'));
