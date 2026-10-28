# Product site

The public landing page of StudioFlow on GitHub Pages: <https://opten.github.io/StudioFlow/> (issue 67). Plain HTML, CSS and
TypeScript, built with Vite. No framework, no tracking, no cookies; the only request to another host is the optional
GitHub API call for the latest release.

```bash
npm run start:site      # dev server, http://localhost:5173/StudioFlow/
npm run build:site      # dist/site, with studioflow-prototype.html and the font licences next to the page
npm run typecheck:site
node site/og/render.mjs # site/public/og.png from site/og/og.html
```

`.github/workflows/pages.yml` builds and deploys it on pushes to `main` that touch `site/`, the prototype or the
dependencies. The product video (issue 69, `video/`) is not in Git: the workflow downloads `studioflow.mp4`,
`studioflow-vertical.mp4` and `studioflow.vtt` from the release `product-video` into `site/public/media` (git-ignored),
and `site/vite.config.ts` swaps the hero's film screenshot for the video when they are there.

## Look and motion

The site is a marketing page, not the console. `DESIGN.md` binds the Regie and the sender; here only its fonts and its
five state colours carry over.

- **Type:** Sofia Sans Semi Condensed at weight 900 for the display headlines (`.display`), self-hosted from
  `prototype/fonts`. Every headline has exactly one coloured phrase (`.hl--red`, `--green`, `--blue`, `--amber`,
  `--violet`), taken from the product's state colours. JetBrains Mono only for commands and code.
- **Ground:** near-black `#0b0e13` (dark, default) or `#f7f8fa` (light, from the theme button, stored per browser in
  `localStorage['studioflow.site.theme']`).
- **Imagery:** only real UI, cropped from captures of the running stack (`video/captures`, made by
  `tests/e2e/specs/ui/ui-product-video.spec.ts`) and from `docs/assets`. People and slides are synthetic. The QR code in
  `assets/ui/pairing.webp` is replaced by one that points to the site, so no test token is shown.
- **Motion** (all of it off under `prefers-reduced-motion`, where every section shows its final state):
  headlines rise word by word, blocks fade in from a blur, the hero's UI fragments float with pointer and scroll
  parallax, the Regie screenshot tilts up while scrolling, the Take demo switches by itself until someone touches it,
  "Wi-Fi drops" is a pinned sequence of four stages, the network diagram draws itself, the statement lights up line by
  line, and the terminal types the setup.

## Assets

| File | Source |
|---|---|
| `assets/regie.webp`, `regie-960.webp`, `public/hero-poster.webp` | `video/captures/still-regie-studio-dark.png` |
| `assets/ui/preview.webp`, `program.webp`, `welcome.webp`, `control.webp`, `stations.webp`, `templates.webp` | crops of the same still |
| `assets/ui/pairing.webp` | crop of `still-regie-pairing-qr.png`, QR code replaced (see above) |
| `assets/ui/obs.webp` | crop of `still-regie-output-obs.png` (the steps only, no addresses) |
| `assets/screenshot-sender.webp` | `docs/assets/screenshot-sender.png` |
| `public/og.png` | `og/og.html` |

Crops are made with ffmpeg (`-c:v libwebp -quality 88`). After a UI change, capture again and re-crop.
