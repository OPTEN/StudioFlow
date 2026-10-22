import { TestBed } from '@angular/core/testing';
import type { AssetDto } from '@flowstudio/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ApiError } from '../../core/api/api-error';
import { StudioApiService, type UploadOptions } from '../../core/api/studio-api.service';
import { ToastService } from '../../core/ui/toast.service';
import { AssetUploadService } from './asset-upload.service';

interface PendingUpload {
  readonly file: File;
  readonly options: UploadOptions;
  resolve(asset: AssetDto): void;
  reject(error: unknown): void;
}

function asset(id: string, name: string): AssetDto {
  return {
    id,
    code: 'M1',
    kind: 'image',
    name,
    contentType: 'image/png',
    sizeBytes: 10,
    width: 1920,
    height: 1080,
    createdAt: '2026-10-22T10:00:00.000Z',
    contentUrl: `/api/productions/${PRODUCTION_ID}/assets/${id}/content`,
  };
}

describe('AssetUploadService', () => {
  let harness: StoreHarness;
  let uploads: AssetUploadService;
  let toasts: ToastService;
  let pending: PendingUpload[];

  beforeEach(async () => {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub);
    pending = [];
    const api = TestBed.inject(StudioApiService);
    vi.spyOn(api, 'uploadAsset').mockImplementation(
      (productionId, file, options = {}) =>
        new Promise<AssetDto>((resolve, reject) => {
          expect(productionId).toBe(PRODUCTION_ID);
          pending.push({ file, options, resolve, reject });
          options.signal?.addEventListener('abort', () =>
            reject(new ApiError({ status: 0, code: 'aborted' })),
          );
        }),
    );
    uploads = TestBed.inject(AssetUploadService);
    toasts = TestBed.inject(ToastService);
  });

  afterEach(() => harness.http.verify());

  const png = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/png' });

  it('rejects wrong files before uploading and queues the rest', () => {
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    const result = uploads.add([svg, png('titel.png')]);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toEqual([
      '«logo.svg»: Dieser Dateityp ist nicht erlaubt. Erlaubt sind PNG, JPEG, WebP, MP4 und WebM.',
    ]);
    expect(uploads.uploads().map((entry) => entry.name)).toEqual(['titel.png']);
  });

  it('uploads one file after the other with progress and offers to add it to the scene', async () => {
    uploads.add([png('a.png'), png('b.png')]);
    await flushMicrotasks();
    expect(pending).toHaveLength(1);
    expect(uploads.uploads().map((entry) => entry.state)).toEqual(['uploading', 'queued']);
    expect(uploads.activeCount()).toBe(2);
    pending[0].options.onProgress?.({ loaded: 5, total: 10, fraction: 0.5 });
    expect(uploads.uploads()[0].fraction).toBe(0.5);
    pending[0].resolve(asset('ast_aaaaaaaaaaaaaaaa', 'a'));
    await flushMicrotasks();
    expect(uploads.uploads()[0]).toMatchObject({ state: 'done', fraction: 1 });
    expect(toasts.current()?.message).toBe('«a» ist hochgeladen und steht als M1 bereit');
    expect(toasts.current()?.action?.label).toBe('Zur Szene hinzufügen');
    expect(pending).toHaveLength(2);
    expect(pending[1].file.name).toBe('b.png');
    toasts.runAction();
    const add = harness.http.expectOne(`/api/productions/${PRODUCTION_ID}/scenes/scn_a/items`);
    expect(add.request.method).toBe('PUT');
    expect(add.request.body.items.at(-1).source).toBe('ast_aaaaaaaaaaaaaaaa');
    add.flush({ ...harness.store.sceneById('scn_a'), version: 2 });
    pending[1].resolve(asset('ast_bbbbbbbbbbbbbbbb', 'b'));
    await flushMicrotasks();
    expect(uploads.activeCount()).toBe(0);
  });

  it('cancels queued and running uploads', async () => {
    uploads.add([png('a.png'), png('b.png')]);
    await flushMicrotasks();
    const [first, second] = uploads.uploads();
    uploads.cancel(second.id);
    expect(uploads.uploads()[1].state).toBe('aborted');
    uploads.cancel(first.id);
    await flushMicrotasks();
    expect(uploads.uploads()[0].state).toBe('aborted');
    expect(toasts.current()?.message).toBe('Hochladen von «a.png» abgebrochen');
    expect(pending).toHaveLength(1);
    uploads.dismiss(first.id);
    expect(uploads.uploads().map((entry) => entry.name)).toEqual(['b.png']);
  });

  it('turns 415 and 413 into German messages', async () => {
    uploads.add([png('a.png'), png('b.png')]);
    await flushMicrotasks();
    pending[0].reject(new ApiError({ status: 415, code: 'unsupported_media' }));
    await flushMicrotasks();
    expect(uploads.uploads()[0]).toMatchObject({
      state: 'failed',
      error: 'Dieser Dateityp ist nicht erlaubt. Erlaubt sind PNG, JPEG, WebP, MP4 und WebM.',
    });
    pending[1].reject(new ApiError({ status: 413 }));
    await flushMicrotasks();
    expect(uploads.uploads()[1].error).toBe(
      'Die Datei ist zu gross. Bilder dürfen höchstens 25 MB, Videos höchstens 1 GB gross sein.',
    );
    expect(toasts.current()?.message).toContain('«b.png» wurde nicht hochgeladen');
  });
});
