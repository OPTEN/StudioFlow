import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { BroadcastState, SceneDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { defaultScenes, productionFixture, snapshotFixture } from '../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../testing/store-harness';
import { PREFERENCE_KEYS } from '../core/ui/preferences.service';
import { ViewportService } from '../core/ui/viewport.service';
import { EditorService } from './editor.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { SCENE_RENDERER_FACTORY } from './scene-view.component';
import { StageComponent } from './stage.component';
import { FakeRendererFactory, ManualFrames, type FakeSceneRenderer } from './testing/stage-fakes';

describe('StageComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let factory: FakeRendererFactory;
  let fixture: ComponentFixture<StageComponent>;
  let element: HTMLElement;
  let frames: ManualFrames;

  /** The breakpoints of the test window (the DOM of the test runner is 1024 px wide, which would be stacked). */
  const viewport = {
    stacked: signal(false),
    narrow: signal(false),
    shortLaptop: signal(false),
    reducedMotion: signal(false),
  };

  async function setup(
    options: {
      studio?: boolean;
      preview?: string | null;
      broadcast?: BroadcastState;
      stacked?: boolean;
      scenes?: SceneDto[];
    } = {},
  ): Promise<void> {
    viewport.stacked.set(options.stacked ?? false);
    hub = new FakeStudioHub();
    factory = new FakeRendererFactory();
    frames = new ManualFrames();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub, storage),
        { provide: SCENE_RENDERER_FACTORY, useValue: factory.create },
        { provide: FRAME_SCHEDULER, useValue: frames.scheduler },
        { provide: ViewportService, useValue: viewport },
      ],
    });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({
          previewSceneId: options.preview ?? null,
          broadcast: options.broadcast ?? 'standby',
        }),
        ...(options.scenes ? { scenes: options.scenes } : {}),
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

  function monitor(kind: 'preview' | 'program'): HTMLElement | null {
    return element.querySelector(`sf-monitor.c-monitor--${kind}`);
  }

  function text(node: Element | null): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function rendererOf(kind: 'preview' | 'program'): FakeSceneRenderer {
    const found = factory.renderers.filter(
      (renderer) =>
        !renderer.destroyed && renderer.container.closest('sf-monitor') === monitor(kind),
    );
    if (found.length !== 1) {
      throw new Error(`expected one ${kind} renderer, found ${found.length}`);
    }
    return found[0];
  }

  afterEach(() => harness?.http.verify());

  it('writes the monitor widths one frame after the measurement, outside the ResizeObserver callback', async () => {
    let notify: ResizeObserverCallback = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    try {
      await setup({ studio: true, preview: 'scn_b' });
      const measured = [
        { borderBoxSize: [{ inlineSize: 1000, blockSize: 500 }] },
      ] as unknown as ResizeObserverEntry[];

      notify(measured, {} as ResizeObserver);
      notify(measured, {} as ResizeObserver);

      // A write here would resize the observed host again within the same delivery (“ResizeObserver loop completed with
      // undelivered notifications”).
      expect(element.style.getPropertyValue('--sf-program-w')).toBe('');
      expect(frames.pending).toBe(1);

      frames.flush();
      expect(element.style.getPropertyValue('--sf-program-w')).toMatch(/^\d+(\.\d+)?px$/);
      expect(element.style.getPropertyValue('--sf-preview-w')).toMatch(/^\d+(\.\d+)?px$/);
      expect(frames.pending).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without Studio Mode: one Program monitor with the overlay, the Studio Mode panel beside it', async () => {
    await setup();
    expect(monitor('preview')).toBeNull();
    const program = monitor('program') as HTMLElement;
    expect(program.getAttribute('role')).toBe('region');
    const labelId = program.getAttribute('aria-labelledby') as string;
    expect(text(element.querySelector(`#${labelId}`))).toBe('Program');
    expect(text(program.querySelector('.c-monitor__name'))).toBe('Welcome');
    const liveEdit = program.querySelector('.c-monitor__live-edit') as HTMLElement;
    expect(text(liveEdit)).toBe('Changes go live immediately');
    // Not on air: a neutral note, not a red warning.
    expect(liveEdit.classList).not.toContain('is-on-air');
    expect(text(program.querySelector('.c-monitor__meta'))).toBe('1920 × 1080');
    expect(program.querySelector('sf-edit-overlay')).not.toBeNull();
    // The place of the Preview teaches what the mode means and offers to turn it on (no longer aria-hidden).
    const off = element.querySelector('.c-stage__preview-off') as HTMLElement;
    expect(off.getAttribute('aria-hidden')).toBeNull();
    expect(text(off.querySelector('.c-stage__off-label'))).toBe('Preview');
    expect(text(off.querySelector('.c-stage__off-state'))).toBe('Off');
    expect(text(off.querySelector('.c-stage__preview-off-title'))).toBe('Studio Mode is off');
    expect(text(off.querySelector('.c-stage__off-text'))).toBe(
      'A click on a scene goes live at once. Turn it on to prepare the next scene in Preview first.',
    );
    expect(text(off.querySelector('button'))).toBe('Turn on Studio Mode');
    expect(element.querySelector('sf-control-column')).not.toBeNull();
    expect(rendererOf('program').element.getAttribute('aria-label')).toBe(
      'Program monitor: Welcome, matches the output',
    );
  });

  it('with Studio-Modus: Preview | split | Program, the overlay on the Preview', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    const preview = monitor('preview') as HTMLElement;
    const program = monitor('program') as HTMLElement;
    expect(
      preview.compareDocumentPosition(program) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(text(preview.querySelector('.c-monitor__name'))).toBe('Presentation');
    expect(text(preview.querySelector('.c-monitor__meta'))).toBe('2 items');
    expect(text(program.querySelector('.c-monitor__meta'))).toBe('1920 × 1080');
    expect(preview.querySelector('sf-edit-overlay')).not.toBeNull();
    expect(program.querySelector('sf-edit-overlay')).toBeNull();
    expect(program.querySelector('.c-monitor__live-edit')).toBeNull();
    const split = element.querySelector('.c-stage__split') as HTMLElement;
    expect(split.getAttribute('role')).toBe('separator');
    expect(split.getAttribute('aria-label')).toBe('Size of Preview and Program');
    expect(element.querySelector('.c-stage__preview-off')).toBeNull();
    expect(rendererOf('preview').current?.id).toBe('scn_b');
    expect(rendererOf('program').current?.id).toBe('scn_a');
  });

  it('says “Live, read only” in the Preview header while the live scene is in the Preview', async () => {
    await setup({ studio: true, preview: 'scn_a' });
    const note = monitor('preview')?.querySelector('.c-monitor__live-note') as HTMLElement;
    expect(text(note)).toBe('Live, read only');
    expect(note.getAttribute('title')).toBe(
      'This scene is live right now. Editing is possible once another scene is on Program.',
    );
    // The note sits in the header, so nothing covers the lower third of the picture.
    expect(note.closest('.c-monitor__head')).not.toBeNull();
    expect(
      monitor('preview')?.querySelector('.c-monitor__screen .c-monitor__live-note'),
    ).toBeNull();
    expect(monitor('program')?.querySelector('.c-monitor__live-note')).toBeNull();
    expect(monitor('preview')?.querySelector('sf-edit-overlay')?.classList).toContain('is-locked');
  });

  it('turns “Changes go live immediately” red only while the broadcast is on air', async () => {
    await setup({ broadcast: 'live' });
    expect(monitor('program')?.querySelector('.c-monitor__live-edit')?.classList).toContain(
      'is-on-air',
    );
  });

  it('“Turn on Studio Mode” in the place of the Preview turns the mode on', async () => {
    await setup();
    (element.querySelector('.c-stage__preview-off button') as HTMLButtonElement).click();
    await render();
    harness.http
      .expectOne((request) => request.url.endsWith('/preview'))
      .flush(productionFixture({ previewSceneId: 'scn_b' }));
    await render();
    expect(element.querySelector('.c-stage__preview-off')).toBeNull();
    expect(monitor('preview')).not.toBeNull();
  });

  it('counts every item of the Preview and names the hidden ones', async () => {
    const scenes = defaultScenes();
    scenes[1] = {
      ...scenes[1],
      items: [{ ...scenes[1].items[0], hidden: true }, scenes[1].items[1]],
    };
    await setup({ studio: true, preview: 'scn_b', scenes });
    expect(text(monitor('preview')?.querySelector('.c-monitor__meta') ?? null)).toBe(
      '2 items · 1 hidden',
    );
  });

  it('teaches where to add a scene when the production has none', async () => {
    await setup({ scenes: [] });
    const empty = monitor('program')?.querySelector('.c-monitor__empty');
    expect(text(empty?.querySelector('strong') ?? null)).toBe('No scene yet');
    expect(text(empty?.querySelector('span') ?? null)).toBe('Add a scene in the Scenes dock.');
  });

  it('does not render the split in the stacked layout, where resizing is off (A11Y-05)', async () => {
    await setup({ studio: true, preview: 'scn_b', stacked: true });
    expect(element.querySelector('.c-stage__split')).toBeNull();
    expect(element.querySelector('[role="separator"]')).toBeNull();
    expect(element.querySelector('.c-stage__gap')).not.toBeNull();
  });

  it('shows the progress of a running fade under the Program header', async () => {
    await setup();
    expect(monitor('program')?.querySelector('.c-monitor__fade')).toBeNull();
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: null,
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 1000 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    await render();
    const line = monitor('program')?.querySelector('.c-monitor__fade') as HTMLElement;
    expect(line.style.animationDuration).toBe('1000ms');
    expect(line.getAttribute('aria-hidden')).toBe('true');
  });

  function press(target: Element, init: PointerEventInit = {}): void {
    const options = {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      ...init,
    };
    target.dispatchEvent(new PointerEvent('pointerdown', options));
    target.dispatchEvent(new PointerEvent('pointerup', options));
  }

  it('a press on the stage around the editable screen clears the selection', async () => {
    await setup();
    const editor = TestBed.inject(EditorService);
    const program = monitor('program') as HTMLElement;
    const around = [
      element,
      program.querySelector('.c-monitor__head') as Element,
      program.querySelector('.c-monitor__name') as Element,
      element.querySelector('.c-stage__preview-off') as Element,
      element.querySelector('.c-stage__off-panel') as Element,
      element.querySelector('.c-stage__monitors') as Element,
    ];
    for (const target of around) {
      editor.select('itm_a1');
      press(target);
      expect(editor.selectedItemId()).toBeNull();
    }
    await render();
    harness.http.expectNone(() => true);
  });

  it('leaves the selection to the editable screen, the controls and other mouse buttons', async () => {
    await setup();
    const editor = TestBed.inject(EditorService);
    editor.select('itm_a1');
    const screen = monitor('program')?.querySelector('.c-monitor__screen') as HTMLElement;
    press(screen.querySelector('sf-scene-view') as Element);
    press(element.querySelector('sf-control-column') as Element);
    press(element.querySelector('sf-control-column button') as Element);
    press(element.querySelector('sf-control-column label') as Element);
    press(element, { button: 2 });
    expect(editor.selectedItemId()).toBe('itm_a1');
    await render();
    harness.http.expectNone(() => true);
  });

  it('with Studio-Modus: a press on the Program monitor clears the selection, the split does not', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    const editor = TestBed.inject(EditorService);
    editor.select('itm_b1');
    press(element.querySelector('.c-stage__split') as Element);
    expect(editor.selectedItemId()).toBe('itm_b1');
    press(monitor('preview')?.querySelector('.c-monitor__screen sf-scene-view') as Element);
    expect(editor.selectedItemId()).toBe('itm_b1');
    press(monitor('program')?.querySelector('.c-monitor__screen') as Element);
    expect(editor.selectedItemId()).toBeNull();
    editor.select('itm_b1');
    press(monitor('preview')?.querySelector('.c-monitor__head') as Element);
    expect(editor.selectedItemId()).toBeNull();
    await render();
  });

  it('keeps the Program renderer when Studio-Modus toggles', async () => {
    await setup();
    const program = rendererOf('program');
    (element.querySelector('input[role="switch"]') as HTMLInputElement).click();
    await render();
    harness.http
      .expectOne((request) => request.url.endsWith('/preview'))
      .flush(productionFixture({ previewSceneId: 'scn_b' }));
    await render();
    expect(monitor('preview')).not.toBeNull();
    expect(rendererOf('program')).toBe(program);
    expect(program.destroyed).toBe(false);
  });

  it('plays the program switch on the Program monitor and flashes it afterwards', async () => {
    await setup();
    const screen = monitor('program')?.querySelector('.c-monitor__screen') as HTMLElement;
    const animations: unknown[] = [];
    screen.animate = ((keyframes: Keyframe[]) => {
      animations.push(keyframes);
      return {} as Animation;
    }) as typeof screen.animate;
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: null,
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 500 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    await render();
    const renderer = rendererOf('program');
    expect(renderer.calls.at(-1)).toEqual({
      op: 'transitionTo',
      sceneId: 'scn_b',
      transition: { kind: 'fade', durationMs: 500 },
    });
    expect(animations).toHaveLength(0);
    renderer.finishTransitions();
    await render();
    expect(animations).toHaveLength(1);
    expect(animations[0]).toEqual([
      { outlineWidth: '6px', outlineColor: 'var(--red-flash)' },
      { outlineWidth: '2px', outlineColor: 'var(--red)' },
    ]);
    expect(text(monitor('program')?.querySelector('.c-monitor__name') ?? null)).toBe(
      'Presentation',
    );
  });

  it('cuts the Preview when a take swaps the scenes', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: 'scn_a',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 300 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    await render();
    expect(rendererOf('preview').ops().at(-1)).toBe('show:scn_a');
    expect(rendererOf('program').ops().at(-1)).toBe('transitionTo:scn_b');
  });
});
