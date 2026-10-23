import {
  statusWord,
  type SourceDto,
  type SourceKind,
  type SourceStatus,
} from '@studioflow/scene-model';
import type { IconName } from '../../core/ui/icon.component';

/**
 * Pure view helpers for sources, shared by the Quellen, Eigenschaften and Stationen docks (prototype `lampClass`,
 * `srcState`, `KIND_ICON`). No Angular, no DOM.
 */

/** Modifier of `.c-lamp`: green (''), idle, amber or red. */
export type LampTone = '' | 'is-idle' | 'is-warn' | 'is-bad';

/** Colour of a state word: `.c-state--warn|bad|ok` or the muted meta colour. */
export type StateTone = 'warn' | 'bad' | 'ok' | 'muted';

/** The state line of a source row («verbindet neu 00:08»). */
export interface SourceStateView {
  /** German state word, e.g. «Teilen beendet». */
  readonly word: string;
  readonly tone: StateTone;
  /** A running outage timer since `statusSince` follows the word. */
  readonly timer: boolean;
}

/** Icon per source kind (prototype `KIND_ICON`). */
export const KIND_ICON: Readonly<Record<SourceKind, IconName>> = {
  camera: 'camera',
  screen: 'screen',
  image: 'image',
  video: 'video',
};

/** True for uploaded media (image, video), which are always available and have no lamp. */
export function isMediaKind(kind: SourceKind | undefined): boolean {
  return kind === 'image' || kind === 'video';
}

/** Lamp of a status: ok green, reconnecting amber, ended/lost/blocked red, connecting/offline idle. */
export function statusLamp(status: SourceStatus): LampTone {
  switch (status) {
    case 'ok':
      return '';
    case 'reconnecting':
      return 'is-warn';
    case 'ended':
    case 'lost':
    case 'blocked':
      return 'is-bad';
    case 'connecting':
    case 'offline':
      return 'is-idle';
  }
}

/** Lamp of a source row; null for media (no lamp), idle for a deleted source («Quelle fehlt»). */
export function sourceLamp(source: SourceDto | null | undefined): LampTone | null {
  if (!source) {
    return 'is-idle';
  }
  return isMediaKind(source.kind) ? null : statusLamp(source.status);
}

/** Tone of a status word. */
export function statusTone(status: SourceStatus): StateTone {
  switch (status) {
    case 'reconnecting':
      return 'warn';
    case 'ended':
    case 'lost':
    case 'blocked':
      return 'bad';
    case 'ok':
      return 'ok';
    case 'connecting':
    case 'offline':
      return 'muted';
  }
}

/** True when the status shows a running outage timer (prototype: reconnecting and ended; also lost). */
export function statusHasTimer(status: SourceStatus): boolean {
  return status === 'reconnecting' || status === 'ended' || status === 'lost';
}

/** State line of a source row (prototype `srcState`); null while the source is ok, a medium or deleted. */
export function sourceStateView(source: SourceDto | null | undefined): SourceStateView | null {
  if (!source || source.status === 'ok' || isMediaKind(source.kind)) {
    return null;
  }
  return {
    word: statusWord(source.status, source.kind),
    tone: statusTone(source.status),
    timer: statusHasTimer(source.status),
  };
}

/** CSS class of a state tone (`c-state--muted` is defined by the docks that use it). */
export function toneClass(tone: StateTone): string {
  return `c-state--${tone}`;
}
