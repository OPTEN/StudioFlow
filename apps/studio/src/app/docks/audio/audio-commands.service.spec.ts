import { TestBed } from '@angular/core/testing';
import type { AudioChannelDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, audioChannelFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { AUDIO_UNDO_LIMIT, AudioCommandsService, FADER_SEND_MS } from './audio-commands.service';

const DESK = 'dev_cccccccccccccccc/mic';
const SCREEN = 'dev_bbbbbbbbbbbbbbbb/screen-1';
const URL = `/api/productions/${PRODUCTION_ID}/audio/channels`;

interface Request {
  readonly channels: AudioChannelDto[];
  readonly adjusting: boolean;
}

describe('AudioCommandsService', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let commands: AudioCommandsService;
  let toasts: ToastService;

  /**
   * Answers the requests of the mixer, one after the other (only one is in flight at a time), with the channels they
   * carried, and returns their bodies in the order they were sent.
   */
  async function answered(): Promise<Request[]> {
    const bodies: Request[] = [];
    for (let round = 0; round < 8; round += 1) {
      await flushMicrotasks();
      const requests = harness.http.match(URL);
      if (requests.length === 0) {
        break;
      }
      for (const request of requests) {
        bodies.push(request.request.body as Request);
        request.flush((request.request.body as Request).channels);
      }
    }
    await flushMicrotasks();
    return bodies;
  }

  /** The server confirms: the channels arrive as an event, like the hub delivers them. */
  async function confirm(...channels: AudioChannelDto[]): Promise<void> {
    harness.emitEvent({ type: 'audioChannelsChanged', channels });
    await harness.settle();
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      snapshotFixture({
        audioChannels: [audioChannelFixture(DESK, { mode: 'always' }), audioChannelFixture(SCREEN)],
      }),
    );
    commands = TestBed.inject(AudioCommandsService);
    toasts = TestBed.inject(ToastService);
    await harness.settle();
  });

  afterEach(() => {
    try {
      harness.http.verify();
    } finally {
      TestBed.resetTestingModule();
      vi.useRealTimers();
    }
  });

  it('shows the channels of the store', () => {
    expect(commands.channels().get(DESK)).toMatchObject({ mode: 'always', gainDb: 0 });
    expect(commands.canUndo()).toBe(false);
    expect(commands.canRedo()).toBe(false);
  });

  describe('mute, mode and sync offset', () => {
    it('sends a mute at once and shows it before the event arrives', async () => {
      commands.toggleMute(DESK);
      expect(commands.channels().get(DESK)?.muted).toBe(true);
      const [request] = await answered();
      expect(request).toEqual({
        channels: [{ sourceId: DESK, gainDb: 0, muted: true, mode: 'always', syncOffsetMs: 0 }],
        adjusting: false,
      });
      expect(commands.canUndo()).toBe(true);
    });

    it('lets go of the shown change once the store reports it', async () => {
      commands.setMuted(DESK, true);
      await answered();
      await confirm(audioChannelFixture(DESK, { mode: 'always', muted: true }));
      expect(commands.channels().get(DESK)?.muted).toBe(true);
      await confirm(audioChannelFixture(DESK, { mode: 'always', muted: false }));
      expect(commands.channels().get(DESK)?.muted).toBe(false);
    });

    it('sets the mode and the sync offset, clamping the offset to 0–500 ms', async () => {
      commands.setMode(SCREEN, 'off');
      commands.setSyncOffset(SCREEN, 900);
      const bodies = await answered();
      expect(bodies.at(-1)?.channels[0]).toMatchObject({ mode: 'off', syncOffsetMs: 500 });
      commands.setSyncOffset(SCREEN, -20);
      expect(commands.channels().get(SCREEN)?.syncOffsetMs).toBe(0);
      await answered();
    });

    it('sends nothing for a change that changes nothing, or for a channel that does not exist', async () => {
      commands.setMode(DESK, 'always');
      commands.setMuted('dev_zzzzzzzzzzzzzzzz/mic', true);
      commands.toggleMute('dev_zzzzzzzzzzzzzzzz/mic');
      await flushMicrotasks();
      expect(harness.http.match(URL)).toHaveLength(0);
      expect(commands.canUndo()).toBe(false);
    });

    it('falls back and says so when the server refuses', async () => {
      commands.setMuted(DESK, true);
      await flushMicrotasks();
      harness.http
        .expectOne(URL)
        .flush({ code: 'validation_failed' }, { status: 400, statusText: 'Bad Request' });
      await flushMicrotasks();
      await harness.settle();
      expect(commands.channels().get(DESK)?.muted).toBe(false);
      expect(toasts.current()).not.toBeNull();
    });

    it('does not send while the Regie is offline', async () => {
      hub.drop();
      await harness.settle();
      commands.setMuted(DESK, true);
      await flushMicrotasks();
      expect(harness.http.match(URL)).toHaveLength(0);
      expect(toasts.current()?.message).toBe(
        'No connection to the server. Please try again in a moment.',
      );
      expect(commands.channels().get(DESK)?.muted).toBe(false);
    });
  });

  describe('the fader', () => {
    it('sends a drag every 80 ms as adjusting and the end of it once, as one undo step', async () => {
      commands.beginFader(DESK);
      commands.moveFader(DESK, -3);
      expect(commands.channels().get(DESK)?.gainDb).toBe(-3);
      await vi.advanceTimersByTimeAsync(FADER_SEND_MS);
      const first = await answered();
      commands.moveFader(DESK, -9);
      commands.moveFader(DESK, -12);
      await vi.advanceTimersByTimeAsync(FADER_SEND_MS);
      const second = await answered();
      commands.endFader(DESK, -12.5);
      const last = await answered();

      expect(first).toEqual([
        { channels: [expect.objectContaining({ gainDb: -3 })], adjusting: true },
      ]);
      expect(second).toEqual([
        { channels: [expect.objectContaining({ gainDb: -12 })], adjusting: true },
      ]);
      expect(last).toEqual([
        { channels: [expect.objectContaining({ gainDb: -12.5 })], adjusting: false },
      ]);

      // One gesture, one undo step: back to 0 dB.
      commands.undo();
      const [undone] = await answered();
      expect(undone.channels[0]).toMatchObject({ gainDb: 0 });
      expect(undone.adjusting).toBe(false);
      expect(commands.canUndo()).toBe(false);
    });

    it('keeps a single request in flight and sends the newest state after it', async () => {
      commands.beginFader(DESK);
      commands.moveFader(DESK, -3);
      await vi.advanceTimersByTimeAsync(FADER_SEND_MS);
      await flushMicrotasks();
      const pending = harness.http.match(URL);
      expect(pending).toHaveLength(1);

      commands.moveFader(DESK, -6);
      await vi.advanceTimersByTimeAsync(FADER_SEND_MS);
      expect(harness.http.match(URL)).toHaveLength(0);

      pending[0].flush([]);
      await flushMicrotasks();
      const next = harness.http.match(URL);
      expect(next).toHaveLength(1);
      expect((next[0].request.body as Request).channels[0].gainDb).toBe(-6);
      next[0].flush([]);
    });

    it('resets to 0 dB and clamps the fader range', async () => {
      commands.beginFader(DESK);
      commands.moveFader(DESK, 25);
      expect(commands.channels().get(DESK)?.gainDb).toBe(10);
      commands.moveFader(DESK, -500);
      expect(commands.channels().get(DESK)?.gainDb).toBe(-100);
      commands.endFader(DESK, -500);
      await answered();
      commands.resetFader(DESK);
      expect(commands.channels().get(DESK)?.gainDb).toBe(0);
      await answered();
    });

    it('records no step for a drag that ends where it began', async () => {
      commands.beginFader(DESK);
      commands.moveFader(DESK, -3);
      commands.moveFader(DESK, 0);
      commands.endFader(DESK, 0);
      await answered();
      expect(commands.canUndo()).toBe(false);
    });
  });

  describe('undo and redo', () => {
    it('undoes and redoes mixer changes in order and clears the redo steps with a new change', async () => {
      commands.setMuted(DESK, true);
      commands.setMode(SCREEN, 'off');
      await answered();
      await confirm(
        audioChannelFixture(DESK, { mode: 'always', muted: true }),
        audioChannelFixture(SCREEN, { mode: 'off' }),
      );

      expect(commands.undo()).toBe(true);
      const [undoSent] = await answered();
      expect(undoSent.channels).toEqual([audioChannelFixture(SCREEN)]);
      expect(toasts.current()?.message).toBe('Mixer change undone');
      expect(commands.canRedo()).toBe(true);

      expect(commands.redo()).toBe(true);
      const [redoSent] = await answered();
      expect(redoSent.channels).toEqual([audioChannelFixture(SCREEN, { mode: 'off' })]);

      commands.undo();
      await answered();
      commands.setSyncOffset(DESK, 40);
      await answered();
      expect(commands.canRedo()).toBe(false);
    });

    it('says when there is nothing to undo or redo', () => {
      expect(commands.undo()).toBe(false);
      expect(toasts.current()?.message).toBe('Nothing to undo in the mixer');
      expect(commands.redo()).toBe(false);
      expect(toasts.current()?.message).toBe('Nothing to redo in the mixer');
    });

    it('keeps at most 60 steps', async () => {
      for (let step = 1; step <= AUDIO_UNDO_LIMIT + 5; step += 1) {
        commands.setSyncOffset(DESK, step);
        await answered();
        await confirm(audioChannelFixture(DESK, { mode: 'always', syncOffsetMs: step }));
      }
      let undone = 0;
      while (commands.canUndo()) {
        commands.undo();
        undone += 1;
        await answered();
        await confirm(audioChannelFixture(DESK, { mode: 'always', syncOffsetMs: 0 }));
      }
      expect(undone).toBe(AUDIO_UNDO_LIMIT);
    });
  });

  describe('selection and the M key', () => {
    it('mutes the selected channel, and nothing without a selection', async () => {
      expect(commands.toggleSelectedMute()).toBe(false);
      commands.select(SCREEN);
      expect(commands.selected()).toBe(SCREEN);
      expect(commands.toggleSelectedMute()).toBe(true);
      const [request] = await answered();
      expect(request.channels[0]).toMatchObject({ sourceId: SCREEN, muted: true });
    });

    it('drops the selection of a channel that went away', async () => {
      commands.select(SCREEN);
      harness.emitEvent({ type: 'sourceRemoved', sourceId: SCREEN });
      await harness.settle();
      expect(commands.selected()).toBeNull();
    });
  });
});
