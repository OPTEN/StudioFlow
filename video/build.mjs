// Builds the product video from its source in one go: optionally records the UI again, then cuts the frames, makes the
// music and the effects, mixes them and renders the three formats. The Pages workflow runs this; it works locally too.
//
//   npm run build:video                       from the captures in video/captures/
//   npm run build:video -- --capture          record the UI first (E2E stack 5, started and removed again; needs Docker)
//   npm run build:video -- --capture --stack 1
//
// Needs Node, ffmpeg and a Python with video/audio/requirements.txt and earshot (video/audio/earshot.txt); set PYTHON to
// that interpreter when it is not the `python` on PATH. Output: video/out/ (render.mjs lists the files); the files the
// site plays are copied to site/public/media/, which is committed (the Pages workflow does not render).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const videoDir = fileURLToPath(new URL('.', import.meta.url));
const repo = join(videoDir, '..');
const args = process.argv.slice(2);
const stack = args.includes('--stack') ? args[args.indexOf('--stack') + 1] : '5';
const python = process.env.PYTHON ?? 'python';
const audio = join(videoDir, 'work', 'audio');

const run = (command, commandArgs, env = {}) => {
  console.log(`\n> ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error})`);
};

if (args.includes('--capture')) {
  run('bash', ['tests/e2e/stack.sh', 'up', stack]);
  try {
    run(
      'bash',
      [
        'tests/e2e/stack.sh',
        'test',
        stack,
        '--project=desktop-chromium',
        'specs/ui/ui-product-video.spec.ts',
      ],
      { E2E_PRODUCT_VIDEO: '1', E2E_REUSE_STACK: '1' },
    );
  } finally {
    run('bash', ['tests/e2e/stack.sh', 'down', stack]);
  }
}

run('node', ['video/extract.mjs']);
// music.py writes into this folder; a fresh checkout (CI) does not have it yet.
mkdirSync(audio, { recursive: true });
run(python, ['video/audio/music.py', join(audio, 'music.wav')]);
run(python, [
  '-m',
  'earshot',
  'kit',
  'render',
  'video/audio/kit.json',
  '--out',
  join(audio, 'kit'),
]);
run(python, [
  'video/audio/mix.py',
  join(audio, 'music.wav'),
  join(audio, 'kit'),
  join(videoDir, 'out', 'audio', 'mix.wav'),
]);
run('node', ['video/render.mjs']);

const media = join(repo, 'site', 'public', 'media');
mkdirSync(media, { recursive: true });
for (const file of ['studioflow.mp4', 'studioflow-vertical.mp4', 'studioflow.vtt'])
  copyFileSync(join(videoDir, 'out', file), join(media, file));
console.log(`
Copied the site's video to ${media}; commit it to publish.`);
