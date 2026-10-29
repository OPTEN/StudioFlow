// TEMPORARY visual harness for the stage redesign (not committed): renders <sf-stage> against a fake hub.
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideI18n } from '@studioflow/i18n/angular';
import { HUB, canvasDto, type ProductionEvent } from '@studioflow/scene-model';
import { MEDIA_CLIENT_LOADER } from './app/core/media/studio-media.service';
import { ProductionStoreService } from './app/core/state/production-store.service';
import { STUDIO_HUB_FACTORY } from './app/core/state/studio-hub';
import { BROWSER_STORAGE, PREFERENCE_KEYS } from './app/core/ui/preferences.service';
import { EditorService } from './app/stage/editor.service';
import { FRAME_SCHEDULER } from './app/stage/frame-scheduler';
import { StageComponent } from './app/stage/stage.component';
import { FakeStudioHub } from './testing/fake-studio-hub';
import {
  audioChannelFixture,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotChanges,
  snapshotFixture,
  sourceFixture,
  textSourceFixture,
} from './testing/fixtures';
import { MemoryStorage } from './testing/store-harness';

const params = new URLSearchParams(location.search);
document.documentElement.dataset['theme'] = params.get('theme') === 'light' ? 'light' : 'dark';
Object.assign(window, {
  mag: (x: number, y: number, s = 2.5) => {
    const root = document.documentElement;
    root.style.transformOrigin = `${x}px ${y}px`;
    root.style.transform = `scale(${s})`;
  },
  unmag: () => (document.documentElement.style.transform = ''),
});
const hub = new FakeStudioHub();
const storage = new MemoryStorage();
if (params.get('studio') === '1') {
  storage.setItem(PREFERENCE_KEYS.studioMode, '1');
}
if (params.get('cut') === '1') {
  storage.setItem(PREFERENCE_KEYS.transition, JSON.stringify({ kind: 'cut', durationMs: 300 }));
}
const K1 = 'dev_aaaaaaaaaaaaaaaa/camera';
const S1 = 'dev_bbbbbbbbbbbbbbbb/screen-1';
const T1 = 'txt_aaaaaaaaaaaaaaaa';
const lockId = params.get('lock');
const scenes =
  params.get('empty') === '1'
    ? []
    : [
        sceneFixture('scn_a', 'Welcome', 0, [
          itemFixture('itm_a1', K1, { x: 0, y: 0, w: 1920, h: 1080 }),
          itemFixture('itm_a2', T1, { x: 80, y: 820, w: 900, h: 180 }),
        ]),
        sceneFixture('scn_b', 'Presentation', 1, [
          itemFixture('itm_b1', S1, { x: 40, y: 40, w: 1360, h: 765, fit: 'contain' }),
          itemFixture('itm_b2', K1, {
            x: 1440,
            y: 40,
            w: 440,
            h: 248,
            locked: lockId === 'itm_b2',
          }),
          itemFixture('itm_b3', T1, { x: 80, y: 860, w: 900, h: 160 }),
        ]),
        sceneFixture('scn_c', 'Interview with a guest from the board', 2, [
          itemFixture('itm_c1', K1, { x: 0, y: 0, w: 960, h: 1080 }),
          itemFixture('itm_c2', S1, { x: 960, y: 0, w: 960, h: 1080, hidden: true }),
        ]),
      ];
const snapshot = snapshotFixture({
  production: productionFixture({
    previewSceneId: params.get('preview'),
    programSceneId: params.get('program') ?? 'scn_a',
    broadcast: params.get('broadcast') === 'live' ? 'live' : 'standby',
    canvas: params.get('canvas') === 'portrait' ? canvasDto('portrait', 'p1080') : undefined,
  }),
  scenes,
  sources: [
    sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Stage phone' }),
    sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop Lea · Slides' }),
    textSourceFixture(T1, 'T1'),
  ],
  audioChannels: params.get('audio') === '1' ? [audioChannelFixture(K1)] : [],
});
if (!params.get('canvas')) {
  snapshot.production = { ...snapshot.production, canvas: canvasDto('widescreen', 'p1080') };
}

@Component({
  selector: 'sf-root',
  imports: [StageComponent],
  template: `
    <div class="h-bar" style="height: 52px"></div>
    <div class="h-bar" style="height: 36px"></div>
    <section class="h-stage" [style.height]="height" aria-label="Monitors"><sf-stage /></section>
    <div class="h-docks"></div>
  `,
  styles: `
    :host {
      background: var(--panel);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .h-bar {
      border-bottom: 1px solid var(--seam);
      flex: none;
    }
    .h-stage {
      background: var(--stage);
      container-type: size;
      flex: none;
      min-width: 0;
      padding: 0 16px;
    }
    .h-docks {
      border-top: 1px solid var(--seam);
      flex: 1;
    }
    @media (max-width: 1180px) {
      :host {
        height: auto;
      }
      .h-stage {
        container-type: inline-size;
        height: auto !important;
      }
      .h-docks {
        min-height: 400px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HarnessComponent {
  protected readonly height = `${params.get('h') ?? 425}px`;

  constructor() {
    const store = inject(ProductionStoreService);
    const http = inject(HttpTestingController);
    const editor = inject(EditorService);
    hub.subscribe = () => Promise.resolve(snapshotChanges(snapshot));
    store.start();
    http.expectOne('/api/productions/active').flush({
      id: snapshot.production.id,
      name: snapshot.production.name,
      slug: snapshot.production.slug,
      isActive: true,
      createdAt: '2026-10-22T08:00:00.000Z',
    });
    setTimeout(() => {
      hub.connect();
      const select = params.get('sel');
      if (select) {
        setTimeout(() => editor.select(select), 50);
      }
    });
    let revision = 100;
    (window as unknown as Record<string, unknown>)['harness'] = {
      fade(to: string, ms = 2000) {
        revision += 1;
        hub.emit(HUB.event, {
          type: 'programSwitched',
          programSceneId: to,
          previewSceneId: store.previewSceneId(),
          previousProgramSceneId: store.programSceneId(),
          transition: { kind: 'fade', durationMs: ms },
          at: new Date().toISOString(),
          revision,
        } as ProductionEvent);
      },
      drop: () => hub.drop(),
    };
  }
}

bootstrapApplication(HarnessComponent, {
  providers: [
    provideI18n(),
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    { provide: STUDIO_HUB_FACTORY, useValue: () => hub },
    { provide: BROWSER_STORAGE, useValue: () => storage },
    { provide: MEDIA_CLIENT_LOADER, useValue: () => new Promise<never>(() => undefined) },
    {
      provide: FRAME_SCHEDULER,
      useValue: (callback: () => void) => {
        const timer = setTimeout(callback, 16);
        return () => clearTimeout(timer);
      },
    },
  ],
}).catch((error: unknown) => console.error(error));
