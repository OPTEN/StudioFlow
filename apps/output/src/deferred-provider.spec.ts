import { DeferredSourceProvider } from './deferred-provider';
import { FakeMediaProvider } from './testing/fakes';
import { CAMERA, SCREEN } from './testing/fixtures';

describe('DeferredSourceProvider', () => {
  it('answers pending and resolves assets before LiveKit is loaded', () => {
    const provider = new DeferredSourceProvider((id) => `/media/${id}`);
    expect(provider.availability(CAMERA)).toEqual({ state: 'pending' });
    expect(provider.assetUrl('ast_x')).toBe('/media/ast_x');
    expect(provider.bound).toBe(false);
  });

  it('hands remembered videos and desired sizes to the real provider', () => {
    const provider = new DeferredSourceProvider(() => null);
    const camera = document.createElement('video');
    const screen = document.createElement('video');
    provider.attach(CAMERA, camera);
    provider.attach(SCREEN, screen);
    provider.detach(SCREEN, screen);
    provider.setDesiredSize(CAMERA, 'r1', { width: 1920, height: 1088 });
    provider.setDesiredSize(SCREEN, 'r1/preload', { width: 320, height: 176 });
    provider.setDesiredSize(SCREEN, 'r1/preload', null);

    const inner = new FakeMediaProvider();
    const changes: string[] = [];
    provider.onChange((id) => changes.push(id));
    provider.bind(inner);

    expect(inner.attached).toEqual([[CAMERA, camera]]);
    expect(inner.sizes).toEqual([[CAMERA, 'r1', { width: 1920, height: 1088 }]]);
    expect(changes).toEqual([CAMERA]);
    expect(provider.bound).toBe(true);
  });

  it('forwards everything after bind', () => {
    const provider = new DeferredSourceProvider(() => null);
    const inner = new FakeMediaProvider();
    provider.bind(inner);
    const video = document.createElement('video');
    provider.attach(CAMERA, video);
    provider.setDesiredSize(CAMERA, 'r1', null);
    inner.available.set(CAMERA, { state: 'live' });
    expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
    const changes: string[] = [];
    provider.onChange((id) => changes.push(id));
    inner.emit(CAMERA);
    expect(changes).toEqual([CAMERA]);
    provider.detach(CAMERA, video);
    expect(inner.attached).toEqual([]);
    expect(inner.sizes).toEqual([[CAMERA, 'r1', null]]);
  });

  it('binds only once', () => {
    const provider = new DeferredSourceProvider(() => null);
    const first = new FakeMediaProvider();
    const second = new FakeMediaProvider();
    provider.bind(first);
    provider.bind(second);
    provider.attach(CAMERA, document.createElement('video'));
    expect(first.attached).toHaveLength(1);
    expect(second.attached).toHaveLength(0);
  });

  it('reports video registrations', () => {
    const provider = new DeferredSourceProvider(() => null);
    const events: string[] = [];
    provider.onVideosChange((id, _video, attached) => events.push(`${attached ? '+' : '-'}${id}`));
    const video = document.createElement('video');
    provider.attach(CAMERA, video);
    expect(provider.videos()).toEqual([[CAMERA, video]]);
    provider.detach(CAMERA, video);
    provider.detach(CAMERA, video);
    expect(events).toEqual([`+${CAMERA}`, `-${CAMERA}`]);
    expect(provider.videos()).toEqual([]);
  });

  it('survives a throwing asset resolver and a throwing inner provider', () => {
    const provider = new DeferredSourceProvider(() => {
      throw new Error('broken');
    });
    expect(provider.assetUrl('ast_x')).toBeNull();
    const inner = new FakeMediaProvider();
    inner.attach = () => {
      throw new Error('attach failed');
    };
    provider.attach(CAMERA, document.createElement('video'));
    expect(() => provider.bind(inner)).not.toThrow();
  });
});
