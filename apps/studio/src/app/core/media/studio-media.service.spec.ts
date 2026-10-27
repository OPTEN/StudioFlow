import { TestBed } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import {
  MEDIA_CLIENT_LOADER,
  StudioMediaService,
  type MediaClientModule,
} from './studio-media.service';

/** Records what the service does with the media client. */
class FakeSession {
  static last: FakeSession | null = null;
  state = 'idle';
  role = 'studio';
  room = null;
  starts = 0;
  restarts = 0;
  stops = 0;
  private listener: ((state: string) => void) | null = null;

  constructor(readonly options: { role: string; tokenProvider: () => Promise<unknown> }) {
    FakeSession.last = this;
  }

  onStateChange(listener: (state: string) => void): () => void {
    this.listener = listener;
    return () => (this.listener = null);
  }

  onRoom(): () => void {
    return () => undefined;
  }

  start(): void {
    this.starts += 1;
    this.emit('connecting');
  }

  restart(): void {
    this.restarts += 1;
  }

  stop(): void {
    this.stops += 1;
    this.emit('stopped');
  }

  emit(state: string): void {
    this.state = state;
    this.listener?.(state);
  }
}

class FakeProvider {
  static last: FakeProvider | null = null;
  disposed = false;

  constructor(
    readonly session: FakeSession,
    readonly options: { assetUrl: (assetId: string) => string | null },
  ) {
    FakeProvider.last = this;
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe('StudioMediaService', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let media: StudioMediaService;
  let loads: number;

  beforeEach(async () => {
    hub = new FakeStudioHub();
    loads = 0;
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        {
          provide: MEDIA_CLIENT_LOADER,
          useValue: () => {
            loads += 1;
            return Promise.resolve({
              MediaSession: FakeSession,
              LiveKitSourceProvider: FakeProvider,
            } as unknown as MediaClientModule);
          },
        },
      ],
    });
    media = TestBed.inject(StudioMediaService);
    harness = await startStore(
      hub,
      snapshotFixture({
        assets: [
          {
            id: 'ast_aaaaaaaaaaaaaaaa',
            code: 'M1',
            kind: 'image',
            name: 'Titelfolie',
            contentType: 'image/png',
            sizeBytes: 10,
            width: 1920,
            height: 1080,
            createdAt: '',
            hasAudio: false,
            contentUrl: '/api/productions/x/assets/ast_aaaaaaaaaaaaaaaa/content',
          },
        ],
      }),
    );
    await harness.settle();
  });

  it('loads the media client lazily once the store is live and starts a studio session', () => {
    expect(loads).toBe(1);
    expect(FakeSession.last?.options.role).toBe('studio');
    expect(FakeSession.last?.starts).toBe(1);
    expect(media.state()).toBe('connecting');
    expect(media.provider()).toBe(FakeProvider.last);
  });

  it('fetches tokens from the API for the current production', async () => {
    const token = FakeSession.last?.options.tokenProvider();
    harness.http
      .expectOne(`/api/productions/${PRODUCTION_ID}/livekit-token`)
      .flush({ token: 't', url: 'wss://x' });
    await expect(token).resolves.toMatchObject({ token: 't' });
  });

  it('resolves asset URLs from the store, with a fallback', () => {
    const assetUrl = FakeProvider.last?.options.assetUrl;
    expect(assetUrl?.('ast_aaaaaaaaaaaaaaaa')).toBe(
      '/api/productions/x/assets/ast_aaaaaaaaaaaaaaaa/content',
    );
    expect(assetUrl?.('ast_bbbbbbbbbbbbbbbb')).toBe(
      `/api/productions/${PRODUCTION_ID}/assets/ast_bbbbbbbbbbbbbbbb/content`,
    );
  });

  it('reports degraded and unavailable states', () => {
    FakeSession.last?.emit('waiting');
    expect(media.degraded()).toBe(true);
    FakeSession.last?.emit('unauthorized');
    expect(media.unavailable()).toBe(true);
    media.restart();
    expect(FakeSession.last?.restarts).toBe(1);
  });

  it('rejoins when the active production changes', async () => {
    media.ensureStarted('prd_bbbbbbbbbbbbbbbb');
    expect(FakeSession.last?.restarts).toBe(1);
    media.ensureStarted('prd_bbbbbbbbbbbbbbbb');
    expect(FakeSession.last?.restarts).toBe(1);
    await flushMicrotasks();
  });

  it('stops and releases the provider', () => {
    const session = FakeSession.last;
    const provider = FakeProvider.last;
    media.stop();
    expect(session?.stops).toBe(1);
    expect(provider?.disposed).toBe(true);
    expect(media.provider()).toBeNull();
    expect(media.state()).toBe('idle');
  });
});
