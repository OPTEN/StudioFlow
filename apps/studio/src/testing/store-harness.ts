/**
 * Starts the real ProductionStoreService against a FakeStudioHub and HttpTestingController. Test-only.
 */
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HUB, type ProductionEvent, type ProductionSnapshot } from '@flowstudio/scene-model';
import { csrfInterceptor } from '../app/core/api/csrf.interceptor';
import { MEDIA_CLIENT_LOADER } from '../app/core/media/studio-media.service';
import { ProductionStoreService } from '../app/core/state/production-store.service';
import { STUDIO_HUB_FACTORY } from '../app/core/state/studio-hub';
import { BROWSER_STORAGE } from '../app/core/ui/preferences.service';
import { FakeStudioHub, flushMicrotasks } from './fake-studio-hub';
import { PRODUCTION_ID, snapshotChanges, snapshotFixture } from './fixtures';

/** In-memory `Storage` for preference tests. */
export class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Providers for a Regie spec: HTTP testing, router, fake hub, memory storage, no media chunk. */
export function studioTestProviders(
  hub: FakeStudioHub,
  storage: Storage = new MemoryStorage(),
): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(withInterceptors([csrfInterceptor])),
    provideHttpClientTesting(),
    provideRouter([]),
    { provide: STUDIO_HUB_FACTORY, useValue: () => hub },
    { provide: BROWSER_STORAGE, useValue: () => storage },
    // The media client stays unloaded in unit tests (no WebRTC in the test DOM).
    { provide: MEDIA_CLIENT_LOADER, useValue: () => new Promise<never>(() => undefined) },
  ];
}

/** An event without (or with an explicit) revision. */
export type EventInput = ProductionEvent extends infer E
  ? E extends ProductionEvent
    ? Omit<E, 'revision'> & { revision?: number }
    : never
  : never;

/** A running store with a loaded snapshot. */
export interface StoreHarness {
  readonly store: ProductionStoreService;
  readonly hub: FakeStudioHub;
  readonly http: HttpTestingController;
  /** Pushes one event with the next revision (or the given one). */
  emitEvent(event: EventInput): ProductionEvent;
  /** Current revision of the store. */
  revision(): number;
  /** Runs pending effects and change detection. */
  settle(): Promise<void>;
}

/**
 * Starts the store: answers `GET /api/productions/active`, connects the hub and answers `Subscribe` with `snapshot`.
 * Call after `TestBed.configureTestingModule({ providers: studioTestProviders(hub) })`.
 */
export async function startStore(
  hub: FakeStudioHub,
  snapshot: ProductionSnapshot = snapshotFixture(),
): Promise<StoreHarness> {
  const store = TestBed.inject(ProductionStoreService);
  const http = TestBed.inject(HttpTestingController);
  hub.subscribe = () => Promise.resolve(snapshotChanges(snapshot));
  store.start();
  http.expectOne('/api/productions/active').flush({
    id: snapshot.production.id ?? PRODUCTION_ID,
    name: snapshot.production.name,
    slug: snapshot.production.slug,
    isActive: true,
    createdAt: '2026-10-22T08:00:00.000Z',
  });
  await flushMicrotasks();
  hub.connect();
  await flushMicrotasks();
  const settle = async (): Promise<void> => {
    await flushMicrotasks();
    TestBed.tick();
    await flushMicrotasks();
  };
  await settle();
  return {
    store,
    hub,
    http,
    revision: () => store.state()?.revision ?? 0,
    emitEvent: (event) => {
      const full = {
        ...event,
        revision: event.revision ?? (store.state()?.revision ?? 0) + 1,
      } as ProductionEvent;
      hub.emit(HUB.event, full);
      return full;
    },
    settle,
  };
}
