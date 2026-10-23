import type { SceneDto } from '@studioflow/scene-model';

import type { MonitorSourceStatus } from './types';
import {
  CLIP,
  fakeAnimate,
  fakeCanvas2d,
  flushMicrotasks,
  giveFrame,
  IMAGE,
  mount,
  PAUSE_IMAGE,
  phone,
  scene,
  sceneItem,
  type Mounted,
} from './testing/fixtures';

/** Deterministic pseudo-random numbers (mulberry32), so a failing sequence can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOURCES = [phone(1), phone(2), phone(3), phone(4), IMAGE, CLIP, 'ast_gone0001', 'nonsense'];
const STATUSES: MonitorSourceStatus[] = [
  'ok',
  'reconnecting',
  'ended',
  'lost',
  'blocked',
  'connecting',
];

/**
 * One seed runs 1500 operations with about ten DOM assertions each: 2 to 3 s alone, but over 5 s (the
 * default timeout) when the other test files of the run compete for the CPU, as on a CI runner. The
 * limit is generous on purpose: it only has to catch a loop that never ends, the invariants themselves
 * are asserted in every step.
 */
const SEED_TIMEOUT_MS = 30_000;

describe('scene renderer: randomised stress', () => {
  let mounted: Mounted;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeAnimate();
    fakeCanvas2d();
  });

  afterEach(() => {
    mounted?.container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([1, 2, 3, 4, 5])(
    'keeps its invariants over 1500 random operations (seed %i)',
    async (seed) => {
      const next = random(seed);
      const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)];
      const statuses = new Map<string, MonitorSourceStatus>();
      mounted = mount({
        mode: pick(['output', 'monitor', 'thumbnail'] as const),
        statusOf: (id) => statuses.get(id) ?? 'ok',
        codeOf: (id) => id.slice(-6),
        reducedMotion: next() < 0.2,
      });
      const { renderer, provider, container } = mounted;
      let version = 1;

      const randomScene = (id: string): SceneDto =>
        scene(
          id,
          Array.from({ length: Math.floor(next() * 12) }, (_, index) =>
            sceneItem(`itm_${Math.floor(next() * 15)}_${index % 3}`, pick(SOURCES), {
              x: Math.round(next() * 2000 - 100),
              y: Math.round(next() * 1200 - 100),
              w: Math.round(16 + next() * 1900),
              h: Math.round(16 + next() * 1060),
              fit: pick(['cover', 'contain'] as const),
              rotation: pick([0, 90, 180, 270, 45]),
              mirror: next() < 0.3,
              hidden: next() < 0.1,
              radius: Math.round(next() * 250),
              crop: {
                top: next() * 0.5,
                right: next() * 0.5,
                bottom: next() * 0.5,
                left: next() * 0.5,
              },
              border: next() < 0.2 ? { width: 4, color: '#ffffff' } : null,
              onLost: {
                holdMs: pick([0, 500, 3000, null]),
                fallbackSource: next() < 0.3 ? pick([PAUSE_IMAGE, phone(4), null]) : null,
              },
            }),
          ),
          { version: (version += 1), layoutMode: next() < 0.3 ? 'autoGrid' : 'free' },
        );

      for (let step = 0; step < 1500; step += 1) {
        const sceneId = pick(['scn_a', 'scn_b', 'scn_c']);
        switch (Math.floor(next() * 12)) {
          case 0:
            renderer.show(next() < 0.1 ? null : randomScene(sceneId));
            break;
          case 1:
            renderer.update(randomScene(sceneId));
            break;
          case 2:
            void renderer.transitionTo(next() < 0.1 ? null : randomScene(sceneId), {
              kind: pick(['cut', 'fade'] as const),
              durationMs: pick([0, 200, 300, 2000]),
            });
            break;
          case 3:
            renderer.showSlate(
              next() < 0.5 ? null : { title: 'Pause', subtitle: null, backgroundAssetId: null },
            );
            break;
          case 4:
            renderer.setPreloadScenes([randomScene('scn_p')]);
            break;
          case 5: {
            const source = pick(SOURCES.slice(0, 4));
            if (next() < 0.5) {
              provider.live(source);
            } else {
              provider.lose(source, performance.now() - next() * 5000);
            }
            break;
          }
          case 6:
            statuses.set(pick(SOURCES), pick(STATUSES));
            renderer.setSourceStatuses();
            break;
          case 7:
            mounted.setSize(Math.round(next() * 2000), Math.round(next() * 1200));
            break;
          case 8:
            for (const video of container.querySelectorAll('video')) {
              if (next() < 0.5) {
                giveFrame(video, next() < 0.5 ? 1280 : 0, 720);
                video.dispatchEvent(new Event('loadeddata'));
              }
            }
            break;
          case 9:
            renderer.stats();
            renderer.effectiveRects();
            break;
          default:
            await vi.advanceTimersByTimeAsync(Math.floor(next() * 2500));
            await flushMicrotasks();
        }

        const deviceVideos = container.querySelectorAll('video.sf-r-media--device').length;
        expect(provider.registrationCount).toBe(deviceVideos);
        expect(container.querySelectorAll('.sf-r-layer').length).toBeLessThanOrEqual(2);
        expect(container.querySelectorAll('.sf-r-slate').length).toBeLessThanOrEqual(1);
        expect(vi.getTimerCount()).toBeLessThan(80);
        expect(mounted.errors).toEqual([]);
      }

      renderer.destroy();
      await flushMicrotasks();
      expect(provider.registrationCount).toBe(0);
      expect(provider.desiredCount).toBe(0);
      expect(provider.listenerCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(container.childElementCount).toBe(0);
    },
    SEED_TIMEOUT_MS,
  );
});
