/*
 * Test init script (docs/testing.md 1.3), injected into every page of a context with context.addInitScript.
 * Registers WebSockets and RTCPeerConnections (window.__sfNet), records media requests (window.__sfMedia), can make the
 * camera fail and can replace getUserMedia/getDisplayMedia by canvas streams with known content. None of this ships in
 * the product.
 */
(function () {
  if (window.__sfNet) return;
  const sfNet = (window.__sfNet = {
    sockets: new Set(),
    peers: new Set(),
    /** True from cut() to restore(): the page cannot open a socket or a peer connection (the Wi-Fi is off). */
    blocked: false,
    counts() {
      return {
        sockets: [...this.sockets].filter((s) => s.readyState <= 1).length,
        peers: [...this.peers].filter((p) => p.connectionState !== 'closed').length,
      };
    },
    /**
     * Closes every tracked socket and peer connection: what "the Wi-Fi is gone" does to the page. The close handshake
     * has to finish before the browser goes offline (the harness sets `setOffline` afterwards): a Close frame that the
     * emulated offline mode swallows leaves the server with a silent loss (`T-DETECT-SILENT`) instead of the clean
     * close that `T-DETECT-CLEAN` measures. New sockets and peers are refused from the first moment, so the apps
     * cannot reconnect in the gap before the browser is offline. Resolves with `Date.now()` of the cut and whether
     * every socket closed within a second.
     */
    cut() {
      this.blocked = true;
      const at = Date.now();
      const closed = [...this.sockets].map(
        (s) =>
          new Promise((resolve) => {
            if (s.readyState === 3) return resolve();
            s.addEventListener('close', () => resolve());
            try { s.close(); } catch (e) { resolve(); }
          }),
      );
      for (const p of this.peers) { try { p.close(); } catch (e) {} }
      return new Promise((resolve) => {
        const giveUp = setTimeout(() => resolve({ at, clean: false }), 1000);
        Promise.all(closed).then(() => {
          clearTimeout(giveUp);
          resolve({ at, clean: true });
        });
      });
    },
    /** Lets the page open sockets and peer connections again. */
    restore() {
      this.blocked = false;
    },
  });
  const track = (Native, registry) =>
    new Proxy(Native, {
      construct(target, args, newTarget) {
        if (sfNet.blocked) throw new DOMException('The network is gone (net.cut)', 'NetworkError');
        const instance = Reflect.construct(target, args, newTarget);
        registry.add(instance);
        if (instance.addEventListener && target.name === 'WebSocket') instance.addEventListener('close', () => registry.delete(instance));
        return instance;
      },
    });
  if (window.WebSocket) window.WebSocket = track(window.WebSocket, sfNet.sockets);
  if (window.RTCPeerConnection) window.RTCPeerConnection = track(window.RTCPeerConnection, sfNet.peers);

  const media = (window.__sfMedia = { userMediaCalls: [], displayCalls: 0, failCamera: false, canvasScreen: false, timecodeCamera: false });
  const devices = navigator.mediaDevices;
  if (!devices) return;
  const timecodeStream = (fps) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    const g = canvas.getContext('2d');
    const stream = canvas.captureStream(0);
    const vt = stream.getVideoTracks()[0];
    const draw = () => {
      if (window.LatencyCodec) window.LatencyCodec.drawStamp(g);
      else { g.fillStyle = '#' + (Date.now() % 0xffffff).toString(16).padStart(6, '0'); g.fillRect(0, 0, 1280, 720); }
      if (typeof vt.requestFrame === 'function') vt.requestFrame(); else stream.requestFrame();
    };
    setInterval(draw, 1000 / (fps || 30));
    draw();
    return stream;
  };
  const nativeGetUserMedia = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async function (constraints) {
    media.userMediaCalls.push(JSON.parse(JSON.stringify(constraints || {})));
    if (media.failCamera && constraints && constraints.video) throw new DOMException('Could not start video source', 'NotReadableError');
    if (media.timecodeCamera && constraints && constraints.video) return timecodeStream(30);
    return nativeGetUserMedia(constraints);
  };
  if (devices.getDisplayMedia) {
    const nativeGetDisplayMedia = devices.getDisplayMedia.bind(devices);
    devices.getDisplayMedia = async function (constraints) {
      media.displayCalls += 1;
      if (media.canvasScreen) return timecodeStream(30);
      return nativeGetDisplayMedia(constraints);
    };
  }
})();
