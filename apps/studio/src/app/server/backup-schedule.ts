import { zonedClock } from '@studioflow/i18n';

/**
 * The backup schedule as the operator chooses it (off, daily at a time, weekly on a day at a time, or a cron expression
 * of their own) and as the API stores it (one cron expression, null for off). Pure functions, no Angular.
 */

/** The four ways to schedule automatic backups. */
export type SchedulePreset = 'off' | 'daily' | 'weekly' | 'custom';

/** The schedule in the parts the form edits. */
export interface ScheduleParts {
  readonly preset: SchedulePreset;
  /** "HH:MM", 24 h. */
  readonly time: string;
  /** Weekday as in cron: 0 = Sunday … 6 = Saturday. */
  readonly day: number;
  /** The cron expression of a custom schedule. */
  readonly cron: string;
}

/** The weekdays in the order of a Swiss week (Monday first), as cron numbers. */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_TIME = '03:00';
const DEFAULT_DAY = 1;
const NUMBER = '(\\d{1,2})';
const DAILY = new RegExp(`^${NUMBER} ${NUMBER} \\* \\* \\*$`);
const WEEKLY = new RegExp(`^${NUMBER} ${NUMBER} \\* \\* ([0-7])$`);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clockOf(minute: number, hour: number): string | null {
  return minute <= 59 && hour <= 23 ? `${pad2(hour)}:${pad2(minute)}` : null;
}

/** Reads a stored cron expression: a daily or weekly one becomes a preset, anything else stays custom. */
export function parseSchedule(cron: string | null | undefined): ScheduleParts {
  const text = (cron ?? '').trim().replace(/\s+/g, ' ');
  const base = { time: DEFAULT_TIME, day: DEFAULT_DAY, cron: text };
  if (text === '') {
    return { ...base, preset: 'off' };
  }
  const daily = DAILY.exec(text);
  const dailyTime = daily ? clockOf(Number(daily[1]), Number(daily[2])) : null;
  if (dailyTime) {
    return { ...base, preset: 'daily', time: dailyTime };
  }
  const weekly = WEEKLY.exec(text);
  const weeklyTime = weekly ? clockOf(Number(weekly[1]), Number(weekly[2])) : null;
  if (weekly && weeklyTime) {
    return { ...base, preset: 'weekly', time: weeklyTime, day: Number(weekly[3]) % 7 };
  }
  return { ...base, preset: 'custom' };
}

/** True for a time the form can turn into a schedule ("03:00"). */
export function isScheduleTime(time: string): boolean {
  return TIME.test(time);
}

/** The cron expression of the parts, or null when automatic backups are off (a custom schedule is taken as typed). */
export function scheduleCron(parts: ScheduleParts): string | null {
  switch (parts.preset) {
    case 'off':
      return null;
    case 'custom':
      return parts.cron.trim() || null;
    case 'daily':
    case 'weekly': {
      const match = TIME.exec(parts.time);
      if (!match) {
        return null;
      }
      const [hour, minute] = [Number(match[1]), Number(match[2])];
      return `${minute} ${hour} * * ${parts.preset === 'daily' ? '*' : parts.day}`;
    }
  }
}

/** When the next backup of a daily or weekly schedule runs, seen from `now` in the time zone of the schedule. */
export interface NextRun {
  /** 0 today, 1 tomorrow, up to 7. */
  readonly daysAhead: number;
  /** Weekday of the run (cron number). */
  readonly day: number;
  /** "HH:MM" in the time zone of the schedule. */
  readonly time: string;
}

/**
 * The next run of a daily or weekly schedule, or null for an off or custom schedule, an invalid time or a time zone the
 * browser does not know. Changes of daylight saving time are ignored: it is a preview, the server decides.
 */
export function nextRun(parts: ScheduleParts, timeZone: string, now: Date): NextRun | null {
  const match = TIME.exec(parts.time);
  if ((parts.preset !== 'daily' && parts.preset !== 'weekly') || !match) {
    return null;
  }
  const clock = zonedClock(now, timeZone);
  if (!clock) {
    return null;
  }
  const nowMinutes = clock.hour * 60 + clock.minute;
  const target = Number(match[1]) * 60 + Number(match[2]);
  let daysAhead: number;
  if (parts.preset === 'daily') {
    daysAhead = target > nowMinutes ? 0 : 1;
  } else {
    daysAhead = (parts.day - clock.weekday + 7) % 7;
    if (daysAhead === 0 && target <= nowMinutes) {
      daysAhead = 7;
    }
  }
  return { daysAhead, day: (clock.weekday + daysAhead) % 7, time: parts.time };
}

/** Every IANA time zone the browser knows, with UTC first; `include` adds a stored zone the list may lack. */
export function timeZoneOptions(include: readonly string[] = []): readonly string[] {
  const supported =
    (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
      'timeZone',
    ) ?? [];
  const zones = new Set<string>(supported);
  for (const zone of include) {
    if (zone) {
      zones.add(zone);
    }
  }
  zones.delete('UTC');
  return ['UTC', ...[...zones].sort()];
}
