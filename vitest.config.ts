import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Aliases mirror the `paths` in tsconfig.json so packages are consumed as TypeScript source. A key also matches its
 * subpaths and the first match wins, so `@studioflow/media-client/device` must come before `@studioflow/media-client`
 * and `@studioflow/i18n/angular` before `@studioflow/i18n`.
 */
const alias = {
  '@studioflow/i18n/angular': fromRoot('./packages/i18n/src/angular.ts'),
  '@studioflow/i18n': fromRoot('./packages/i18n/src/index.ts'),
  '@studioflow/scene-model': fromRoot('./packages/scene-model/src/index.ts'),
  '@studioflow/scene-renderer': fromRoot('./packages/scene-renderer/src/index.ts'),
  '@studioflow/media-client/device': fromRoot('./packages/media-client/src/device.ts'),
  '@studioflow/media-client': fromRoot('./packages/media-client/src/index.ts'),
  '@studioflow/realtime-client': fromRoot('./packages/realtime-client/src/index.ts'),
};

/** Resets the locale to English before every test, so a test never depends on the one before it. */
const setupFiles = [fromRoot('./packages/i18n/src/testing-setup.ts')];

/**
 * Unit tests for the framework-free code (shared packages and output page) and the repository tools.
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
          setupFiles,
          include: [
            'packages/scene-model/src/**/*.spec.ts',
            'packages/realtime-client/src/**/*.spec.ts',
            'tools/lib/**/*.spec.ts',
            'tests/e2e/support/perf/**/*.spec.ts',
            'tests/e2e/support/output/**/*.spec.ts',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          globals: true,
          environment: 'happy-dom',
          setupFiles,
          include: [
            'packages/i18n/src/**/*.spec.ts',
            'packages/scene-renderer/src/**/*.spec.ts',
            'packages/media-client/src/**/*.spec.ts',
            'apps/output/src/**/*.spec.ts',
          ],
        },
      },
    ],
  },
});
