import { auditEntryFixture } from '../../testing/fixtures';
import {
  NO_FILTERS,
  auditQuery,
  hasFilters,
  isCustomRangeInvalid,
  lastBroadcastRange,
  type AuditFilters,
} from './audit-filters';

const NOW = new Date(2026, 9, 26, 14, 30, 0);

function filters(overrides: Partial<AuditFilters>): AuditFilters {
  return { ...NO_FILTERS, ...overrides };
}

describe('auditQuery', () => {
  it('has no restriction without filters', () => {
    expect(auditQuery(NO_FILTERS, NOW, null)).toEqual({
      from: undefined,
      to: undefined,
      production: undefined,
      category: undefined,
      q: undefined,
    });
  });

  it('starts "today" at the local midnight', () => {
    const query = auditQuery(filters({ range: 'today' }), NOW, null);
    expect(query.from).toBe(new Date(2026, 9, 26, 0, 0, 0).toISOString());
    expect(query.to).toBeUndefined();
  });

  it('reads the local times of a custom range', () => {
    const query = auditQuery(
      filters({ range: 'custom', from: '2026-10-26T09:00', to: '2026-10-26T10:30' }),
      NOW,
      null,
    );
    expect(query.from).toBe(new Date(2026, 9, 26, 9, 0).toISOString());
    expect(query.to).toBe(new Date(2026, 9, 26, 10, 30).toISOString());
  });

  it('accepts a custom range with one end open', () => {
    const query = auditQuery(filters({ range: 'custom', from: '2026-10-26T09:00' }), NOW, null);
    expect(query.from).toBe(new Date(2026, 9, 26, 9, 0).toISOString());
    expect(query.to).toBeUndefined();
  });

  it('uses the range of the last broadcast, open-ended while it is live', () => {
    const ended = { from: '2026-10-26T10:00:00.000Z', to: '2026-10-26T11:00:00.001Z' };
    expect(auditQuery(filters({ range: 'lastBroadcast' }), NOW, ended)).toMatchObject(ended);
    expect(
      auditQuery(filters({ range: 'lastBroadcast' }), NOW, { from: ended.from, to: null }),
    ).toMatchObject({ from: ended.from, to: undefined });
  });

  it('passes production, categories and the trimmed text on', () => {
    const query = auditQuery(
      filters({ production: 'none', categories: ['devices', 'media'], text: '  Lena ' }),
      NOW,
      null,
    );
    expect(query).toMatchObject({ production: 'none', category: ['devices', 'media'], q: 'Lena' });
  });

  it('treats a blank text as no text', () => {
    expect(auditQuery(filters({ text: '   ' }), NOW, null).q).toBeUndefined();
  });
});

describe('isCustomRangeInvalid', () => {
  it('is true only when a custom range ends before or at its start', () => {
    const custom = (from: string, to: string) =>
      isCustomRangeInvalid(filters({ range: 'custom', from, to }));
    expect(custom('2026-10-26T10:00', '2026-10-26T09:00')).toBe(true);
    expect(custom('2026-10-26T10:00', '2026-10-26T10:00')).toBe(true);
    expect(custom('2026-10-26T10:00', '2026-10-26T10:01')).toBe(false);
    expect(custom('2026-10-26T10:00', '')).toBe(false);
    expect(custom('', '2026-10-26T10:00')).toBe(false);
    expect(
      isCustomRangeInvalid(
        filters({ range: 'today', from: '2026-10-26T10:00', to: '2026-01-01T00:00' }),
      ),
    ).toBe(false);
  });
});

describe('hasFilters', () => {
  it('is false for the default and true for every kind of restriction', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters(filters({ range: 'today' }))).toBe(true);
    expect(hasFilters(filters({ production: 'prd_1' }))).toBe(true);
    expect(hasFilters(filters({ categories: ['media'] }))).toBe(true);
    expect(hasFilters(filters({ text: 'a' }))).toBe(true);
    expect(hasFilters(filters({ text: '  ' }))).toBe(false);
  });
});

describe('lastBroadcastRange', () => {
  const started = (id: number, at: string) =>
    auditEntryFixture(id, { action: 'broadcast.started', at });
  const ended = (id: number, at: string) =>
    auditEntryFixture(id, { action: 'broadcast.ended', at });

  it('is the newest start up to just after the end that follows it', () => {
    const entries = [
      ended(4, '2026-10-26T12:00:00.123456+00:00'),
      started(3, '2026-10-26T11:00:00.000000+00:00'),
      ended(2, '2026-10-25T12:00:00.000000+00:00'),
      started(1, '2026-10-25T11:00:00.000000+00:00'),
    ];
    expect(lastBroadcastRange(entries)).toEqual({
      from: '2026-10-26T11:00:00.000000+00:00',
      to: '2026-10-26T12:00:00.124Z',
    });
  });

  it('has no end while the broadcast is live', () => {
    const entries = [
      started(3, '2026-10-26T11:00:00.000000+00:00'),
      ended(2, '2026-10-25T12:00:00.000000+00:00'),
    ];
    expect(lastBroadcastRange(entries)).toEqual({
      from: '2026-10-26T11:00:00.000000+00:00',
      to: null,
    });
  });

  it('takes the first end after the start when the broadcast ended more than once', () => {
    const entries = [
      ended(5, '2026-10-26T14:00:00.000000+00:00'),
      ended(4, '2026-10-26T12:00:00.000000+00:00'),
      started(3, '2026-10-26T11:00:00.000000+00:00'),
    ];
    expect(lastBroadcastRange(entries)?.to).toBe('2026-10-26T12:00:00.001Z');
  });

  it('is null when there was no broadcast', () => {
    expect(lastBroadcastRange([])).toBeNull();
    expect(lastBroadcastRange([ended(1, '2026-10-26T12:00:00.000000+00:00')])).toBeNull();
  });
});
