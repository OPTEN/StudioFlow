// Renders the product video: serves the repository, opens video/composition in Chromium (Playwright from the repo's
// node_modules), captures every frame with window.renderFrame(t) and pipes it to ffmpeg. Frame 0 is the poster frame,
// so every platform's thumbnail shows it (the duration and the audio sync stay the same).
//
//   node video/render.mjs                         all three formats, with video/out/audio/mix.wav when it exists
//   node video/render.mjs --format landscape      one format (landscape | vertical | square)
//   node video/render.mjs --stills 1.2,6,12.5     PNG stills of each format into video/work/stills (no video)
//
// Output: video/out/studioflow.mp4 (16:9), studioflow-vertical.mp4 (9:16), studioflow-square.mp4 (1:1),
// studioflow.jpg (poster), studioflow.vtt (captions).
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { captionCues, DURATION, FPS } from './scenes.mjs';

const videoDir = fileURLToPath(new URL('.', import.meta.url));
const repo = join(videoDir, '..');
const outDir = join(videoDir, 'out');
const POSTER_T = 2.6; // "Just phones.": the hook, settled
const FORMATS = {
  landscape: { width: 1920, height: 1080, file: 'studioflow.mp4' },
  vertical: { width: 1080, height: 1920, file: 'studioflow-vertical.mp4' },
  square: { width: 1080, height: 1080, file: 'studioflow-square.mp4' },
};

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const formats = option('--format') ? [option('--format')] : Object.keys(FORMATS);
const stills = option('--stills')?.split(',').map(Number);

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};
const server = createServer((request, response) => {
  const path = normalize(join(repo, decodeURIComponent(new URL(request.url, 'http://x').pathname)));
  if (!path.startsWith(repo) || !existsSync(path) || statSync(path).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/video/composition/index.html`;

// The QR that covers the pairing QR of the capture (scenes.mjs coverQr): the product site, drawn by uqr like the Regie's own.
const { renderSVG } = await import('uqr');
mkdirSync(join(videoDir, 'work'), { recursive: true });
writeFileSync(
  join(videoDir, 'work', 'qr.svg'),
  renderSVG('https://opten.github.io/StudioFlow/', { ecc: 'M', border: 0 }),
);

const browser = await chromium.launch();
mkdirSync(outDir, { recursive: true });

const vttTime = (s) => {
  const ms = Math.round(s * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};
writeFileSync(
  join(outDir, 'studioflow.vtt'),
  `WEBVTT\n\n${captionCues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n')}`,
);

for (const name of formats) {
  const spec = FORMATS[name];
  const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height } });
  await page.goto(`${base}?format=${name}`);
  await page.evaluate(() => window.ready);
  const shot = async (t) => {
    await page.evaluate((time) => window.renderFrame(time), t);
    return page.screenshot({ type: 'png' });
  };

  if (stills) {
    const dir = join(videoDir, 'work', 'stills');
    mkdirSync(dir, { recursive: true });
    for (const t of stills) writeFileSync(join(dir, `${name}-${t.toFixed(2)}.png`), await shot(t));
    console.log(`${name}: ${stills.length} stills`);
    await page.close();
    continue;
  }

  const mix = join(outDir, 'audio', 'mix.wav');
  const withAudio = existsSync(mix);
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      String(FPS),
      '-i',
      '-',
      ...(withAudio ? ['-i', mix] : []),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      ...(withAudio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
      '-movflags',
      '+faststart',
      join(outDir, spec.file),
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise((resolve, reject) =>
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`)))),
  );

  const total = Math.round(DURATION * FPS);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const png = await shot(i === 0 ? POSTER_T : i / FPS);
    if (i === 0 && name === 'landscape') writeFileSync(join(outDir, 'studioflow-poster.png'), png);
    if (!ffmpeg.stdin.write(png))
      await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    if (i % 150 === 0)
      console.log(`${name}: frame ${i}/${total} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  ffmpeg.stdin.end();
  await done;
  console.log(`${name}: wrote ${spec.file}${withAudio ? ' with audio' : ' (no audio yet)'}`);
  await page.close();
}

if (!stills && formats.includes('landscape')) {
  await new Promise((resolve) =>
    spawn('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      join(outDir, 'studioflow-poster.png'),
      '-q:v',
      '2',
      join(outDir, 'studioflow.jpg'),
    ]).on('close', resolve),
  );
}
await browser.close();
server.close();
