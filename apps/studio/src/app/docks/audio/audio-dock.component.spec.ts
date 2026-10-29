import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ApplyOptions,
  AudioGraphState,
  GraphLevels,
  MonitorSelection,
} from '@studioflow/media-client/device';
import type { ChannelTarget } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  audioChannelFixture,
  deviceFixture,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import {
  METER_INTERVAL_MS,
  STUDIO_MIX_FACTORY,
  type StudioMix,
} from '../../core/audio/studio-audio.service';
import {
  StudioMediaService,
  type StudioSourceProvider,
} from '../../core/media/studio-media.service';
import { KeyboardService } from '../../core/ui/keyboard.service';
import { ToastService } from '../../core/ui/toast.service';
import { AudioDockComponent } from './audio-dock.component';

const URL = `/api/productions/${PRODUCTION_ID}/audio/channels`;
const DESK = 'dev_cccccccccccccccc/mic';
const SCREEN = 'dev_bbbbbbbbbbbbbbbb/screen-1';

class FakeMix implements StudioMix {
  state: AudioGraphState = 'running';
  readonly inputs = new Map<string, MediaStream | null>();
  levelsByChannel = new Map<string, number>();
  program = -100;
  monitors: MonitorSelection[] = [];
  canChooseOutputDevice = false;
  readonly resume = vi.fn(async (): Promise<AudioGraphState> => this.state);

  onStateChange(): () => void {
    return () => undefined;
  }
  setInput(sourceId: string, stream: MediaStream | null): void {
    this.inputs.set(sourceId, stream);
  }
  hasInput(sourceId: string): boolean {
    return (this.inputs.get(sourceId) ?? null) !== null;
  }
  apply(_targets: ReadonlyMap<string, ChannelTarget>, _options: ApplyOptions): void {}
  levels(): GraphLevels {
    const channels = new Map<string, number>();
    for (const sourceId of this.inputs.keys()) {
      channels.set(sourceId, this.levelsByChannel.get(sourceId) ?? -100);
    }
    return { channels, program: this.program };
  }
  setMonitor(selection: MonitorSelection): void {
    this.monitors.push(selection);
  }
  setSinkId(): Promise<boolean> {
    return Promise.resolve(true);
  }
  dispose(): void {}
}

function sound(): MediaStream {
  return {
    getAudioTracks: () => [{ stop: () => undefined }],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

describe('AudioDockComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let fixture: ComponentFixture<AudioDockComponent>;
  let element: HTMLElement;
  let mix: FakeMix;
  let provider: {
    audioStream(id: string): MediaStream | null;
    audioSourceIds(): string[];
    onAudioChange(listener: (id: string) => void): () => void;
    give(id: string, stream: MediaStream | null): void;
  };

  async function setup(withChannels = true, mixState: AudioGraphState = 'running'): Promise<void> {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    hub = new FakeStudioHub();
    mix = new FakeMix();
    mix.state = mixState;
    const sounds = new Map<string, MediaStream>();
    const listeners = new Set<(id: string) => void>();
    provider = {
      audioStream: (id) => sounds.get(id) ?? null,
      audioSourceIds: () => [...sounds.keys()],
      onAudioChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      give: (id, stream) => {
        if (stream) {
          sounds.set(id, stream);
        } else {
          sounds.delete(id);
        }
        listeners.forEach((listener) => listener(id));
      },
    };
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        { provide: STUDIO_MIX_FACTORY, useValue: () => mix },
        {
          provide: StudioMediaService,
          useValue: { provider: signal(provider as unknown as StudioSourceProvider) },
        },
      ],
    });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ broadcast: 'live', programSceneId: 'scn_a' }),
        scenes: [
          sceneFixture('scn_a', 'Slides', 0, [itemFixture('itm_a1', SCREEN)]),
          sceneFixture('scn_b', 'Break', 1),
        ],
        devices: [
          deviceFixture('dev_bbbbbbbbbbbbbbbb', 'Laptop Lea', { kind: 'laptop' }),
          deviceFixture('dev_cccccccccccccccc', 'Mixing desk', { kind: 'audioStation' }),
        ],
        sources: [
          sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', {
            label: 'Laptop Lea · Screen 1',
          }),
          sourceFixture('dev_cccccccccccccccc', 'mic', 'A1', { label: 'Mixing desk' }),
        ],
        audioChannels: withChannels
          ? [audioChannelFixture(DESK, { mode: 'always' }), audioChannelFixture(SCREEN)]
          : [],
      }),
    );
    TestBed.inject(KeyboardService);
    fixture = TestBed.createComponent(AudioDockComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function tick(ms = METER_INTERVAL_MS): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await render();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function rows(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('[data-source]'));
  }

  function row(sourceId: string): HTMLElement {
    return element.querySelector<HTMLElement>(`[data-source="${sourceId}"]`) as HTMLElement;
  }

  function control<T extends HTMLElement>(scope: Element, testId: string): T {
    return scope.querySelector<T>(`[data-testid="${testId}"]`) as T;
  }

  /** Answers the pending mixer request with the channels it carried and returns its body. */
  async function answered(): Promise<{ channels: Record<string, unknown>[]; adjusting: boolean }> {
    await flushMicrotasks();
    const request = harness.http.expectOne(URL);
    const body = request.request.body as {
      channels: Record<string, unknown>[];
      adjusting: boolean;
    };
    request.flush(body.channels);
    await flushMicrotasks();
    return body;
  }

  afterEach(() => {
    try {
      harness.http.verify();
    } finally {
      TestBed.resetTestingModule();
      vi.useRealTimers();
    }
  });

  it('lists the channels with code, name, role, mode and the Live tag of the audible ones', async () => {
    await setup();
    provider.give(SCREEN, sound());
    await tick();

    expect(rows().map((entry) => entry.getAttribute('data-source'))).toEqual([DESK, SCREEN]);
    const desk = row(DESK);
    expect(text(desk.querySelector('.c-audio__name'))).toBe('Mixing desk');
    expect(text(desk.querySelector('.c-audio__sub'))).toContain('Audio station');
    expect(text(desk.querySelector('.c-audio__sub'))).toContain('Always');
    expect(text(desk.querySelector('.c-tag--pgm'))).toBe('Live');
    expect(text(control(desk, 'audio-db'))).toBe('0.0 dB');
    expect(text(element.querySelector('.c-dock-frame__count'))).toBe('2');
  });

  it('shows a screen only once it shares sound', async () => {
    await setup();
    expect(rows().map((entry) => entry.getAttribute('data-source'))).toEqual([DESK]);
    provider.give(SCREEN, sound());
    await tick();
    expect(rows()).toHaveLength(2);
  });

  it('says what to do when there is no channel yet', async () => {
    await setup(false);
    expect(text(element.querySelector('.c-empty'))).toContain('No sound sources yet');
    // An empty list would break the ARIA rules (a list needs list items), so there is none.
    expect(element.querySelector('[role="list"]')).toBeNull();
  });

  it('draws the level of a channel in its meter', async () => {
    await setup();
    provider.give(DESK, sound());
    mix.levelsByChannel.set(DESK, -30);
    await tick();
    expect(control(row(DESK), 'audio-meter').style.transform).toBe('scaleX(0.5)');
    mix.levelsByChannel.set(DESK, -0.5);
    await tick();
    expect(control(row(DESK), 'audio-meter').classList.contains('is-hot')).toBe(true);
  });

  it('mutes with the Mute button, shows it at once and sends one request', async () => {
    await setup();
    const mute = control<HTMLButtonElement>(row(DESK), 'audio-mute');
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    mute.click();
    await render();
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(text(row(DESK).querySelector('[data-testid="audio-state"]'))).toBe('muted');
    expect(await answered()).toEqual({
      channels: [{ sourceId: DESK, gainDb: 0, muted: true, mode: 'always', syncOffsetMs: 0 }],
      adjusting: false,
    });
  });

  it('mutes the selected channel with the M key and ignores the key without a selection', async () => {
    await setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    await flushMicrotasks();
    expect(harness.http.match(URL)).toHaveLength(0);

    row(SCREEN)?.click();
    row(DESK).click();
    await render();
    expect(row(DESK).classList.contains('is-selected')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    const body = await answered();
    expect(body.channels[0]).toMatchObject({ sourceId: DESK, muted: true });
  });

  it('moves the fader: adjusting requests while it moves, the last one for the audit log', async () => {
    await setup();
    const fader = control<HTMLInputElement>(row(DESK), 'audio-fader');
    fader.value = '0.5';
    fader.dispatchEvent(new Event('input'));
    await render();
    expect(text(control(row(DESK), 'audio-db'))).toMatch(/^−\d+\.\d dB$/);
    await vi.advanceTimersByTimeAsync(100);
    const moved = await answered();
    expect(moved.adjusting).toBe(true);

    fader.dispatchEvent(new Event('change'));
    const ended = await answered();
    expect(ended.adjusting).toBe(false);
    expect(ended.channels[0]).toMatchObject({ sourceId: DESK });
  });

  it('resets the fader to 0 dB with a double click', async () => {
    await setup();
    harness.emitEvent({
      type: 'audioChannelsChanged',
      channels: [audioChannelFixture(DESK, { mode: 'always', gainDb: -12 })],
    });
    await render();
    expect(text(control(row(DESK), 'audio-db'))).toBe('−12.0 dB');
    control<HTMLInputElement>(row(DESK), 'audio-fader').dispatchEvent(new Event('dblclick'));
    const body = await answered();
    expect(body.channels[0]).toMatchObject({ gainDb: 0 });
  });

  it('opens the details to set mode and sync offset', async () => {
    await setup();
    expect(row(SCREEN)).toBeNull();
    provider.give(SCREEN, sound());
    await tick();
    const screen = row(SCREEN);
    control<HTMLButtonElement>(screen, 'audio-more').click();
    await render();
    expect(control(screen, 'audio-more').getAttribute('aria-expanded')).toBe('true');
    expect(screen.querySelectorAll('.c-seg button')).toHaveLength(3);
    expect(control(screen, 'audio-mode-follow').getAttribute('aria-pressed')).toBe('true');

    control<HTMLButtonElement>(screen, 'audio-mode-off').click();
    expect((await answered()).channels[0]).toMatchObject({ sourceId: SCREEN, mode: 'off' });

    const sync = control<HTMLInputElement>(screen, 'audio-sync');
    sync.value = '120';
    sync.dispatchEvent(new Event('change'));
    expect((await answered()).channels[0]).toMatchObject({ sourceId: SCREEN, syncOffsetMs: 120 });
  });

  it('warns about a channel that has been silent for 10 seconds', async () => {
    await setup();
    provider.give(DESK, sound());
    mix.levelsByChannel.set(DESK, -90);
    await tick(10_500);
    const state = row(DESK).querySelector('[data-testid="audio-state"]');
    expect(text(state)).toBe('silent for 10 s');
    expect(state?.classList.contains('c-state--warn')).toBe(true);

    mix.levelsByChannel.set(DESK, -20);
    await tick();
    expect(row(DESK).querySelector('[data-testid="audio-state"]')).toBeNull();
  });

  it('says "not sending" for a microphone without a sound', async () => {
    await setup();
    expect(text(row(DESK).querySelector('[data-testid="audio-state"]'))).toBe('not sending');
  });

  it('listens to one channel and stops, and the headphones button and popover say what plays', async () => {
    await setup();
    const pfl = control<HTMLButtonElement>(row(DESK), 'audio-pfl');
    expect(pfl.getAttribute('aria-label')).toBe('Listen to Mixing desk');
    expect(text(control(element, 'audio-monitor'))).toBe('Headphones');
    pfl.click();
    await render();
    expect(pfl.getAttribute('aria-pressed')).toBe('true');
    expect(mix.monitors.at(-1)).toEqual({ kind: 'channel', sourceId: DESK });
    expect(text(control(element, 'audio-monitor'))).toBe('Headphones: A1');

    control<HTMLButtonElement>(element, 'audio-monitor').click();
    await render();
    expect(text(control(element, 'monitor-channel'))).toContain('A1 Mixing desk');
    control<HTMLButtonElement>(element, 'monitor-program').click();
    await render();
    expect(mix.monitors.at(-1)).toEqual({ kind: 'program' });
    expect(pfl.getAttribute('aria-pressed')).toBe('false');
    expect(text(control(element, 'audio-monitor'))).toBe('Headphones: Program');
    control<HTMLButtonElement>(element, 'monitor-off').click();
    expect(mix.monitors.at(-1)).toEqual({ kind: 'off' });
  });

  it('undoes and redoes with the buttons', async () => {
    await setup();
    const undo = control<HTMLButtonElement>(element, 'audio-undo');
    const redo = control<HTMLButtonElement>(element, 'audio-redo');
    expect(undo.disabled).toBe(true);
    control<HTMLButtonElement>(row(DESK), 'audio-mute').click();
    await answered();
    harness.emitEvent({
      type: 'audioChannelsChanged',
      channels: [audioChannelFixture(DESK, { mode: 'always', muted: true })],
    });
    await render();
    expect(undo.disabled).toBe(false);
    undo.click();
    expect((await answered()).channels[0]).toMatchObject({ muted: false });
    await render();
    expect(redo.disabled).toBe(false);
    expect(TestBed.inject(ToastService).current()?.message).toBe('Mixer change undone');
    redo.click();
    expect((await answered()).channels[0]).toMatchObject({ muted: true });
  });

  it('undoes with Ctrl+Z only while the focus is inside the dock', async () => {
    await setup();
    control<HTMLButtonElement>(row(DESK), 'audio-mute').click();
    await answered();
    harness.emitEvent({
      type: 'audioChannelsChanged',
      channels: [audioChannelFixture(DESK, { mode: 'always', muted: true })],
    });
    await render();

    document.body.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );
    await flushMicrotasks();
    expect(harness.http.match(URL)).toHaveLength(0);

    document.body.append(element);
    control<HTMLButtonElement>(row(DESK), 'audio-pfl').focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );
    expect((await answered()).channels[0]).toMatchObject({ muted: false });
    element.remove();
  });

  it('tells that the meters wait for a click while the browser blocks the context', async () => {
    await setup(true, 'blocked');
    expect(text(element.querySelector('[data-testid="audio-suspended"]'))).toBe(
      'The meters start with your first click on this page.',
    );
  });

  it('tells when the browser has no Web Audio', async () => {
    await setup(true, 'unavailable');
    expect(element.querySelector('[data-testid="audio-suspended"]')).toBeNull();
    expect(text(element)).toContain('This browser has no Web Audio');
  });
});
