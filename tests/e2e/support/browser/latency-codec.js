/*
 * Latency stamp codec (docs/testing.md 1.3, research 2026-10-22): the publisher draws a 32-bit millisecond stamp as
 * black/white blocks on a canvas, the subscriber decodes it from the received <video> and computes
 * now - stamp. Both sides use performance.timeOrigin + performance.now() (the OS clock), so one machine shares it.
 * Layout: block 0 = black reference, block 1 = white reference, 32 data bits MSB first, one even-parity bit.
 */
(function (global) {
  const W = 640, H = 360, BW = 16, BAR_H = 48, BITS = 32, FIRST_BIT = 2, PARITY_AT = FIRST_BIT + BITS;
  const now = () => performance.timeOrigin + performance.now();
  function drawStamp(g, tMs, extra) {
    const stamp = Math.round(tMs === undefined ? now() : tMs) >>> 0;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    let parity = 0;
    const block = (i, on) => { g.fillStyle = on ? '#fff' : '#000'; g.fillRect(i * BW, 0, BW, BAR_H); };
    block(0, false); block(1, true);
    for (let b = 0; b < BITS; b++) { const bit = (stamp >>> (BITS - 1 - b)) & 1; parity ^= bit; block(FIRST_BIT + b, !!bit); }
    block(PARITY_AT, !!parity);
    if (extra) extra(g);
    return stamp;
  }
  function decodeStamp(img, scratch) {
    const c = scratch || (decodeStamp._c = decodeStamp._c || Object.assign(document.createElement('canvas'), { width: W, height: H }));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const luma = (i) => {
      const d = g.getImageData(i * BW + BW / 2 - 3, BAR_H / 2 - 3, 6, 6).data;
      let s = 0;
      for (let p = 0; p < d.length; p += 4) s += 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      return s / (d.length / 4);
    };
    const lo = luma(0), hi = luma(1);
    if (hi - lo < 100) return { ok: false, ts: 0 };
    const th = (lo + hi) / 2;
    let v = 0, parity = 0;
    for (let b = 0; b < BITS; b++) { const bit = luma(FIRST_BIT + b) > th ? 1 : 0; v = (v * 2 + bit) >>> 0; parity ^= bit; }
    return { ok: (luma(PARITY_AT) > th ? 1 : 0) === parity, ts: v };
  }
  const latencyMs = (ts32, nowMs) => ((Math.round(nowMs === undefined ? now() : nowMs) >>> 0) - ts32) >>> 0;
  global.LatencyCodec = { W, H, drawStamp, decodeStamp, latencyMs, now };
})(globalThis);
