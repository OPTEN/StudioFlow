import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { canvasDto, type CanvasDto, type SceneDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture } from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import { PropertiesDockComponent } from './properties/properties-dock.component';
import { ScenesDockComponent } from './scenes/scenes-dock.component';
import { dockSnapshot } from './testing/dock-fixtures';

const BASE = `/api/productions/${PRODUCTION_ID}`;

/** The docks that show the shape of the canvas: the scene thumbnails and the template previews. */
describe('docks on a canvas other than 16:9', () => {
  let harness: StoreHarness;

  async function setup(canvas: CanvasDto): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      dockSnapshot({
        production: productionFixture({ canvas, programSceneId: 'scn_b' }),
      }),
    );
  }

  async function render(fixture: ComponentFixture<unknown>): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function ratio(element: Element | null): string {
    return ((element as HTMLElement | null)?.style.aspectRatio ?? '').replace(/\s/g, '');
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  afterEach(() => harness?.http.verify());

  describe('scene thumbnails', () => {
    async function thumbs(canvas: CanvasDto): Promise<string[]> {
      await setup(canvas);
      const fixture = TestBed.createComponent(ScenesDockComponent);
      await render(fixture);
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.c-scene__thumb'),
      ).map(ratio);
    }

    it('are 16:9 for the default production', async () => {
      expect(await thumbs(canvasDto('widescreen', 'p1080'))).toEqual([
        '1920/1080',
        '1920/1080',
        '1920/1080',
      ]);
    });

    it('take the shape of a portrait canvas', async () => {
      expect(await thumbs(canvasDto('portrait', 'p1080'))).toEqual([
        '1080/1920',
        '1080/1920',
        '1080/1920',
      ]);
    });

    it.each([
      ['square', 'p720', '720/720'],
      ['standard', 'p1080', '1440/1080'],
    ] as const)('take the shape of %s %s', async (format, resolution, expected) => {
      const shapes = await thumbs(canvasDto(format, resolution));

      expect(new Set(shapes)).toEqual(new Set([expected]));
    });
  });

  describe('template previews', () => {
    async function openProperties(canvas: CanvasDto): Promise<HTMLElement> {
      await setup(canvas);
      const fixture = TestBed.createComponent(PropertiesDockComponent);
      await render(fixture);
      return fixture.nativeElement as HTMLElement;
    }

    function tiles(element: HTMLElement): HTMLButtonElement[] {
      return Array.from(element.querySelectorAll<HTMLButtonElement>('.c-preset'));
    }

    it('show the eight templates in the shape of a portrait canvas', async () => {
      const element = await openProperties(canvasDto('portrait', 'p1080'));

      expect(tiles(element)).toHaveLength(8);
      expect(
        new Set(tiles(element).map((tile) => ratio(tile.querySelector('sf-layout-preview')))),
      ).toEqual(new Set(['1080/1920']));
    });

    it('name the stacked templates for a portrait or square canvas', async () => {
      const element = await openProperties(canvasDto('square', 'p1080'));

      const names = tiles(element).map((tile) => text(tile.querySelector('.c-preset__name')));
      expect(names).toContain('Stacked');
      expect(names).toContain('Screen + camera row');
      expect(names).not.toContain('Side by side');
    });

    it('keep the names of 16:9 and 4:3', async () => {
      const element = await openProperties(canvasDto('standard', 'p1080'));

      const names = tiles(element).map((tile) => text(tile.querySelector('.c-preset__name')));
      expect(names).toContain('Side by side');
      expect(names).toContain('Screen + camera column');
    });

    it('place the blocks of a portrait template inside the preview', async () => {
      const element = await openProperties(canvasDto('portrait', 'p1080'));
      const stacked = tiles(element).find((tile) => text(tile).includes('Stacked')) as HTMLElement;

      const blocks = Array.from(stacked.querySelectorAll<HTMLElement>('.c-layout-preview__slot'));

      expect(blocks).toHaveLength(2);
      for (const block of blocks) {
        expect(Number.parseFloat(block.style.left)).toBeGreaterThanOrEqual(0);
        expect(
          Number.parseFloat(block.style.left) + Number.parseFloat(block.style.width),
        ).toBeLessThanOrEqual(100.0001);
        expect(
          Number.parseFloat(block.style.top) + Number.parseFloat(block.style.height),
        ).toBeLessThanOrEqual(100.0001);
      }
      expect(Number.parseFloat(blocks[1].style.top)).toBeGreaterThan(
        Number.parseFloat(blocks[0].style.top),
      );
    });

    it('apply a template with the slots of the canvas', async () => {
      const element = await openProperties(canvasDto('portrait', 'p1080'));

      tiles(element)
        .find((tile) => text(tile).includes('Stacked'))
        ?.click();

      const request = harness.http.expectOne(`${BASE}/scenes/scn_b/items`);
      expect(
        request.request.body.items.map((item: { x: number; y: number; w: number; h: number }) => [
          item.x,
          item.y,
          item.w,
          item.h,
        ]),
      ).toEqual([
        [40, 377, 1000, 563],
        [40, 980, 1000, 563],
      ]);
      request.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 2 });
    });
  });
});
