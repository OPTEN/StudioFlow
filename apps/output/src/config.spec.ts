import {
  KEY_STORAGE_PREFIX,
  parseFlags,
  parseRoute,
  pathSegment,
  resolveRoute,
  urlWithoutKey,
  type KeyStorage,
  type RouteWindow,
} from './config';
import { KEY } from './testing/fixtures';

const BASE = '/o/';

function at(url: string): { pathname: string; search: string; hash: string } {
  const parsed = new URL(url, 'https://studioflow.test');
  return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
}

class MemoryStorage implements KeyStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function fakeWindow(url: string, storage: KeyStorage | undefined = new MemoryStorage()) {
  const location = { ...at(url) };
  const replaced: string[] = [];
  const win: RouteWindow = {
    location,
    history: {
      state: null,
      replaceState: (_data: unknown, _unused: string, next?: string | URL | null) => {
        replaced.push(String(next));
        Object.assign(location, at(String(next)));
      },
    },
    sessionStorage: storage,
  };
  return { win, location, replaced, storage };
}

describe('pathSegment', () => {
  it.each([
    ['/o/webinar', 'webinar'],
    ['/o/webinar/', 'webinar'],
    ['/o/q4-2026', 'q4-2026'],
    ['/o/_clock', '_clock'],
    ['/o/%61bc', 'abc'],
  ])('reads %s as %s', (pathname, expected) => {
    expect(pathSegment(pathname, BASE)).toBe(expected);
  });

  it.each(['/o/', '/o', '/x/webinar', '/o/a/b', '/o//', '/o/%E0%A4%A'])(
    'rejects %s',
    (pathname) => {
      expect(pathSegment(pathname, BASE)).toBeNull();
    },
  );

  it('accepts a base without trailing slash', () => {
    expect(pathSegment('/o/webinar', '/o')).toBe('webinar');
  });
});

describe('parseRoute', () => {
  it('parses a valid link with key and default flags', () => {
    expect(parseRoute(at(`/o/webinar?k=${KEY}`), BASE)).toEqual({
      kind: 'output',
      slug: 'webinar',
      key: KEY,
      keyFromUrl: true,
      flags: { background: 'black', debug: false, latency: false },
    });
  });

  it('recognises the measurement clock without key', () => {
    expect(parseRoute(at('/o/_clock'), BASE)).toEqual({ kind: 'clock' });
    expect(parseRoute(at('/o/_clock/?debug=1'), BASE)).toEqual({ kind: 'clock' });
  });

  it.each([
    '/o/',
    '/o/Webinar',
    '/o/web_inar',
    '/o/web.inar',
    `/o/${'a'.repeat(49)}`,
    '/o/a/b',
    '/o/%20',
    '/o/<script>',
  ])('rejects the malformed slug in %s', (path) => {
    const route = parseRoute(at(`${path}?k=${KEY}`), BASE);
    expect(route).toMatchObject({ kind: 'invalid', reason: 'slug' });
  });

  it('accepts the longest slug', () => {
    const slug = 'a'.repeat(48);
    expect(parseRoute(at(`/o/${slug}?k=${KEY}`), BASE)).toMatchObject({ kind: 'output', slug });
  });

  it('rejects a missing key when nothing is stored', () => {
    expect(parseRoute(at('/o/webinar'), BASE)).toMatchObject({ kind: 'invalid', reason: 'key' });
  });

  it.each(['', 'short', 'with space and more chars', `${KEY}!`, 'a'.repeat(257)])(
    'rejects the malformed key %j',
    (key) => {
      const route = parseRoute(at(`/o/webinar?k=${encodeURIComponent(key)}`), BASE, () => KEY);
      expect(route).toMatchObject({ kind: 'invalid', reason: 'key' });
    },
  );

  it('falls back to the key stored for this slug', () => {
    const route = parseRoute(at('/o/webinar'), BASE, (slug) => (slug === 'webinar' ? KEY : null));
    expect(route).toMatchObject({ kind: 'output', key: KEY, keyFromUrl: false });
  });

  it('prefers the key in the URL over a stored one', () => {
    const other = 'Z'.repeat(43);
    const route = parseRoute(at(`/o/webinar?k=${other}`), BASE, () => KEY);
    expect(route).toMatchObject({ kind: 'output', key: other, keyFromUrl: true });
  });

  it('keeps the flags of an invalid link (transparent background for “No access”)', () => {
    expect(parseRoute(at('/o/Bad?bg=transparent'), BASE)).toMatchObject({
      kind: 'invalid',
      flags: { background: 'transparent' },
    });
  });
});

describe('parseFlags', () => {
  it.each([
    ['', { background: 'black', debug: false, latency: false }],
    ['?bg=transparent', { background: 'transparent', debug: false, latency: false }],
    ['?bg=TRANSPARENT', { background: 'transparent', debug: false, latency: false }],
    ['?bg=black', { background: 'black', debug: false, latency: false }],
    ['?bg=red', { background: 'black', debug: false, latency: false }],
    ['?debug=1', { background: 'black', debug: true, latency: false }],
    ['?debug=true&latency=1', { background: 'black', debug: true, latency: true }],
    ['?debug=0&latency=no', { background: 'black', debug: false, latency: false }],
    ['?debug', { background: 'black', debug: false, latency: false }],
  ])('parses %j', (search, expected) => {
    expect(parseFlags(search)).toEqual(expected);
  });
});

describe('urlWithoutKey', () => {
  it('removes only the key and keeps the other parameters and the hash', () => {
    expect(urlWithoutKey(at(`/o/webinar?bg=transparent&k=${KEY}&debug=1#x`))).toBe(
      '/o/webinar?bg=transparent&debug=1#x',
    );
  });

  it('drops the question mark when the key was the only parameter', () => {
    expect(urlWithoutKey(at(`/o/webinar?k=${KEY}`))).toBe('/o/webinar');
  });
});

describe('resolveRoute', () => {
  it('moves the key from the address bar into sessionStorage', () => {
    const { win, location, replaced, storage } = fakeWindow(`/o/webinar?k=${KEY}&debug=1`);
    const route = resolveRoute(win, BASE);
    expect(route).toMatchObject({ kind: 'output', key: KEY });
    expect(replaced).toEqual(['/o/webinar?debug=1']);
    expect(location.search).toBe('?debug=1');
    expect((storage as MemoryStorage).items.get(`${KEY_STORAGE_PREFIX}webinar`)).toBe(KEY);
  });

  it('keeps working after a reload without key in the URL', () => {
    const storage = new MemoryStorage();
    resolveRoute(fakeWindow(`/o/webinar?k=${KEY}`, storage).win, BASE);
    const reloaded = fakeWindow('/o/webinar', storage);
    expect(resolveRoute(reloaded.win, BASE)).toMatchObject({ kind: 'output', key: KEY });
    expect(reloaded.replaced).toEqual([]);
  });

  it('keeps the key in the URL when sessionStorage is blocked', () => {
    const blocked: KeyStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    const { win, replaced } = fakeWindow(`/o/webinar?k=${KEY}`, blocked);
    expect(resolveRoute(win, BASE)).toMatchObject({ kind: 'output', key: KEY });
    expect(replaced).toEqual([]);
  });

  it('keeps the key in the URL when sessionStorage does not exist', () => {
    const { win, replaced } = fakeWindow(`/o/webinar?k=${KEY}`, undefined);
    delete (win as { sessionStorage?: KeyStorage }).sessionStorage;
    expect(resolveRoute(win, BASE)).toMatchObject({ kind: 'output' });
    expect(replaced).toEqual([]);
  });

  it('does not touch the URL of an invalid link or the clock', () => {
    for (const url of ['/o/Bad?k=x', '/o/_clock']) {
      const { win, replaced } = fakeWindow(url);
      resolveRoute(win, BASE);
      expect(replaced).toEqual([]);
    }
  });

  it('removes the key from the real address bar (happy-dom)', () => {
    history.replaceState(null, '', `/o/webinar?bg=transparent&k=${KEY}`);
    sessionStorage.clear();
    const route = resolveRoute(window, BASE);
    expect(route).toMatchObject({ kind: 'output', key: KEY, flags: { background: 'transparent' } });
    expect(location.pathname + location.search).toBe('/o/webinar?bg=transparent');
    expect(location.href).not.toContain(KEY);
    expect(sessionStorage.getItem(`${KEY_STORAGE_PREFIX}webinar`)).toBe(KEY);
    sessionStorage.clear();
  });
});
