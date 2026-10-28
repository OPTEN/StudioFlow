/**
 * Synthetic demo content for screenshots and screen recordings of the real UI (README screenshots, product video): made-up
 * people and slides drawn on canvases that stand in for the cameras and the screen, so no real person or customer appears.
 */

/** A presenter drawn on a canvas (camera) or a slide (screen): replaces getUserMedia({video}) and getDisplayMedia(). */
export function demoSources(hue: number, name: string): string {
  return `(() => {
  const draw = (kind, hue, label) => {
    const width = 1280, height = 720;
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const g = canvas.getContext('2d');
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    let t = 0;
    const frame = () => {
      if (track.readyState === 'ended') return clearInterval(timer);
      t += 1;
      if (kind === 'camera') {
        const back = g.createLinearGradient(0, 0, width, height);
        back.addColorStop(0, 'hsl(' + hue + ' 35% 30%)');
        back.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ' 40% 14%)');
        g.fillStyle = back; g.fillRect(0, 0, width, height);
        g.fillStyle = 'hsla(' + hue + ' 60% 70% / 0.12)';
        for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(160 + i * 220, 140 + ((i * 97) % 200), 70 + (i % 3) * 30, 0, 7); g.fill(); }
        const sway = Math.sin(t / 25) * 6;
        g.fillStyle = 'hsl(' + hue + ' 25% 22%)';
        g.beginPath(); g.ellipse(width / 2 + sway, height + 40, 330, 300, 0, 0, 7); g.fill();
        g.fillStyle = 'hsl(28 45% 68%)';
        g.beginPath(); g.ellipse(width / 2 + sway, 330, 118, 142, 0, 0, 7); g.fill();
        g.fillStyle = 'hsl(' + hue + ' 30% 18%)';
        g.beginPath(); g.ellipse(width / 2 + sway, 235, 126, 78, 0, Math.PI, 0); g.fill();
      } else {
        g.fillStyle = '#f5f6f8'; g.fillRect(0, 0, width, height);
        g.fillStyle = '#1d2b53'; g.fillRect(0, 0, width, 120);
        g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif'; g.textBaseline = 'middle';
        g.fillText('Demo webinar: Q3 results', 60, 62);
        g.fillStyle = '#2b2f3a'; g.font = '38px sans-serif';
        ['Visitors up 18 percent', 'New sign-ups per week', 'Support answered in 4 minutes'].forEach((line, i) => {
          g.fillRect(70, 205 + i * 78, 14, 14); g.fillText(line, 104, 212 + i * 78);
        });
        const bars = [0.35, 0.5, 0.42, 0.68, 0.8, 0.95];
        bars.forEach((value, i) => {
          const grow = Math.min(1, t / 20);
          g.fillStyle = i === bars.length - 1 ? '#e5484d' : '#3e63dd';
          const h = value * 300 * grow;
          g.fillRect(790 + i * 70, 640 - h, 48, h);
        });
        g.fillStyle = '#c7ccd6'; g.fillRect(770, 642, 440, 4);
      }
      g.fillStyle = 'rgba(0,0,0,0.001)'; g.fillRect(0, 0, 1, 1);
      track.requestFrame && track.requestFrame();
    };
    const timer = setInterval(frame, 33);
    frame();
    return stream;
  };
  const devices = navigator.mediaDevices;
  const previousUserMedia = devices.getUserMedia.bind(devices);
  devices.getUserMedia = (constraints) => constraints && constraints.video && !constraints.audio
    ? Promise.resolve(draw('camera', ${hue}, ${JSON.stringify(name)}))
    : previousUserMedia(constraints);
  devices.getDisplayMedia = () => Promise.resolve(draw('screen', 220, 'screen'));
})();`;
}
