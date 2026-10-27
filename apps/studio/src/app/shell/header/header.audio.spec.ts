import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { OutputAudioDto, OutputStatusDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { audioChannelFixture, snapshotFixture, sourceFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { HeaderComponent } from './header.component';

const DESK = 'dev_cccccccccccccccc/mic';

function status(audio: OutputAudioDto | null, state: 'connected' | 'stale' = 'connected') {
  const at = new Date().toISOString();
  return {
    state,
    consumers: 1,
    addresses: ['10.0.0.5'],
    latencyMs: 62,
    fps: 30,
    lastReportAt: at,
    links: [
      {
        linkId: 'olk_aaaaaaaaaaaaaaaa',
        name: 'Proxy',
        state,
        consumers: 1,
        addresses: ['10.0.0.5'],
        latencyMs: 62,
        fps: 30,
        lastReportAt: at,
        audio,
      },
    ],
  } satisfies OutputStatusDto;
}

describe('HeaderComponent: audio of the output', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<HeaderComponent>;
  let element: HTMLElement;

  async function setup(
    audio: OutputAudioDto | null,
    options: { channels?: boolean; link?: 'connected' | 'stale' } = {},
  ): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      snapshotFixture({
        sources: [sourceFixture('dev_cccccccccccccccc', 'mic', 'A1', { label: 'Mixing desk' })],
        audioChannels:
          options.channels === false ? [] : [audioChannelFixture(DESK, { mode: 'always' })],
        outputStatus: status(audio, options.link ?? 'connected'),
      }),
    );
    fixture = TestBed.createComponent(HeaderComponent);
    element = fixture.nativeElement as HTMLElement;
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function warning(): HTMLElement | null {
    return element.querySelector<HTMLElement>('[data-testid="audio-blocked"]');
  }

  afterEach(() => harness?.http.verify());

  it('says "Audio blocked" in the output chip while the connected page cannot play sound', async () => {
    await setup({ state: 'blocked', levelDb: null });
    expect(warning()?.textContent?.trim()).toBe('Audio blocked');
    expect(warning()?.classList.contains('c-state--warn')).toBe(true);
    const chip = element.querySelector<HTMLButtonElement>('.c-chipbtn');
    expect(chip?.getAttribute('title')).toContain('Proxy · connected');
    expect(chip?.getAttribute('title')).toContain('Click the output page once');
  });

  it('says nothing while the page plays sound, is switched off for audio, or reports nothing', async () => {
    await setup({ state: 'running', levelDb: -20 });
    expect(warning()).toBeNull();
    TestBed.resetTestingModule();
    await setup({ state: 'off', levelDb: null });
    expect(warning()).toBeNull();
    TestBed.resetTestingModule();
    await setup(null);
    expect(warning()).toBeNull();
  });

  it('says nothing when no channel could be heard, even if the page is blocked', async () => {
    await setup({ state: 'blocked', levelDb: null }, { channels: false });
    expect(warning()).toBeNull();
  });

  it('says nothing for a page that is not connected any more', async () => {
    await setup({ state: 'blocked', levelDb: null }, { link: 'stale' });
    expect(warning()).toBeNull();
  });
});
