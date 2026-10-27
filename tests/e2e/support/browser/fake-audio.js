/*
 * Fake microphone and screen audio with a known sine tone (issue #7), injected with context.addInitScript AFTER
 * fake-sources.js. None of this ships in the product.
 *
 * The tone is written into a MediaStreamTrackGenerator (an audio track made of AudioData), not into an AudioContext: a
 * context created without a user gesture stays suspended, and the audio station starts its microphone at load, before
 * anybody touched the page. Every source has its own frequency and level, so a test can tell the channels apart in the
 * spectrum of the output page and change them while the source is live.
 *
 * - getUserMedia({audio}) without video returns a tone when window.__sfAudioFake.config.mic is set; while the device is
 *   "unplugged" it fails with NotFoundError, like a real microphone that is gone.
 * - getDisplayMedia({audio}) adds a tone track to the screen only when the sender asked for audio (the "Share audio" box)
 *   and window.__sfAudioFake.config.screen is set: a browser that cannot share sound simply returns no audio track.
 * - unplug() / replug() end the tracks of the live microphones and fire `devicechange`, as a USB interface would.
 *
 * Counters: window.__sfMedia.userMediaCalls keeps counting the constraint objects of the microphone requests.
 */
(function () {
  if (window.__sfAudioFake) return;
  const devices = navigator.mediaDevices;
  const media = (window.__sfMedia = window.__sfMedia || { userMediaCalls: [], displayCalls: 0 });
  const generatorSupported =
    typeof MediaStreamTrackGenerator === 'function' && typeof AudioData === 'function';
  const fake = (window.__sfAudioFake = {
    supported: generatorSupported,
    /** { mic: {frequency, level, channels}|null, screen: {frequency, level, channels}|null } */
    config: { mic: null, screen: null },
    /** Every tone made so far: { kind, frequency, level, track, stop() }. */
    sources: [],
    unplugged: false,
    /** The tones that are still live. */
    live(kind) {
      return fake.sources.filter(
        (entry) => entry.track.readyState === 'live' && (kind === undefined || entry.kind === kind),
      );
    },
    /** Changes frequency and/or level of the live tones of a kind (`mic` or `screen`), e.g. level 0 for silence. */
    setTone(kind, patch) {
      for (const entry of fake.live(kind)) Object.assign(entry, patch);
    },
    /** The microphone is gone: its tracks end, a new request fails, `devicechange` fires. */
    unplugMic() {
      fake.unplugged = true;
      for (const entry of fake.live('mic')) {
        entry.stop();
        entry.track.dispatchEvent(new Event('ended'));
      }
      if (devices) devices.dispatchEvent(new Event('devicechange'));
    },
    /** The microphone is back: requests work again, `devicechange` fires. */
    replugMic() {
      fake.unplugged = false;
      if (devices) devices.dispatchEvent(new Event('devicechange'));
    },
  });
  if (!devices || !generatorSupported) return;

  const RATE = 48000;
  const CHUNK_LEAD_S = 0.06;

  function makeTone(kind, cfg) {
    const channels = cfg.channels || 2;
    const generator = new MediaStreamTrackGenerator({ kind: 'audio' });
    const writer = generator.writable.getWriter();
    const entry = {
      kind,
      frequency: cfg.frequency || 440,
      level: cfg.level === undefined ? 0.5 : cfg.level,
      /** How regularly the page fed the track: the longest pause between two chunks (a starved page makes dropouts). */
      stats: { chunks: 0, maxGapMs: 0 },
      track: generator,
      stop() {
        clearInterval(timer);
        try {
          generator.stop();
        } catch (e) {
          // already stopped
        }
      },
    };
    let phase = 0;
    let written = 0;
    let busy = false;
    let lastChunkAt = performance.now();
    const startedAt = lastChunkAt;
    const timer = setInterval(async () => {
      if (generator.readyState !== 'live') {
        clearInterval(timer);
        return;
      }
      if (busy) return;
      const wanted = Math.floor(((performance.now() - startedAt) / 1000 + CHUNK_LEAD_S) * RATE);
      const frames = Math.min(wanted - written, RATE / 2);
      if (frames < 128) return;
      busy = true;
      try {
        const planar = new Float32Array(frames * channels);
        const step = (2 * Math.PI * entry.frequency) / RATE;
        for (let i = 0; i < frames; i += 1) {
          const value = entry.level * Math.sin(phase);
          phase += step;
          if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
          for (let c = 0; c < channels; c += 1) planar[c * frames + i] = value;
        }
        const data = new AudioData({
          format: 'f32-planar',
          sampleRate: RATE,
          numberOfFrames: frames,
          numberOfChannels: channels,
          timestamp: Math.round((written / RATE) * 1e6),
          data: planar,
        });
        written += frames;
        await writer.write(data);
        data.close();
        const now = performance.now();
        entry.stats.chunks += 1;
        entry.stats.maxGapMs = Math.max(entry.stats.maxGapMs, Math.round(now - lastChunkAt));
        lastChunkAt = now;
      } catch (e) {
        // the track was stopped while a chunk was in flight
      } finally {
        busy = false;
      }
    }, 10);
    fake.sources.push(entry);
    return entry;
  }

  const previousGetUserMedia = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async function (constraints) {
    const cfg = fake.config.mic;
    if (cfg && constraints && constraints.audio && !constraints.video) {
      media.userMediaCalls.push(JSON.parse(JSON.stringify(constraints)));
      if (fake.unplugged) throw new DOMException('Requested device not found', 'NotFoundError');
      return new MediaStream([makeTone('mic', cfg).track]);
    }
    return previousGetUserMedia(constraints);
  };

  if (devices.enumerateDevices) {
    const previousEnumerate = devices.enumerateDevices.bind(devices);
    devices.enumerateDevices = async function () {
      const list = await previousEnumerate();
      return fake.unplugged ? list.filter((device) => device.kind !== 'audioinput') : list;
    };
  }

  if (devices.getDisplayMedia) {
    const previousGetDisplayMedia = devices.getDisplayMedia.bind(devices);
    devices.getDisplayMedia = async function (constraints) {
      const stream = await previousGetDisplayMedia(constraints);
      const cfg = fake.config.screen;
      if (cfg && constraints && constraints.audio) {
        const entry = makeTone('screen', cfg);
        stream.addTrack(entry.track);
        // Sharing ends with the picture: the sound of the shared tab or screen goes with it.
        const video = stream.getVideoTracks()[0];
        if (video) video.addEventListener('ended', () => entry.stop());
      }
      return stream;
    };
  }
})();
