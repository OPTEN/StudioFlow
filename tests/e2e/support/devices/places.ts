import { expect, type Page } from '@playwright/test';
import { pollUntil } from '../helpers';
import type { RegiePage } from '../ui/regie';

/**
 * The “six places” of the outage language (docs/testing.md 0.3, DESIGN.md): the health button of the activity bar, the
 * incidents of the activity bar (its issues list, which stays in the DOM while the popover is closed), monitor element
 * (Program / Preview), scene list row, Sources dock row and Devices dock row. One DOM read gives all of them,
 * so a test can poll them at 100 ms and measure when the last one changed (T-DETECT-*).
 *
 * The Regie has no data-testid hooks; the class names are the ones of apps/studio (c-status__inc, c-src, c-st, c-scene)
 * and of the scene renderer (sf-r-alert-label inside [data-item-id]). Reads are tolerant: a missing place is null, never
 * an exception, so `outage()` can report which places are still missing.
 */

export type OutageKind = 'reconnecting' | 'ended' | 'lost' | 'blocked';
export type SourceKindName = 'camera' | 'screen';

export interface StripEntry {
  code: string;
  name: string;
  word: string;
  place: string;
  timer: string;
  tone: 'bad' | 'warn' | 'ok';
  recovered: boolean;
  actions: string[];
}

export interface StationEntry {
  id: string;
  name: string;
  codes: string[];
  line: string;
  tone: 'bad' | 'warn' | '';
  lamp: string;
  tag: string;
  recoveredBox: string | null;
  expanded: boolean;
  ariaLabel: string;
}

export interface Places {
  /** `Date.now()` inside the page when the DOM was read (the clock of the machine, like the one of every other page). */
  readAt: number;
  header: { text: string; lamp: string };
  strip: StripEntry[];
  stripCalm: string | null;
  /** Visible alert labels of the Program / Preview monitors with the item and outline colour. */
  program: Array<{ itemId: string; text: string; outline: string }>;
  preview: Array<{ itemId: string; text: string; outline: string }>;
  scenes: Array<{ name: string; ariaLabel: string; health: string | null; meta: string }>;
  sources: Array<{ code: string; name: string; state: string }>;
  stations: StationEntry[];
}

/** One DOM read of every place that reports a source. */
export async function readPlaces(page: Page): Promise<Places> {
  return page.evaluate(() => {
    const text = (element: Element | null | undefined): string =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element as HTMLElement);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };

    const health = document.querySelector('sf-status-line .c-status__health');
    const healthLamp = health?.querySelector('.c-lamp');

    const strip = [...document.querySelectorAll('sf-status-line .c-status__inc')].map((row) => {
      const recovered = row.classList.contains('is-ok');
      return {
        code: text(row.querySelector('.c-code')),
        name: text(row.querySelector('.c-status__target')).replace(text(row.querySelector('.c-code')), '').trim(),
        word: text(row.querySelector('strong')),
        place: text(row.querySelector('.c-status__where')),
        timer: text(row.querySelector('.c-status__time')),
        tone: (recovered ? 'ok' : row.classList.contains('is-bad') ? 'bad' : 'warn') as 'bad' | 'warn' | 'ok',
        recovered,
        actions: [...row.querySelectorAll('button')].filter((button) => !button.classList.contains('c-status__target')).map((button) => text(button)),
      };
    });

    const alerts = (selector: string) =>
      [...document.querySelectorAll(`${selector} [data-item-id]`)].flatMap((item) => {
        const label = item.querySelector('.sf-r-alert-label');
        const outline = item.querySelector('.sf-r-alert') as HTMLElement | null;
        if (!label || !visible(label) || !text(label)) return [];
        return [{ itemId: item.getAttribute('data-item-id') ?? '', text: text(label), outline: outline ? `${getComputedStyle(outline).borderTopStyle} ${getComputedStyle(outline).borderTopColor}` : '' }];
      });

    return {
      readAt: Date.now(),
      header: { text: text(health), lamp: healthLamp ? [...healthLamp.classList].filter((name) => name.startsWith('is-')).join(' ') : '' },
      strip,
      stripCalm: document.querySelector('sf-status-line .c-status__inc') ? null : text(health) || null,
      program: alerts('.c-monitor--program'),
      preview: alerts('.c-monitor--preview'),
      scenes: [...document.querySelectorAll('button.c-scene[aria-pressed]')].map((button) => ({
        name: text(button.querySelector('.c-scene__name')),
        ariaLabel: button.getAttribute('aria-label') ?? '',
        health: text(button.querySelector('.c-scene__meta .c-state--bad, .c-scene__meta .c-state--warn')) || null,
        meta: text(button.querySelector('.c-scene__meta')),
      })),
      sources: [...document.querySelectorAll('.c-src')].map((row) => ({
        code: text(row.querySelector('.c-code')),
        name: text(row.querySelector('.c-src__name')),
        state: text(row.querySelector('.c-src__state')),
      })),
      stations: [...document.querySelectorAll('.c-st[data-device]')].map((row) => ({
        id: row.getAttribute('data-device') ?? '',
        name: text(row.querySelector('.c-st__name')),
        codes: [...row.querySelectorAll('.c-st__codes .c-code')].map((code) => text(code)),
        line: text(row.querySelector('.c-st__l2')),
        tone: (row.classList.contains('is-bad') ? 'bad' : row.classList.contains('is-warn') ? 'warn' : '') as 'bad' | 'warn' | '',
        lamp: [...(row.querySelector('.c-st__l2 .c-lamp')?.classList ?? [])].filter((name) => name.startsWith('is-')).join(' '),
        tag: text(row.querySelector('.c-st__l1 .c-tag')),
        recoveredBox: text(row.querySelector('.c-st__ack')) || null,
        expanded: row.querySelector('.c-st__row')?.getAttribute('aria-expanded') === 'true',
        ariaLabel: row.querySelector('.c-st__row')?.getAttribute('aria-label') ?? '',
      })),
    };
  });
}

/** The state word each place shows for an outage kind. */
export function outageWord(kind: OutageKind, source: SourceKindName = 'camera'): string {
  switch (kind) {
    case 'reconnecting':
      return 'reconnecting';
    case 'ended':
      return source === 'camera' ? 'camera stopped' : 'sharing stopped';
    case 'lost':
      return 'no picture';
    case 'blocked':
      return 'blocked';
  }
}

export interface OutageCheck {
  /** Place -> whether it already shows the outage. */
  places: Record<'header' | 'strip' | 'monitor' | 'scene' | 'sources' | 'station', boolean>;
  complete: boolean;
  /** What each place showed (for the failure message and the attachments). */
  detail: Record<string, string>;
}

export interface OutageOptions {
  /** The code is on the Program monitor (default true). */
  inProgram?: boolean;
  /** Also on the Preview monitor (Studio Mode). */
  inPreview?: boolean;
  /** Source kind for the wording of `ended`. */
  source?: SourceKindName;
  /** The element is wide enough for the long monitor label (default true; narrow items show the short variants). */
  wide?: boolean;
  /** The scene with the source is in the Sources dock (default true). */
  inSources?: boolean;
}

/** Evaluates the six places for one source code. */
export function checkOutage(places: Places, code: string, kind: OutageKind, options: OutageOptions = {}): OutageCheck {
  const word = outageWord(kind, options.source ?? 'camera');
  const detail: Record<string, string> = {};
  const wide = options.wide ?? true;

  const strip = places.strip.find((entry) => entry.code === code && !entry.recovered);
  detail['strip'] = strip ? `${strip.code} ${strip.name} ${strip.word} ${strip.place} ${strip.timer}` : 'no entry';

  const wantsHeader = kind !== 'blocked';
  const headerLamp = kind === 'reconnecting' ? 'is-warn' : 'is-bad';
  const header = !wantsHeader || (/^\d+ issues?$/.test(places.header.text) && places.header.lamp.includes(headerLamp));
  detail['header'] = `${places.header.text} [${places.header.lamp}]`;

  const monitorWord = (text: string): boolean => {
    if (!text.startsWith(`${code} · `)) return false;
    if (kind === 'reconnecting') return wide ? /· Freeze frame \d+:\d\d$/.test(text) : /· \d+:\d\d$/.test(text);
    if (kind === 'ended') return wide ? text.endsWith(`· ${word}`) : text.endsWith('· ended');
    return text.endsWith(`· ${word}`);
  };
  const program = options.inProgram === false ? true : places.program.some((label) => monitorWord(label.text));
  const preview = options.inPreview ? places.preview.some((label) => monitorWord(label.text)) : true;
  detail['program'] = places.program.map((label) => `${label.text} (${label.outline})`).join(' | ') || 'no label';
  if (options.inPreview) detail['preview'] = places.preview.map((label) => `${label.text} (${label.outline})`).join(' | ') || 'no label';

  const scene = kind === 'blocked' ? true : places.scenes.some((row) => row.health === 'disrupted' && row.meta.includes(code));
  detail['scene'] = places.scenes.map((row) => `${row.name}: ${row.meta}`).join(' | ');

  const sourceRow = places.sources.find((row) => row.code === code);
  const sources = options.inSources === false ? true : Boolean(sourceRow && sourceRow.state.includes(word));
  detail['sources'] = sourceRow ? `${sourceRow.code} ${sourceRow.name} ${sourceRow.state}` : 'no row';

  const station = places.stations.find((row) => row.codes.includes(code));
  const stationOk = Boolean(station && station.line.includes(word) && (kind === 'reconnecting' ? station.tone === 'warn' : station.tone === 'bad'));
  detail['station'] = station ? `${station.name}: ${station.line} [${station.tone}]` : 'no row';

  const stripOk = kind === 'blocked' ? true : Boolean(strip && strip.word === word);
  const result = {
    header,
    strip: stripOk,
    monitor: program && preview,
    scene,
    sources,
    station: stationOk,
  };
  return { places: result, complete: Object.values(result).every(Boolean), detail };
}

/**
 * Polls the six places every 100 ms until they all show the outage of `code`. Resolves with the time from `startedAt`
 * (default: the call; a caller that cut the cable passes the moment of the cut) to the DOM read that showed all places,
 * both taken from the clocks inside the browsers: the round trips of the harness (CDP, the poll's own evaluate) are not
 * counted into a detection time.
 */
export async function waitForOutage(
  regie: RegiePage,
  code: string,
  kind: OutageKind,
  options: OutageOptions & { timeoutMs?: number; startedAt?: number } = {},
): Promise<{ elapsedMs: number; check: OutageCheck; places: Places }> {
  const startedAt = options.startedAt ?? Date.now();
  let last: { check: OutageCheck; places: Places } | undefined;
  try {
    await pollUntil(
      `${code} shows “${outageWord(kind, options.source)}” in all six places`,
      async () => {
        const places = await readPlaces(regie.page);
        last = { check: checkOutage(places, code, kind, options), places };
        return last.check.complete;
      },
      (complete) => complete,
      { timeoutMs: options.timeoutMs ?? 15_000, intervalMs: 100 },
    );
  } catch (error) {
    throw new Error(`${(error as Error).message}\nplaces: ${JSON.stringify(last?.check.places)}\ndetail: ${JSON.stringify(last?.check.detail, null, 1)}`);
  }
  return { elapsedMs: last!.places.readAt - startedAt, check: last!.check, places: last!.places };
}

/** The recovered state in the places that keep it until “Dismiss”: strip entry, device line and its strip. */
export function checkRecovered(places: Places, code: string, seconds?: { min: number; max: number }): { ok: boolean; detail: string; seconds: number | null } {
  const strip = places.strip.find((entry) => entry.code === code && entry.recovered);
  const station = places.stations.find((row) => row.codes.includes(code));
  const parsed = strip ? Number(/was gone for (\d+) s/.exec(strip.place)?.[1] ?? NaN) : NaN;
  const inRange = seconds === undefined || (Number.isFinite(parsed) && parsed >= seconds.min && parsed <= seconds.max);
  const ok = Boolean(
    strip &&
      strip.word === 'back' &&
      strip.actions.includes('Dismiss') &&
      station &&
      /back\s*was gone \d+ s/.test(station.line) &&
      station.recoveredBox?.includes('The device is back.') &&
      inRange,
  );
  return {
    ok,
    seconds: Number.isFinite(parsed) ? parsed : null,
    detail: `strip: ${strip ? `${strip.word} ${strip.place} [${strip.actions.join(',')}]` : 'none'}; station: ${station ? `${station.line} | ${station.recoveredBox}` : 'none'}`,
  };
}

/** Waits for the recovered state of `code` (strip entry “back” with “Dismiss”, station box) and returns the seconds. */
export async function waitForRecovered(
  regie: RegiePage,
  code: string,
  options: { timeoutMs?: number; seconds?: { min: number; max: number }; stableMs?: number } = {},
): Promise<{ elapsedMs: number; seconds: number | null }> {
  // The state must hold for `stableMs`: a recovered entry that flashes for a few milliseconds and is replaced by a new outage
  // (DEV-01) is not “back”.
  const stableMs = options.stableMs ?? 1500;
  let last = '';
  let since = 0;
  let firstAt = 0;
  const startedAt = Date.now();
  try {
    const { value } = await pollUntil(
      `${code} is back for ${stableMs} ms`,
      async () => {
        const result = checkRecovered(await readPlaces(regie.page), code, options.seconds);
        last = result.detail;
        if (!result.ok) since = 0;
        else if (since === 0) {
          since = Date.now();
          if (firstAt === 0) firstAt = since;
        }
        return { ...result, stable: since !== 0 && Date.now() - since >= stableMs };
      },
      (result) => result.stable,
      { timeoutMs: options.timeoutMs ?? 30_000, intervalMs: 100 },
    );
    return { elapsedMs: since - startedAt, seconds: value.seconds };
  } catch (error) {
    throw new Error(`${(error as Error).message}\nlast: ${last}`);
  }
}

/** Expect helper for the calm state: no open incidents anywhere. */
export async function expectNoIncidents(regie: RegiePage): Promise<void> {
  await expect
    .poll(async () => (await readPlaces(regie.page)).strip.length, { message: 'the activity bar holds no incident', timeout: 15_000 })
    .toBe(0);
}

/** Facts a station row shows, by code. */
export async function stationOf(regie: RegiePage, code: string): Promise<StationEntry | undefined> {
  return (await readPlaces(regie.page)).stations.find((row) => row.codes.includes(code));
}
