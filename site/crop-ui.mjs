// Cuts the UI images of the site from the stills in video/captures (made by tests/e2e/specs/ui/ui-product-video.spec.ts)
// and writes them as PNG to the folder given; site/README.md converts them to WebP. Run from the repository root:
//   node site/crop-ui.mjs video/work/crops
// The rectangles are those of the 1920 x 1080 stills; after a UI change, check them against the new stills.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { renderSVG } from 'uqr';

const root = process.cwd();
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const still = (name) =>
  `data:image/png;base64,${readFileSync(join(root, 'video/captures', name)).toString('base64')}`;
const qr = `data:image/svg+xml;base64,${Buffer.from(renderSVG('https://opten.github.io/StudioFlow/', { ecc: 'M', border: 0 })).toString('base64')}`;

// name: [still, x, y, width, height, cover the QR tile?]
const crops = {
  'preview.png': ['still-regie-studio-dark.png', 16, 134, 838, 470],
  'program.png': ['still-regie-studio-dark.png', 871, 134, 838, 470],
  'welcome.png': ['still-regie-studio-dark.png', 16, 134, 419, 470],
  'control.png': ['still-regie-studio-dark.png', 1722, 176, 186, 204],
  'stations.png': ['still-regie-studio-dark.png', 1072, 662, 368, 210],
  'templates.png': ['still-regie-studio-dark.png', 672, 800, 392, 270],
  'pairing.png': ['still-regie-pairing-qr.png', 440, 664, 580, 300, true],
  'obs.png': ['still-regie-output-obs.png', 794, 716, 604, 326],
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, [source, x, y, w, h, cover]] of Object.entries(crops)) {
  await page.setViewportSize({ width: w, height: h });
  // The tile of the capture: white, 200 x 200 at x 450, y 758; the code inside starts 18 px from its edge.
  const tile = cover
    ? `<div style="position:absolute;left:${450 - x}px;top:${758 - y}px;width:200px;height:200px;box-sizing:border-box;padding:18px;background:#fff;border-radius:4px"><img src="${qr}" style="display:block;width:100%;height:100%;image-rendering:pixelated"></div>`
    : '';
  await page.setContent(
    `<body style="margin:0;overflow:hidden"><div style="position:relative;width:${w}px;height:${h}px;overflow:hidden"><img src="${still(source)}" style="position:absolute;left:${-x}px;top:${-y}px">${tile}</div></body>`,
  );
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.screenshot({ path: resolve(out, file) });
  console.log(file, w, h);
}
await browser.close();
