// StudioFlow product site: reveal and scroll motion, the hero parallax, the Take demo, the pinned incident sequence, the
// typing terminal, copy buttons, the prototype loader and the latest release. No tracking, no cookies; the only request to
// another host is the optional GitHub API call for the latest release.
import welcome from '../assets/ui/welcome.webp';
import presentation from '../assets/ui/program.webp';
import interview from '../assets/ui/preview.webp';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

// ---------- Theme ----------

const themeButton = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
const syncTheme = (): void => {
  const dark = document.documentElement.dataset['theme'] !== 'light';
  themeButton?.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0b0e13' : '#f7f8fa');
};
themeButton?.addEventListener('click', () => {
  const next = document.documentElement.dataset['theme'] === 'light' ? 'dark' : 'light';
  document.documentElement.dataset['theme'] = next;
  try {
    localStorage.setItem('studioflow.site.theme', next);
  } catch {
    // Storage can be blocked; the choice then lasts for this page view.
  }
  syncTheme();
});
syncTheme();

// ---------- Headlines word by word, reveals ----------

for (const heading of document.querySelectorAll<HTMLElement>('[data-split]')) {
  let index = 0;
  const split = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? '').split(/(\s+)/);
        const fragment = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            fragment.append(document.createTextNode(part));
            continue;
          }
          const outer = document.createElement('span');
          outer.className = 'w';
          const inner = document.createElement('span');
          inner.style.setProperty('--i', String(index++));
          inner.textContent = part;
          outer.append(inner);
          fragment.append(outer);
        }
        child.replaceWith(fragment);
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName !== 'BR') {
        split(child);
      }
    }
  };
  heading.setAttribute('aria-label', heading.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  split(heading);
  for (const word of heading.querySelectorAll('.w')) word.setAttribute('aria-hidden', 'true');
}

const revealables = document.querySelectorAll<HTMLElement>('[data-reveal], [data-split]');
if (reduced || !('IntersectionObserver' in window)) {
  for (const element of revealables) element.classList.add('is-in');
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  for (const element of revealables) observer.observe(element);
}

// ---------- Scroll-linked progress (--p from 0 to 1) ----------

const nav = document.querySelector<HTMLElement>('[data-nav]');
const hero = document.querySelector<HTMLElement>('[data-hero]');
const stage = hero?.querySelector<HTMLElement>('.stage');
const progressed = Array.from(document.querySelectorAll<HTMLElement>('[data-progress]'));
const incident = document.querySelector<HTMLElement>('[data-incident]');

const progressOf = (element: HTMLElement): number => {
  const rect = element.getBoundingClientRect();
  const view = window.innerHeight;
  // Pinned sections run from their top reaching the top of the viewport to their end; the others from entering to leaving.
  if (element.matches('[data-incident], [data-statement], [data-net]'))
    return clamp(-rect.top / (rect.height - view));
  return clamp((view - rect.top) / (view + rect.height));
};

// ---------- Signal path in 3D ----------

const net = document.querySelector<HTMLElement>('[data-net]');
const netStage = net?.querySelector<HTMLElement>('[data-net-stage]');
const board = net?.querySelector<HTMLElement>('[data-board]');
const ease = (t: number): number => t * t * (3 - 2 * t);
const deg = Math.PI / 180;

// Scale the plate so its finished isometric view fits the stage; the camera angles come from the CSS.
const measureNet = (): void => {
  if (!netStage || !board) return;
  const style = getComputedStyle(netStage);
  const camX = parseFloat(style.getPropertyValue('--cam-x')) * deg;
  const camZ = Math.abs(parseFloat(style.getPropertyValue('--cam-z'))) * deg;
  const w = board.offsetWidth;
  const h = board.offsetHeight;
  const wide = w * Math.cos(camZ) + h * Math.sin(camZ);
  const tall = (w * Math.sin(camZ) + h * Math.cos(camZ)) * Math.cos(camX) + 320 * Math.sin(camX);
  const k = Math.min(
    1.1,
    (netStage.clientWidth * 0.96) / wide,
    (netStage.clientHeight * 0.96) / tall,
  );
  netStage.style.setProperty('--k', k.toFixed(4));
};

const paintNet = (p: number): void => {
  if (!net || !netStage) return;
  const set = (name: string, value: number): void =>
    netStage.style.setProperty(name, value.toFixed(4));
  set('--tilt', ease(clamp(p / 0.26)));
  set('--rise', clamp((p - 0.06) / 0.3));
  set('--draw', clamp((p - 0.3) / 0.24));
  set('--explode', ease(clamp((p - 0.56) / 0.22)));
  netStage.style.setProperty('--orbit', `${((p - 0.5) * 16).toFixed(2)}deg`);
  net.dataset['stage'] = String(p < 0.3 ? 0 : p < 0.56 ? 1 : p < 0.8 ? 2 : 3);
};
measureNet();

const film = document.querySelector<HTMLElement>('[data-film]');
const filmFrame = film?.querySelector<HTMLElement>('.film__frame');

// How much the film frame has to scale to fill the viewport width; only changes on resize.
const measureFilm = (): void => {
  if (!film || !filmFrame) return;
  film.style.setProperty(
    '--grow',
    (document.documentElement.clientWidth / film.clientWidth).toFixed(4),
  );
};
measureFilm();

const onScroll = (): void => {
  nav?.classList.toggle('is-scrolled', window.scrollY > 24);
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  nav?.style.setProperty('--sp', clamp(window.scrollY / Math.max(1, scrollable)).toFixed(4));
  if (reduced) {
    // Without motion the pinned sections are plain blocks, shown in their final state.
    for (const element of progressed) element.style.setProperty('--p', '1');
    if (incident) incident.dataset['stage'] = '4';
    paintNet(1);
    return;
  }
  for (const element of progressed) {
    const p = progressOf(element);
    element.style.setProperty('--p', p.toFixed(4));
    if (element === net) paintNet(p);
  }
  if (incident)
    incident.dataset['stage'] = String(Math.min(4, Math.floor(progressOf(incident) * 5)));
  if (stage && hero)
    stage.style.setProperty('--sy', clamp(window.scrollY / hero.offsetHeight).toFixed(3));
};

let queued = false;
const schedule = (): void => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    onScroll();
  });
};
addEventListener('scroll', schedule, { passive: true });
addEventListener('resize', () => {
  measureFilm();
  measureNet();
  schedule();
});
// The pointer turns the camera a little around the model.
if (!reduced && netStage && matchMedia('(hover: hover)').matches) {
  netStage.addEventListener('pointermove', (event) => {
    const rect = netStage.getBoundingClientRect();
    netStage.style.setProperty('--ox', ((event.clientX - rect.left) / rect.width - 0.5).toFixed(3));
    netStage.style.setProperty('--oy', ((event.clientY - rect.top) / rect.height - 0.5).toFixed(3));
  });
  netStage.addEventListener('pointerleave', () => {
    netStage.style.setProperty('--ox', '0');
    netStage.style.setProperty('--oy', '0');
  });
}
onScroll();

// ---------- Hero parallax and spotlight on the pointer ----------

const aurora = document.querySelector<HTMLElement>('[data-aurora]');
const fine = matchMedia('(hover: hover)').matches;

if (!reduced && stage && fine) {
  hero?.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    stage.style.setProperty('--mx', ((event.clientX - rect.left) / rect.width - 0.5).toFixed(3));
    stage.style.setProperty('--my', ((event.clientY - rect.top) / rect.height - 0.5).toFixed(3));
  });
  hero?.addEventListener('pointerleave', () => {
    stage.style.setProperty('--mx', '0');
    stage.style.setProperty('--my', '0');
  });
}
if (!reduced && aurora && fine) {
  addEventListener(
    'pointermove',
    (event) => {
      const rect = aurora.getBoundingClientRect();
      if (event.clientY > rect.bottom) return;
      aurora.style.setProperty('--sx', `${event.clientX - rect.left}px`);
      aurora.style.setProperty('--sy', `${event.clientY - rect.top}px`);
    },
    { passive: true },
  );
}

// ---------- Ticker: drifts by itself, the scroll pushes it and leans the words ----------

const ticker = document.querySelector<HTMLElement>('[data-ticker]');
if (ticker && !reduced) {
  const tracks = Array.from(ticker.querySelectorAll<HTMLElement>('.ticker__track'));
  const speeds = [70, -55]; // px per second; the second band runs the other way
  let visible = false;
  let last = performance.now();
  let lastScroll = window.scrollY;
  let lean = 0;
  const offsets = tracks.map(() => 0);
  const tick = (now: number): void => {
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const delta = window.scrollY - lastScroll;
    lastScroll = window.scrollY;
    lean += (clamp(delta * -0.35, -14, 14) - lean) * 0.12;
    tracks.forEach((track, index) => {
      const half = track.scrollWidth / 2;
      const direction = Math.sign(speeds[index]!);
      offsets[index] = (offsets[index]! + speeds[index]! * dt + delta * 1.4 * direction) % half;
      if (offsets[index]! < 0) offsets[index]! += half;
      track.style.setProperty('--x', offsets[index]!.toFixed(1));
    });
    ticker.style.setProperty('--skew', lean.toFixed(2));
    requestAnimationFrame(tick);
  };
  new IntersectionObserver(([entry]) => {
    const was = visible;
    visible = !!entry?.isIntersecting;
    if (visible && !was) {
      last = performance.now();
      lastScroll = window.scrollY;
      requestAnimationFrame(tick);
    }
  }).observe(ticker);
}

// ---------- Feature cards: tilt and a light that follows the pointer ----------

if (!reduced && fine) {
  for (const card of document.querySelectorAll<HTMLElement>('.feature')) {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      card.style.setProperty('--px', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--py', `${(y * 100).toFixed(1)}%`);
      card.style.setProperty('--tx', (x - 0.5).toFixed(3));
      card.style.setProperty('--ty', (y - 0.5).toFixed(3));
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--tx', '0');
      card.style.setProperty('--ty', '0');
    });
  }
}

// ---------- Magnetic primary buttons ----------

if (!reduced && fine) {
  for (const pill of document.querySelectorAll<HTMLElement>('.pill--fill, .take')) {
    pill.addEventListener('pointermove', (event) => {
      const rect = pill.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * 0.22;
      const y = (event.clientY - rect.top - rect.height / 2) * 0.32;
      pill.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    });
    pill.addEventListener('pointerleave', () => {
      pill.style.translate = '';
    });
  }
}

// ---------- Take demo ----------

interface Scene {
  name: string;
  image: string;
  alt: string;
}
const sceneList: Record<string, Scene> = {
  welcome: { name: 'Welcome', image: welcome, alt: 'Welcome: the camera of Lea, full screen' },
  presentation: {
    name: 'Presentation',
    image: presentation,
    alt: 'Presentation: a slide with the camera as picture in picture',
  },
  interview: { name: 'Interview', image: interview, alt: 'Interview: two cameras side by side' },
};

const switcher = document.querySelector<HTMLElement>('[data-switcher]');
if (switcher) {
  const pvw = switcher.querySelector<HTMLImageElement>('[data-pvw]')!;
  const pgm = switcher.querySelector<HTMLImageElement>('[data-pgm]')!;
  const next = switcher.querySelector<HTMLImageElement>('[data-pgm-next]')!;
  const pgmScreen = pgm.parentElement!;
  const pvwName = switcher.querySelector<HTMLElement>('[data-pvw-name]')!;
  const pgmName = switcher.querySelector<HTMLElement>('[data-pgm-name]')!;
  const status = switcher.querySelector<HTMLElement>('[data-switch-status]')!;
  const take = switcher.querySelector<HTMLButtonElement>('[data-take]')!;
  const buttons = Array.from(switcher.querySelectorAll<HTMLButtonElement>('[data-scene-btn]'));
  let preview = 'interview';
  let program = 'presentation';
  let userTouched = false;

  const paint = (): void => {
    const p = sceneList[preview]!;
    pvw.src = p.image;
    pvw.alt = `Preview: ${p.alt}`;
    pvwName.textContent = p.name;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset['sceneBtn'] === preview));
      button.dataset['onAir'] = String(button.dataset['sceneBtn'] === program);
    }
  };

  const doTake = (): void => {
    if (take.disabled) return;
    const incoming = sceneList[preview]!;
    const outgoing = program;
    take.disabled = true;
    next.src = incoming.image;
    const finish = (): void => {
      pgm.src = incoming.image;
      pgm.alt = `Program: ${incoming.alt}`;
      pgmName.textContent = incoming.name;
      pgmScreen.classList.remove('is-fading');
      program = preview;
      preview = outgoing;
      paint();
      status.textContent = `${incoming.name} is on air.`;
      take.disabled = false;
    };
    if (reduced) {
      finish();
      return;
    }
    pgmScreen.classList.remove('is-cut');
    switcher.classList.remove('is-taking');
    void pgmScreen.offsetWidth;
    pgmScreen.classList.add('is-fading', 'is-cut');
    switcher.classList.add('is-taking');
    setTimeout(finish, 620);
  };

  take.addEventListener('click', () => {
    userTouched = true;
    doTake();
  });
  for (const button of buttons) {
    button.addEventListener('click', () => {
      userTouched = true;
      const id = button.dataset['sceneBtn']!;
      if (id === program) {
        status.textContent = `${sceneList[id]!.name} is already on air.`;
        return;
      }
      preview = id;
      paint();
      status.textContent = `${sceneList[id]!.name} is in the preview. Press Take.`;
    });
  }
  paint();

  // While nobody has touched it, the demo switches by itself when it is on screen.
  if (!reduced && 'IntersectionObserver' in window) {
    let timer = 0;
    const order = ['welcome', 'presentation', 'interview'];
    new IntersectionObserver(
      ([entry]) => {
        clearInterval(timer);
        if (!entry?.isIntersecting) return;
        timer = window.setInterval(() => {
          if (userTouched) return clearInterval(timer);
          const candidates = order.filter((id) => id !== program);
          preview = candidates[Math.floor(Math.random() * candidates.length)]!;
          paint();
          setTimeout(() => !userTouched && doTake(), 900);
        }, 3600);
      },
      { threshold: 0.6 },
    ).observe(switcher);
  }
}

// ---------- Terminal ----------

const term = document.querySelector<HTMLElement>('[data-term]');
const termOut = term?.querySelector<HTMLElement>('[data-term-out]');
type Line = { type: 'cmd' | 'out'; text: string; cls?: string };
const script: Line[] = [
  { type: 'cmd', text: 'docker compose up -d' },
  { type: 'out', text: '[+] Running 6/6', cls: 'dim' },
  { type: 'out', text: ' ✔ Container studioflow-init-1      Exited', cls: 'ok' },
  { type: 'out', text: ' ✔ Container studioflow-postgres-1  Healthy', cls: 'ok' },
  { type: 'out', text: ' ✔ Container studioflow-livekit-1   Started', cls: 'ok' },
  { type: 'out', text: ' ✔ Container studioflow-api-1       Healthy', cls: 'ok' },
  { type: 'out', text: ' ✔ Container studioflow-caddy-1     Started', cls: 'ok' },
  { type: 'out', text: ' ✔ Container studioflow-backup-1    Started', cls: 'ok' },
  { type: 'cmd', text: 'docker compose logs api | grep "Setup code"' },
  { type: 'out', text: 'api-1  | Setup code: XXXX-XXXX', cls: 'hi' },
];

const renderLine = (line: Line, text: string): string => {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return line.type === 'cmd'
    ? `<span class="p">$</span> ${safe}`
    : `<span class="${line.cls ?? ''}">${safe}</span>`;
};

if (term && termOut) {
  const full = script.map((line) => renderLine(line, line.text)).join('\n');
  if (reduced || !('IntersectionObserver' in window)) {
    termOut.innerHTML = full;
  } else {
    const type = async (): Promise<void> => {
      const done: string[] = [];
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      for (const line of script) {
        if (line.type === 'cmd') {
          for (let i = 1; i <= line.text.length; i++) {
            termOut.innerHTML = [
              ...done,
              `${renderLine(line, line.text.slice(0, i))}<span class="caret"></span>`,
            ].join('\n');
            await wait(38 + Math.random() * 40);
          }
          await wait(350);
        } else {
          await wait(line.cls === 'ok' ? 160 : 260);
        }
        done.push(renderLine(line, line.text));
        termOut.innerHTML = done.join('\n');
      }
      termOut.innerHTML = `${done.join('\n')}\n<span class="p">$</span> <span class="caret"></span>`;
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        void type();
      },
      { threshold: 0.4 },
    );
    observer.observe(term);
  }
}

// ---------- Copy buttons ----------

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset['copy'] ?? '');
      button.textContent = 'Copied';
      button.dataset['state'] = 'done';
    } catch {
      button.textContent = 'Select it';
    }
    setTimeout(() => {
      button.textContent = 'Copy';
      delete button.dataset['state'];
    }, 1800);
  });
}

// ---------- Prototype, loaded only on request ----------

document.querySelector('[data-demo-load]')?.addEventListener('click', () => {
  const holder = document.querySelector<HTMLElement>('[data-demo]');
  if (!holder) return;
  const frame = document.createElement('iframe');
  frame.src = './studioflow-prototype.html';
  frame.title = 'StudioFlow Regie prototype (synthetic data)';
  holder.replaceChildren(frame);
  frame.focus();
});

// ---------- Latest release (optional) ----------

void (async () => {
  try {
    const response = await fetch('https://api.github.com/repos/OPTEN/StudioFlow/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;
    const release = (await response.json()) as { tag_name?: string };
    if (!release.tag_name) return;
    const meta = document.querySelector('[data-release-meta]');
    if (meta)
      meta.textContent = `Latest: ${release.tag_name.replace(/^v/, '')}. Ready-made images on GitHub Container Registry.`;
  } catch {
    // Offline, private repository or rate limited: the static text stays.
  }
})();
