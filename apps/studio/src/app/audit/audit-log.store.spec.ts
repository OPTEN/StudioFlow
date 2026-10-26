import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AuditEntryDto } from '@studioflow/scene-model';
import { auditEntryFixture } from '../../testing/fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { AUDIT_PAGE_SIZE, AuditLogStore } from './audit-log.store';

describe('AuditLogStore', () => {
  let store: AuditLogStore;
  let http: HttpTestingController;

  const page = (entries: AuditEntryDto[], nextCursor: string | null = null) => ({
    entries,
    nextCursor,
  });
  const next = (): TestRequest => http.expectOne((request) => request.url === '/api/audit');
  const settle = async () => {
    for (let round = 0; round < 10; round += 1) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        AuditLogStore,
      ],
    });
    store = TestBed.inject(AuditLogStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the first page with the filter and the page size', async () => {
    const loading = store.load({ production: 'prd_1', q: 'lena' });
    expect(store.status()).toBe('loading');
    const request = next();
    expect(request.request.params.get('production')).toBe('prd_1');
    expect(request.request.params.get('q')).toBe('lena');
    expect(request.request.params.get('limit')).toBe(String(AUDIT_PAGE_SIZE));
    expect(request.request.params.has('cursor')).toBe(false);
    request.flush(page([auditEntryFixture(2), auditEntryFixture(1)], 'cursor-1'));
    await loading;

    expect(store.status()).toBe('ready');
    expect(store.entries().map((entry) => entry.id)).toEqual([2, 1]);
    expect(store.hasMore()).toBe(true);
  });

  it('has no more pages when the server sends no cursor', async () => {
    const loading = store.load({});
    next().flush(page([auditEntryFixture(1)]));
    await loading;
    expect(store.hasMore()).toBe(false);
    await store.loadMore();
    http.expectNone('/api/audit');
  });

  it('reports a failed first page and loads again on the next load', async () => {
    const failing = store.load({});
    next().flush(null, { status: 503, statusText: 'Service Unavailable' });
    await failing;
    expect(store.status()).toBe('error');
    expect(store.error()?.status).toBe(503);
    expect(store.entries()).toEqual([]);

    const retry = store.load({});
    expect(store.status()).toBe('loading');
    expect(store.error()).toBeNull();
    next().flush(page([auditEntryFixture(1)]));
    await retry;
    expect(store.status()).toBe('ready');
  });

  it('appends the next page with the cursor of the previous one', async () => {
    const loading = store.load({ q: 'a' });
    next().flush(page([auditEntryFixture(3), auditEntryFixture(2)], 'cursor-2'));
    await loading;

    const more = store.loadMore();
    expect(store.moreStatus()).toBe('loading');
    const request = next();
    expect(request.request.params.get('cursor')).toBe('cursor-2');
    expect(request.request.params.get('q')).toBe('a');
    request.flush(page([auditEntryFixture(1)]));
    await more;

    expect(store.entries().map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(store.hasMore()).toBe(false);
    expect(store.moreStatus()).toBe('idle');
  });

  it('asks for a page once while it is on its way', async () => {
    const loading = store.load({});
    next().flush(page([auditEntryFixture(2)], 'cursor-1'));
    await loading;

    const first = store.loadMore();
    const second = store.loadMore();
    const request = next();
    request.flush(page([auditEntryFixture(1)]));
    await Promise.all([first, second]);

    expect(store.entries().map((entry) => entry.id)).toEqual([2, 1]);
  });

  it('keeps the loaded entries and offers a retry when a later page fails', async () => {
    const loading = store.load({});
    next().flush(page([auditEntryFixture(2)], 'cursor-1'));
    await loading;

    const failing = store.loadMore();
    next().flush(null, { status: 500, statusText: 'Server Error' });
    await failing;
    expect(store.moreStatus()).toBe('error');
    expect(store.entries().map((entry) => entry.id)).toEqual([2]);
    expect(store.hasMore()).toBe(true);

    const again = store.loadMore();
    next().flush(page([auditEntryFixture(1)]));
    await again;
    expect(store.entries().map((entry) => entry.id)).toEqual([2, 1]);
  });

  it('drops the answer of a filter that was replaced', async () => {
    const stale = store.load({ q: 'old' });
    const staleRequest = next();
    const current = store.load({ q: 'new' });
    const currentRequest = next();

    currentRequest.flush(page([auditEntryFixture(7)]));
    await current;
    staleRequest.flush(page([auditEntryFixture(1)]));
    await stale;

    expect(store.entries().map((entry) => entry.id)).toEqual([7]);
  });

  it('drops a page that arrives after the filter changed', async () => {
    const loading = store.load({ q: 'a' });
    next().flush(page([auditEntryFixture(5)], 'cursor-1'));
    await loading;
    const more = store.loadMore();
    const request = next();

    const reload = store.load({ q: 'b' });
    next().flush(page([auditEntryFixture(9)]));
    await reload;
    request.flush(page([auditEntryFixture(4)]));
    await more;

    expect(store.entries().map((entry) => entry.id)).toEqual([9]);
  });

  describe('refreshHead', () => {
    async function loaded(entries: AuditEntryDto[], cursor: string | null = 'cursor-1') {
      const loading = store.load({ production: 'prd_1' });
      next().flush(page(entries, cursor));
      await loading;
    }

    it('adds the new entries at the top and marks them', async () => {
      await loaded([auditEntryFixture(10), auditEntryFixture(9)]);

      const refresh = store.refreshHead();
      const request = next();
      expect(request.request.params.get('production')).toBe('prd_1');
      expect(request.request.params.has('cursor')).toBe(false);
      request.flush(page([auditEntryFixture(12), auditEntryFixture(11), auditEntryFixture(10)]));
      await refresh;

      expect(store.entries().map((entry) => entry.id)).toEqual([12, 11, 10, 9]);
      expect(store.isFresh(auditEntryFixture(12))).toBe(true);
      expect(store.isFresh(auditEntryFixture(10))).toBe(false);
      expect(store.hasMore()).toBe(true);
    });

    it('changes nothing when nothing is new', async () => {
      await loaded([auditEntryFixture(10)]);
      const before = store.entries();

      const refresh = store.refreshHead();
      next().flush(page([auditEntryFixture(10)]));
      await refresh;

      expect(store.entries()).toBe(before);
    });

    it('starts over with the newest page when more arrived than a page holds', async () => {
      await loaded([auditEntryFixture(10)]);

      const refresh = store.refreshHead();
      next().flush(page([auditEntryFixture(30), auditEntryFixture(29)], 'cursor-new'));
      await refresh;

      expect(store.entries().map((entry) => entry.id)).toEqual([30, 29]);
      const more = store.loadMore();
      expect(next().request.params.get('cursor')).toBe('cursor-new');
      void more;
    });

    it('fills an empty list', async () => {
      await loaded([], null);

      const refresh = store.refreshHead();
      next().flush(page([auditEntryFixture(1)]));
      await refresh;

      expect(store.entries().map((entry) => entry.id)).toEqual([1]);
    });

    it('orders entries with the same time by id', async () => {
      const at = '2026-10-26T14:00:00.000+00:00';
      await loaded([auditEntryFixture(5, { at })]);

      const refresh = store.refreshHead();
      next().flush(page([auditEntryFixture(6, { at }), auditEntryFixture(5, { at })]));
      await refresh;

      expect(store.entries().map((entry) => entry.id)).toEqual([6, 5]);
    });

    it('ignores a failure', async () => {
      await loaded([auditEntryFixture(10)]);

      const refresh = store.refreshHead();
      next().flush(null, { status: 500, statusText: 'Server Error' });
      await refresh;

      expect(store.status()).toBe('ready');
      expect(store.entries().map((entry) => entry.id)).toEqual([10]);
    });

    it('does nothing while the first page is loading or after clear()', async () => {
      void store.load({});
      await store.refreshHead();
      next().flush(page([]));
      await settle();

      store.clear();
      await store.refreshHead();
      http.expectNone('/api/audit');
    });
  });

  it('clear() shows an empty ready list', async () => {
    const loading = store.load({});
    next().flush(page([auditEntryFixture(1)], 'cursor-1'));
    await loading;

    store.clear();

    expect(store.entries()).toEqual([]);
    expect(store.status()).toBe('ready');
    expect(store.hasMore()).toBe(false);
  });
});
