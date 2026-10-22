import { ScreenWakeLock } from './wake-lock';

class FakeSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  onrelease = null;
  readonly release = vi.fn(async () => {
    if (!this.released) {
      this.released = true;
      this.dispatchEvent(new Event('release'));
    }
  });
}

class FakeWakeLock {
  readonly sentinels: FakeSentinel[] = [];
  readonly request = vi.fn(async (_type?: WakeLockType): Promise<WakeLockSentinel> => {
    const sentinel = new FakeSentinel();
    this.sentinels.push(sentinel);
    return sentinel as unknown as WakeLockSentinel;
  });

  get asWakeLock(): WakeLock {
    return this as unknown as WakeLock;
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function setup(): { wakeLock: FakeWakeLock; doc: FakeDocument; lock: ScreenWakeLock } {
  const wakeLock = new FakeWakeLock();
  const doc = new FakeDocument();
  return {
    wakeLock,
    doc,
    lock: new ScreenWakeLock({ wakeLock: wakeLock.asWakeLock, document: doc }),
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await Promise.resolve();
  }
}

describe('ScreenWakeLock', () => {
  it('acquires the screen lock', async () => {
    const { wakeLock, lock } = setup();
    expect(lock.supported).toBe(true);
    await expect(lock.enable()).resolves.toBe(true);
    expect(lock.active).toBe(true);
    expect(wakeLock.request).toHaveBeenCalledWith('screen');
  });

  it('coalesces concurrent requests', async () => {
    const { wakeLock, lock, doc } = setup();
    await Promise.all([
      lock.enable(),
      lock.enable(),
      Promise.resolve(doc.setVisibility('visible')),
    ]);
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
    await lock.enable();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('waits while hidden and re-acquires after the browser released it on hide', async () => {
    const { wakeLock, lock, doc } = setup();
    doc.visibilityState = 'hidden';
    await expect(lock.enable()).resolves.toBe(false);
    expect(wakeLock.request).not.toHaveBeenCalled();
    doc.setVisibility('visible');
    await settle();
    expect(lock.active).toBe(true);

    await wakeLock.sentinels[0].release();
    doc.setVisibility('hidden');
    expect(lock.active).toBe(false);
    doc.setVisibility('visible');
    await settle();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
    expect(lock.active).toBe(true);
  });

  it('treats a refused request as best effort and retries on the next visibility', async () => {
    const { wakeLock, lock, doc } = setup();
    wakeLock.request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(lock.enable()).resolves.toBe(false);
    doc.setVisibility('visible');
    await settle();
    expect(lock.active).toBe(true);
  });

  it('releases on disable and stops re-acquiring', async () => {
    const { wakeLock, lock, doc } = setup();
    await lock.enable();
    await lock.disable();
    expect(wakeLock.sentinels[0].release).toHaveBeenCalled();
    expect(lock.active).toBe(false);
    doc.setVisibility('visible');
    await settle();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('releases a lock granted after disable()', async () => {
    const { wakeLock, lock } = setup();
    const enabling = lock.enable();
    await lock.disable();
    await expect(enabling).resolves.toBe(false);
    expect(wakeLock.sentinels[0].release).toHaveBeenCalled();
  });

  it('does nothing without the API', async () => {
    const lock = new ScreenWakeLock({ wakeLock: undefined, document: undefined });
    expect(lock.supported).toBe(false);
    await expect(lock.enable()).resolves.toBe(false);
    await expect(lock.disable()).resolves.toBeUndefined();
    expect(() => lock.dispose()).not.toThrow();
  });

  it('defaults to the browser environment (happy-dom has no wake lock)', async () => {
    const lock = new ScreenWakeLock();
    expect(lock.supported).toBe(false);
    await expect(lock.enable()).resolves.toBe(false);
    lock.dispose();
  });

  it('removes its listener and releases on dispose', async () => {
    const { wakeLock, lock, doc } = setup();
    await lock.enable();
    lock.dispose();
    await settle();
    expect(wakeLock.sentinels[0].release).toHaveBeenCalled();
    doc.setVisibility('visible');
    await settle();
    await expect(lock.enable()).resolves.toBe(false);
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });
});
