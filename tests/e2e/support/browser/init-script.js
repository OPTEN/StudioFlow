/*
 * Test init script (docs/testing.md 1.3), injected into every page of a context with context.addInitScript.
 * Registers WebSockets and RTCPeerConnections (window.__fsNet), records media requests (window.__fsMedia), can make the
 * camera fail and can replace getUserMedia/getDisplayMedia by canvas streams with known content. None of this ships in
 * the product.
 */
(function () {
  if (window.__fsNet) return;
  const fsNet = (window.__fsNet = {
    sockets: new Set(),
    peers: new Set(),
    counts() {
      return {
        sockets: [...this.sockets].filter((s) => s.readyState <= 1).length,
        peers: [...this.peers].filter((p) => p.connectionState !== 'closed').length,
      };
    },
    /** Closes every tracked socket and peer connection: what "the Wi-Fi is gone" does to the page. */
    cut() {
      for (const s of this.sockets) { try { s.close(); } catch (e) {} }
      for (const p of this.peers) { try { p.close(); } catch (e) {} }
    },
  });
  const track = (Native, registry) =>
    new Proxy(Native, {
      construct(target, args, newTarget) {
        const instance = Reflect.construct(target, args, newTarget);
        registry.add(instance);
        if (instance.addEventListener && target.name === 'WebSocket') instance.addEventListener('close', () => registry.delete(instance));
        return instance;
      },
    });
  if (window.WebSocket) window.WebSocket = track(window.WebSocket, fsNet.sockets);
  if (window.RTCPeerConnection) window.RTCPeerConnection = track(window.RTCPeerConnection, fsNet.peers);

  const media = (window.__fsMedia = { userMediaCalls: [], displayCalls: 0, failCamera: false, canvasScreen: false, timecodeCamera: false });
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
