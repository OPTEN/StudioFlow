import { test as base, expect } from '../fixtures';
import { installUiInit, newUiContext, type NewUiContextOptions, type UiInitOptions } from './init';
import { OutputPage, type EmbedOptions, type OutputFlags, type OutputTarget } from './output';
import { RegiePage } from './regie';
import { AudioStationSender, LaptopSender, PhoneSender } from './sender';

/**
 * Fixtures of the UI tests: `import { test, expect } from '../../support/ui/fixtures'` instead of `support/fixtures`
 * (this `test` extends it, so `config`, `api`, `production`, `pairContext`, `onCleanup` ... are all there).
 *
 *  - `context` / `page`: the test's own browser context with the UI init (test hooks flag, media counters, fake
 *    screen); override its options per file with `test.use({ uiInit: { ... } })`.
 *  - `regie`: the Regie in `page`'s context, logged in by cookie injection, hub live, showing the `production`.
 *  - `openRegie(options)`: further Regies (a second operator, UI login) in their own contexts.
 *  - `openPhone(options)` / `openLaptop(options)`: senders in contexts of their own (Pixel 7 / iPhone 15 / Desktop
 *    profile, fake media); closed after the test.
 *  - `openOutput(production, flags)` / `embedOutput(production, options)`: the output page, directly or in an iframe
 *    on `https://embed.test`.
 */

export interface UiFixtures {
  regie: RegiePage;
  openRegie: (options?: {
    login?: 'api' | 'ui';
    contextOptions?: NewUiContextOptions;
  }) => Promise<RegiePage>;
  openPhone: (options?: NewUiContextOptions) => Promise<PhoneSender>;
  openLaptop: (options?: NewUiContextOptions) => Promise<LaptopSender>;
  openAudioStation: (options?: NewUiContextOptions) => Promise<AudioStationSender>;
  openOutput: (
    target: OutputTarget,
    flags?: OutputFlags,
    options?: { context?: NewUiContextOptions },
  ) => Promise<OutputPage>;
  embedOutput: (
    target: OutputTarget,
    options?: EmbedOptions & { context?: NewUiContextOptions },
  ) => Promise<OutputPage>;
}

export interface UiOptions {
  /** Options of {@link installUiInit} for the default `context`. */
  uiInit: UiInitOptions;
}

/** The context options of a fixture: the locale of the project (`use.locale`) unless the test sets its own. */
function withLocale(locale: string | undefined, options: NewUiContextOptions = {}): NewUiContextOptions {
  return { ...options, context: { ...(locale ? { locale } : {}), ...options.context } };
}

export const test = base.extend<UiFixtures & UiOptions>({
  uiInit: [{}, { option: true }],

  context: async ({ context, uiInit }, use) => {
    await installUiInit(context, uiInit);
    await use(context);
  },

  regie: async ({ context, api, production, onCleanup }, use) => {
    void production; // the production is created and activated first, so the Regie loads it
    const regie = await RegiePage.open(context, { login: 'api', cookie: api.cookie });
    onCleanup(() => regie.page.close());
    await use(regie);
  },

  openRegie: async ({ browser, api, production, onCleanup, locale }, use) => {
    void production;
    await use(async (options = {}) => {
      const context = await newUiContext(browser, withLocale(locale, options.contextOptions));
      onCleanup(() => context.close());
      return RegiePage.open(context, { login: options.login ?? 'api', cookie: api.cookie });
    });
  },

  openPhone: async ({ browser, onCleanup, locale }, use) => {
    await use(async (options = {}) => {
      const phone = await PhoneSender.open(browser, withLocale(locale, options));
      onCleanup(() => phone.close());
      return phone;
    });
  },

  openLaptop: async ({ browser, onCleanup, locale }, use) => {
    await use(async (options = {}) => {
      const laptop = await LaptopSender.open(browser, withLocale(locale, options));
      onCleanup(() => laptop.close());
      return laptop;
    });
  },

  openAudioStation: async ({ browser, onCleanup, locale }, use) => {
    await use(async (options = {}) => {
      const station = await AudioStationSender.open(browser, withLocale(locale, options));
      onCleanup(() => station.close());
      return station;
    });
  },

  openOutput: async ({ browser, onCleanup, locale }, use) => {
    await use(async (target, flags = {}, options = {}) => {
      const context = await newUiContext(browser, withLocale(locale, options.context));
      onCleanup(() => context.close());
      return OutputPage.open(context, target, flags);
    });
  },

  embedOutput: async ({ browser, onCleanup, locale }, use) => {
    await use(async (target, options = {}) => {
      const { context: contextOptions, ...embed } = options;
      const context = await newUiContext(browser, withLocale(locale, contextOptions));
      onCleanup(() => context.close());
      return OutputPage.embed(context, target, embed);
    });
  },
});

export { expect };
