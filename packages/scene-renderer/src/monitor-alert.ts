import { PALETTE } from './palette';
import type { MonitorSourceStatus } from './types';

/**
 * Alert outline and label of a down source on a Regie monitor (pure, wording as in the prototype).
 */

/** Statuses that draw an alert: the picture is (or may be) frozen or gone. */
export type AlertStatus = Extract<
  MonitorSourceStatus,
  'reconnecting' | 'ended' | 'lost' | 'blocked'
>;

/** What the monitor draws for an alert. */
export interface AlertPresentation {
  /** Outline and label fill colour. */
  readonly color: string;
  /** Label text, e.g. «K2 · Standbild 00:12». */
  readonly text: string;
  /** True when the text contains a running timer (needs a refresh every second). */
  readonly timed: boolean;
}

/** Items narrower than this (screen pixels) get the short label variants. */
const NARROW_ALERT_SCREEN_PX = 190;

/** True for statuses that draw an alert. */
export function isAlertStatus(status: MonitorSourceStatus | undefined): status is AlertStatus {
  return (
    status === 'reconnecting' || status === 'ended' || status === 'lost' || status === 'blocked'
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Elapsed time as mm:ss (minutes keep counting beyond 59; negative and malformed values count as 0). */
export function formatElapsed(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;
}

function alertWord(status: AlertStatus, elapsedMs: number, narrow: boolean): string {
  switch (status) {
    case 'reconnecting':
      return narrow ? formatElapsed(elapsedMs) : `Standbild ${formatElapsed(elapsedMs)}`;
    case 'ended':
      return narrow ? 'beendet' : 'Teilen beendet';
    case 'blocked':
      return 'gesperrt';
    case 'lost':
      return 'kein Bild';
  }
}

/**
 * Presentation of an alert, or null when the status is not an outage.
 *
 * @param code slot code («K2»); omitted from the label when unknown
 * @param elapsedMs time since the source went down (timer of «reconnecting»)
 * @param screenWidth item width in screen pixels (short variants below {@link NARROW_ALERT_SCREEN_PX})
 */
export function alertPresentation(
  status: MonitorSourceStatus | undefined,
  code: string | undefined,
  elapsedMs: number,
  screenWidth: number,
): AlertPresentation | null {
  if (!isAlertStatus(status)) {
    return null;
  }
  const word = alertWord(status, elapsedMs, screenWidth < NARROW_ALERT_SCREEN_PX);
  return {
    color: status === 'reconnecting' ? PALETTE.amber : PALETTE.red,
    text: code ? `${code} · ${word}` : word,
    timed: status === 'reconnecting',
  };
}
