import { silentLogger } from '../logger';
import { FakeMediaStream, FakeMediaStreamTrack } from '../testing/fake-livekit';
import { AssetAudioTap } from './asset-audio';

const ASSET = 'ast_aaaaaaaaaaaaaaaa';

function video(readyState = 4): HTMLVideoElement {
  const element = document.createElement('video');
  Object.defineProperty(element, 'readyState', { value: readyState, configurable: true });
  return element;
}

function soundStream(): MediaStream {
  return new FakeMediaStream(new FakeMediaStreamTrack('audio').asTrack) as unknown as MediaStream;
}

function silentStream(): MediaStream {
  return new FakeMediaStream(new FakeMediaStreamTrack('video').asTrack) as unknown as MediaStream;
}

function setup(capture: (element: HTMLVideoElement) => MediaStream | null = () => soundStream()) {
  const changes: [string, MediaStream | null][] = [];
  const tap = new AssetAudioTap({
    onChange: (sourceId, stream) => changes.push([sourceId, stream]),
    capture,
    logger: silentLogger,
  });
  return { tap, changes };
}

describe('AssetAudioTap', () => {
  it('captures the sound of an element that has loaded and tells the mix', () => {
    const { tap, changes } = setup();
    const element = video();
    tap.attach(ASSET, element);

    expect(tap.streamOf(ASSET)).not.toBeNull();
    expect(tap.sourceIds()).toEqual([ASSET]);
    expect(changes.at(-1)).toEqual([ASSET, tap.streamOf(ASSET)]);
  });

  it('waits for the metadata of an element that is still loading', () => {
    const { tap, changes } = setup();
    const element = video(0);
    tap.attach(ASSET, element);
    expect(tap.streamOf(ASSET)).toBeNull();
    expect(changes).toEqual([[ASSET, null]]);

    Object.defineProperty(element, 'readyState', { value: 1, configurable: true });
    element.dispatchEvent(new Event('loadedmetadata'));

    expect(tap.streamOf(ASSET)).not.toBeNull();
    expect(changes).toHaveLength(2);
  });

  it('gives no sound for a video without an audio track or a browser without capture', () => {
    const silent = setup(() => silentStream());
    silent.tap.attach(ASSET, video());
    expect(silent.tap.streamOf(ASSET)).toBeNull();

    const unsupported = setup(() => null);
    unsupported.tap.attach(ASSET, video());
    expect(unsupported.tap.sourceIds()).toEqual([]);
  });

  it('survives a capture that throws', () => {
    const { tap } = setup(() => {
      throw new Error('NotSupportedError');
    });
    expect(() => tap.attach(ASSET, video())).not.toThrow();
    expect(tap.streamOf(ASSET)).toBeNull();
  });

  it('uses the newest element of an asset and returns to the older one when it goes', () => {
    const { tap, changes } = setup();
    const first = video();
    const second = video();
    tap.attach(ASSET, first);
    const firstStream = tap.streamOf(ASSET);
    tap.attach(ASSET, second);
    const secondStream = tap.streamOf(ASSET);
    expect(secondStream).not.toBe(firstStream);

    tap.detach(ASSET, second);
    expect(tap.streamOf(ASSET)).toBe(firstStream);
    expect(changes.at(-1)).toEqual([ASSET, firstStream]);
  });

  it('does not change the sound when an older element goes', () => {
    const { tap, changes } = setup();
    const first = video();
    const second = video();
    tap.attach(ASSET, first);
    tap.attach(ASSET, second);
    const count = changes.length;
    tap.detach(ASSET, first);
    expect(changes).toHaveLength(count);
    expect(tap.streamOf(ASSET)).not.toBeNull();
  });

  it('stops the capture and removes the sound when the last element goes', () => {
    const { tap, changes } = setup();
    const element = video();
    tap.attach(ASSET, element);
    const stream = tap.streamOf(ASSET) as unknown as FakeMediaStream;
    tap.detach(ASSET, element);

    expect(stream.track.readyState).toBe('ended');
    expect(tap.streamOf(ASSET)).toBeNull();
    expect(changes.at(-1)).toEqual([ASSET, null]);
    tap.detach(ASSET, element);
  });

  it('ignores the same element twice and elements it does not know', () => {
    const { tap, changes } = setup();
    const element = video();
    tap.attach(ASSET, element);
    tap.attach(ASSET, element);
    expect(changes).toHaveLength(1);
    tap.detach(ASSET, video());
    expect(tap.streamOf(ASSET)).not.toBeNull();
  });

  it('forgets an element that goes before its metadata arrived', () => {
    const { tap } = setup();
    const element = video(0);
    tap.attach(ASSET, element);
    tap.detach(ASSET, element);
    Object.defineProperty(element, 'readyState', { value: 4, configurable: true });
    element.dispatchEvent(new Event('loadedmetadata'));
    expect(tap.streamOf(ASSET)).toBeNull();
  });

  it('stops everything on dispose and accepts nothing afterwards', () => {
    const { tap } = setup();
    tap.attach(ASSET, video());
    const stream = tap.streamOf(ASSET) as unknown as FakeMediaStream;
    tap.dispose();
    tap.dispose();
    expect(stream.track.readyState).toBe('ended');
    tap.attach(ASSET, video());
    expect(tap.sourceIds()).toEqual([]);
  });

  it('isolates a throwing listener', () => {
    const tap = new AssetAudioTap({
      onChange: () => {
        throw new Error('mix bug');
      },
      capture: () => soundStream(),
      logger: silentLogger,
    });
    expect(() => tap.attach(ASSET, video())).not.toThrow();
  });
});
