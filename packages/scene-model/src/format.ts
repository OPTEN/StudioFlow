import type { IncidentKind, SourceStatus } from './contracts';

/**
 * German (Switzerland) formatting for everything the Regie, the sender and the output page show: decimal comma,
 * 24 h clock, «s» and «Mbit/s» units. Values that are unknown (null, NaN) render as {@link MISSING_VALUE}.
 */

/** Placeholder for an unknown value (en dash, as in the prototype). */
export const MISSING_VALUE = '–';

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;
const BYTES_PER_UNIT = 1024;
const CHECK_CODE_PATTERN = /^\d{4}$/;
const NEGATIVE_ZERO_PATTERN = /^-(0[.,]?0*)$/;

const pad2 = (value: number): string => String(value).padStart(2, '0');

function isKnown(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Fixed number of fraction digits with a decimal comma; never renders «-0,0». */
function toFixedComma(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace(NEGATIVE_ZERO_PATTERN, '$1').replace('.', ',');
}

/** Splits a non-negative duration into whole hours, minutes and seconds (negative and NaN count as 0). */
function splitDuration(ms: number): { hours: number; minutes: number; seconds: number } {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/**
 * Number with a decimal comma and at most `maxFractionDigits` digits, trailing zeros removed
 * (0.45 → «0,45», 2 → «2», 1.5 → «1,5»).
 */
export function formatDecimal(value: number, maxFractionDigits = 2): string {
  if (!isKnown(value)) {
    return MISSING_VALUE;
  }
  const text = toFixedComma(value, maxFractionDigits);
  return text.includes(',') ? text.replace(/,?0+$/, '') : text;
}

/** Elapsed time «mm:ss»; from one hour on «h:mm:ss» (outage timers, «war 0:09 weg»). */
export function formatDuration(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms);
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

/** LIVE runtime in the header, always «hh:mm:ss». */
export function formatRuntime(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** Local wall clock «HH:MM:SS» (header clock). */
export function formatClock(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Local time «HH:MM» (log entries, «Gekoppelt heute 10:42»). */
export function formatHm(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Seconds with a decimal comma: 300 → «0,3 s», 2000 → «2 s» (fade durations, prototype `fmtSec`). */
export function formatSeconds(ms: number): string {
  return isKnown(ms) ? `${formatDecimal(ms / 1000, 3)} s` : MISSING_VALUE;
}

/** Bit rate in Mbit/s with one decimal: 2.8 → «2,8». The unit is rendered separately by the UI. */
export function formatRate(mbitPerS: number | null | undefined): string {
  return isKnown(mbitPerS) ? toFixedComma(mbitPerS, 1) : MISSING_VALUE;
}

/** Bit rate reported in kbit/s, shown in Mbit/s: 2800 → «2,8». */
export function formatKbpsAsMbit(kbps: number | null | undefined): string {
  return isKnown(kbps) ? formatRate(kbps / 1000) : MISSING_VALUE;
}

/** Pairing check code «4712» → «47 12»; anything that is not exactly four digits is returned unchanged. */
export function formatCheckCode(code: string): string {
  return CHECK_CODE_PATTERN.test(code) ? `${code.slice(0, 2)} ${code.slice(2)}` : code;
}

/** A value that already is a percentage: 78 → «78 %», (0.4, 1) → «0,4 %». */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  return isKnown(value) ? `${toFixedComma(value, fractionDigits)} %` : MISSING_VALUE;
}

/** File size with binary units and one decimal at most: 1_258_291 → «1,2 MB», 512 → «512 B». */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return MISSING_VALUE;
  }
  if (Math.round(bytes) < BYTES_PER_UNIT) {
    return `${Math.round(bytes)} B`;
  }
  let value = bytes / BYTES_PER_UNIT;
  let unit = 0;
  while (Math.round(value * 10) / 10 >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }
  return `${formatDecimal(value, 1)} ${BYTE_UNITS[unit]}`;
}

/**
 * Short German word for a source status as used on lamps, rows and labels («K2 verbindet neu»).
 * `ok` has no word (empty string).
 */
export function statusWord(status: SourceStatus): string {
  switch (status) {
    case 'reconnecting':
      return 'verbindet neu';
    case 'ended':
      return 'Teilen beendet';
    case 'blocked':
      return 'gesperrt';
    case 'connecting':
      return 'verbindet …';
    case 'lost':
      return 'kein Bild';
    case 'offline':
      return 'nicht verbunden';
    case 'ok':
      return '';
  }
}

/** Word for an incident in the message strip; identical to the status word of the source state it reports. */
export function incidentWord(kind: IncidentKind): string {
  return statusWord(kind);
}

/** Count with the matching noun: (1, 'Element', 'Elemente') → «1 Element», (3, …) → «3 Elemente». */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Number of elements of a scene («1 Element», «3 Elemente»), e.g. in the monitor header. */
export function formatItemCount(count: number): string {
  return pluralize(count, 'Element', 'Elemente');
}
