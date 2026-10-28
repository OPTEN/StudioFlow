// The StudioFlow product video as a function of time: window.renderFrame(t) puts the frame for film time t on screen and
// resolves when every picture of it has decoded. No clocks, no CSS transitions, no randomness: the same t gives the same
// pixels, so render.mjs can capture frame by frame. The pictures are frames cut from screen recordings of the real UI
// (extract.mjs); everything drawn here sits around them: captions, the cursor, zoom and pan, the end card.
import { FPS, scenes } from '../scenes.mjs';

const format = new URLSearchParams(location.search).get('format') ?? 'landscape';
const frame = document.getElementById('frame');
frame.classList.add(format);
document.body.style.width = getComputedStyle(frame).width;

const $ = (id) => document.getElementById(id);
const caption = $('caption');
const media = $('media');
const mediaImg = $('mediaImg');
const mediaLayer = $('mediaLayer');
const qr = $('qr');
const cursor = $('cursor');
const cursorRing = $('cursorRing');
const phone = $('phone');
const phoneImg = $('phoneImg');
const type = $('type');
const end = $('end');
const glow = $('glow');

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 4);
const easeInOut = (x) => {
  const v = clamp(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
const px = (name) => parseFloat(getComputedStyle(frame).getPropertyValue(name));

// ---------- Text with one coloured phrase (*...*), word by word ----------

function wordsHtml(text, accent) {
  const out = [];
  let em = false;
  for (const raw of text.split(' ')) {
    let word = raw;
    const opens = word.startsWith('*');
    if (opens) word = word.slice(1);
    const closes = word.endsWith('*');
    if (closes) word = word.slice(0, -1);
    if (opens) em = true;
    out.push(`<span class="w">${em ? `<em class="accent-${accent}">${word}</em>` : word}</span>`);
    if (closes) em = false;
  }
  return out.join(' ');
}

/** Word entrance: each word rises out of a blur, 60 ms after the one before. */
function animateWords(container, local) {
  container.querySelectorAll('.w').forEach((word, i) => {
    const p = easeOut((local - i * 0.06) / 0.5);
    word.style.opacity = String(p);
    word.style.transform = `translateY(${(1 - p) * 0.45}em)`;
    word.style.filter = `blur(${(1 - p) * 14}px)`;
  });
}

/** 1 while the scene runs, falling to 0 over its last `span` seconds (the exit), with a lift. */
const exitOf = (scene, t, span = 0.22) => (scene.id === 'end' ? 1 : clamp((scene.end - t) / span));

// ---------- Clip framing: a rect of the capture fitted into the media box ----------

function rectAt(scene, local) {
  const key = format === 'landscape' ? 'r' : 'v';
  const frames = scene.rects;
  const pick = (k) => k[key] ?? k.r;
  if (local <= frames[0].at) return pick(frames[0]);
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (local <= b.at) {
      const p = easeInOut((local - a.at) / (b.at - a.at));
      return pick(a).map((v, j) => v + (pick(b)[j] - v) * p);
    }
  }
  return pick(frames[frames.length - 1]);
}

function viewFor(rect) {
  const boxW = px('--box-w');
  const boxH = px('--box-h');
  const [rx, ry, rw, rh] = rect;
  let s = Math.min(boxW / rw, boxH / rh);
  s = Math.max(s, boxW / 1920, boxH / 1080);
  const vw = boxW / s;
  const vh = boxH / s;
  const x0 = clamp(rx + rw / 2 - vw / 2, 0, 1920 - vw);
  const y0 = clamp(ry + rh / 2 - vh / 2, 0, 1080 - vh);
  return { s, x0, y0, boxW, boxH };
}

// ---------- Cursor from the recorded pointer log ----------

const pointerLogs = {};
async function loadPointers() {
  for (const scene of scenes) {
    if (scene.kind !== 'clip') continue;
    try {
      const response = await fetch(`../captures/${scene.clip}.cursor.json`);
      pointerLogs[scene.clip] = response.ok ? (await response.json()).events : [];
    } catch {
      pointerLogs[scene.clip] = [];
    }
  }
}

function pointerAt(events, srcT) {
  if (!events?.length || srcT < events[0].t) return null;
  let i = 0;
  while (i < events.length - 1 && events[i + 1].t <= srcT) i++;
  const a = events[i];
  const b = events[i + 1];
  let x = a.x;
  let y = a.y;
  if (b && b.t - a.t < 0.25) {
    const p = (srcT - a.t) / (b.t - a.t);
    x = a.x + (b.x - a.x) * p;
    y = a.y + (b.y - a.y) * p;
  }
  const down = events.filter((e) => e.action === 'down' && e.t <= srcT && srcT - e.t < 0.5).pop();
  return { x, y, press: down ? (srcT - down.t) / 0.5 : null };
}

// ---------- Frames ----------

const frameSrc = (scene, local) => {
  const index = clamp(
    Math.floor(local * FPS + 1e-6) + 1,
    1,
    Math.round((scene.end - scene.start + 0.2) * FPS),
  );
  return `../work/frames/${scene.id}/${String(index).padStart(4, '0')}.jpg`;
};

let lastCaptionScene = null;
let lastTypeKey = null;

function hideAll() {
  media.style.opacity = '0';
  phone.style.opacity = '0';
  type.style.opacity = '0';
  end.style.opacity = '0';
  caption.style.opacity = '0';
}

async function renderFrame(t) {
  const scene = scenes.find((s) => t >= s.start && t < s.end) ?? scenes[scenes.length - 1];
  const local = t - scene.start;
  const out = exitOf(scene, t);
  const waits = [];
  hideAll();

  glow.style.setProperty('--gx', `${30 + 14 * Math.sin(t * 0.35)}%`);
  glow.style.setProperty('--gy', `${22 + 8 * Math.cos(t * 0.27)}%`);
  glow.style.setProperty('--hx', `${78 + 10 * Math.cos(t * 0.31)}%`);
  glow.style.setProperty('--hy', `${82 + 6 * Math.sin(t * 0.23)}%`);

  // Caption of clip and phone scenes.
  if (scene.caption) {
    if (lastCaptionScene !== scene.id) {
      caption.innerHTML = wordsHtml(scene.caption, scene.accent);
      lastCaptionScene = scene.id;
    }
    caption.style.opacity = String(out);
    caption.style.transform = `translateY(${(1 - out) * -24}px)`;
    animateWords(caption, local);
  }

  if (scene.kind === 'clip') {
    const p = easeOut(local / 0.45);
    media.style.opacity = String(p * out);
    media.style.transform = `translateY(${(1 - p) * 60 + (1 - out) * -30}px) scale(${0.94 + 0.06 * p})`;
    media.style.filter = `blur(${(1 - p) * 16 + (1 - out) * 10}px)`;
    const view = viewFor(rectAt(scene, local));
    mediaLayer.style.transform = `translate(${-view.x0 * view.s}px, ${-view.y0 * view.s}px) scale(${view.s})`;
    qr.style.display = scene.coverQr ? 'block' : 'none';
    const src = frameSrc(scene, local);
    if (!mediaImg.src.endsWith(src.slice(2))) {
      mediaImg.src = src;
      waits.push(mediaImg.decode().catch(() => {}));
    }
    const pointer = pointerAt(pointerLogs[scene.clip], scene.src + local);
    if (pointer) {
      const cx = (pointer.x - view.x0) * view.s;
      const cy = (pointer.y - view.y0) * view.s;
      const inside = cx > -10 && cy > -10 && cx < view.boxW && cy < view.boxH;
      cursor.style.opacity = inside ? '1' : '0';
      const press = pointer.press;
      const scale = press === null ? 1 : 1 - 0.18 * Math.sin(Math.PI * clamp(press * 2));
      cursor.style.transform = `translate(${cx - 6}px, ${cy - 4}px) scale(${scale})`;
      cursorRing.setAttribute('r', String(press === null ? 0 : 6 + 26 * easeOut(press)));
      cursorRing.style.opacity = press === null ? '0' : String(1 - press);
    } else {
      cursor.style.opacity = '0';
    }
  }

  if (scene.kind === 'phone') {
    const p = easeOut(local / 0.5);
    phone.style.opacity = String(p * out);
    phone.querySelector('.phone__body').style.transform =
      `translateY(${(1 - p) * 120}px) rotate(${(1 - p) * 4}deg)`;
    const src = frameSrc(scene, local);
    if (!phoneImg.src.endsWith(src.slice(2))) {
      phoneImg.src = src;
      waits.push(phoneImg.decode().catch(() => {}));
    }
  }

  if (scene.kind === 'type' || scene.kind === 'facts') {
    const items = scene.lines ?? scene.items;
    const key = `${scene.id}`;
    if (lastTypeKey !== key) {
      type.innerHTML = items
        .map(
          (item) =>
            `<p class="${item.big ? 'big' : ''}">${wordsHtml(item.text, item.accent ?? 'red')}</p>`,
        )
        .join('');
      lastTypeKey = key;
    }
    type.style.opacity = String(out);
    type.style.transform = `translateY(${(1 - out) * -30}px)`;
    type.querySelectorAll('p').forEach((line, i) => {
      animateWords(line, local - items[i].at);
      // In the hook the first line steps back when the punchline lands.
      if (scene.kind === 'type' && i === 0)
        line.style.opacity = String(1 - 0.55 * easeOut((local - items[1].at) / 0.4));
    });
  }

  if (scene.kind === 'end') {
    end.style.opacity = '1';
    Array.from(end.children).forEach((child, i) => {
      const p = easeOut((local - i * 0.12) / 0.6);
      child.style.opacity = String(p);
      child.style.transform = `translateY(${(1 - p) * 40}px)`;
      child.style.filter = `blur(${(1 - p) * 12}px)`;
    });
  }

  await Promise.all(waits);
}

window.renderFrame = renderFrame;
window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.fonts].map((f) => f.load()));
  await loadPointers();
  await Promise.all(
    [...document.images].map((img) => (img.complete ? null : img.decode().catch(() => {}))),
  );
  return { format, width: frame.offsetWidth, height: frame.offsetHeight };
})();
