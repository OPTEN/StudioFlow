# Design: issue #6, English source language and a typed i18n layer

Written 2026-10-23 as the binding design for issue #6 (after the #3 rename). Paths are relative to the repository root.

## 0. Pinned decisions

These need to be fixed before the briefs go out, because parallel agents must not decide them individually. D3 and D5 are the two I recommend the owner confirms.

| # | Decision |
|---|---|
| D1 | Locales are `en` (source) and `de-CH`. `parseLocaleTag`: `en`, `en-*` → `en`; `de`, `de-*` (DE, AT, LI) → `de-CH`; anything else → `en`. |
| D2 | Setting is `'auto' \| 'en' \| 'de-CH'` in `localStorage['studioflow.locale']`, with the key absent meaning auto. Regie, `/monitoring` and sender are one origin and share the key. A `storage` event switches other open tabs live. The output page ignores storage and uses `?lang=` → `navigator.languages` → `en`. |
| D3 | `Intl.NumberFormat('de-CH')` produces a decimal point (`2.8`, `1’234.5`), but the product convention (DESIGN.md, E2E pins) is a decimal comma. So `LOCALES['de-CH'].numberTag = 'de-DE'` while `dateTag` stays `'de-CH'`. If the owner prefers CLDR, it is a one-field change. |
| D4 | The clock is always 24 h (`hourCycle: 'h23'`), also for English. `en` uses `numberTag 'en'` and `dateTag 'en-GB'`. |
| D5 | The English UI says "Control room" for the Regie. Code, docs and file names keep "Regie" as a proper noun, glossed once as "Regie (control room)". The word "Regie" is exempt from the German check. |
| D6 | Quotation marks: English uses “…” and ’; German uses « » and ’. Both live inside catalogue strings, never in code. |
| D7 | API texts are English. Clients localise by `code`. UI never displays server `detail` or field messages except as a last-resort fallback for unknown codes. `ApiError.detail` stays for diagnostics only. |
| D8 | Server-created defaults are English with no contract change: scenes "Welcome / Presentation / Break", slates "Starting soon" / "Thanks for watching", label suffix "· Camera". This is a documented limitation; a follow-up could add optional seed texts to `CreateProductionRequest`. |
| D9 | Ops scripts, `.env.example`, compose messages and CLI output are English only and ASCII only (no « », no `…`, no `–`), because Windows PowerShell 5.1 mangles non-BOM UTF-8. They have no i18n layer. |
| D10 | German identifiers in URLs are renamed: `/join/warten` → `/join/waiting` and `/o/_uhr` → `/o/_clock`. Hard switch, no redirect, consistent with #3. PWA `manifest.webmanifest` becomes `lang: "en"` with an English description. |
| D11 | Catalogues are eager and single: both locales are bundled and there is no per-app split. The foundation measures the bundle budgets. Lazy-loading `de-CH` is a follow-up only if budgets fail. |
| D12 | E2E runs in `en-US` plus a small `de-CH` project (`specs/i18n`). E2E text lives in `tests/e2e/support/text.ts` as literal strings and does NOT import the product catalogue (black-box principle). |
| D13 | Exempt from the German check: `.impeccable/**` (design-tool state), `docs/history/**`, generated files, the `de-CH` catalogue and the German test files. |

### Glossary (German → English), fixed for all agents
- Szene → Scene; Quelle → Source; Element → Item; Vorlage → Template; Auto-Grid → Auto grid; Dock → Dock; Stationen/Station → Stations/Station; Eigenschaften → Properties.
- Studio-Modus → Studio Mode; Blende → Fade; Schnitt → Cut; Take → Take; Sendung → Broadcast; Standbild → freeze frame; "Bei Ausfall" → "On failure".
- Gerät → Device; Handy → Phone; koppeln → pair; Einladung → Invite; Technik-Check → Tech check.
- Störung → Incident; Meldungen → Messages; "Letzte Ereignisse" → Recent events; "Gesehen" → Seen; zulassen/ablehnen/sperren/entsperren → allow/deny/block/unblock.
- Status words: "verbindet neu" → reconnecting; "verbindet …" → connecting…; "Kamera beendet" → camera stopped; "Teilen beendet" → sharing stopped; gesperrt → blocked; "kein Bild" → no picture; "nicht verbunden" → not connected.
- Slates: "Gleich geht's los" → "Starting soon"; "Danke fürs Zuschauen" → "Thanks for watching"; "Kein Zugang" → "No access"; "Bild kommt gleich zurück" → "Picture returns shortly"; "Quelle fehlt" → "Source missing".

The foundation commits the full table to `docs/i18n.md`.

## 1. `packages/i18n` API

### Layout
```
packages/i18n/
  tsconfig.json                    // extends ../../tsconfig.packages.json, include src/**/*.ts
  src/
    index.ts                       // public, framework-free
    angular.ts                     // secondary entry @studioflow/i18n/angular (imports @angular/core)
    types.ts  locales.ts  store.ts  translate.ts  format.ts
    catalogue.ts                   // exports catalogues, MessageKey (reads messages/*/index.ts)
    testing-setup.ts               // vitest setup: beforeEach(() => resetLocaleForTests('en'))
    messages/en/*.ts  messages/de-CH/*.ts   (+ generated index.ts per locale)
    *.spec.ts
```
Path wiring (foundation-owned):
- `tsconfig.json` paths: `@studioflow/i18n` → `packages/i18n/src/index.ts`, `@studioflow/i18n/angular` → `packages/i18n/src/angular.ts`.
- Mirror both in `vitest.config.ts` aliases. The `/angular` entry goes first, because the first match wins.
- Add only `@studioflow/i18n` to `apps/output/vite.config.ts`, so the output bundle can never pull in Angular. `check:i18n` forbids importing `@studioflow/i18n/angular` outside `apps/studio` and `apps/sender`.
- Add `setupFiles` to vitest (`packages/i18n/src/testing-setup.ts`) and to the `test` targets in `angular.json` (`apps/studio/src/testing/setup-i18n.ts`, `apps/sender/src/testing/setup-i18n.ts`). The Angular unit-test builder supports `setupFiles`.
- `isolatedModules` is on, so re-exports of types must be `export type`.

### Types (`types.ts`)
```ts
export interface PluralMessage {
  readonly '=0'?: string;            // ICU-style exact zero, any locale
  readonly zero?: string; readonly one?: string; readonly two?: string;
  readonly few?: string;  readonly many?: string;
  readonly other: string;            // always required
}
export type MessageValue = string | PluralMessage;
export type Namespace<P extends string> = { readonly [K in `${P}.${string}`]: MessageValue };
export type Catalogue = Readonly<Record<string, MessageValue>>;

// Placeholders are parsed from the English literal type: {name}
type Names<S extends string> = S extends `${string}{${infer N}}${infer R}` ? N | Names<R> : never;
export type Params<K extends MessageKey> =
  /* plural  */ (typeof en)[K] extends PluralMessage ? { count: number } & Record<Exclude<Names<Forms>, 'count'>, string | number>
  /* string  */ : [Names<(typeof en)[K] & string>] extends [never] ? undefined : Record<Names<(typeof en)[K] & string>, string | number>;
export type TArgs<K extends MessageKey> = Params<K> extends undefined ? [params?: undefined] : [params: Params<K>];

// German (and every future locale) must mirror English exactly: missing key, extra key or wrong shape is a compile error.
export type Translation<E extends Catalogue> = {
  readonly [K in keyof E]: E[K] extends string ? string : PluralMessage;
};
```
Interpolation rules:
- Syntax is `{name}`.
- Literal braces are forbidden in messages (a spec checks this).
- `t` never formats numbers. Callers pass strings from the format helpers, and `count` is inserted with `String(count)`.
- A missing runtime param leaves `{name}` in place and reports it.

### Locale and store (`locales.ts`, `store.ts`)
```ts
export const SUPPORTED_LOCALES = ['en', 'de-CH'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LocaleSetting = 'auto' | Locale;
export const SOURCE_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'studioflow.locale';
export interface LocaleInfo { tag: Locale; nativeName: string; numberTag: string; dateTag: string }
export const LOCALES: Record<Locale, LocaleInfo>;     // D3/D4 live here
export function parseLocaleTag(tag: string | null | undefined): Locale | null;
export function resolveLocale(setting: LocaleSetting, languages: readonly string[]): Locale; // setting → first matching navigator language → 'en'

export interface InitOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;  // default localStorage inside try/catch
  languages?: readonly string[];                                          // default navigator.languages
  setting?: LocaleSetting;                                                // override, not persisted (output ?lang=)
  document?: Document | null;                                             // syncs <html lang>; default globalThis.document
}
export function initLocale(options?: InitOptions): Locale;   // idempotent; adds the 'storage' listener
export function getLocale(): Locale;                         // reader() ?? state.locale
export function getLocaleSetting(): LocaleSetting;
export function setLocaleSetting(setting: LocaleSetting): Locale;  // 'auto' removes the key, otherwise writes it; notifies listeners
export function onLocaleChange(listener: (locale: Locale) => void): () => void;
export function installLocaleReader(reader: (() => Locale) | null): void;
export function resetLocaleForTests(setting?: LocaleSetting): void;
```

### Translate (`translate.ts`)
```ts
export function t<K extends MessageKey>(key: K, ...args: TArgs<K>): string;
export function tFor(locale: Locale): typeof t;           // explicit locale: tests, English diagnostic notes
export interface Msg { readonly key: MessageKey; readonly params?: Readonly<Record<string, string | number>> }
export function msg<K extends MessageKey>(key: K, ...args: TArgs<K>): Msg;   // typed at creation, resolved later
export function tm(m: Msg | null | undefined): string;                        // '' for null
export function key<K extends MessageKey>(k: K): K;                           // identity; for `satisfies` tables
```
Resolution order:
1. The active locale's catalogue.
2. The English catalogue.
3. The key itself.

A missing key calls a `setMissingHandler` hook (default: one `console.error`) and records the key in `missingKeys` for tests.

Plurals use `new Intl.PluralRules(getLocale()).select(count)`, then `'=0'` if `count === 0`, then the category, then `other`. `Intl.PluralRules` instances are cached.

### Format helpers (`format.ts`)
All helpers use `getLocale()` and cache `Intl` instances keyed by tag and options:
```ts
formatNumber(value, { minimumFractionDigits?, maximumFractionDigits?, signDisplay? }): string   // uses numberTag; default signDisplay 'negative' (no "-0.0")
formatTime(date, { seconds?: boolean }): string      // dateTag, hourCycle h23, 2-digit
formatDate(date): string;  formatDateTime(date): string
compareText(a, b, { numeric?: boolean }): number     // Intl.Collator(dateTag, sensitivity 'base')
lowerCase(s): string                                 // toLocaleLowerCase(dateTag)
```
They take finite numbers and valid dates only. Callers keep the "unknown" handling (`MISSING_VALUE` stays in scene-model).

### How framework-free packages get the locale, and how switching stays reactive
`scene-model`, `scene-renderer`, `media-client` and the output page call `t()` directly, with no locale parameter. `getLocale()` goes through an optional reader. The Angular glue (`@studioflow/i18n/angular`) installs `() => localeSignal()` as that reader. As a result, any `t()` call made inside an Angular `computed()` or a template, including those inside `statusWord()` or `healthSummary()`, registers a signal dependency. Locale switches then re-render without a reload and without callers threading the locale through. Outside Angular (output page, plain vitest) the reader is null and the plain store variable is used.

`scene-renderer` is imperative DOM. Item, overlay and slate views recompute their text in each render pass and assign `textContent` only when it changed. The renderer subscribes once via `onLocaleChange` to request a render and unsubscribes on destroy.

Runtime switching rules, to be copied into every brief:
- **R1:** Never store a translated string in module scope or in decorator metadata (`host: { 'aria-label': … }`, `Routes[].title`). Store a `MessageKey` or `Msg` and resolve at render time. Dock titles become `DOCK_TITLE_KEYS = {...} as const satisfies Record<DockId, MessageKey>`.
- Values that outlive an interaction (banners, slot messages, inline errors, connection labels) hold a key or `Msg`. Toasts (≤6 s) and one-shot confirmations may hold strings.
- Code-to-key mapping uses typed template literals, e.g. ``t(`media.slot.failure.${failure}`)``. Tables must be `satisfies Record<Code, MessageKey>`.

## 2. Catalogue layout (merge-conflict-minimising)

One file per area/feature in both locales, names mirrored:
```
packages/i18n/src/messages/en/regie-scenes.ts
packages/i18n/src/messages/de-CH/regie-scenes.ts
```
Rules:
- **Prefix rule.** The file `<area>-<feature>.ts` owns exactly the keys `<area>.<feature>.*` (for example `regie-scenes.ts` owns `regie.scenes.*`; `common.ts` owns `common.*`). Keys are flat, one message per line, and ≤4 dot segments. They describe purpose, not text, for example `regie.scenes.row.menuLabel`.
- **English file:**
  ```ts
  import type { Namespace } from '../../types';
  export const regieScenes = {
    'regie.scenes.dock.title': 'Scenes',
    'regie.scenes.count': { '=0': 'No scenes', one: '{count} scene', other: '{count} scenes' },
    'regie.scenes.toast.created': 'Scene “{name}” created',
  } as const satisfies Namespace<'regie.scenes'>;
  ```
  The spike must prove that `satisfies Namespace<…>` rejects keys outside the prefix.
- **German file** is annotated against the English counterpart, so a missing or extra key is a TS error:
  ```ts
  import type { regieScenes as en } from '../en/regie-scenes';
  import type { Translation } from '../../types';
  export const regieScenes: Translation<typeof en> = { … };
  ```
- **Parity tests** (`catalogue.spec.ts`, which TS cannot do) cover each of these:
  - the placeholder sets of en and de-CH are equal per key (and per plural form);
  - the plural forms provide every category in `new Intl.PluralRules(locale).resolvedOptions().pluralCategories`;
  - no empty strings, no literal braces, no duplicate keys across namespaces;
  - every file's keys match its prefix.
- **Aggregation without hand-edited lists.** `tools/i18n-index.mjs` (`npm run i18n:index`) scans `messages/<locale>/*.ts` and writes `messages/<locale>/index.ts`, with sorted one-per-line imports and a single spread object. `en` exports `en = {…} as const`; `de-CH` exports `deCH: Translation<typeof en>`. `catalogue.ts` derives `export type MessageKey = keyof typeof en`.
- **Conflict handling.**
  - `.gitattributes` gets `packages/i18n/src/messages/*/index.ts merge=union`. A later feature adds its two files, runs `npm run i18n:index`, and two parallel features never produce conflict markers. `check:i18n` (`i18n-index.mjs --check`) fails if an index is stale or unioned wrongly.
  - Untranslated markers: there is no escape hatch, because German is compiler-enforced. `check:i18n` warns when a de-CH value equals the English value, except for entries in a short `IDENTICAL_OK` list (Output, Dock, Screen, Take, Tally, …).
- **Fan-out freeze.** The foundation pre-creates every namespace file in §8 (empty or seeded), so during the parallel phase no package touches `index.ts` or anyone else's file. A package needing an extra namespace file adds it inside its own prefix family and leaves the index to the integrator.
- **`common.ts` is frozen after the foundation.** It holds only `common.{ok,cancel,close,retry,save,delete,back,next,loading,yes,no,apply,language,...}`. Duplicated words across feature namespaces are acceptable.

Copy rules for all briefs:
- **Interpolation and plurals:** use `{param}` interpolation and plural messages, and never assemble a sentence from fragments.
- **Numbers and dates:** go only through `@studioflow/i18n` or scene-model `format*`. Banned outside the package: `toFixed(`+`replace('.', ',')`, `toLocale*String`, `Intl.` constructors, `Intl.Collator('de-CH')`, Angular `DatePipe`/`DecimalPipe`/`PercentPipe`/`registerLocaleData`. `check:i18n` greps for these.
- **English copy style:** sentence case; no trailing period on labels and buttons; full sentences end with a period.
- **Aria and visible text:** `aria-label` and visible text are separate keys when they differ.
- **Never translated:** product name, slot codes (K1/S1/M1), LiveKit, OBS, QR, units like Mbit/s, API codes, storage keys.
- **Module-level `t(`:** `check:i18n` flags a column-0 `const … = t(` as an R1 violation.

## 3. Angular integration (studio and sender)

**`packages/i18n/src/angular.ts`** is plain TS with no decorators, so it can be tested under vitest without `TestBed`:
```ts
export interface I18n {
  readonly locale: Signal<Locale>; readonly setting: Signal<LocaleSetting>;
  readonly locales: readonly LocaleInfo[];
  setSetting(setting: LocaleSetting): void;
}
export const I18N = new InjectionToken<I18n>('I18N', { providedIn: 'root', factory: createI18n });
export function injectI18n(): I18n;
export function provideI18n(options?: InitOptions): EnvironmentProviders; // provideAppInitializer → runs before the first render
```
- `createI18n` calls `initLocale()`, creates the signals, calls `installLocaleReader(() => locale())`, and subscribes to `onLocaleChange` to update both signals and `document.documentElement.lang`. Its `DestroyRef.onDestroy` uninstalls the reader so TestBed teardown is clean.
- **Templates and TS** use the same function: each component declares `protected readonly t = t;` and writes `{{ t('regie.scenes.dock.title') }}`, `[attr.aria-label]="t('…')"`, `[title]`, `[placeholder]`, and ``t('…', { count: n })``. Generic `K extends MessageKey` keeps the literal. The foundation spike must prove two things:
  - an unknown key in a template fails `ng build` under `strictTemplates`;
  - a deliberately missing parameter also fails.

  If template literals widen, fall back to an impure pipe `| t` with the same typing. No `i18n` attributes and no `$localize`, because build-time locales cannot switch at runtime.
- **`LOCALE_ID`:** remove `registerLocaleData` and `{provide: LOCALE_ID, useValue: 'de-CH'}` from `apps/studio/src/main.ts`, `apps/studio/src/app/app.config.ts` and `apps/sender/src/app/app.config.ts`. No Angular locale pipe is used anywhere, and `check:i18n` forbids them. Add `provideI18n()` to both app configs.
- **`lang` attributes:** remove the static `lang: 'de-CH'` host bindings from `StudioPageComponent`, `ToastHostComponent` and `MonitoringPageComponent`. The `<html lang>` that `I18n` maintains is inherited. The E2E assertions become "closest `[lang]` equals the active tag".
- **Titles:** routes carry `data: { titleKey: 'regie.login.title' satisfies MessageKey }`. `StudioTitleStrategy` builds the title from the key and re-applies it in an `effect` on `locale()`, because `Routes[].title` is resolved once. The sender keeps one static brand title.
- **Setting UI:**
  - A shared tiny `LanguageSelectComponent` exists per app (`apps/studio/src/app/core/ui/language-select.component.ts`, `apps/sender/src/app/shared/language-select.component.ts`). It is a native `<select>` with options "Automatic (browser language)" (`locale.auto`), "English", "Deutsch (Schweiz)" (`LocaleInfo.nativeName`, never translated). It calls `i18n.setSetting(...)`.
  - **Regie:** a new header gear button opens `sf-settings-popover` (`shell/header/settings-popover.component.ts`), containing the "Language" row. #10 later adds "Theme" to it. The login page gets the same select in its footer.
  - **Sender:** the select goes in the footer of `pairing/start.component.html` and at the bottom of the existing tech-check sheet, the only overlay surface. If P1 finds that unsuitable, a `<details>` under the connection banner is the fallback.
- **Error messages.**
  - Studio: `core/api/api-error.ts` renames `toGermanMessage` → `toUserMessage`. `ERROR_CODE_MESSAGES` and `HTTP_STATUS_MESSAGES` become `Record<…, MessageKey>` tables (`errors.*`). `minutesText` becomes a plural message. The `DETAIL_PREFERRED` logic is removed (D7), and `rate_limited` with `retryAfterSeconds` uses a parameterised message.
  - Sender: `ApiError` keeps its fields and gets a lazily evaluated `get userMessage(): string` (built from `code`, `status`, `retryAfterSeconds` at read time). `message` becomes an English diagnostic snapshot via `tFor('en')`. The five `.message` UI call sites become `.userMessage`.
  - The sender's slot-error messages (`SLOT_ERROR_MESSAGES`) move to `sender-station.ts`.

## 4. Output page (vanilla/Vite)

- **Foundation:** `apps/output/src/main.ts` calls `initLocale({ setting: parseLocaleTag(new URLSearchParams(location.search).get('lang')) ?? 'auto', storage: null })` before routing. It sets `<html lang>`, and `index.html` ships `lang="en"`.
- `slates.ts`: `NO_ACCESS_SLATE` and `CLOCK_HINT` become functions `noAccessSlate(): SlateDto` and `clockHint(): string` using `output-slates.ts` keys. They are evaluated when shown, because there is no runtime switching on the output page. `program-view.ts` and `output-app.ts` change from importing a constant to calling the function.
- **P1:**
  - `debug-overlay.ts` word tables become key tables in `output-debug.ts`.
  - `formatDebugLines` uses plural-free keys, with `fps`, `Mbit/s` and `ms` staying as unit literals.
  - `clock-page.ts` keeps its own `HH:MM:SS.mmm` clock, which is locale-independent.
- **Route rename:** `CLOCK_SEGMENT = '_clock'` (`config.ts` and its spec, `page-behaviour.spec.ts`, comments).
- **`?lang=` flag:** `config.ts` and `parseRoute` accept and ignore it. Add it to the documented flags (`bg`, `debug`, `latency`, `lang`). The link is not auto-appended by the Regie. The runbook documents `…/o/{slug}?k=…&lang=de-CH` for OBS machines.

## 5. API

**Policy.** Every `StudioFlowException` message, `ProblemDetails.title`/`detail`, validation field message, hub error text and server-created default is English. `code` stays the stable machine key.

**Text changes.**
- **Titles:** `Problems.TitleFor` is the English set: "Invalid input", "Not signed in", "No access", "Not found", "Request timeout", "Conflict", "No longer valid", "Too large", "Unsupported file type", "Too many attempts", "Temporarily unavailable", "Server error".
- **Not-found nouns:** `StudioFlowException.NotFound(string what)` takes an English noun ("Production", "Device", "Invite", "Request", "File") and produces "{what} was not found."
- **Where German strings live:** about 45 string literals across `Domain/*`, `Application/Services/*`, `Application/MutationContextExtensions.cs`, `Application/SnapshotBuilder.cs`, `Infrastructure/Media/FileMediaStore.cs`, `Web/Errors/{Problems,StudioFlowExceptionHandler,JsonBindingErrors,DatabaseOutage}.cs`, `Web/Hosting/StudioFlowHost.cs`, `Web/Security/{RequestSecurity,OutputAuthenticationHandler}.cs`, `Web/Endpoints/DeviceAndMediaEndpoints.cs`, and `Hubs.cs` (the `{code}: {message}` HubException texts).
- **Server defaults (D8):** `Production.DefaultSceneNames` = Welcome/Presentation/Break; `StandbySlate` = "Starting soon"; `EndSlate` = "Thanks for watching"; `Device.LabelOf` → "{Name} · Screen {n}" / "{Name} · Camera".
- **Left alone:** `Slugs.cs` keeps its ä/ö/ü/ß transliteration table, which is allowlisted. The CLI output (`broadcast-status` and, since issue #4, `reset-admin`) is already English.
- XML-doc comments quoting German UI strings are rewritten to English examples (the check's comment tier flags umlauts).

**Log entries: recommendation is structured, with an English fallback.** Reasons:
1. "Letzte Ereignisse" is the only place server text reaches the screen in normal operation (not just errors), in every language, for every operator.
2. Entries are already derived at snapshot time from persisted audit entries (`LogTexts.For(AuditEntry)`), which are structured (`action` + `details`), so no stored text needs migration.
3. The Regie's `statusWord` already duplicates the same phrases, and structured codes let the client reuse one catalogue.
4. Entries embed user data (scene and device names) that must be inserted into a translated template.
5. English-only would show English log lines inside a German Regie from day one.

Keeping `Text` (English) costs one extra string per entry. It keeps API-only consumers and E2E/sync clients working, and it degrades gracefully if the API gains a code before the client does.

Contract (`Contracts/ProductionContracts.cs`, `Contracts/Enums.cs`):
```csharp
public enum LogCode { SceneLive, SceneCreated, SceneDeleted, BroadcastStarted, BroadcastEnded, DevicePaired,
  DeviceBlocked, DeviceUnblocked, DeviceRemoved, PairingDenied, InviteLinkCreated, InviteLinkRevoked,
  OutputLinkRegenerated, OutputAccessChanged, AssetUploaded, AssetDeleted, SourceReconnecting,
  CameraEnded, ScreenEnded, SourceLost, SourceRecovered }          // serialised camelCase: "sceneLive"
public sealed record LogEntryDto(DateTimeOffset At, LogCode Code, IReadOnlyDictionary<string, string> Params, string Text);
```
- `LogTexts` gains `Describe(AuditEntry) → (LogCode, Params, Text)?`. `Actions` and `For` remain for the query pre-filter. `SourceEnded` splits into `CameraEnded`/`ScreenEnded` by `Kind`, which avoids select syntax.
- **Params per code** (camelCase keys): `scene` for scene codes; `subject` (language-neutral "S1, S2 Laptop Mia" or the name alone) for device codes; `name` for `PairingDenied`; `code` and `name` for asset codes; `code` for source codes; `code` and `downSeconds` for `SourceRecovered`. The client formats the downtime via `model.format.secondsShort` / `minutesShort`.
- `ProductionCoordinator.Audit` and `SnapshotBuilder` construct `LogEntryDto` from `Describe`. `LogAppendedEvent` is unchanged structurally and stays hidden from the output page.

**Contract impact (run `npm run gen:contracts`).**
- `apps/api/openapi/studioflow.json` and `packages/scene-model/src/generated/api.ts` change: `LogEntryDto` gains `code`/`params`, and a new `LogCode` union appears.
- `packages/scene-model/src/contracts.ts` re-exports `LogCode`.
- `regie-log.ts` keys are `regie.log.<code>`, with `Record<LogCode, MessageKey>` giving compile-time completeness (consumed in `status-line`).
- Test fixtures to update: `logFixture` in `apps/studio/src/testing/fixtures.ts`, `packages/scene-model/src/testing/fixtures.ts`, `production-state.spec.ts`, `status-line.component.spec.ts`, and `tests/e2e/support/sync-client.ts` and `hubs.ts`.
- xUnit tests asserting German texts: `FlowTests`, `SourceStatusTests`, `SceneApiTests`, `ProductionTests`, `ProductionApiTests`, `PairingDomainTests`.
- Optional drift guard: xUnit writes a golden `{code: text}` JSON that a vitest spec compares against the `en` catalogue.

## 6. Scripts and docs

**Scripts (D9), English and ASCII only; there is no i18n layer.**
- **Files:** `setup|backup|restore|update` in `.sh` and `.ps1`, `infra/scripts/common.sh`, `infra/scripts/StudioFlow.psm1`, `.env.example` (comments), `docker-compose.yml` (`${VAR:?message}` texts), `docker-compose.override.example.yml`, `tools/capture.ps1`, `tools/make-artifact.ps1`, `tools/mobile-wrap.html`.
- **Helpers:** the prefixes `Fehler:`/`Warnung:` become `Error:`/`Warning:` in `sf_die`/`sf_warn` and the psm1 equivalents. `--help` text is translated.
- **Encoding:** `.ps1` keeps CRLF (per `.gitattributes`).
- **Verification:** `bash -n`, a PowerShell parse check, `docker compose config -q` using values from `.env.example`.
- **Cross-dependency:** the E2E ops specs assert exact script texts, so P7 reads them after P5 merges. The runbook paraphrases script messages and does not quote them verbatim.

**Docs.**
- **Move:** `git mv` `plan/*.html`, `plan/regie-*.png` and `plan/archiv/` into `docs/history/` (the PNGs sit next to the HTML so relative `src` still works). Add an English `docs/history/README.md` saying the files are historical, German and unmaintained. No content edits.
- **Update references:** the README table, `tools/make-artifact.ps1` example, `docs/architecture/implementation-spec.md` line 4, and the `docs/testing.md` header.
- **Translate:** `README.md` (the minimum; #5 later restructures it), `PRODUCT.md` (line 54 becomes: "Interface language: English by default; German (Switzerland) as the first translation; follows the user setting, browser language by default; Swiss spelling with ss, « », decimal comma"), the German parts of `DESIGN.md` (including the brand commitment and outage-language lines), `docs/runbook.md`, `docs/security-review.md`, `prototype/regie.html` (visible texts and `lang`), and the language statements in `docs/architecture/implementation-spec.md` (lines 7, 78, 275, 450–460, 589, 711, 774). The spec is otherwise English.
- **New:** `docs/i18n.md` (how to add a string, rules R1+, glossary, German style: ss, « », decimal comma), and `docs/decisions.md` gains a "#6 pinned details" list from §0.
- **`docs/testing.md`** (2440 lines): the §0.2 convention "quoted in « » are literal German UI strings" becomes "quoted strings are the English UI text; the German text of any string is in `packages/i18n/src/messages/de-CH/`". The test catalogue is converted by P7.

## 7. Tests and the definition-of-done check

### Unit tests
- Unit and component tests run in `en` (global `setupFiles` reset it per test) and assert literal English strings.
- German-asserting unit tests live in files named `*.de.spec.ts`, which the checker allowlists, and set the locale through `resetLocaleForTests('de-CH')`.
- Rewrite the format specs of scene-model for both locales (comma/point, `HH:MM:SS`).
- **New specs:** `packages/i18n/src/{translate,locales,format,catalogue,angular}.spec.ts`. The `angular` one uses `signal`/`computed` directly and proves a `computed` containing `t()` recomputes after `setLocaleSetting`.
- API xUnit tests update expected strings. Unicode names ("Bühne", slug transliteration) stay as test data.

### E2E (`tests/e2e`)
- **Strings module:** `tests/e2e/support/text.ts` exports `TEXT` (literal English, grouped by area: slates, status words, log lines, labels/aria names, toasts, script messages). It replaces the German `DE` object in `support/constants.ts`.
- **German module:** `tests/e2e/support/text.de.ts` holds German expectations for the `i18n` project only.
- **Locale config:** `playwright.config.ts` switches to `locale: 'en-US'`, keeps `timezoneId: 'Europe/Zurich'`, and adds an `i18n` project with `locale: 'de-CH'` matching `specs/i18n/*.spec.ts`. The same change applies to every hard-coded `locale: 'de-CH'` (`support/ui/init.ts`, `support/a11y/browser-flows.ts`, `out-engines.firefox/webkit.spec.ts`).
- **New suite `specs/i18n`:**
  - auto-detection (`en-US` → en; `de-AT` → de-CH; `fr-CH` → en);
  - setting persistence in `studioflow.locale`;
  - live switching without reload in the Regie and the sender;
  - `<html lang>` and the toast inheritance;
  - decimal comma vs point;
  - output `?lang=de-CH` slates;
  - structured log entries rendered per locale.
- **Existing audits:** `a11y-german.spec.ts` and `E2E-DEV-17` become locale-parametrised. The German rules (no ß, « », decimal comma) run only under de-CH. Under en, a runtime audit collects all visible text and aria attributes and asserts that the German-detection module `tools/lib/german.mjs` finds nothing. The module is loaded with `await import()` from the CJS harness.
- Test IDs stay unchanged.

### `tools/check-german.mjs` (definition of done)

CLI: `node tools/check-german.mjs [--root <dir>] [--paths <p>…] [--json] [--comments] [--staged]`. Exit codes: 0 clean, 1 findings, 2 usage error or unused allowlist entry. It scans `git ls-files` (so `.claude/` and `node_modules` are out) with extensions `ts html scss cs json sh ps1 psm1 yml yaml md webmanifest caddy`, plus `Caddyfile` and `.env.example`.

Scope per file type:

| Type | Comments | Scanned |
|---|---|---|
| ts, cs | stripped (`//`, `/* */`, `///`) | strings, templates and inline HTML templates |
| html (Angular) | `<!-- -->` stripped | text, attributes |
| sh, ps1, psm1, yml, `.env.example`, Caddyfile | **kept**: operator-facing | everything |
| md and docs html | kept | everything, H2 (guillemets) off |

Heuristics, evaluated per line after stripping:
- **H1: umlaut or ß** `/[äöüÄÖÜß]/`. In test files (`*.spec.ts`, `tests/**`, `**/*.Tests/**`) an H1-only hit is downgraded to `info`, because unicode test data is legitimate. It is an error only if H2, H3 or H4 also hit on that line.
- **H2: guillemets** `/[«»‹›]/`, in code, templates, scripts and config only (not in md, and not in comments).
- **H3: German function words.** Tokenise lowercase `\p{L}+`.
  - STRONG (1 hit is enough): nicht bitte wurde wurden werden wird sind kein keine keinen keinem für über wieder jetzt noch auch nur oder und dass diese dieser dieses diesem einen einer eines zum zur beim vom ohne gerade bereits damit sowie sobald alle.
  - WEAK (≥2 distinct on one line): der die das dem den des ein eine ist hat haben mit von zu auf aus bei nach um wenn dann hier dort wo wie was.
  - Words that are also English are excluded: die, den, war, was, hat, bis, an, am, man, falls, …
- **H4: product vocabulary,** case-sensitive and word-bounded. Nouns: Szene(n), Quelle(n), Stationen, Gerät(e), Sendung, Einladung, Anfrage, Produktion(en), Einstellung(en), Verbindung, Kamera, Bildschirm, Freigabe, Störung(en), Übergang, Blende, Schnitt, Vorschau, Datei, Medien, Abbrechen, Speichern, Löschen, Schliessen, Zurück, Weiter, Anmelden, Abmelden, Passwort, Benutzername, Fehler, Warnung, Hinweis, Koppeln, Standbild, Sprache, Zuschauen, Willkommen, Begrüssung, Präsentation, Moderation, Ereignisse, Meldungen, Eigenschaften, Hintergrund, Rahmen, Zuschnitt, Einpassen. Participles: verbindet, gesperrt, entsperrt, gekoppelt, abgebrochen, hochgeladen, gelöscht, erstellt, gestartet, beendet, geändert, verbunden, getrennt, erneut. "Station", "Pause", "Regie", "Dock" and "Output" are intentionally not listed.
- **`--comments` tier** (included in DoD): in ts/cs comments, H1 (umlaut/ß) is an error; guillemets are tolerated as quotation marks.

**Allowlist and markers.**
- Suppression markers are `i18n-ignore: <reason>` on the same or previous line, in `//`, `<!-- -->` or `#` form, plus block markers `i18n-ignore-start` / `i18n-ignore-end`.
- Path allowlist lives in `tools/german-allowlist/<package>.json`, one file per work package so edits never collide. Each entry is `{path glob, rules[] | "all", reason}`. An allowlist entry that matches nothing is exit 2.
- Initial entries: `packages/i18n/src/messages/de-CH/**` (all), `**/*.de.spec.ts`, `packages/i18n/src/*.spec.ts`, `tests/e2e/support/text.de.ts`, `tests/e2e/specs/i18n/**`, `docs/history/**`, `.impeccable/**`, `**/generated/**`, `apps/api/openapi/*.json`, `**/Migrations/**`, `package-lock.json`, `apps/api/src/Opten.StudioFlow.Core/Domain/Slugs.cs` (H1, transliteration table).

**Calibration (also part of the foundation's acceptance).** The checker must be unit-tested (`tools/lib/german.spec.ts`, with an added `include` in the `model` project of `vitest.config.ts`) against two corpora:
- 25 German UI strings taken from `main` must be flagged. Examples: "Gleich geht's los", "Bild kommt gleich zurück", "Alle 2 Stationen ok", "Die Eingabe ist ungültig.", "Zu viele Versuche. Bitte später erneut versuchen.".
- 25 English strings must pass. Examples: "Starting soon", "Scene “Break” is live", "Station K2 reconnecting".
- A recall run uses `git archive a507e36 | tar -x -C <tmp>` plus `--root <tmp>`. It must report ≥90% of the file counts in the issue table (studio ~139, sender ~58, api ~58, output ~25, packages ~55, ops ~10).

### `tools/check-i18n.mjs` and npm scripts
It checks: index freshness, the prefix rule, the banned formatting constructs (§2), module-level `t(`, imports of `@studioflow/i18n/angular` from forbidden places, and a warning for unused keys and for de-CH values identical to English.

`package.json` scripts (foundation-owned):
```
"i18n:index": "node tools/i18n-index.mjs",
"check:i18n": "node tools/i18n-index.mjs --check && node tools/check-i18n.mjs",
"check:german": "node tools/check-german.mjs && node tools/check-german.mjs --comments",
"check": "npm run check:i18n && npm run check:german && npm run typecheck"
```
CI wiring belongs to #15.

**Definition of done** for the whole issue:
- `npm run check` is green.
- `test:unit`, `test:studio`, `test:sender`, `test:api` and `build:web` pass; `build:web` includes the bundle budgets in `angular.json`.
- `npm run gen:contracts` produces no diff.
- `test:e2e` (the `@p0` smoke plus `specs/i18n`) passes.
- Manual: switch the language in the Regie and the sender during a live production, with no reload.

## 8. Work partition

**Order.** Foundation F merges first, then P1–P6 run in parallel branches from it, then P7 (it needs the final English copy), then an integrator step. The integrator step runs `i18n:index`, `gen:contracts` and the full check set.

**Shared-file owners**

| File | Owner |
|---|---|
| `tsconfig.json`, `tsconfig.packages.json`, `vitest.config.ts`, `angular.json`, `package.json`, `.gitattributes`, `apps/output/vite.config.ts` | F |
| studio and sender `app.config.ts`, `main.ts`, `index.html`; sender `manifest.webmanifest` | F |
| output `index.html`, `main.ts` | F |
| `packages/i18n/**`, `tools/**` (except `tools/*.ps1`, `tools/mobile-wrap.html`) | F |
| `docs/i18n.md`, `docs/decisions.md` | F |
| `packages/scene-model/src/**` including `generated/api.ts` and `apps/api/openapi/studioflow.json` | F first, then P4 for the final regeneration only |
| `apps/studio/src/testing/**` | P2 (P3 adds new fixture files under `apps/studio/src/app/docks/testing/`) |
| `README.md`, `PRODUCT.md`, `DESIGN.md`, `docs/**` except testing.md, i18n.md and decisions.md | P6 |
| `docs/testing.md`, `tests/e2e/**` incl. `playwright.config.ts` | P7 |
| `tools/german-allowlist/<pkg>.json` | its own package |

**F: Foundation** (single sequential line; F4 can run in parallel with F3).
- **F1:** `packages/i18n` complete, `tools/*`, the root wiring and `docs/i18n.md`.
- **F2:** all of `packages/scene-model`.
  - Same exported names and signatures; only values become locale-aware.
  - Deliberate changes: `IncidentPlace` becomes `'program' | 'preview' | 'off'` plus new `incidentPlaceWord(place)`.
  - `HOLD_OPTIONS[].label` and `LAYOUT_TEMPLATES[].name/description` become getters, so existing consumers keep working.
  - `formatItemCount` uses a plural key; `pluralize` stays exported but unused.
  - The `Intl.Collator('de-CH')` in `selectors.ts` goes through `compareText`.
  - `validateItem` messages go through `t`.
- **F3, one example per app.**
  - Studio: `login/**`, `core/api/api-error.ts` (+spec), `toast.service.ts` rename, language select, settings popover plus header button and gear icon, title strategy, routes `titleKey`, `app.config.ts`, `main.ts`.
  - Sender: `core/api-error.ts`, `pairing/start.component.*`, language select, `app.config.ts`, manifest, `index.html`.
  - Output: `slates.ts`, `main.ts`, `index.html`, and the `clock-page.ts` hint line.
- **F4: API log slice.** `LogCode`, `LogEntryDto`, `LogTexts.Describe`, English `Text`, `SnapshotBuilder`, `ProductionCoordinator`, regeneration, `contracts.ts`, `regie-log.ts`, and the fixtures/tests listed in §5.
- **Seeded catalogues** (names and keys frozen): `common`, `errors`, `locale`, `model-format`, `model-status`, `model-scene`, `regie-login`, `regie-settings`, `regie-log`, `sender-pairing` (start-screen part), `output-slates`, `renderer`, `media-slot`, `media-techcheck`, `media-device`.
- **Also seeded:** empty twins for every namespace file listed below.
- **Verification:**
  - `npm run check:i18n`
  - `npm run typecheck`
  - `npx vitest run`
  - `npm run test:studio && npm run test:sender`
  - `npm run build:web`, comparing the budgets
  - `dotnet test apps/api/StudioFlow.slnx`
  - `npm run gen:contracts` (a clean diff afterwards)
  - the calibration run.
- **Spikes the foundation must prove first:**
  1. Template-literal key narrowing and param checking in templates under `strictTemplates` (negative test).
  2. `satisfies Namespace<…>` rejecting out-of-prefix keys.
  3. `computed()` plus OnPush template re-rendering on a locale switch without reload.
  4. Bundle sizes of studio and sender.

**P1: Sender and device-side runtime**
- **Owns:**
  - `apps/sender/**` (except F files);
  - `packages/media-client/**`, `packages/scene-renderer/**`, `packages/realtime-client/**`;
  - `apps/output/src/**` (except F files).
- **Does:**
  - Converts all German texts.
  - Renames `/join/warten` → `/join/waiting` (routes, guards, `start.component`, specs).
  - Renames `/o/_uhr` → `/o/_clock`.
  - Replaces `jest`-style German assertions in its specs with English.
- **media-client interface change** (the consumer is the sender, the same package):
  - `SlotProblem` becomes `{ failure; messageKey: MessageKey }`.
  - The slot listener gets `messageKey: MessageKey | null` instead of a message string. `SLOT_MESSAGES` is removed.
  - `runTechCheck` returns `TechCheckDto & { problems: TechProblem[] }`, where `TechProblem = { key: MessageKey; params? }`.
  - The wire `note` stays an English summary built with `tFor('en')`. The report strips `problems` before sending.
  - The sender renders from `problems`, and falls back to `note` for results stored by older versions.
- **Catalogue files:** `sender-pairing` (continues), `sender-station`, `sender-techcheck`, `sender-camera-problem`, `sender-notices`, `sender-core`, `output-debug`, `output-clock`. It wires the seeded `renderer`, `media-slot`, `media-techcheck`, `media-device`.
- **Must not touch:** `packages/scene-model`, `packages/i18n`, the F-owned files, `apps/studio/**`, `tests/e2e/**`.
- **Verify:**
  - `npm run typecheck`
  - `npx vitest run`
  - `npm run test:sender`
  - `npm run build:sender && npm run build:output`
  - `node tools/check-german.mjs --paths apps/sender packages/media-client packages/scene-renderer packages/realtime-client apps/output && node tools/check-german.mjs --comments --paths …`

**P2: Regie shell and stage**
- **Owns:**
  - `apps/studio/src/app/{app.component.ts,core/**,monitoring/**,shell/**,stage/**}`;
  - `apps/studio/src/testing/**`, `apps/studio/src/styles/**`;
  - the non-F parts of `login/`.
- **Does:** removes the `lang` host bindings, converts the `host: {'aria-label'…}` metadata, and converts the header, output and layout popovers. Uses `pluralize`-free plural keys in `monitoring-page`. Renders `status-line` log entries through `regie.log.<code>` with `Text` as fallback.
- **Catalogue files:** `regie-header`, `regie-statusline`, `regie-workspace`, `regie-monitoring`, `regie-stage`, `regie-core`.
- **Must not touch:** `docks/**`, the F-owned studio files.
- **Verify:**
  - `npm run test:studio`
  - `npm run build:studio`
  - `node tools/check-german.mjs --paths apps/studio/src/app/core apps/studio/src/app/shell apps/studio/src/app/monitoring apps/studio/src/app/stage apps/studio/src/app/login apps/studio/src/testing`
  - the `--comments` variant.

**P3: Regie docks**
- **Owns:** `apps/studio/src/app/docks/**` (scenes, sources, properties, stations, pairing, shared).
- **Does:** converts all dock templates and components. Replaces `HOLD_OPTIONS` and template usage with the F2 getters (no change needed). Converts upload-validation and toast texts.
- **Catalogue files:** `regie-scenes`, `regie-sources`, `regie-media`, `regie-properties`, `regie-stations`, `regie-pairing`.
- **Must not touch:** `apps/studio/src/testing/**` (new fixtures go in `docks/testing/`), `core/**`, `shell/**`, `stage/**`.
- **Verify:** `npm run test:studio`, `npm run build:studio`, and `node tools/check-german.mjs --paths apps/studio/src/app/docks` (both modes).

**P4: API**
- **Owns:**
  - `apps/api/src/**` and `apps/api/tests/**`;
  - the final `apps/api/openapi/studioflow.json` and `packages/scene-model/src/generated/api.ts` regeneration (docs-only diff after F4).
- **Does:** converts all strings per §5 and rewrites XML-doc German quotes. Adds xUnit tests for `LogTexts.Describe` coverage of every `LogTexts.Actions` entry, the English `Text`, `Params`, and the English titles.
- **Must not touch:** TypeScript sources, C# contract shapes (no contract change beyond F4).
- **Verify:**
  - `dotnet build apps/api/StudioFlow.slnx -warnaserror`
  - `npm run test:api`
  - `npm run gen:contracts` (diff limited to descriptions)
  - `node tools/check-german.mjs --paths apps/api` (both modes).

**P5: Ops and infra scripts**
- **Owns:**
  - `setup|backup|restore|update` `.sh` and `.ps1`;
  - `infra/scripts/**`, `.env.example`, `docker-compose.yml`, `docker-compose.override.example.yml`;
  - `tools/capture.ps1`, `tools/make-artifact.ps1`, `tools/mobile-wrap.html`;
  - `infra/caddy/**` if any text appears.
- **Does:** per §6 and D9, in English and ASCII only.
- **Must not touch:** docs, `tests/e2e/**`.
- **Verify:**
  - `bash -n` on each `.sh`
  - a PowerShell parse of each `.ps1`/`.psm1`
  - `docker compose config -q`
  - `node tools/check-german.mjs --paths setup.sh setup.ps1 backup.sh backup.ps1 restore.sh restore.ps1 update.sh update.ps1 infra .env.example docker-compose.yml docker-compose.override.example.yml tools`.

**P6: Docs, prototype and history**
- **Owns:**
  - `README.md`, `PRODUCT.md`, `DESIGN.md`;
  - `docs/runbook.md`, `docs/security-review.md`, `docs/architecture/**`;
  - `prototype/**`;
  - `plan/` → `docs/history/` plus its README.
- **Does:** per §6, including the `?lang=` and language-setting sections in the runbook.
- **Must not touch:** `docs/testing.md`, `docs/i18n.md`, `docs/decisions.md`.
- **Verify:**
  - `node tools/check-german.mjs --paths README.md PRODUCT.md DESIGN.md docs prototype`
  - `git log --follow` shows the moved plan files as renames
  - a grep for stale `plan/` references.

**P7: E2E and testing.md** (after P1–P6 merge)
- **Owns:** `tests/e2e/**` (new `support/text.ts`, `support/text.de.ts`, `specs/i18n/**`, locale config, the ops/script-message specs) and `docs/testing.md`.
- **Does:** converts all assertions and the test-catalogue prose. Rewrites the German-audit specs. Adds `tools/german-allowlist/e2e.json`. Roughly 74 of 148 files contain umlaut/guillemet literals, and many more German strings contain neither, so expect a larger scope than the grep shows.
- **Verify:**
  - `npm run typecheck`
  - `npx playwright test -c tests/e2e/playwright.config.ts --list`
  - the `@p0` smoke and `specs/i18n` against a stack
  - `node tools/check-german.mjs --paths tests docs/testing.md`
  - then the full DoD list.

## 9. Risks to watch
1. **Template-literal narrowing** in Angular templates (spike 1); the pipe fallback is specified.
2. **Reactivity depends on the reader.** Any `t()` call outside a reactive context (an event handler) is fine. Anything cached outside signals (module constants, `Subject` values) will not refresh, which is why R1 exists.
3. **Decimal comma (D3)** differs from CLDR `de-CH`. The owner should confirm before E2E pins are rewritten.
4. **Server defaults are English (D8).** A German Regie shows English scene names for new productions until a follow-up adds seed texts.
5. **Regenerated contract files conflict easily.** Only F4 and then P4 may regenerate them.
6. **Bundle size** (D11): both locales ship in both apps. Check the studio 900 kB and sender 800 kB initial warn budgets in the foundation.
7. **Ordering with #3:** do not start before the rename is merged. A late rename would force every package to redo paths and prefixes.

### Critical Files for Implementation
- packages/scene-model/src/format.ts
- apps/studio/src/app/core/api/api-error.ts
- apps/api/src/Opten.StudioFlow.Core/Domain/LogTexts.cs
- tsconfig.json
- tests/e2e/support/constants.ts
