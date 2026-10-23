import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Aliases mirror the `paths` in tsconfig.json so packages are consumed as TypeScript source. A key also matches its
 * subpaths and the first match wins, so `@studioflow/media-client/device` must come before `@studioflow/media-client`.
 */
const alias = {
  '@studioflow/scene-model': fromRoot('./packages/scene-model/src/index.ts'),
  '@studioflow/scene-renderer': fromRoot('./packages/scene-renderer/src/index.ts'),
  '@studioflow/media-client/device': fromRoot('./packages/media-client/src/device.ts'),
  '@studioflow/media-client': fromRoot('./packages/media-client/src/index.ts'),
  '@studioflow/realtime-client': fromRoot('./packages/realtime-client/src/index.ts'),
};

/**
 * Unit tests for the framework-free code (shared packages and output page).
 * The Angular apps run their own tests through `ng test`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'model',
          globals: true,
          environment: 'node',
          include: [
            'packages/scene-model/src/**/*.spec.ts',
            'packages/realtime-client/src/**/*.spec.ts',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          globals: true,
          environment: 'happy-dom',
          include: [
            'packages/scene-renderer/src/**/*.spec.ts',
            'packages/media-client/src/**/*.spec.ts',
            'apps/output/src/**/*.spec.ts',
          ],
        },
      },
    ],
  },
});
