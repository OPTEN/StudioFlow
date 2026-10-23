/*
 * Fake camera and screen sources with known content (UI test fixtures, support/ui/init.ts), injected with
 * context.addInitScript AFTER init-script.js and latency-codec.js. None of this ships in the product.
 *
 * - getUserMedia({video}) returns a canvas stream when window.__sfFake.config.camera is set ("stamp camera"): a
 *   moving picture with the latency stamp (latency-codec.js) in the top bar, so the real sender app publishes frames
 *   whose capture time the output page can decode (?latency=1).
 * - getDisplayMedia() returns a canvas stream when window.__sfFake.config.screen is set: a flat colour per screen (the
 *   n-th call uses colors[n % colors.length]), a large label and the same stamp bar, so a test can tell the screens
 *   apart by their pixels and measure their latency.
 * - audio-only requests and everything not configured go to the next wrapper (init-script.js, then the browser).
 *
 * The stamp is drawn on the 640 x 360 grid of the codec and scaled to the canvas, so any canvas size decodes.
 * Counters: window.__sfMedia.userMediaCalls / displayCalls (init-script.js) keep counting here as well.
 */
(function () {
  if (window.__sfFake) return;
  const devices = navigator.mediaDevices;
  const media = (window.__sfMedia = window.__sfMedia || { userMediaCalls: [], displayCalls: 0 });
  const fake = (window.__sfFake = {
    /** { screen: {width,height,fps,colors,labelPrefix,stamp}|null, camera: {width,height,fps,label,stamp}|null } */
    config: { screen: null, camera: null },
    /** Every stream made so far: { kind, index, track, stop(), frames() }. */
    streams: [],
    /** Stops the n-th screen (default: the last one) like the browser's "Stop sharing": stop() plus an `ended` event. */
    endScreen(index) {
      const screens = fake.streams.filter((entry) => entry.kind === 'screen');
      const entry = index === undefined ? screens[screens.length - 1] : screens[index];
      if (!entry) return false;
      entry.stop();
      entry.track.dispatchEvent(new Event('ended'));
      return true;
    },
    /** Draws the stamp bar (top 48/360 of the picture, current time) onto any canvas context of any size. */
    drawStampBar(g, width, height) {
      if (!window.LatencyCodec) return;
      if (!fake._grid) {
        fake._grid = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
        fake._gridContext = fake._grid.getContext('2d');
      }
      window.LatencyCodec.drawStamp(fake._gridContext);
      const smoothing = g.imageSmoothingEnabled;
      g.imageSmoothingEnabled = false;
      g.drawImage(fake._grid, 0, 0, 640, 48, 0, 0, width, Math.round((48 * height) / 360));
      g.imageSmoothingEnabled = smoothing;
    },
    /** Frames drawn per stream, for "is the fake source alive" checks. */
    frames() {
      return fake.streams.map((entry) => ({
        kind: entry.kind,
        index: entry.index,
        frames: entry.frames(),
        live: entry.track.readyState === 'live',
      }));
    },
  });
  if (!devices) return;

  function makeStream(kind, index, cfg) {
    const width = cfg.width || 1280;
    const height = cfg.height || 720;
    const fps = cfg.fps || 30;
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const g = canvas.getContext('2d');
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    let phase = 0;
    let frames = 0;
    const colors =
      cfg.colors && cfg.colors.length ? cfg.colors : ['#e5484d', '#30a46c', '#3e63dd', '#f5d90a'];
    const label =
      cfg.label ||
      (cfg.labelPrefix
        ? cfg.labelPrefix + (index + 1)
        : kind === 'screen'
          ? 'S' + (index + 1)
          : 'K');
    const draw = () => {
      // The app stopped the track itself (stop() does not fire `ended`): nothing is watching, stop drawing.
      if (track.readyState === 'ended') {
        clearInterval(timer);
        return;
      }
      phase = (phase + 6) % 360;
      frames += 1;
      if (kind === 'screen') {
        g.fillStyle = colors[index % colors.length];
        g.fillRect(0, 0, width, height);
      } else {
        const gradient = g.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, 'hsl(' + phase + ' 70% 40%)');
        gradient.addColorStop(1, 'hsl(' + ((phase + 120) % 360) + ' 70% 25%)');
        g.fillStyle = gradient;
        g.fillRect(0, 0, width, height);
      }
      // A moving box keeps the encoder busy (static content produces almost no frames).
      g.fillStyle = 'rgba(255,255,255,0.85)';
      const box = Math.round(height * 0.12);
      g.fillRect(
        Math.round(((phase / 360) * (width - box)) | 0),
        Math.round(height * 0.78),
        box,
        box,
      );
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.font = 'bold ' + Math.round(height / 5) + 'px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, width / 2, height / 2);
      if (cfg.stamp !== false) fake.drawStampBar(g, width, height);
      if (typeof track.requestFrame === 'function') track.requestFrame();
      else stream.requestFrame();
    };
    const timer = setInterval(draw, 1000 / fps);
    draw();
    const entry = {
      kind,
      index,
      track,
      stop() {
        clearInterval(timer);
        track.stop();
      },
      frames: () => frames,
    };
    track.addEventListener('ended', () => clearInterval(timer));
    fake.streams.push(entry);
    return stream;
  }

  const previousGetUserMedia = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async function (constraints) {
    const cfg = fake.config.camera;
    if (cfg && constraints && constraints.video && !media.failCamera) {
      media.userMediaCalls.push(JSON.parse(JSON.stringify(constraints)));
      const index = fake.streams.filter((entry) => entry.kind === 'camera').length;
      const stream = makeStream('camera', index, cfg);
      if (constraints.audio) {
        // The product never asks for audio; if a test does, add the native audio track next to the fake picture.
        const audio = await previousGetUserMedia({ audio: constraints.audio });
        audio.getAudioTracks().forEach((track) => stream.addTrack(track));
      }
      return stream;
    }
    return previousGetUserMedia(constraints);
  };

  if (devices.getDisplayMedia) {
    const previousGetDisplayMedia = devices.getDisplayMedia.bind(devices);
    devices.getDisplayMedia = async function (constraints) {
      const cfg = fake.config.screen;
      if (cfg) {
        media.displayCalls += 1;
        const index = fake.streams.filter((entry) => entry.kind === 'screen').length;
        return makeStream('screen', index, cfg);
      }
      return previousGetDisplayMedia(constraints);
    };
  }
})();
