import {
  entryScriptOf,
  RELOAD_MARKER_KEY,
  VersionWatch,
  type MarkerStorage,
} from './version-watch';

const OLD = '/o/assets/index-AAAA1111.js';
const NEW = '/o/assets/index-BBBB2222.js';

function html(entry: string): string {
  return `<!doctype html><html><head><link rel="preload" href="/o/assets/x.woff2" as="font">
    <script type="module" crossorigin src="${entry}"></script></head><body></body></html>`;
}

class MemoryStorage implements MarkerStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function setup(
  published: string,
  live = false,
  storage: MarkerStorage | null = new MemoryStorage(),
) {
  const flags = { live, published, now: 0 };
  const reload = vi.fn();
  const fetchIndex = vi.fn(() => Promise.resolve(html(flags.published)));
  const watch = new VersionWatch({
    currentEntry: OLD,
    fetchIndex,
    storage,
    canReload: () => !flags.live,
    reload,
    now: () => flags.now,
  });
  return { watch, reload, fetchIndex, flags, storage };
}

describe('entryScriptOf', () => {
  it('finds the module entry of a built index.html', () => {
    expect(entryScriptOf(html(NEW))).toBe(NEW);
    expect(entryScriptOf('<script type=module src="/src/main.ts"></script>')).toBe('/src/main.ts');
  });

  it('ignores classic scripts and pages without entry', () => {
    expect(entryScriptOf('<script src="/legacy.js"></script>')).toBeNull();
    expect(entryScriptOf('<p>502 Bad Gateway</p>')).toBeNull();
  });
});

describe('VersionWatch', () => {
  it('does nothing while the published build is the running one', async () => {
    const { watch, reload } = setup(OLD);
    await watch.check();
    expect(reload).not.toHaveBeenCalled();
    expect(watch.pending).toBeNull();
  });

  it('reloads once for a new build while not live', async () => {
    const { watch, reload, storage } = setup(NEW);
    await watch.check();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage?.getItem(RELOAD_MARKER_KEY)).toBe(NEW);
  });

  it('waits for the end of a live broadcast', async () => {
    const { watch, reload, flags } = setup(NEW, true);
    await watch.check();
    watch.maybeReload();
    expect(reload).not.toHaveBeenCalled();
    expect(watch.pending).toBe(NEW);
    flags.live = false;
    watch.maybeReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads twice for the same build (no loop when a cache serves an old page)', async () => {
    const storage = new MemoryStorage();
    storage.setItem(RELOAD_MARKER_KEY, NEW);
    const { watch, reload } = setup(NEW, false, storage);
    await watch.check();
    expect(reload).not.toHaveBeenCalled();
  });

  it('never reloads without sessionStorage', async () => {
    const { watch, reload, fetchIndex } = setup(NEW, false, null);
    await watch.check();
    expect(fetchIndex).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('checks at most once a minute and tolerates failing fetches', async () => {
    const { watch, fetchIndex, flags, reload } = setup(OLD);
    await watch.check();
    flags.now = 30_000;
    await watch.check();
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    fetchIndex.mockRejectedValueOnce(new Error('offline'));
    flags.now = 61_000;
    await expect(watch.check()).resolves.toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores an index without entry script (error page during a restart)', async () => {
    const { watch, reload, fetchIndex } = setup(OLD);
    fetchIndex.mockResolvedValueOnce('<p>502</p>');
    await watch.check();
    expect(reload).not.toHaveBeenCalled();
  });
});
