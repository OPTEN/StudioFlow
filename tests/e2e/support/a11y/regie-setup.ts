import { expect, type Page } from '@playwright/test';
import type { RegiePage } from '../ui/regie';
import type { NewUiContextOptions } from '../ui';
import type { PairContext } from '../production';
import { seedBusyConsole, type SeedOptions, type SeededConsole } from './seed';

/**
 * Opens the Regie on a seeded production in a context of its own (viewport, touch, colour scheme, reduced motion).
 * `openRegie` is the UI fixture of support/ui/fixtures.ts.
 */

export interface BusyRegieOptions extends SeedOptions {
  viewport?: { width: number; height: number };
  /** Touch device (390 x 844 test). */
  touch?: boolean;
  reducedMotion?: 'reduce' | 'no-preference';
  forcedColors?: 'active' | 'none';
  studio?: boolean;
  /** Extra context options (init script, permissions ...). */
  context?: NonNullable<NewUiContextOptions['context']>;
  /** Do not wait for the five station rows (seeds with fewer stations). */
  waitForStations?: boolean;
}

export interface Fixtures {
  openRegie: (options?: { login?: 'api' | 'ui'; contextOptions?: NewUiContextOptions }) => Promise<RegiePage>;
  pairContext: PairContext;
  onCleanup: (fn: () => Promise<unknown> | unknown) => void;
}

export async function openBusyRegie(fx: Fixtures, options: BusyRegieOptions = {}): Promise<{ regie: RegiePage; seeded: SeededConsole }> {
  const seeded = await seedBusyConsole(fx.pairContext, fx.onCleanup, options);
  const regie = await openRegieOn(fx, options);
  if (options.waitForStations !== false && seeded.stations.length > 0) {
    for (const station of seeded.stations) await expect(regie.station(station.name)).toBeVisible({ timeout: 20_000 });
  }
  if (options.studio !== undefined) await regie.setStudioMode(options.studio);
  // The click on the switch left the focus on it; start from the document like a freshly loaded page.
  await regie.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await settle(regie.page);
  return { regie, seeded };
}

/** Opens the Regie only (the production is already seeded). */
export async function openRegieOn(fx: Pick<Fixtures, 'openRegie'>, options: BusyRegieOptions = {}): Promise<RegiePage> {
  const viewport = options.viewport ?? { width: 1440, height: 900 };
  const contextOptions: NewUiContextOptions = {
    context: {
      viewport,
      ...(options.touch ? { hasTouch: true, isMobile: true } : {}),
      ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
      ...(options.forcedColors ? { forcedColors: options.forcedColors } : {}),
      ...options.context,
    },
  };
  return fx.openRegie({ contextOptions });
}

/** Fonts loaded and the layout quiet: two animation frames after `document.fonts.ready`. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
