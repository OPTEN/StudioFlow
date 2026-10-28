import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain JavaScript module of the repository tools
import { buildPrototypeFile } from '../tools/lib/prototype-files.mjs';

// The product site on GitHub Pages (issue 67): https://opten.github.io/StudioFlow/. Build with `npm run build:site`, preview
// with `npm run start:site`. Output: dist/site.
const root = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(root, '..');
const media = join(root, 'public', 'media');

/**
 * The product video (issue 69) is not in Git: pages.yml downloads it from the release asset into site/public/media before the
 * build. When it is there, the hero monitor plays it with the Regie screenshot as poster; without it the hero shows the screenshot.
 */
function productVideo(): Plugin {
  return {
    name: 'studioflow-product-video',
    transformIndexHtml(html) {
      const files = existsSync(media) ? readdirSync(media) : [];
      if (!files.includes('studioflow.mp4')) return html;
      const vertical = files.includes('studioflow-vertical.mp4')
        ? '<source media="(max-width: 700px) and (orientation: portrait)" src="./media/studioflow-vertical.mp4" type="video/mp4" />'
        : '';
      const captions = files.includes('studioflow.vtt')
        ? '<track kind="captions" src="./media/studioflow.vtt" srclang="en" label="English" />'
        : '';
      return html.replace(
        /<picture>[\s\S]*?data-hero-poster[\s\S]*?<\/picture>/,
        `<video data-hero-video autoplay muted loop playsinline controls preload="metadata" poster="./hero-poster.webp"
          aria-label="Product video: phones join as cameras, the Regie switches, the program goes on air (synthetic demo content)">
          ${vertical}<source src="./media/studioflow.mp4" type="video/mp4" />${captions}
        </video>`,
      );
    },
  };
}

/** The clickable prototype as one file next to the page (fixes the dead release link of issue 64 for the site), and the
 * SIL Open Font License texts of the two fonts the site serves. */
function prototype(): Plugin {
  let outDir = '';
  return {
    name: 'studioflow-prototype',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/StudioFlow/studioflow-prototype.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(buildPrototypeFile(repo));
      });
    },
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'studioflow-prototype.html'), buildPrototypeFile(repo));
      mkdirSync(join(outDir, 'licenses'), { recursive: true });
      for (const file of ['OFL-SofiaSansSemiCondensed.txt', 'OFL-JetBrainsMono.txt']) {
        copyFileSync(join(repo, 'prototype', 'fonts', file), join(outDir, 'licenses', file));
      }
    },
  };
}

export default defineConfig({
  root,
  base: '/StudioFlow/',
  publicDir: 'public',
  plugins: [productVideo(), prototype()],
  server: { fs: { allow: [repo] } },
  build: {
    outDir: resolve(repo, 'dist/site'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
  },
});
