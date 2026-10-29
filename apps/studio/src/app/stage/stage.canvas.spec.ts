import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { canvasDto, type CanvasDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { productionFixture, snapshotFixture } from '../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../testing/store-harness';
import { PREFERENCE_KEYS } from '../core/ui/preferences.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { SCENE_RENDERER_FACTORY } from './scene-view.component';
import { StageComponent } from './stage.component';
import { FakeRendererFactory, ManualFrames } from './testing/stage-fakes';

describe('StageComponent: shape of the canvas', () => {
  let harness: StoreHarness;
  let factory: FakeRendererFactory;
  let fixture: ComponentFixture<StageComponent>;
  let element: HTMLElement;

  async function setup(canvas: CanvasDto, studio = false): Promise<void> {
    const hub = new FakeStudioHub();
    factory = new FakeRendererFactory();
    const storage = new MemoryStorage();
    if (studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub, storage),
        { provide: SCENE_RENDERER_FACTORY, useValue: factory.create },
        { provide: FRAME_SCHEDULER, useValue: new ManualFrames().scheduler },
      ],
    });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ canvas, previewSceneId: studio ? 'scn_b' : null }),
      }),
    );
    fixture = TestBed.createComponent(StageComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function screens(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.c-monitor__screen'));
  }

  function meta(kind: 'preview' | 'program'): string {
    const found = element.querySelector(`sf-monitor.c-monitor--${kind} .c-monitor__meta`);
    return (found?.textContent ?? '').trim();
  }

  afterEach(() => harness?.http.verify());

  it.each([
    ['widescreen', 'p1080', '1920 / 1080'],
    ['widescreen', 'p720', '1280 / 720'],
    ['portrait', 'p1080', '1080 / 1920'],
    ['square', 'p720', '720 / 720'],
    ['standard', 'p1080', '1440 / 1080'],
  ] as const)('gives the monitor screen the shape of %s %s', async (format, resolution, ratio) => {
    await setup(canvasDto(format, resolution));

    expect(screens()[0].style.aspectRatio.replace(/\s/g, '')).toBe(ratio.replace(/\s/g, ''));
  });

  it('gives the Preview and the Program the same shape in Studio Mode', async () => {
    await setup(canvasDto('portrait', 'p1080'), true);

    expect(screens()).toHaveLength(2);
    expect(screens().map((screen) => screen.style.aspectRatio.replace(/\s/g, ''))).toEqual([
      '1080/1920',
      '1080/1920',
    ]);
  });

  it('names the size of the canvas on the Program monitor', async () => {
    await setup(canvasDto('portrait', 'p720'), true);

    expect(meta('program')).toBe('720 × 1280');
  });

  it('follows a change of the format live', async () => {
    await setup(canvasDto('widescreen', 'p1080'));

    harness.emitEvent({
      type: 'productionCanvasChanged',
      production: productionFixture({ canvas: canvasDto('square', 'p1080') }),
      scenes: [],
    });
    await harness.settle();
    await render();

    expect(screens()[0].style.aspectRatio.replace(/\s/g, '')).toBe('1080/1080');
    expect(meta('program')).toBe('1080 × 1080');
  });
});
