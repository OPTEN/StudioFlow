import { canvasSize, type CanvasSize } from '@studioflow/scene-model';

import { CAMERA, CAMERA_2, mount, phone, scene, sceneItem, type Mounted } from './testing/fixtures';

const PORTRAIT = canvasSize('portrait', 'p1080');
const SQUARE = canvasSize('square', 'p720');
const STANDARD = canvasSize('standard', 'p1080');

describe('scene renderer: canvas of the production', () => {
  let mounted: Mounted;

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
  });

  function stage(): HTMLElement {
    return mounted.renderer.element;
  }

  describe('stage', () => {
    it.each([
      ['portrait 1080p', PORTRAIT, '1080px', '1920px'],
      ['square 720p', SQUARE, '720px', '720px'],
      ['4:3 1080p', STANDARD, '1440px', '1080px'],
      ['16:9 720p', canvasSize('widescreen', 'p720'), '1280px', '720px'],
    ])('is as large as the canvas: %s', (_name, canvas, width, height) => {
      mounted = mount({ canvas });

      expect(stage().style.width).toBe(width);
      expect(stage().style.height).toBe(height);
    });

    it('is 1920 × 1080 without a canvas option', () => {
      mounted = mount();

      expect([stage().style.width, stage().style.height]).toEqual(['1920px', '1080px']);
    });

    it('fits a portrait canvas into a 16:9 window with bars left and right', () => {
      mounted = mount({ canvas: PORTRAIT }, { width: 1920, height: 1080 });

      expect(stage().style.transform).toBe(`translate(656.25px, 0px) scale(${1080 / 1920})`);
    });

    it('fits a 16:9 window into a portrait container with bars above and below', () => {
      mounted = mount({ canvas: canvasSize('widescreen', 'p1080') }, { width: 360, height: 640 });

      expect(stage().style.transform).toBe(`translate(0px, 218.75px) scale(${360 / 1920})`);
    });

    it('fills a container of the canvas shape exactly', () => {
      mounted = mount({ canvas: STANDARD }, { width: 720, height: 540 });

      expect(stage().style.transform).toBe('translate(0px, 0px) scale(0.5)');
    });

    it.each([
      ['NaN width', { width: Number.NaN, height: 1080 }],
      ['zero height', { width: 1920, height: 0 }],
      ['negative', { width: -1, height: -1 }],
      ['infinite', { width: Number.POSITIVE_INFINITY, height: 1080 }],
    ])('falls back to 1920 × 1080 for an unusable canvas option: %s', (_name, canvas) => {
      mounted = mount({ canvas });

      expect([stage().style.width, stage().style.height]).toEqual(['1920px', '1080px']);
    });
  });

  describe('setCanvas', () => {
    it('resizes and re-fits the stage without a new renderer', () => {
      mounted = mount({}, { width: 960, height: 540 });

      mounted.renderer.setCanvas(PORTRAIT);

      expect([stage().style.width, stage().style.height]).toEqual(['1080px', '1920px']);
      expect(stage().style.transform).toBe(`translate(328.125px, 0px) scale(${540 / 1920})`);
    });

    it('goes back to the first canvas', () => {
      mounted = mount({}, { width: 960, height: 540 });

      mounted.renderer.setCanvas(PORTRAIT);
      mounted.renderer.setCanvas({ width: 1920, height: 1080 });

      expect([stage().style.width, stage().style.height]).toEqual(['1920px', '1080px']);
      expect(stage().style.transform).toBe('translate(0px, 0px) scale(0.5)');
    });

    it('ignores an unusable canvas and the same canvas', () => {
      mounted = mount({ canvas: SQUARE });
      const transform = stage().style.transform;

      mounted.renderer.setCanvas({ width: 0, height: 100 });
      mounted.renderer.setCanvas({ width: Number.NaN, height: 100 });
      mounted.renderer.setCanvas({ ...SQUARE });

      expect([stage().style.width, stage().style.height]).toEqual(['720px', '720px']);
      expect(stage().style.transform).toBe(transform);
      expect(mounted.errors).toEqual([]);
    });

    it('does nothing after destroy', () => {
      mounted = mount();
      mounted.renderer.destroy();

      expect(() => mounted.renderer.setCanvas(PORTRAIT)).not.toThrow();
    });

    it('shows the rescaled scene at its new rectangle in the same pass', () => {
      mounted = mount({ canvas: { width: 1920, height: 1080 } }, { width: 960, height: 540 });
      mounted.renderer.show(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 0, y: 0, w: 1920, h: 1080 })]),
      );

      mounted.renderer.setCanvas(PORTRAIT);
      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 0, y: 656, w: 1080, h: 608 })], {
          version: 2,
        }),
      );

      expect(mounted.renderer.effectiveRects().get('itm_a')).toEqual({
        x: 0,
        y: 656,
        w: 1080,
        h: 608,
      });
      expect(mounted.item('itm_a')?.style.width).toBe('1080px');
      expect(mounted.item('itm_a')?.style.transform).toBe('translate(0px, 656px)');
    });
  });

  describe('Auto-Grid', () => {
    function autoGridScene(count: number) {
      const sources = [CAMERA, CAMERA_2, phone(3), phone(4)].slice(0, count);
      return scene(
        'scn_a',
        sources.map((source, index) => sceneItem(`itm_${index}`, source)),
        { layoutMode: 'autoGrid' },
      );
    }

    function rects(): { x: number; y: number; w: number; h: number }[] {
      return [...mounted.renderer.effectiveRects().values()];
    }

    it('stacks two sources on a portrait canvas instead of placing them side by side', () => {
      mounted = mount({ canvas: PORTRAIT });
      mounted.renderer.show(autoGridScene(2));
      mounted.provider.live(CAMERA);
      mounted.provider.live(CAMERA_2);

      const [first, second] = rects();

      expect(first.x).toBe(second.x);
      expect(second.y).toBeGreaterThan(first.y + first.h - 1);
    });

    it('places two sources side by side on a 4:3 canvas, narrowed to the canvas', () => {
      mounted = mount({ canvas: STANDARD });
      mounted.renderer.show(autoGridScene(2));
      mounted.provider.live(CAMERA);
      mounted.provider.live(CAMERA_2);

      const [first, second] = rects();

      expect(first.y).toBe(second.y);
      expect(second.x).toBeGreaterThan(first.x + first.w - 1);
      expect(second.x + second.w).toBeLessThanOrEqual(STANDARD.width);
    });

    it('arranges again when the canvas changes', () => {
      mounted = mount();
      mounted.renderer.show(autoGridScene(2));
      mounted.provider.live(CAMERA);
      mounted.provider.live(CAMERA_2);
      const wide = rects();

      mounted.renderer.setCanvas(PORTRAIT);
      const tall = rects();

      expect(wide[0].y).toBe(wide[1].y);
      expect(tall[0].x).toBe(tall[1].x);
      for (const rect of tall) {
        expect(rect.x + rect.w).toBeLessThanOrEqual(PORTRAIT.width);
        expect(rect.y + rect.h).toBeLessThanOrEqual(PORTRAIT.height);
      }
    });

    it.each([PORTRAIT, SQUARE, STANDARD])(
      'keeps every cell of four sources inside %o',
      (canvas: CanvasSize) => {
        mounted = mount({ canvas });
        mounted.renderer.show(autoGridScene(4));
        for (const source of [CAMERA, CAMERA_2, phone(3), phone(4)]) {
          mounted.provider.live(source);
        }

        expect(rects()).toHaveLength(4);
        for (const rect of rects()) {
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w).toBeLessThanOrEqual(canvas.width);
          expect(rect.y + rect.h).toBeLessThanOrEqual(canvas.height);
        }
      },
    );
  });

  describe('slates', () => {
    const slate = { title: 'Starting soon', subtitle: 'Webinar', backgroundAssetId: null };

    function fontSizes(): [string | undefined, string | undefined, string | undefined] {
      const element = mounted.container.querySelector<HTMLElement>('.sf-r-slate');
      return [
        element?.style.gap,
        element?.querySelector<HTMLElement>('.sf-r-slate-title')?.style.fontSize,
        element?.querySelector<HTMLElement>('.sf-r-slate-subtitle')?.style.fontSize,
      ];
    }

    it('sets the text for a 1080 pixel short side on 1920 × 1080 and on a portrait canvas', () => {
      mounted = mount();
      mounted.renderer.showSlate(slate);
      expect(fontSizes()).toEqual(['28px', '80px', '36px']);
      mounted.renderer.destroy();
      mounted.container.remove();

      mounted = mount({ canvas: PORTRAIT });
      mounted.renderer.showSlate(slate);
      expect(fontSizes()).toEqual(['28px', '80px', '36px']);
    });

    it('scales the text with the short side of a 720p canvas', () => {
      mounted = mount({ canvas: canvasSize('widescreen', 'p720') });
      mounted.renderer.showSlate(slate);

      expect(fontSizes()).toEqual(['19px', '53px', '24px']);
    });

    it('follows a canvas change while the slate is shown', () => {
      mounted = mount();
      mounted.renderer.showSlate(slate);

      mounted.renderer.setCanvas(SQUARE);

      expect(fontSizes()).toEqual(['19px', '53px', '24px']);
    });

    it('applies the canvas that was set before the slate appears', () => {
      mounted = mount();
      mounted.renderer.setCanvas(SQUARE);

      mounted.renderer.showSlate(slate);

      expect(fontSizes()).toEqual(['19px', '53px', '24px']);
    });

    it('scales a notice of the page the same way, in its smaller sizes', () => {
      const notice = { note: 'This page tries again by itself every 30 seconds.' };
      mounted = mount();
      mounted.renderer.showSlate(slate, null, notice);
      const note = (): string | undefined =>
        mounted.container.querySelector<HTMLElement>('.sf-r-slate-note')?.style.fontSize;
      expect([...fontSizes(), note()]).toEqual(['20px', '48px', '30px', '24px']);

      mounted.renderer.setCanvas(SQUARE);

      expect([...fontSizes(), note()]).toEqual(['13px', '32px', '20px', '16px']);
    });
  });

  describe('texts', () => {
    it('sizes the text from the height of its item, so it scales with the canvas', () => {
      const text = {
        id: 'txt_1',
        code: 'T1',
        line1: 'Name',
        line2: 'Role',
        style: 'lowerThird',
        align: 'left',
      } as const;
      mounted = mount({ canvas: PORTRAIT, textOf: () => text });
      mounted.renderer.show(
        scene('scn_a', [
          sceneItem('itm_t', 'txt_aaaaaaaaaaaaaaaa', { x: 45, y: 1774, w: 540, h: 101 }),
        ]),
      );

      const line1 = mounted.part('itm_t', '.sf-r-text-line1');

      expect(line1?.style.fontSize).toBe('34.34px');
    });
  });
});
