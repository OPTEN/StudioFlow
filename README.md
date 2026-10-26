# StudioFlow

[![CI](https://github.com/OPTEN/FlowStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/OPTEN/FlowStudio/actions/workflows/ci.yml)

StudioFlow is a web-based Regie (control room) modelled on OBS, made for webinars.

- Phones and laptops send camera and screen directly from the browser.
- The Regie composes scenes from them.
- A 16:9 output runs as an iframe at the proxy, which distributes the picture to about 30 people.
- Everything runs in one Docker Compose stack on your own server.

As of 22 October 2026: the plan and the clickable Regie prototype are done. There is no product code yet.

## What is where

| Path | Content |
|---|---|
| `docs/history/FlowStudio Architekturplan.html` | Architecture and plan, draft 2 (historical, German, unmaintained). Open it in a browser. |
| `docs/history/regie-*.png` | Images of the Regie in the plan |
| `docs/history/archiv/` | Earlier version (draft 1 of 21 October 2026) |
| `docs/runbook.md` | Operations guide, including the installation from the ready-made images of a release |
| `docs/releasing.md` | Versions, Conventional Commits, Docker images and the release process |
| `prototype/regie.html` | Clickable Regie prototype with sample data |
| `prototype/fonts/` | Fonts of the prototype with licence texts (SIL Open Font License) |
| `PRODUCT.md` | Product context: users, purpose, principles |
| `DESIGN.md`, `.impeccable/design.json` | Design system of the Regie |
| `.impeccable/surfaces/prototype-regie-html.md` | Brief and design contract of the Regie |
| `.impeccable/review/` | Screenshots of all views, basis of the reviews |
| `.impeccable/qualitybar/`, `.impeccable/decision-payload.json` | The chosen direction “Dark console” («Dunkle Konsole» in these files) and the decision round for it |
| `tools/` | Scripts for screenshots and artifact versions |

## Online

Both pages are private. You can share them with “Share” on the respective page.

- Plan: https://claude.ai/artifact/FKKxDiTsDcu2nfYqfEQRGP
- Prototype: https://claude.ai/artifact/AAF59C3MX62bjKvW2B4UYu

## Using the prototype

1. Open `prototype/regie.html` in the browser. This also works offline, because the fonts sit in the folder.
2. Open specific views directly with these anchors: `#studio`, `#incident`, `#pair`, `#docks`. They can be combined with `+`, for example `regie.html#studio+incident`. The former German names `#stoerung` and `#koppeln` still work.
3. The “Prototype” menu plays incidents and a pairing request. “Reset everything” also resets the layout and Studio Mode.

## Decisions in brief

**Operations**

- One Docker Compose stack with Caddy, ASP.NET Core API, LiveKit and PostgreSQL. Data lives in volumes, there are no cloud services.
- It runs locally with Docker or on a VPS in production.
- Every commit on `main` publishes Docker images; a release (version, tag, GitHub release) comes from a release pull request, and servers pull the images instead of building. Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat: ...`, `fix: ...`); see `docs/releasing.md`.
- Login with one account that is created in the first-run setup of the Regie (stored in the database), without SSO.
- All devices are on site on the same Wi-Fi. HTTPS is used anyway, through a subdomain and DNS challenge.

**Output and audio**

- The output goes through a secret link that can be revoked, to one consumer, the proxy.
- Air mode stays a reserve for later.
- Audio runs externally through a mixing desk. The architecture stays prepared for audio.

**Regie**

- One continuous dark console without boxes and without frames.
- Studio Mode as in OBS, off by default. Then a click on a scene goes live directly.
- No T-bar: there is Cut or Fade, and a fade always runs to completion.
- The scenes sit at the bottom next to the sources.
- All docks can be moved (bottom, left, right), resized and hidden. The browser remembers the layout.
- Fonts and assets come from the project's own build, without a CDN.

**Pairing devices**

- Phones by QR code.
- Laptops by short URL `/join` with a verification code and approval in the Regie, or by one-time invite link.

**Language**

- The interface is English by default, with German (Switzerland) as the first translation. It follows the user setting, the browser language by default. Documentation is English.

## Open

- **Proxy:** What exactly is the proxy, for example a browser source? Whether air mode becomes necessary depends on this.
- **Certificate:** Which domain and which DNS provider, for example `studioflow.opten.ch`?
- **Server:** Does it run on the Regie laptop or on the VPS? Recommendation: a VPS or a second computer connected by cable.
- **Empty artifact:** The empty design artifact “StudioFlow Regie” (https://claude.ai/artifact/NkhevB8Mp4ez2SmZoufRkN) is not needed and can be deleted.
- **Docks:** Dragging and docking have been tested by hand, but not captured as a screenshot.

## Next step

Phase 0 is a technical trial run (details in the plan, section 9):

- Set up the Compose stack.
- Set up HTTPS on the Wi-Fi.
- Send a phone through the SFU to the browser and measure the glass-to-glass latency.
- Test reconnect.

## Tools

**Screenshots of all views** to `.impeccable/review/`. Needs Microsoft Edge, and ffmpeg in addition for `mobile.png`.

```
pwsh tools/capture.ps1
```

**Create an artifact version.** The script removes doctype, html, head and body. When publishing, include the extra files: `fonts/*` for the prototype, `regie-*.png` for the plan.

```
pwsh tools/make-artifact.ps1 -In prototype/regie.html -Out $env:TEMP/regie-artifact.html
```
