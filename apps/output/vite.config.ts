import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/**
 * Output page: framework-free, served by Caddy under /o/ (one index.html for every /o/{slug}).
 * Shared packages are consumed as TypeScript source, like in the Angular apps.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/o/',
  publicDir: 'public',
  resolve: {
    alias: {
      '@flowstudio/scene-model': fromRoot('packages/scene-model/src/index.ts'),
      '@flowstudio/scene-renderer': fromRoot('packages/scene-renderer/src/index.ts'),
      '@flowstudio/media-client': fromRoot('packages/media-client/src/index.ts'),
      '@flowstudio/realtime-client': fromRoot('packages/realtime-client/src/index.ts'),
    },
  },
  build: {
    outDir: fromRoot('dist/output'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
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
