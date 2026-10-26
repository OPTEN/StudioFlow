import type { TextSourceDto, TextThemeDto } from '@studioflow/scene-model';

import {
  fakeAnimate,
  flushMicrotasks,
  mount,
  scene,
  sceneItem,
  withoutAnimate,
  CAMERA,
  type FakeAnimation,
  type Mounted,
} from './testing/fixtures';

const TEXT = 'txt_aaaaaaaaaaaaaaaa';
const OTHER_TEXT = 'txt_bbbbbbbbbbbbbbbb';
const THEME: TextThemeDto = { accent: '#ff8800', background: '#001122', foreground: '#eeeeee' };

function textSource(overrides: Partial<TextSourceDto> = {}): TextSourceDto {
  return {
    id: TEXT,
    code: 'T1',
    line1: 'Mia Meier',
    line2: 'Moderator',
    style: 'lowerThird',
    align: 'left',
    ...overrides,
  };
}

const LOWER_THIRD_RECT = { x: 80, y: 820, w: 960, h: 180 };

describe('scene renderer: texts', () => {
  let mounted: Mounted;
  let texts: Map<string, TextSourceDto>;
  let theme: TextThemeDto | undefined;
  let animations: FakeAnimation[];

  beforeEach(() => {
    vi.useFakeTimers();
    animations = fakeAnimate();
    texts = new Map([[TEXT, textSource()]]);
    theme = THEME;
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function start(
    options: Parameters<typeof mount>[0] = {},
    size?: Parameters<typeof mount>[1],
  ): void {
    mounted = mount(
      {
        textOf: (id) => texts.get(id),
        textTheme: () => theme,
        ...options,
      },
      size,
    );
  }

  function textItem(overrides: Parameters<typeof sceneItem>[2] = {}, source = TEXT) {
    return sceneItem('itm_t', source, { ...LOWER_THIRD_RECT, hidden: false, ...overrides });
  }

  const block = (): HTMLElement | null => mounted.part('itm_t', '.sf-r-text');
  const line1 = (): HTMLElement | null => mounted.part('itm_t', '.sf-r-text-line1');
  const line2 = (): HTMLElement | null => mounted.part('itm_t', '.sf-r-text-line2');
  const shownDisplay = (): string => mounted.item('itm_t')?.style.display ?? '';

  describe('content', () => {
    it('draws both lines as text of the item, sharp HTML and no picture', () => {
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(line1()?.textContent).toBe('Mia Meier');
      expect(line2()?.textContent).toBe('Moderator');
      expect(mounted.item('itm_t')?.querySelectorAll('img, video, canvas')).toHaveLength(0);
      expect(mounted.provider.attachCalls).toEqual([]);
      expect(mounted.errors).toEqual([]);
    });

    it('places the text at the rectangle of its item', () => {
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      const root = mounted.item('itm_t') as HTMLElement;
      expect(root.style.transform).toBe('translate(80px, 820px)');
      expect([root.style.width, root.style.height]).toEqual(['960px', '180px']);
    });

    it('shows markup literally and never creates elements from it', () => {
      texts.set(
        TEXT,
        textSource({ line1: '<img src=x onerror=alert(1)>', line2: '<script>alert(1)</script>' }),
      );
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(line1()?.textContent).toBe('<img src=x onerror=alert(1)>');
      expect(line2()?.textContent).toBe('<script>alert(1)</script>');
      expect(line1()?.children).toHaveLength(0);
      expect(line2()?.children).toHaveLength(0);
      expect(mounted.container.querySelectorAll('.sf-r-text img, .sf-r-text script')).toHaveLength(
        0,
      );
      expect(line1()?.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    it.each(['"><svg onload=alert(1)>', "' onmouseover='alert(1)", '&lt;b&gt;', '</div><div>'])(
      'keeps %j as text',
      (payload) => {
        texts.set(TEXT, textSource({ line1: payload, line2: null }));
        start();

        mounted.renderer.show(scene('scn_a', [textItem()]));

        expect(line1()?.textContent).toBe(payload);
        expect(line1()?.children).toHaveLength(0);
        expect(block()?.children).toHaveLength(3);
      },
    );

    it('keeps emoji, combined letters and symbols as they are', () => {
      const name = 'Zoë 😀 👨‍👩‍👧‍👦 🇨🇭 ✓';
      texts.set(TEXT, textSource({ line1: name, line2: null }));
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(line1()?.textContent).toBe(name);
      expect(block()?.style.fontFamily).toContain('Emoji');
    });

    it('sets the reading direction of every line by its own text, so right-to-left lines read correctly', () => {
      texts.set(TEXT, textSource({ line1: 'مرحبا بالعالم', line2: 'שלום עולם' }));
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(line1()?.textContent).toBe('مرحبا بالعالم');
      expect(line1()?.getAttribute('dir')).toBe('auto');
      expect(line2()?.getAttribute('dir')).toBe('auto');
      expect(line1()?.style.unicodeBidi).toBe('plaintext');
    });

    it('hides the second line when there is none', () => {
      texts.set(TEXT, textSource({ line2: null }));
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(line1()?.style.display).not.toBe('none');
      expect(line2()?.style.display).toBe('none');
    });

    it('draws nothing for a text without any content', () => {
      texts.set(TEXT, textSource({ line1: '', line2: null }));
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(block()?.style.display).toBe('none');
      expect(mounted.errors).toEqual([]);
    });

    it('treats a malformed text like an empty one', () => {
      texts.set(TEXT, { ...textSource(), line1: 42, line2: {} } as unknown as TextSourceDto);
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(block()?.style.display).toBe('none');
      expect(mounted.errors).toEqual([]);
    });
  });

  describe('long text', () => {
    it('keeps the lines of a lower third on one line and ends them with an ellipsis', () => {
      texts.set(TEXT, textSource({ line1: 'x'.repeat(120), line2: 'y'.repeat(120) }));
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      for (const line of [line1(), line2()]) {
        expect(line?.style.whiteSpace).toBe('nowrap');
        expect(line?.style.textOverflow).toBe('ellipsis');
        expect(line?.style.overflow).toBe('hidden');
      }
      expect(line1()?.textContent).toHaveLength(120);
    });

    it('lets a title wrap to two lines before the ellipsis and keeps its second line on one', () => {
      texts.set(TEXT, textSource({ style: 'title', align: 'center', line1: 'word '.repeat(24) }));
      start();
      // The test DOM drops vendor-prefixed properties, so the writes are recorded.
      const written: string[] = [];
      vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (
        this: CSSStyleDeclaration,
        name: string,
        value: string | null,
      ) {
        written.push(`${name}: ${value}`);
      });

      mounted.renderer.show(scene('scn_a', [textItem({ x: 160, y: 390, w: 1600, h: 300 })]));

      expect(written).toContain('-webkit-line-clamp: 2');
      expect(written).toContain('-webkit-box-orient: vertical');
      expect(written).toContain('white-space: normal');
      expect(written).toContain('white-space: nowrap');
    });

    it('breaks a word without spaces instead of overflowing the item', () => {
      texts.set(TEXT, textSource({ style: 'title', line1: 'W'.repeat(120) }));
      start();

      mounted.renderer.show(scene('scn_a', [textItem({ x: 160, y: 390, w: 1600, h: 300 })]));

      expect(line1()?.style.overflowWrap).toBe('anywhere');
      expect(block()?.style.overflow).toBe('hidden');
    });

    it('clips what does not fit inside the item', () => {
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(mounted.item('itm_t')?.style.overflow).toBe('hidden');
    });
  });

  describe('scaling', () => {
    const fontSize = (element: HTMLElement | null): number =>
      parseFloat(element?.style.fontSize ?? '');

    it('sizes the text by the height of the item', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem({ h: 180 })]));
      const small = [fontSize(line1()), fontSize(line2())];

      mounted.renderer.update(scene('scn_a', [textItem({ h: 360 })]));

      expect([fontSize(line1()), fontSize(line2())]).toEqual([small[0] * 2, small[1] * 2]);
      expect(fontSize(line1())).toBeGreaterThan(fontSize(line2()));
    });

    it('does not depend on the size of the screen: the stage is scaled as a whole', () => {
      start({}, { width: 3840, height: 2160 });
      mounted.renderer.show(scene('scn_a', [textItem()]));
      const large = fontSize(line1());
      const stage = mounted.renderer.element;
      const largeTransform = stage.style.transform;

      mounted.setSize(480, 270);

      expect(fontSize(line1())).toBe(large);
      expect(stage.style.transform).not.toBe(largeTransform);
      expect(stage.style.width).toBe('1920px');
    });

    it('draws a note smaller than a title in a larger item', () => {
      texts.set(TEXT, textSource({ style: 'note', line2: null }));
      start();

      mounted.renderer.show(scene('scn_a', [textItem({ x: 1320, y: 60, w: 540, h: 96 })]));

      expect(fontSize(line1())).toBeLessThan(40);
      expect(fontSize(line1())).toBeGreaterThan(20);
    });

    it('stays inside the stage with the default rectangles of the three styles', () => {
      start();
      for (const [style, rect] of [
        ['lowerThird', { x: 80, y: 820, w: 960, h: 180 }],
        ['title', { x: 160, y: 390, w: 1600, h: 300 }],
        ['note', { x: 1320, y: 60, w: 540, h: 96 }],
      ] as const) {
        texts.set(TEXT, textSource({ style }));
        mounted.renderer.show(scene(`scn_${style}`, [textItem(rect)]));

        const { x, y, w, h } = rect;
        expect(x).toBeGreaterThanOrEqual(40);
        expect(y).toBeGreaterThanOrEqual(40);
        expect(x + w).toBeLessThanOrEqual(1880);
        expect(y + h).toBeLessThanOrEqual(1040);
      }
    });
  });

  describe('colours and style', () => {
    it('uses the production colours', () => {
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(block()?.style.backgroundColor).toBe('#001122');
      expect(block()?.style.color).toBe('#eeeeee');
      expect(mounted.part('itm_t', '.sf-r-text-accent')?.style.backgroundColor).toBe('#ff8800');
    });

    it('falls back to the default colour for every invalid one', () => {
      theme = { accent: 'red', background: '#12', foreground: '#EEEEEE' };
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(block()?.style.backgroundColor).toBe('#0d1117');
      expect(block()?.style.color).toBe('#EEEEEE');
      expect(mounted.part('itm_t', '.sf-r-text-accent')?.style.backgroundColor).toBe('#1f6feb');
    });

    it('uses the default colours without a theme', () => {
      theme = undefined;
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(block()?.style.backgroundColor).toBe('#0d1117');
    });

    it('follows a change of the colours on refresh', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      theme = { ...THEME, background: '#102030' };
      mounted.renderer.refresh();

      expect(block()?.style.backgroundColor).toBe('#102030');
    });

    it('follows the reading direction in the lower third and the alignment in the title and note', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));
      expect(block()?.style.textAlign).toBe('start');

      texts.set(TEXT, textSource({ style: 'title', align: 'right' }));
      mounted.renderer.refresh();
      expect(block()?.style.textAlign).toBe('right');

      texts.set(TEXT, textSource({ style: 'note', align: 'center' }));
      mounted.renderer.refresh();
      expect(block()?.style.textAlign).toBe('center');
    });

    it('puts the accent as a bar at the start edge of a lower third and as a rule below a title', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));
      const accent = (): HTMLElement | null => mounted.part('itm_t', '.sf-r-text-accent');
      expect([accent()?.style.top, accent()?.style.height]).toEqual(['0px', '100%']);

      texts.set(TEXT, textSource({ style: 'title' }));
      mounted.renderer.refresh();

      expect([accent()?.style.width, accent()?.style.bottom]).toEqual(['100%', '0px']);
    });
  });

  describe('live changes', () => {
    it('shows new content on refresh without recreating the element', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));
      const first = line1();

      texts.set(TEXT, textSource({ line1: 'Leo Lang', line2: null }));
      mounted.renderer.refresh();

      expect(line1()).toBe(first);
      expect(line1()?.textContent).toBe('Leo Lang');
      expect(line2()?.style.display).toBe('none');
    });

    it('does not rewrite an unchanged line (no flicker)', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));
      const written = vi.spyOn(line1() as HTMLElement, 'textContent', 'set');

      mounted.renderer.refresh();
      mounted.renderer.refresh();

      expect(written).not.toHaveBeenCalled();
    });

    it('shows two items of the same text in different scenes from one source', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      mounted.renderer.show(scene('scn_b', [sceneItem('itm_t', TEXT, { ...LOWER_THIRD_RECT })]));

      expect(line1()?.textContent).toBe('Mia Meier');
    });

    it('shows another text when the item points to another source', () => {
      texts.set(OTHER_TEXT, textSource({ id: OTHER_TEXT, line1: 'Leo Lang' }));
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      mounted.renderer.update(scene('scn_a', [textItem({}, OTHER_TEXT)]));

      expect(line1()?.textContent).toBe('Leo Lang');
      expect(mounted.container.querySelectorAll('.sf-r-text')).toHaveLength(1);
    });

    it('changes between a text and a camera on the same item without leftovers', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      mounted.renderer.update(scene('scn_a', [sceneItem('itm_t', CAMERA)]));

      expect(block()).toBeNull();
      expect(mounted.part('itm_t', 'video')).not.toBeNull();
      mounted.renderer.update(scene('scn_a', [textItem()]));
      expect(mounted.part('itm_t', 'video')).toBeNull();
      expect(line1()?.textContent).toBe('Mia Meier');
      expect(mounted.provider.detachCalls).toHaveLength(1);
    });
  });

  describe('missing text', () => {
    it('draws nothing on the output and no placeholder', () => {
      texts.clear();
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(block()?.style.display).toBe('none');
      expect(mounted.item('itm_t')?.textContent).toBe('');
      expect(mounted.errors).toEqual([]);
    });

    it('says "Source missing" on the monitor', () => {
      texts.clear();
      start({ mode: 'monitor' });

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(mounted.part('itm_t', '.sf-r-missing')?.textContent).toBe('Source missing');
    });

    it('does not say it for a text that exists', () => {
      start({ mode: 'monitor' });

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(mounted.part('itm_t', '.sf-r-missing')?.style.display).toBe('none');
    });
  });

  describe('showing and hiding', () => {
    it('shows a text of a new scene at once, without animation', () => {
      start();

      mounted.renderer.show(scene('scn_a', [textItem()]));

      expect(shownDisplay()).toBe('block');
      expect(animations).toHaveLength(0);
    });

    it('does not draw a hidden text and does not animate its first state', () => {
      start();

      mounted.renderer.show(scene('scn_a', [textItem({ hidden: true })]));

      expect(shownDisplay()).toBe('none');
      expect(animations).toHaveLength(0);
    });

    it('fades and slides a text in when it is shown, 300 ms', () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem({ hidden: true })]));

      mounted.renderer.update(scene('scn_a', [textItem({ hidden: false })], { version: 2 }));

      expect(shownDisplay()).toBe('block');
      const [animation] = animations;
      expect(animation.element).toBe(block());
      expect(animation.duration).toBe(300);
      expect(animation.keyframes[0]).toMatchObject({ opacity: 0 });
      expect(animation.keyframes[0]['transform']).toBe('translate(-57.6px, 0px)');
      expect(animation.keyframes[1]).toMatchObject({ opacity: 1, transform: 'none' });
    });

    it('slides a title up and a note down', () => {
      texts.set(TEXT, textSource({ style: 'title' }));
      start();
      mounted.renderer.show(scene('scn_a', [textItem({ hidden: true, w: 1600, h: 300 })]));
      mounted.renderer.update(
        scene('scn_a', [textItem({ hidden: false, w: 1600, h: 300 })], { version: 2 }),
      );
      expect(animations[0].keyframes[0]['transform']).toBe('translate(0px, 24px)');

      texts.set(TEXT, textSource({ style: 'note' }));
      mounted.renderer.update(
        scene('scn_a', [textItem({ hidden: true, w: 540, h: 96 })], { version: 3 }),
      );
      vi.advanceTimersByTime(400);
      mounted.renderer.update(
        scene('scn_a', [textItem({ hidden: false, w: 540, h: 96 })], { version: 4 }),
      );
      expect(animations.at(-1)?.keyframes[0]['transform']).toBe('translate(0px, -11.52px)');
    });

    it('keeps the text on screen while it hides and removes it when the animation has ended', async () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      mounted.renderer.update(scene('scn_a', [textItem({ hidden: true })], { version: 2 }));

      expect(shownDisplay()).toBe('block');
      expect(animations[0].keyframes[1]).toMatchObject({ opacity: 0 });
      expect(mounted.item('itm_t')?.style.transform).toBe('translate(80px, 820px)');
      await vi.advanceTimersByTimeAsync(300);
      expect(shownDisplay()).toBe('none');
      expect(animations[0].cancelled).toBe(true);
    });

    it('runs every animation to completion, also when it is toggled again at once', async () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      mounted.renderer.update(scene('scn_a', [textItem({ hidden: true })], { version: 2 }));
      await vi.advanceTimersByTimeAsync(100);
      mounted.renderer.update(scene('scn_a', [textItem({ hidden: false })], { version: 3 }));
      await vi.advanceTimersByTimeAsync(1000);

      expect(animations).toHaveLength(2);
      expect(animations.every((animation) => animation.cancelled)).toBe(true);
      expect(shownDisplay()).toBe('block');
    });

    it('ends in the hidden state when it is hidden, shown and hidden again quickly', async () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      for (const [version, hidden] of [
        [2, true],
        [3, false],
        [4, true],
      ] as const) {
        mounted.renderer.update(scene('scn_a', [textItem({ hidden })], { version }));
        await vi.advanceTimersByTimeAsync(50);
      }
      await vi.advanceTimersByTimeAsync(1000);

      expect(shownDisplay()).toBe('none');
    });

    it('completes through the safety timer when the browser never reports the end', async () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));
      vi.spyOn(Element.prototype, 'animate').mockImplementation(
        () =>
          ({
            finished: new Promise<void>(() => undefined),
            cancel: () => undefined,
          }) as unknown as Animation,
      );

      mounted.renderer.update(scene('scn_a', [textItem({ hidden: true })], { version: 2 }));
      await vi.advanceTimersByTimeAsync(399);
      expect(shownDisplay()).toBe('block');
      await vi.advanceTimersByTimeAsync(2);

      expect(shownDisplay()).toBe('none');
    });

    it('cuts instead of animating with reduced motion', () => {
      start({ reducedMotion: true });
      mounted.renderer.show(scene('scn_a', [textItem({ hidden: true })]));

      mounted.renderer.update(scene('scn_a', [textItem({ hidden: false })], { version: 2 }));
      expect(shownDisplay()).toBe('block');
      mounted.renderer.update(scene('scn_a', [textItem({ hidden: true })], { version: 3 }));

      expect(shownDisplay()).toBe('none');
      expect(animations).toHaveLength(0);
    });

    it('cuts in a browser without the Web Animations API', () => {
      const restore = withoutAnimate();
      try {
        start();
        mounted.renderer.show(scene('scn_a', [textItem()]));

        mounted.renderer.update(scene('scn_a', [textItem({ hidden: true })], { version: 2 }));

        expect(shownDisplay()).toBe('none');
      } finally {
        restore();
      }
    });

    it('leaves no inline opacity or transform behind', async () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem({ hidden: true })]));

      mounted.renderer.update(scene('scn_a', [textItem({ hidden: false })], { version: 2 }));
      await vi.advanceTimersByTimeAsync(400);

      expect(block()?.style.opacity).toBe('');
      expect(block()?.style.transform).toBe('');
    });

    it('does not fade a text with the next scene: it travels with the scene', async () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));

      void mounted.renderer.transitionTo(
        scene('scn_b', [sceneItem('itm_u', TEXT, LOWER_THIRD_RECT)]),
        {
          kind: 'cut',
          durationMs: 0,
        },
      );
      await flushMicrotasks();

      expect(animations).toHaveLength(0);
      expect(mounted.container.querySelectorAll('.sf-r-text')).toHaveLength(1);
    });

    it('disposes a running animation with the renderer', async () => {
      start();
      mounted.renderer.show(scene('scn_a', [textItem()]));
      mounted.renderer.update(scene('scn_a', [textItem({ hidden: true })], { version: 2 }));

      mounted.renderer.destroy();

      expect(animations[0].cancelled).toBe(true);
      expect(mounted.container.querySelector('.sf-r-text')).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mounted.errors).toEqual([]);
    });
  });

  describe('Auto-Grid', () => {
    it('keeps a text at its own rectangle while the other items fill the grid', () => {
      start();

      mounted.renderer.show(
        scene('scn_a', [sceneItem('itm_c1', CAMERA), textItem()], { layoutMode: 'autoGrid' }),
      );
      mounted.provider.live(CAMERA);
      mounted.renderer.refresh();

      const rects = mounted.renderer.effectiveRects();
      expect(rects.get('itm_t')).toEqual(LOWER_THIRD_RECT);
      expect(rects.get('itm_c1')).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    });
  });
});
