import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../testing/store-harness';
import { PREFERENCE_KEYS } from '../core/ui/preferences.service';
import { ControlColumnComponent } from './control-column.component';
import { SwitcherService } from './switcher.service';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('ControlColumnComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let fixture: ComponentFixture<ControlColumnComponent>;
  let element: HTMLElement;
  let switcher: SwitcherService;

  async function setup(
    options: { studio?: boolean; preview?: string | null; transition?: string } = {},
  ): Promise<void> {
    hub = new FakeStudioHub();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    if (options.transition) {
      storage.setItem(PREFERENCE_KEYS.transition, options.transition);
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ previewSceneId: options.preview ?? null }),
      }),
    );
    switcher = TestBed.inject(SwitcherService);
    fixture = TestBed.createComponent(ControlColumnComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find(
      (entry) =>
        entry.textContent?.replace(/\s+/g, ' ').trim() === label ||
        entry.getAttribute('aria-label') === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  function take(): HTMLButtonElement | null {
    return element.querySelector('.c-take');
  }

  function studioSwitch(): HTMLInputElement {
    return element.querySelector('input[role="switch"]') as HTMLInputElement;
  }

  afterEach(() => harness?.http.verify());

  it('shows the direct mode: switch off, Fade 0.3 s, no Take, the direct hint', async () => {
    await setup();
    expect(studioSwitch().checked).toBe(false);
    expect(element.querySelector('label.c-switch')?.textContent?.trim()).toBe('Studio Mode');
    expect(element.querySelector('[role="group"][aria-label="Transition type"]')).not.toBeNull();
    expect(button('Fade').getAttribute('aria-pressed')).toBe('true');
    expect(button('Cut').getAttribute('aria-pressed')).toBe('false');
    expect(element.querySelector('.c-duration__value')?.textContent).toBe('0.3 s');
    expect(take()).toBeNull();
    expect(element.querySelector('.c-control-column__hint')?.textContent).toBe(
      'Click a scene to switch it live directly.',
    );
  });

  it('turns Studio Mode on: Take with "Space" appears and the hint changes', async () => {
    await setup();
    studioSwitch().click();
    await render();
    // Turning it on assigns the scene after the program as preview.
    harness.http.expectOne(`${BASE}/preview`).flush(productionFixture({ previewSceneId: 'scn_b' }));
    await render();
    expect(switcher.studioMode()).toBe(true);
    expect(take()?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Take Space');
    expect(take()?.getAttribute('aria-keyshortcuts')).toBe('Space');
    expect(element.querySelector('.c-control-column__hint')?.textContent).toBe(
      'Click a scene to load it into Preview. Take switches it live.',
    );
  });

  it('switches to Cut: the duration is muted and both steppers are disabled', async () => {
    await setup();
    button('Cut').click();
    await render();
    expect(button('Cut').getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelector('.c-duration')?.classList.contains('is-off')).toBe(true);
    expect(button('Shorter fade').disabled).toBe(true);
    expect(button('Longer fade').disabled).toBe(true);
    expect(switcher.transition()).toEqual({ kind: 'cut', durationMs: 0 });
  });

  it('steps the fade duration and disables the steppers at the ends', async () => {
    await setup({ transition: JSON.stringify({ kind: 'fade', durationMs: 200 }) });
    expect(button('Shorter fade').disabled).toBe(true);
    button('Longer fade').click();
    await render();
    expect(element.querySelector('.c-duration__value')?.textContent).toBe('0.3 s');
    for (let step = 0; step < 6; step += 1) {
      button('Longer fade').click();
      await render();
    }
    expect(element.querySelector('.c-duration__value')?.textContent).toBe('2 s');
    expect(button('Longer fade').disabled).toBe(true);
    expect(button('Shorter fade').disabled).toBe(false);
  });

  it('takes once and is disabled while the request is in flight (no double take)', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    expect(take()?.disabled).toBe(false);
    take()?.click();
    await render();
    expect(take()?.disabled).toBe(true);
    take()?.click();
    const request = harness.http.expectOne(`${BASE}/take`);
    expect(request.request.body).toEqual({ transition: { kind: 'fade', durationMs: 300 } });
    request.flush(productionFixture({ programSceneId: 'scn_b', previewSceneId: 'scn_a' }));
    await render();
    expect(take()?.disabled).toBe(false);
  });

  it('disables Take while editing is locked (preview = program) and while offline', async () => {
    await setup({ studio: true, preview: 'scn_a' });
    expect(take()?.disabled).toBe(true);
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_a',
      previewSceneId: 'scn_b',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'cut', durationMs: 0 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    await render();
    expect(take()?.disabled).toBe(false);
    hub.drop();
    await render();
    expect(take()?.disabled).toBe(true);
  });

  it('disables Take while a fade runs', async () => {
    await setup({ studio: true, preview: 'scn_c' });
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: 'scn_c',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 1000 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    await render();
    expect(switcher.transitionRunning()).toBe(true);
    expect(take()?.disabled).toBe(true);
  });
});
