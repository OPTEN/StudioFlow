import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/**
 * Output page: framework-free, served by Caddy under /o/ (one index.html for every /o/{slug}).
 * Shared packages are consumed as TypeScript source, like in the Angular apps (aliases mirror the tsconfig.json
 * `paths`; a key also matches its subpaths and the first match wins, so the `/device` entry comes first).
 * No source maps are published: nothing in production needs them, and they would expose the source under /o/.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/o/',
  publicDir: 'public',
  resolve: {
    alias: {
      // Only the framework-free entry: the output bundle must never pull in Angular (@studioflow/i18n/angular).
      '@studioflow/i18n': fromRoot('packages/i18n/src/index.ts'),
      '@studioflow/scene-model': fromRoot('packages/scene-model/src/index.ts'),
      '@studioflow/scene-renderer': fromRoot('packages/scene-renderer/src/index.ts'),
      '@studioflow/media-client/device': fromRoot('packages/media-client/src/device.ts'),
      '@studioflow/media-client': fromRoot('packages/media-client/src/index.ts'),
      '@studioflow/realtime-client': fromRoot('packages/realtime-client/src/index.ts'),
    },
  },
  build: {
    outDir: fromRoot('dist/output'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    // The lazy livekit-media chunk is ~550 KB minified (~145 KB gzip): livekit-client is not tree-shakable.
    chunkSizeWarningLimit: 650,
  },
  server: {
    port: 4202,
    proxy: {
      '/api': 'http://localhost:5298',
      '/hubs': { target: 'http://localhost:5298', ws: true },
      '/rtc': { target: 'http://localhost:7880', ws: true },
    },
  },
});
