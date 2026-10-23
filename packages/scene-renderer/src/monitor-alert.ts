import { formatDuration, statusWord, type SourceKind } from '@studioflow/scene-model';

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

function alertWord(
  status: AlertStatus,
  elapsedMs: number,
  narrow: boolean,
  kind: SourceKind | null | undefined,
): string {
  switch (status) {
    case 'reconnecting':
      // The same timer as everywhere in the Regie: mm:ss, from one hour on h:mm:ss.
      return narrow ? formatDuration(elapsedMs) : `Standbild ${formatDuration(elapsedMs)}`;
    case 'ended':
      return narrow ? 'beendet' : statusWord(status, kind);
    case 'blocked':
    case 'lost':
      return statusWord(status);
  }
}

/**
 * Presentation of an alert, or null when the status is not an outage.
 *
 * @param code slot code («K2»); omitted from the label when unknown
 * @param elapsedMs time since the source went down (timer of «reconnecting»)
 * @param screenWidth item width in screen pixels (short variants below {@link NARROW_ALERT_SCREEN_PX})
 * @param kind kind of the source: an ended camera reads «Kamera beendet», an ended screen «Teilen beendet»
 */
export function alertPresentation(
  status: MonitorSourceStatus | undefined,
  code: string | undefined,
  elapsedMs: number,
  screenWidth: number,
  kind?: SourceKind | null,
): AlertPresentation | null {
  if (!isAlertStatus(status)) {
    return null;
  }
  const word = alertWord(status, elapsedMs, screenWidth < NARROW_ALERT_SCREEN_PX, kind);
  return {
    color: status === 'reconnecting' ? PALETTE.amber : PALETTE.red,
    text: code ? `${code} · ${word}` : word,
    timed: status === 'reconnecting',
  };
}
