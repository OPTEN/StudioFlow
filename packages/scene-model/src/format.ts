import { formatNumber, formatTime, t } from '@studioflow/i18n';
import type { IncidentKind, SourceKind, SourceStatus } from './contracts';

/**
 * Formatting for everything the Regie, the sender and the output page show, in the active language (see
 * `@studioflow/i18n`): decimal comma or point, 24 h clock, "s" and "Mbit/s" units. Values that are unknown (null,
 * NaN) render as {@link MISSING_VALUE}. The examples below show English; German writes "2,8" and "0,3 s".
 */

/** Placeholder for an unknown value (en dash, as in the prototype). */
export const MISSING_VALUE = '–';

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;
const BYTES_PER_UNIT = 1024;
const CHECK_CODE_PATTERN = /^\d{4}$/;

const pad2 = (value: number): string => String(value).padStart(2, '0');

function isKnown(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Fixed number of fraction digits; never renders "-0.0". */
function toFixed(value: number, fractionDigits: number): string {
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
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

/** Number with at most `maxFractionDigits` digits, trailing zeros removed (0.45 → "0.45", 2 → "2", 1.5 → "1.5"). */
export function formatDecimal(value: number, maxFractionDigits = 2): string {
  return isKnown(value)
    ? formatNumber(value, { maximumFractionDigits: maxFractionDigits })
    : MISSING_VALUE;
}

/** Elapsed time "mm:ss"; from one hour on "h:mm:ss" (outage timers, "was gone 0:09"). */
export function formatDuration(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms);
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

/** LIVE runtime in the header, always "hh:mm:ss". */
export function formatRuntime(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** Local wall clock "HH:MM:SS" (header clock), always 24 h. */
export function formatClock(date: Date): string {
  return Number.isNaN(date.getTime()) ? '--:--:--' : formatTime(date, { seconds: true });
}

/** Local time "HH:MM" (log entries, "Paired today 10:42"), always 24 h. */
export function formatHm(date: Date): string {
  return Number.isNaN(date.getTime()) ? '--:--' : formatTime(date);
}

/** Seconds: 300 → "0.3 s", 2000 → "2 s" (fade durations, prototype `fmtSec`). */
export function formatSeconds(ms: number): string {
  return isKnown(ms)
    ? t('model.format.secondsShort', { value: formatDecimal(ms / 1000, 3) })
    : MISSING_VALUE;
}

/** Outage duration as the log shows it: "9 s" below a minute, "3 min" from there (at least "1 s"). */
export function formatDowntime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(1, Math.floor(seconds)) : 1;
  return whole < 60
    ? t('model.format.secondsShort', { value: whole })
    : t('model.format.minutesShort', { value: roundHalfToEven(whole / 60) });
}

/** Rounds like the API does (C# `Math.Round`): 1.5 → 2, 2.5 → 2, so the client text matches the server text. */
function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest === 0.5) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(value);
}

/** Bit rate in Mbit/s with one decimal: 2.8 → "2.8". The unit is rendered separately by the UI. */
export function formatRate(mbitPerS: number | null | undefined): string {
  return isKnown(mbitPerS) ? toFixed(mbitPerS, 1) : MISSING_VALUE;
}

/** Bit rate reported in kbit/s, shown in Mbit/s: 2800 → "2.8". */
export function formatKbpsAsMbit(kbps: number | null | undefined): string {
  return isKnown(kbps) ? formatRate(kbps / 1000) : MISSING_VALUE;
}

/** Pairing check code "4712" → "47 12"; anything that is not exactly four digits is returned unchanged. */
export function formatCheckCode(code: string): string {
  return CHECK_CODE_PATTERN.test(code) ? `${code.slice(0, 2)} ${code.slice(2)}` : code;
}

/** A value that already is a percentage: 78 → "78%", (0.4, 1) → "0.4%" ("78 %" in German). */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  return isKnown(value)
    ? t('model.format.percent', { value: toFixed(value, fractionDigits) })
    : MISSING_VALUE;
}

/** File size with binary units and one decimal at most: 1_258_291 → "1.2 MB", 512 → "512 B". */
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
 * Short word for a source status as used on lamps, rows and labels ("K2 reconnecting"). `ok` has no word (empty
 * string). `ended` depends on the kind of the source: a camera that was stopped on purpose is "camera stopped", a
 * screen share (and a source of unknown kind) "sharing stopped".
 */
export function statusWord(status: SourceStatus, kind?: SourceKind | null): string {
  switch (status) {
    case 'reconnecting':
      return t('model.status.reconnecting');
    case 'ended':
      return t(kind === 'camera' ? 'model.status.endedCamera' : 'model.status.endedScreen');
    case 'blocked':
      return t('model.status.blocked');
    case 'connecting':
      return t('model.status.connecting');
    case 'lost':
      return t('model.status.lost');
    case 'offline':
      return t('model.status.offline');
    case 'ok':
      return '';
  }
}

/**
 * Word for an incident in the message strip; identical to the status word of the source state it reports
 * (`sourceKind` as in {@link statusWord}: "camera stopped" / "sharing stopped").
 */
export function incidentWord(kind: IncidentKind, sourceKind?: SourceKind | null): string {
  return statusWord(kind, sourceKind);
}

/**
 * Count with the matching noun: (1, 'item', 'items') → "1 item", (3, …) → "3 items". Kept for callers that already
 * have both words; new code uses a plural message (`t('…', { count })`), which also works for other languages.
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Number of items of a scene ("1 item", "3 items"), e.g. in the monitor header. */
export function formatItemCount(count: number): string {
  return t('model.format.itemCount', { count });
}
