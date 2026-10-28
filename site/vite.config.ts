import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain JavaScript module of the repository tools
import { buildPrototypeFile } from '../tools/lib/prototype-files.mjs';

// The product site on GitHub Pages (issue 67): https://opten.github.io/StudioFlow/. Build with `npm run build:site`, preview
// with `npm run start:site`. Output: dist/site.
const root = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(root, '..');

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
  plugins: [prototype()],
  server: { fs: { allow: [repo] } },
  build: {
    outDir: resolve(repo, 'dist/site'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
  },
});
