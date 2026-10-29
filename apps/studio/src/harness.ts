// TEMPORARY visual harness for the docks redesign (not committed).
import {
  HttpResponse,
  provideHttpClient,
  withInterceptors,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { AssetDto, ProductionSnapshot, SourceDto } from '@studioflow/scene-model';
import { MEDIA_CLIENT_LOADER } from './app/core/media/studio-media.service';
import { ProductionStoreService } from './app/core/state/production-store.service';
import { STUDIO_HUB_FACTORY } from './app/core/state/studio-hub';
import { PropertiesDockComponent } from './app/docks/properties/properties-dock.component';
import { ScenesDockComponent } from './app/docks/scenes/scenes-dock.component';
import { SourcesDockComponent } from './app/docks/sources/sources-dock.component';
import { EditorService } from './app/stage/editor.service';
import { FakeStudioHub } from './testing/fake-studio-hub';
import {
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotChanges,
  snapshotFixture,
  sourceFixture,
  textSourceFixture,
} from './testing/fixtures';

const params = new URLSearchParams(location.search);
document.documentElement.style.setProperty('--h', params.get('h') ?? '420px');
document.documentElement.style.setProperty('--dw', params.get('dw') ?? '290px');
if (params.get('only') === '1') {
  document.documentElement.classList.add('h-only');
}
document.documentElement.dataset['theme'] = params.get('theme') ?? 'dark';
if (params.get('studio') === '1') {
  localStorage.setItem('studioflow.studio', '1');
} else {
  localStorage.setItem('studioflow.studio', '0');
}

function asset(id: string, code: string, name: string, kind: 'image' | 'video'): AssetDto {
  return {
    id,
    code,
    kind,
    name,
    contentType: kind === 'image' ? 'image/png' : 'video/mp4',
    sizeBytes: 1_258_291,
    width: 1920,
    height: 1080,
    createdAt: '2026-10-22T09:00:00.000Z',
    hasAudio: false,
    contentUrl: '',
  };
}

function mediaSource(id: string, code: string, label: string, kind: 'image' | 'video'): SourceDto {
  return {
    id,
    code,
    kind,
    label,
    deviceId: null,
    slot: null,
    assetId: id,
    status: 'ok',
    statusSince: null,
    text: null,
  };
}

const K1 = 'dev_aaaaaaaaaaaaaaaa/camera';
const S1 = 'dev_bbbbbbbbbbbbbbbb/screen-1';
const K2 = 'dev_cccccccccccccccc/camera';
const K3 = 'dev_dddddddddddddddd/camera';
const base = snapshotFixture();
const empty = params.get('empty') === '1';
const snapshot: ProductionSnapshot = snapshotFixture({
  production: productionFixture({
    programSceneId: 'scn_b',
    previewSceneId: params.get('studio') === '1' ? (params.get('preview') ?? 'scn_c') : null,
    broadcast: (params.get('broadcast') as 'live' | 'standby') ?? 'standby',
  }),
  scenes: empty
    ? []
    : [
        sceneFixture('scn_a', 'Welcome', 0, [itemFixture('itm_a1', K1)]),
        sceneFixture('scn_b', 'Presentation with a long name', 1, [
          itemFixture('itm_b1', S1, { x: 40, y: 40, w: 1360, h: 765, fit: 'contain' }),
          itemFixture('itm_b2', K1, { x: 1440, y: 40, w: 440, h: 248 }),
        ]),
        sceneFixture('scn_c', 'Interview', 2, [
          itemFixture('itm_c1', K1, { x: 0, y: 0, w: 960, h: 1080 }),
          itemFixture('itm_c2', K2, { x: 960, y: 0, w: 960, h: 1080, locked: true }),
          itemFixture('itm_c3', 'txt_aaaaaaaaaaaaaaaa', { x: 80, y: 820, w: 960, h: 180 }),
          itemFixture('itm_c4', 'ast_aaaaaaaaaaaaaaaa', { hidden: true }),
          itemFixture('itm_c5', 'dev_eeeeeeeeeeeeeeee/camera'),
        ]),
        sceneFixture('scn_d', 'Panel', 3),
        sceneFixture('scn_e', 'Q&A', 4, [itemFixture('itm_e1', K3)]),
        sceneFixture('scn_f', 'Break', 5, [itemFixture('itm_f1', 'ast_bbbbbbbbbbbbbbbb')]),
      ],
  sources: [
    ...base.sources,
    sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', {
      label: 'Guest camera',
      status: 'reconnecting',
      statusSince: new Date(Date.now() - 8000).toISOString(),
    }),
    sourceFixture('dev_dddddddddddddddd', 'camera', 'K3', { label: 'Hall camera', status: 'lost' }),
    sourceFixture('dev_ffffffffffffffff', 'camera', 'K4', { label: 'Blocked phone', status: 'blocked' }),
    textSourceFixture('txt_aaaaaaaaaaaaaaaa', 'T1'),
    textSourceFixture('txt_bbbbbbbbbbbbbbbb', 'T2', { line1: 'Leo Lang', line2: 'Guest' }),
    mediaSource('ast_aaaaaaaaaaaaaaaa', 'M1', 'Title slide', 'image'),
    mediaSource('ast_bbbbbbbbbbbbbbbb', 'M2', 'Break loop', 'video'),
  ],
  assets: [
    asset('ast_aaaaaaaaaaaaaaaa', 'M1', 'Title slide', 'image'),
    asset('ast_bbbbbbbbbbbbbbbb', 'M2', 'Break loop', 'video'),
  ],
  placeholders: [
    {
      id: 'plh_aaaaaaaaaaaaaaaa',
      sourceId: 'dev_eeeeeeeeeeeeeeee/camera',
      code: 'K7',
      kind: 'camera',
      label: 'Stage phone',
    },
  ] as ProductionSnapshot['placeholders'],
});

const hub = new FakeStudioHub();
hub.subscribe = () => Promise.resolve(snapshotChanges(snapshot));

const mockApi: HttpInterceptorFn = (request) => {
  if (request.url.endsWith('/api/productions/active')) {
    return of(
      new HttpResponse({
        status: 200,
        body: {
          id: snapshot.production.id,
          name: snapshot.production.name,
          slug: snapshot.production.slug,
          isActive: true,
          createdAt: '2026-10-22T08:00:00.000Z',
        },
      }),
    );
  }
  console.log('[harness]', request.method, request.url, request.body);
  return of(new HttpResponse({ status: 200, body: snapshot.production }));
};

@Component({
  selector: 'sf-root',
  imports: [ScenesDockComponent, SourcesDockComponent, PropertiesDockComponent],
  template: `
    <div class="h-stage"></div>
    <div class="h-docks">
      <section class="h-dock" aria-label="Scenes"><sf-scenes-dock /></section>
      <section class="h-dock" aria-label="Sources of the scene"><sf-sources-dock /></section>
      <section class="h-dock h-dock--wide" aria-label="Properties"><sf-properties-dock /></section>
      <section class="h-dock" aria-label="Devices"></section>
      <section class="h-dock" aria-label="Audio"></section>
    </div>
  `,
  styles: `
    :host { display: grid; grid-template-rows: minmax(0, 1fr) var(--h, 420px); height: 100vh; overflow: hidden; background: var(--panel); }
    .h-stage { background: var(--stage); border-bottom: 1px solid var(--seam); }
    .h-docks { display: flex; min-height: 0; }
    .h-dock { border-right: 1px solid var(--seam); display: flex; flex: 1 1 0; flex-direction: column; min-width: 0; container-type: inline-size; }
    .h-dock--wide { flex-grow: 1.2; }
    :host-context(.h-only) { grid-template-rows: 0 minmax(0, 1fr); }
    :host-context(.h-only) .h-dock { flex: 0 0 var(--dw); }
    :host-context(.h-only) .h-dock:nth-child(n + 4) { display: none; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HarnessComponent {
  constructor() {
    const store = inject(ProductionStoreService);
    const editor = inject(EditorService);
    store.start();
    setTimeout(() => {
      hub.connect();
      const select = params.get('select');
      if (select) {
        setTimeout(() => editor.select(select), 300);
      }
    }, 200);
  }
}

bootstrapApplication(HarnessComponent, {
  providers: [
    provideHttpClient(withInterceptors([mockApi])),
    provideRouter([]),
    { provide: STUDIO_HUB_FACTORY, useValue: () => hub },
    { provide: MEDIA_CLIENT_LOADER, useValue: () => new Promise<never>(() => undefined) },
  ],
}).catch((error: unknown) => console.error(error));
