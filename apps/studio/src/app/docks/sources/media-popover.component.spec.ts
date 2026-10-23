import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { AssetDto, SourceDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  defaultScenes,
  itemFixture,
  sceneFixture,
  snapshotFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { MediaPopoverComponent } from './media-popover.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;

function asset(id: string, code: string, name: string): AssetDto {
  return {
    id,
    code,
    kind: 'image',
    name,
    contentType: 'image/png',
    sizeBytes: 1_258_291,
    width: 1920,
    height: 1080,
    createdAt: '2026-10-22T09:00:00.000Z',
    contentUrl: `${BASE}/assets/${id}/content`,
  };
}

function mediaSource(id: string, code: string, label: string): SourceDto {
  return {
    id,
    code,
    kind: 'image',
    label,
    deviceId: null,
    slot: null,
    assetId: id,
    status: 'ok',
    statusSince: null,
  };
}

describe('MediaPopoverComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<MediaPopoverComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    const base = snapshotFixture();
    const [first, second, third] = defaultScenes();
    harness = await startStore(
      hub,
      snapshotFixture({
        assets: [
          asset('ast_aaaaaaaaaaaaaaaa', 'M1', 'Titelfolie'),
          asset('ast_bbbbbbbbbbbbbbbb', 'M2', 'Pause-Slate'),
        ],
        sources: [
          ...base.sources,
          mediaSource('ast_aaaaaaaaaaaaaaaa', 'M1', 'Titelfolie'),
          mediaSource('ast_bbbbbbbbbbbbbbbb', 'M2', 'Pause-Slate'),
        ],
        scenes: [
          first,
          second,
          sceneFixture(third.id, third.name, 2, [itemFixture('itm_c1', 'ast_bbbbbbbbbbbbbbbb')]),
        ],
      }),
    );
    fixture = TestBed.createComponent(MediaPopoverComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  });

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function assets(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.c-media-pop__asset'));
  }

  afterEach(() => harness.http.verify());

  it('lists the media with code, name and facts', () => {
    expect(assets().map((row) => text(row.querySelector('.c-media-pop__name')))).toEqual([
      'Titelfolie',
      'Pause-Slate',
    ]);
    expect(text(assets()[0].querySelector('.c-media-pop__meta'))).toBe(
      'Bild · 1920 × 1080 · 1,2 MB',
    );
    expect(text(element.querySelector('.c-hint'))).toBe(
      'PNG, JPEG oder WebP bis 25 MB · MP4 oder WebM bis 1 GB',
    );
  });

  it('explains where a medium is used instead of deleting it', async () => {
    assets()[1].querySelector<HTMLButtonElement>('[aria-label="Löschen: Pause-Slate"]')?.click();
    await render();
    expect(text(assets()[1].querySelector('.c-media-pop__inuse'))).toBe(
      'wird verwendet Wird in «Pause» verwendet. Erst dort entfernen.',
    );
    harness.http.expectNone(() => true);
  });

  it('deletes after the confirmation and shows «wird verwendet» on 409', async () => {
    assets()[0].querySelector<HTMLButtonElement>('[aria-label="Löschen: Titelfolie"]')?.click();
    await render();
    expect(text(assets()[0].querySelector('.c-confirm span'))).toBe(
      '«Titelfolie» wird gelöscht. Das lässt sich nicht rückgängig machen.',
    );
    assets()[0].querySelector<HTMLButtonElement>('.c-btn--danger-fill')?.click();
    harness.http
      .expectOne(`${BASE}/assets/ast_aaaaaaaaaaaaaaaa`)
      .flush({ code: 'asset_in_use' }, { status: 409, statusText: 'Conflict' });
    await render();
    expect(assets()[0].querySelector('.c-confirm')).toBeNull();
    expect(text(assets()[0].querySelector('.c-media-pop__inuse'))).toContain('wird verwendet');
    expect(TestBed.inject(ToastService).current()).toBeNull();
  });

  it('renames a medium inline', async () => {
    assets()[0].querySelector<HTMLButtonElement>('[aria-label="Umbenennen: Titelfolie"]')?.click();
    await render();
    const input = assets()[0].querySelector<HTMLInputElement>(
      'sf-inline-edit input',
    ) as HTMLInputElement;
    input.value = 'Titel 2026';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const request = harness.http.expectOne(`${BASE}/assets/ast_aaaaaaaaaaaaaaaa`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Titel 2026' });
    request.flush(asset('ast_aaaaaaaaaaaaaaaa', 'M1', 'Titel 2026'));
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe('Datei heisst jetzt «Titel 2026»');
  });

  it('reports rejected files of a drop inline', async () => {
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    const zone = element.querySelector('.c-media-pop__drop') as HTMLElement;
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [svg] } });
    zone.dispatchEvent(drop);
    await render();
    expect(text(element.querySelector('.c-field-error'))).toBe(
      '«logo.svg»: Dieser Dateityp ist nicht erlaubt. Erlaubt sind PNG, JPEG, WebP, MP4 und WebM.',
    );
  });
});
