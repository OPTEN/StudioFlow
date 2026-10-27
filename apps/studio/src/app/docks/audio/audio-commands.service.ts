import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  clampGainDb,
  clampSyncOffsetMs,
  sameChannel,
  type AudioChannelDto,
  type AudioMode,
} from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';

/** One undoable change of the mixer: the channels as they were and as they became. */
interface HistoryEntry {
  readonly before: readonly AudioChannelDto[];
  readonly after: readonly AudioChannelDto[];
}

/** Undo steps kept (like the scene editor). */
export const AUDIO_UNDO_LIMIT = 60;
/** A fader drag sends a request about this often. */
export const FADER_SEND_MS = 80;
/** How long a change stays on the controls when the store does not report it (a lost event, a clamped value). */
const OVERLAY_MS = 3000;

const NO_OVERLAY: ReadonlyMap<string, AudioChannelDto> = new Map();

/**
 * The commands of the Audio dock (spec 4.4, 9.1): fader, mute, mode and sync offset of a channel, all through
 * `PUT …/audio/channels`. The mixer is one global state that changes like a scene – every change is a revisioned event
 * that reaches the output page and the other Regie seats – and it has an undo history of its own (60 steps) for the
 * seat that made the changes.
 *
 * - The controls show a change at once ({@link channels} lays it over the store's channels) until the event confirms it;
 *   when the request fails they fall back and a toast says so.
 * - A fader drag is one undo step: requests go out every {@link FADER_SEND_MS} with `adjusting` (not audited) and the
 *   last one without, so the audit log gets one entry for the drag.
 * - Requests are sent one at a time, the newest state of a channel replacing an older one that waits.
 */
@Injectable({ providedIn: 'root' })
export class AudioCommandsService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly toasts = inject(ToastService);

  private readonly overlay = signal<ReadonlyMap<string, AudioChannelDto>>(NO_OVERLAY);
  private readonly selectedSignal = signal<string | null>(null);
  private readonly historyVersion = signal(0);
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly drags = new Map<string, AudioChannelDto>();
  private waiting = new Map<string, AudioChannelDto>();
  private waitingAdjusting = true;
  private inFlight = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private overlayTimer: ReturnType<typeof setTimeout> | null = null;
  private productionId: string | null = null;

  /** The channels with the changes that wait for their confirmation laid over them. */
  readonly channels = computed<ReadonlyMap<string, AudioChannelDto>>(() => {
    const overlay = this.overlay();
    const stored = this.store.audioChannels();
    if (overlay.size === 0) {
      return stored;
    }
    const merged = new Map(stored);
    for (const [sourceId, channel] of overlay) {
      if (merged.has(sourceId)) {
        merged.set(sourceId, channel);
      }
    }
    return merged;
  });
  /** The selected channel (the target of the M key), or null. */
  readonly selected = this.selectedSignal.asReadonly();
  /** Something can be undone. */
  readonly canUndo = computed(() => this.historyVersion() >= 0 && this.undoStack.length > 0);
  /** Something can be redone. */
  readonly canRedo = computed(() => this.historyVersion() >= 0 && this.redoStack.length > 0);
  /** Mixer changes can reach the server. */
  readonly online = computed(() => this.store.canCommand());

  constructor() {
    effect(() => {
      // A change has done its job once the store reports it.
      const overlay = this.overlay();
      const stored = this.store.audioChannels();
      if (overlay.size === 0) {
        return;
      }
      const open = [...overlay].filter(([sourceId, channel]) => {
        const reported = stored.get(sourceId);
        return reported !== undefined && !sameChannel(reported, channel);
      });
      if (open.length < overlay.size) {
        untracked(() => this.overlay.set(new Map(open)));
      }
    });
    effect(() => {
      // Another production has another mixer, another history.
      const productionId = this.store.productionId();
      untracked(() => {
        if (this.productionId !== productionId) {
          this.productionId = productionId;
          this.reset();
        }
      });
    });
    effect(() => {
      // A channel that went away cannot stay selected.
      const selected = this.selectedSignal();
      if (selected !== null && !this.store.audioChannels().has(selected)) {
        untracked(() => this.selectedSignal.set(null));
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.clearTimers();
    });
  }

  /** Selects a channel (null clears the selection). */
  select(sourceId: string | null): void {
    this.selectedSignal.set(sourceId);
  }

  /** Starts a fader gesture: the channel as it is now is the "before" of the undo step. */
  beginFader(sourceId: string): void {
    const current = this.channels().get(sourceId);
    if (current && !this.drags.has(sourceId)) {
      this.drags.set(sourceId, current);
    }
  }

  /** The fader moved to `gainDb` (during the gesture or a keyboard step). */
  moveFader(sourceId: string, gainDb: number): void {
    const current = this.channels().get(sourceId);
    if (!current) {
      return;
    }
    this.beginFader(sourceId);
    const next = { ...current, gainDb: clampGainDb(gainDb) };
    this.show(next);
    this.queue([next], true);
    this.scheduleSend();
  }

  /** The fader gesture ended at `gainDb`: the final request is sent at once and the gesture is one undo step. */
  endFader(sourceId: string, gainDb: number): void {
    const before = this.drags.get(sourceId);
    this.drags.delete(sourceId);
    const current = this.channels().get(sourceId);
    if (!current || !before) {
      return;
    }
    const after = { ...current, gainDb: clampGainDb(gainDb) };
    this.show(after);
    this.queue([after], false);
    if (!sameChannel(before, after)) {
      this.record({ before: [before], after: [after] });
    }
    this.clearSendTimer();
    void this.flush();
  }

  /** Sets the fader to 0 dB (unity gain). */
  resetFader(sourceId: string): void {
    this.change(sourceId, { gainDb: 0 });
  }

  /** Mutes or unmutes a channel. */
  setMuted(sourceId: string, muted: boolean): void {
    this.change(sourceId, { muted });
  }

  /** Mutes the channel if it is audible and unmutes it otherwise. */
  toggleMute(sourceId: string): void {
    const current = this.channels().get(sourceId);
    if (current) {
      this.change(sourceId, { muted: !current.muted });
    }
  }

  /** Mutes or unmutes the selected channel; false without a selection. */
  toggleSelectedMute(): boolean {
    const selected = this.selectedSignal();
    if (selected === null || !this.channels().has(selected)) {
      return false;
    }
    this.toggleMute(selected);
    return true;
  }

  /** Sets the mode (always, with the picture, off). */
  setMode(sourceId: string, mode: AudioMode): void {
    this.change(sourceId, { mode });
  }

  /** Sets the sync offset in milliseconds (0–500). */
  setSyncOffset(sourceId: string, syncOffsetMs: number): void {
    this.change(sourceId, { syncOffsetMs: clampSyncOffsetMs(syncOffsetMs) });
  }

  /** Undoes the last mixer change of this seat. */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.toasts.show(t('regie.audio.history.nothingToUndo'));
      return false;
    }
    this.redoStack.push(entry);
    this.historyVersion.update((version) => version + 1);
    this.apply(entry.before);
    this.toasts.show(t('regie.audio.history.undone'));
    return true;
  }

  /** Redoes the last undone mixer change. */
  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) {
      this.toasts.show(t('regie.audio.history.nothingToRedo'));
      return false;
    }
    this.undoStack.push(entry);
    this.historyVersion.update((version) => version + 1);
    this.apply(entry.after);
    this.toasts.show(t('regie.audio.history.redone'));
    return true;
  }

  private change(sourceId: string, patch: Partial<AudioChannelDto>): void {
    const current = this.channels().get(sourceId);
    if (!current) {
      return;
    }
    const next: AudioChannelDto = { ...current, ...patch, sourceId };
    if (sameChannel(current, next)) {
      return;
    }
    this.show(next);
    this.queue([next], false);
    this.record({ before: [current], after: [next] });
    void this.flush();
  }

  /** Sends the channels of an undo or redo step (the ones that still exist). */
  private apply(channels: readonly AudioChannelDto[]): void {
    const present = channels.filter((channel) => this.channels().has(channel.sourceId));
    for (const channel of present) {
      this.show(channel);
    }
    if (present.length > 0) {
      this.queue(present, false);
      void this.flush();
    }
  }

  private record(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > AUDIO_UNDO_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.historyVersion.update((version) => version + 1);
  }

  private reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.drags.clear();
    this.waiting = new Map();
    this.overlay.set(NO_OVERLAY);
    this.selectedSignal.set(null);
    this.clearTimers();
    this.historyVersion.update((version) => version + 1);
  }

  private show(channel: AudioChannelDto): void {
    this.overlay.update((overlay) => new Map(overlay).set(channel.sourceId, channel));
    if (this.overlayTimer !== null) {
      clearTimeout(this.overlayTimer);
    }
    this.overlayTimer = setTimeout(() => {
      this.overlayTimer = null;
      this.overlay.set(NO_OVERLAY);
    }, OVERLAY_MS);
  }

  private queue(channels: readonly AudioChannelDto[], adjusting: boolean): void {
    for (const channel of channels) {
      this.waiting.set(channel.sourceId, channel);
    }
    this.waitingAdjusting = this.waitingAdjusting && adjusting;
  }

  private scheduleSend(): void {
    if (this.sendTimer !== null) {
      return;
    }
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      void this.flush();
    }, FADER_SEND_MS);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || this.waiting.size === 0) {
      return;
    }
    const productionId = this.store.productionId();
    if (!productionId || !this.store.canCommand()) {
      this.waiting = new Map();
      this.waitingAdjusting = true;
      this.overlay.set(NO_OVERLAY);
      this.toasts.show(t('regie.docks.offline'));
      return;
    }
    const channels = [...this.waiting.values()];
    const adjusting = this.waitingAdjusting;
    this.waiting = new Map();
    this.waitingAdjusting = true;
    this.inFlight = true;
    try {
      await this.api.setAudioChannels(productionId, { channels, adjusting });
    } catch (error) {
      this.overlay.set(NO_OVERLAY);
      this.toasts.error(error, undefined);
    } finally {
      this.inFlight = false;
    }
    if (this.waiting.size > 0 && this.sendTimer === null) {
      void this.flush();
    }
  }

  private clearSendTimer(): void {
    if (this.sendTimer !== null) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearSendTimer();
    if (this.overlayTimer !== null) {
      clearTimeout(this.overlayTimer);
      this.overlayTimer = null;
    }
  }
}
