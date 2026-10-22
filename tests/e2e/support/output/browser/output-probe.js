/*
 * Browser-side probe of the output page (OUT specs, tests/e2e/support/output). Injected with context.addInitScript, so it
 * also runs in the iframe of an embedding page and survives reloads. It only starts on the output route (/o/{slug}) and
 * changes nothing on the page: a MutationObserver logs what appears and disappears, an optional requestAnimationFrame
 * sampler records the state of the stage per frame, an optional requestVideoFrameCallback logger records every presented
 * video frame. None of this ships in the product. All times are epoch milliseconds (performance.timeOrigin + now), the
 * same clock as Date.now() in the Node test process.
 *
 * The output page has no data-state / data-slate hooks (docs/testing.md 1.7 lists them, the product has none), so the
 * state of an item is derived from the computed styles of the elements the renderer toggles:
 *   fallback  .fs-r-fallback is displayed (the fallback source instead of the lost picture)
 *   held      .fs-r-held is displayed (blurred picture, dark scrim, «Bild kommt gleich zurück»)
 *   hold      the hold-frame canvas (.fs-r-hold-frame) is displayed (last picture of a lost source, sharp)
 *   live      a device video with a decoded picture
 *   connecting a device video without a picture yet
 *   media     an image or video asset
 */
(function () {
  if (window.__outProbe) return;
  if (!/^\/o\//.test(location.pathname)) return;

  const epoch = () => performance.timeOrigin + performance.now();
  const MAX_EVENTS = 20000;
  const probe = (window.__outProbe = {
    version: 1,
    bootAt: epoch(),
    timeOrigin: performance.timeOrigin,
    events: [],
    frames: null,
    frameLog: [],
    standbySeen: false,
    denySeen: false,
    /** navigator.userActivation.hasBeenActive when the first video started to play (null: unsupported). */
    activationAtFirstPlay: undefined,
    /** Epoch ms of the first 'playing' event of a video in this document (undefined: none yet). */
    firstPlayAt: undefined,
    /** navigator.userActivation.hasBeenActive when the document started. */
    activationAtStart: navigator.userActivation ? navigator.userActivation.hasBeenActive : null,
  });
  const STANDBY = "Gleich geht's los";
  const DENIED = 'Kein Zugang';

  function log(type, data) {
    if (probe.events.length < MAX_EVENTS) probe.events.push(Object.assign({ t: epoch(), type: type }, data || {}));
  }

  // Playwright's evaluate() counts as a user gesture for the page, so the question «did autoplay need a gesture» has to be
  // answered at the moment the first video starts playing, before the test talks to the page.
  document.addEventListener(
    'playing',
    () => {
      if (probe.activationAtFirstPlay === undefined) probe.activationAtFirstPlay = navigator.userActivation ? navigator.userActivation.hasBeenActive : null;
      if (probe.firstPlayAt === undefined) probe.firstPlayAt = epoch();
    },
    true,
  );

  function itemOf(node) {
    return node && node.closest ? node.closest('[data-item-id]') : null;
  }

  function scanAdded(node) {
    if (!(node instanceof Element)) return;
    const visit = (el) => {
      if (el.matches('.fs-r-layer[data-scene-id]')) log('layer+', { id: el.getAttribute('data-scene-id') });
      else if (el.matches('.fs-r-slate')) {
        const title = (el.querySelector('.fs-r-slate-title') || {}).textContent || '';
        if (title.indexOf(STANDBY) >= 0) probe.standbySeen = true;
        if (title.indexOf(DENIED) >= 0) probe.denySeen = true;
        log('slate+', { title: title });
      } else if (el.matches('video')) {
        const item = itemOf(el);
        log('video+', { item: item ? item.getAttribute('data-item-id') : null });
      } else if (el.matches('.fs-r-slate-title')) {
        const text = el.textContent || '';
        if (text.indexOf(STANDBY) >= 0) probe.standbySeen = true;
        if (text.indexOf(DENIED) >= 0) probe.denySeen = true;
      }
    };
    visit(node);
    node.querySelectorAll('.fs-r-layer[data-scene-id], .fs-r-slate, video, .fs-r-slate-title').forEach(visit);
  }

  function scanRemoved(node) {
    if (!(node instanceof Element)) return;
    const visit = (el) => {
      if (el.matches('.fs-r-layer[data-scene-id]')) log('layer-', { id: el.getAttribute('data-scene-id') });
      else if (el.matches('.fs-r-slate')) log('slate-', {});
      else if (el.matches('video')) log('video-', {});
    };
    visit(node);
    node.querySelectorAll('.fs-r-layer[data-scene-id], .fs-r-slate, video').forEach(visit);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(scanAdded);
      record.removedNodes.forEach(scanRemoved);
      if (record.type === 'characterData' || record.type === 'childList') {
        const target = record.target;
        const el = target instanceof Element ? target : target.parentElement;
        const title = el && el.closest ? el.closest('.fs-r-slate-title') : null;
        if (title) {
          const text = title.textContent || '';
          if (text.indexOf(STANDBY) >= 0) probe.standbySeen = true;
          if (text.indexOf(DENIED) >= 0) probe.denySeen = true;
        }
      }
    }
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true });

  // --- state of one item -----------------------------------------------------------------------------------------
  function displayed(el) {
    return !!el && getComputedStyle(el).display !== 'none';
  }

  function itemState(item) {
    if (displayed(item.querySelector('.fs-r-fallback'))) return 'fallback';
    if (displayed(item.querySelector('.fs-r-held'))) return 'held';
    if (displayed(item.querySelector('canvas.fs-r-hold-frame'))) return 'hold';
    const video = item.querySelector('video.fs-r-media--device');
    if (!video) return item.querySelector('.fs-r-media') ? 'media' : 'missing';
    return video.videoWidth > 0 && video.readyState >= 2 ? 'live' : 'connecting';
  }

  const lumaCanvas = Object.assign(document.createElement('canvas'), { width: 32, height: 18 });
  let lumaContext = null;
  function lumaOf(source) {
    try {
      lumaContext = lumaContext || lumaCanvas.getContext('2d', { willReadFrequently: true });
      lumaContext.drawImage(source, 0, 0, 32, 18);
      const data = lumaContext.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      return sum / (data.length / 4);
    } catch (e) {
      return null;
    }
  }

  function snapshotItem(item, withLuma) {
    const rect = item.getBoundingClientRect();
    const video = item.querySelector('video.fs-r-media--device');
    const layer = item.closest('.fs-r-layer');
    const hold = item.querySelector('canvas.fs-r-hold-frame');
    const box = item.querySelector('.fs-r-box');
    const out = {
      id: item.getAttribute('data-item-id'),
      layer: layer ? layer.getAttribute('data-scene-id') : null,
      state: itemState(item),
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
      video: video
        ? { ready: video.readyState, w: video.videoWidth, h: video.videoHeight, paused: video.paused, time: video.currentTime }
        : null,
      blur: box ? getComputedStyle(box).filter : 'none',
    };
    if (withLuma) {
      if (video && video.videoWidth > 0 && video.readyState >= 2 && out.state === 'live') out.luma = lumaOf(video);
      else if (hold && hold.width > 0) out.luma = lumaOf(hold);
      else out.luma = video ? 0 : null;
    }
    return out;
  }

  function snapshotSlate() {
    const slate = document.querySelector('.fs-r-slate');
    if (!slate) return null;
    const title = slate.querySelector('.fs-r-slate-title');
    const subtitle = slate.querySelector('.fs-r-slate-subtitle');
    return {
      opacity: parseFloat(getComputedStyle(slate).opacity),
      title: title ? title.textContent : '',
      subtitle: subtitle && getComputedStyle(subtitle).display !== 'none' ? subtitle.textContent : '',
    };
  }

  function snapshotAnimations() {
    return document.getAnimations().map((animation) => {
      const effect = animation.effect;
      const target = effect && effect.target;
      const keyframes = effect && effect.getKeyframes ? effect.getKeyframes() : [];
      const timing = effect && effect.getTiming ? effect.getTiming() : {};
      return {
        scene: target && target.getAttribute ? target.getAttribute('data-scene-id') : null,
        cls: target && typeof target.className === 'string' ? target.className : null,
        duration: timing.duration === undefined ? null : timing.duration,
        props: keyframes.length ? Object.keys(keyframes[0]).filter((k) => ['offset', 'computedOffset', 'easing', 'composite'].indexOf(k) < 0) : [],
        time: animation.currentTime,
      };
    });
  }

  probe.snapshot = function (withLuma, withAnimations) {
    const layers = [...document.querySelectorAll('.fs-r-layer')].map((l) => ({
      id: l.getAttribute('data-scene-id'),
      opacity: parseFloat(getComputedStyle(l).opacity),
    }));
    return {
      t: epoch(),
      layers: layers,
      items: [...document.querySelectorAll('.fs-r-item')].map((i) => snapshotItem(i, !!withLuma)),
      slate: snapshotSlate(),
      videos: document.querySelectorAll('video').length,
      anims: withAnimations ? snapshotAnimations() : undefined,
    };
  };

  // --- per-frame sampler -------------------------------------------------------------------------------------------
  let sampling = false;
  probe.startSampler = function (options) {
    const opts = options || {};
    probe.frames = [];
    sampling = true;
    const tick = () => {
      if (!sampling) return;
      probe.frames.push(probe.snapshot(opts.luma, opts.animations));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  probe.stopSampler = function () {
    sampling = false;
    const frames = probe.frames || [];
    probe.frames = null;
    return frames;
  };

  // --- presented video frames ----------------------------------------------------------------------------------------
  let logging = false;
  let serial = 0;
  const watched = new WeakSet();
  const MAX_LOG = 200000;
  function watchVideo(video) {
    if (watched.has(video) || typeof video.requestVideoFrameCallback !== 'function') return;
    watched.add(video);
    const id = ++serial;
    const callback = (now, metadata) => {
      if (!logging) return;
      const item = itemOf(video);
      if (probe.frameLog.length < MAX_LOG)
        probe.frameLog.push({ t: epoch(), v: id, item: item ? item.getAttribute('data-item-id') : null, w: metadata.width, h: metadata.height, n: metadata.presentedFrames, m: metadata.mediaTime });
      video.requestVideoFrameCallback(callback);
    };
    video.requestVideoFrameCallback(callback);
  }
  const videoObserver = new MutationObserver((records) => {
    if (!logging) return;
    for (const record of records) record.addedNodes.forEach((node) => {
      if (node instanceof Element) {
        if (node.matches('video')) watchVideo(node);
        node.querySelectorAll('video').forEach(watchVideo);
      }
    });
  });
  probe.startFrameLog = function () {
    probe.frameLog = [];
    logging = true;
    document.querySelectorAll('video').forEach((video) => {
      watched.delete ? watched.delete(video) : null;
      watchVideo(video);
    });
    videoObserver.observe(document, { childList: true, subtree: true });
  };
  probe.stopFrameLog = function () {
    logging = false;
    videoObserver.disconnect();
    const log2 = probe.frameLog;
    probe.frameLog = [];
    return log2;
  };

  probe.takeEvents = function () {
    const events = probe.events;
    probe.events = [];
    return events;
  };
})();
