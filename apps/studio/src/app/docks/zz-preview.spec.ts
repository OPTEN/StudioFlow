// TEMPORARY visual harness (not committed): renders the docks with fixtures and writes static HTML for a screenshot.
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AudioGraphState, GraphLevels, MonitorSelection } from '@studioflow/media-client/device';
import { HUB } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  audioChannelFixture,
  deviceFixture,
  incidentFixture,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
  sourceFixture,
} from '../../testing/fixtures';
import { startStore, studioTestProviders } from '../../testing/store-harness';
import { STUDIO_MIX_FACTORY, type StudioMix } from '../core/audio/studio-audio.service';
import { StudioMediaService, type StudioSourceProvider } from '../core/media/studio-media.service';
import { DockLayoutService } from '../shell/workspace/dock-layout.service';
import { AudioDockComponent } from './audio/audio-dock.component';
import { PairingDockComponent } from './pairing/pairing-dock.component';
import { StationsDockComponent } from './stations/stations-dock.component';

const OUT = true;

class FakeMix implements StudioMix {
  state: AudioGraphState = 'running';
  canChooseOutputDevice = true;
  readonly inputs = new Map<string, MediaStream | null>();
  resume = async (): Promise<AudioGraphState> => this.state;
  onStateChange(): () => void {
    return () => undefined;
  }
  setInput(id: string, stream: MediaStream | null): void {
    this.inputs.set(id, stream);
  }
  hasInput(id: string): boolean {
    return (this.inputs.get(id) ?? null) !== null;
  }
  apply(): void {}
  levels(): GraphLevels {
    const channels = new Map<string, number>();
    let level = -8;
    for (const id of this.inputs.keys()) {
      channels.set(id, level);
      level -= 14;
    }
    return { channels, program: -12 };
  }
  setMonitor(_: MonitorSelection): void {}
  setSinkId(): Promise<boolean> {
    return Promise.resolve(true);
  }
  dispose(): void {}
}

function sound(): MediaStream {
  return { getAudioTracks: () => [{ stop: () => undefined }], getVideoTracks: () => [] } as unknown as MediaStream;
}

const PHONE = 'dev_aaaaaaaaaaaaaaaa';
const PHONE2 = 'dev_dddddddddddddddd';
const LAPTOP = 'dev_bbbbbbbbbbbbbbbb';
const DESK = 'dev_cccccccccccccccc';

function snapshot() {
  const now = Date.now();
  return snapshotFixture({
    production: productionFixture({ broadcast: 'live', programSceneId: 'scn_a' }),
    scenes: [
      sceneFixture('scn_a', 'Slides', 0, [itemFixture('itm_a1', `${PHONE}/camera`), itemFixture('itm_a2', `${LAPTOP}/screen-1`)]),
      sceneFixture('scn_b', 'Break', 1),
    ],
    devices: [
      deviceFixture(PHONE, 'Stage camera', {
        telemetry: {
          at: new Date().toISOString(),
          rtc: 'connected',
          batteryPct: 14,
          charging: false,
          network: 'wifi',
          rttMs: 31,
          slots: [{ slot: 'camera', state: 'live', width: 1920, height: 1080, fps: 30, bitrateKbps: 2800, packetLossPct: 0.2, codec: 'h264' }],
          camera: {
            v: 1,
            capabilities: {
              lenses: [
                { id: 'main', label: 'a', kind: 'standard' },
                { id: 'wide', label: 'b', kind: 'ultraWide' },
                { id: 'front', label: 'c', kind: 'front' },
              ],
              zoom: { min: 1, max: 8, step: 0.1 },
              focusModes: ['auto', 'manual'],
              focusDistance: { min: 0.1, max: 2, step: 0.05 },
              exposureCompensation: { min: -2, max: 2, step: 0.5 },
              torch: true,
            },
            settings: { lensId: 'main', zoom: 2, focusMode: 'auto', focusDistance: null, exposureCompensation: 0.5, torch: false },
            problem: null,
          },
        },
      }),
      deviceFixture(PHONE2, 'Hall camera with a long name'),
      deviceFixture(LAPTOP, 'Laptop Lea', { kind: 'laptop', platform: 'Windows · Edge' }),
      deviceFixture(DESK, 'Mixing desk', { kind: 'audioStation', platform: 'macOS · Chrome', connection: 'offline' }),
    ],
    sources: [
      sourceFixture(PHONE, 'camera', 'K1', { label: 'Stage camera' }),
      sourceFixture(PHONE2, 'camera', 'K2', { label: 'Hall camera', status: 'reconnecting', statusSince: new Date(now - 12_000).toISOString() }),
      sourceFixture(LAPTOP, 'screen-1', 'S1', { label: 'Laptop Lea · Screen 1', status: 'ended', statusSince: new Date(now - 40_000).toISOString() }),
      sourceFixture(LAPTOP, 'screen-2', 'S2', { label: 'Laptop Lea · Screen 2' }),
      sourceFixture(DESK, 'mic', 'A1', { label: 'Mixing desk', status: 'offline' }),
    ],
    incidents: [
      incidentFixture('inc_1', `${PHONE2}/camera`, 'K2', { startedAt: new Date(now - 12_000).toISOString() }),
      incidentFixture('inc_2', `${LAPTOP}/screen-2`, 'S2', { startedAt: new Date(now - 60_000).toISOString(), endedAt: new Date(now - 51_000).toISOString() }),
    ],
    audioChannels: [
      audioChannelFixture(`${DESK}/mic`, { mode: 'always' }),
      audioChannelFixture(`${LAPTOP}/screen-1`, { muted: true }),
    ],
    pairingRequests: [
      {
        id: 'prq_aaaaaaaaaaaaaaaa',
        name: 'Laptop Mia',
        kind: 'laptop',
        platform: 'Windows · Chrome',
        checkCode: '4712',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(now + 540_000).toISOString(),
      },
    ],
    invites: [
      {
        id: 'inv_qqqqqqqqqqqqqqqq',
        kind: 'phoneQr',
        url: 'https://studioflow.example.com/join/i/inv_qqqqqqqqqqqqqqqq',
        createdAt: new Date(now - 10_000).toISOString(),
        expiresAt: new Date(now + 1_790_000).toISOString(),
      },
      {
        id: 'inv_llllllllllllllll',
        kind: 'laptopLink',
        url: 'https://studioflow.example.com/j/inv_llllllllllllllll',
        createdAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 1_500_000).toISOString(),
      },
    ],
  });
}

const seen = new Set<string>();
function collect(): void {
  document.head.querySelectorAll('style').forEach((style) => seen.add(style.outerHTML));
}
function styles(): string {
  collect();
  return [...seen].join('\n');
}

describe.runIf(OUT)('preview', () => {
  it('writes the docks', async () => {
    const hub = new FakeStudioHub();
    const sounds = new Map<string, MediaStream>([[`${LAPTOP}/screen-1`, sound()], [`${DESK}/mic`, sound()]]);
    const provider = {
      audioStream: (id: string) => sounds.get(id) ?? null,
      audioSourceIds: () => [...sounds.keys()],
      onAudioChange: () => () => undefined,
      attach: () => undefined,
      detach: () => undefined,
      setDesiredSize: () => undefined,
      getStats: async () => null,
    };
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        { provide: STUDIO_MIX_FACTORY, useValue: () => new FakeMix() },
        { provide: StudioMediaService, useValue: { provider: signal(provider as unknown as StudioSourceProvider) } },
      ],
    });
    const harness = await startStore(hub, snapshot());
    const st = TestBed.createComponent(StationsDockComponent);
    const audio = TestBed.createComponent(AudioDockComponent);
    const render = async () => {
      await flushMicrotasks();
      st.detectChanges();
      audio.detectChanges();
      await st.whenStable();
    };
    await render();
    (st.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`[data-device="${PHONE}"] .c-st__row`)!.click();
    await render();
    (st.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="camera-open"]')!.click();
    await render();
    (st.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.c-st__disclosure')!.click();
    await render();
    audio.nativeElement.querySelector('[data-testid="audio-more"]')?.click();
    await render();
    const layout = TestBed.inject(DockLayoutService);
    layout.openPairing('phone');
    const pair = TestBed.createComponent(PairingDockComponent);
    pair.detectChanges();
    await flushMicrotasks();
    harness.http.match(() => true).forEach((request) => {
      if (request.request.url.endsWith('/system/info')) {
        request.flush({ version: '1', publicBaseUrl: 'https://studioflow.example.com', canvasWidth: 1920, canvasHeight: 1080 });
      }
    });
    await flushMicrotasks();
    pair.detectChanges();
    const phoneHtml = (pair.nativeElement as HTMLElement).outerHTML;
    collect();
    layout.setPairingTab('laptop');
    pair.detectChanges();
    await flushMicrotasks();
    pair.detectChanges();
    const laptopHtml = (pair.nativeElement as HTMLElement).outerHTML;
    collect();
    layout.setPairingTab('link');
    pair.detectChanges();
    await flushMicrotasks();
    pair.detectChanges();
    Array.from((pair.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Create link'))?.click();
    harness.http.match(() => true).forEach((request) => {
      if (request.request.url.endsWith('/pairing/invites')) {
        request.flush({ id: 'inv_cccccccccccccccc', kind: 'laptopLink', url: 'https://studioflow.example.com/j/inv_cccccccccccccccc', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
      }
    });
    await flushMicrotasks();
    await flushMicrotasks();
    pair.detectChanges();
    const linkHtml = (pair.nativeElement as HTMLElement).outerHTML;
    void HUB;
    // @ts-ignore node module in the test runner
    const fs = await import('node:fs');
    fs.writeFileSync(
      'C:/Users/NICOMA~1/AppData/Local/Temp/claude/C--Users-NicoMarra--claude-spares-spare-cghQ1v/f29e2978-4c8b-45e3-a799-c40919341aae/scratchpad/dockb-preview.json',
      JSON.stringify({
        styles: styles(),
        stations: (st.nativeElement as HTMLElement).outerHTML,
        audio: (audio.nativeElement as HTMLElement).outerHTML,
        phone: phoneHtml,
        laptop: laptopHtml,
        link: linkHtml,
      }),
    );
  });
});
