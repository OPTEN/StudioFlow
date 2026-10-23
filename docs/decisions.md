# Decisions for issues #3–#19

Decisions taken on 2026-10-23 for the open "To decide" points of the GitHub issues #3–#19, so the implementation
can proceed without waiting. Each decision follows the suggestion in the issue unless a reason is given. Change a
decision deliberately: update this file and the code together.

## Order of implementation

1. #15 CI (safety net) and #3 rename, then #6 English/i18n (each file changed once).
2. Features: #4 first-run setup, #10 light mode, #19 drag and drop, #17 audit log, #11 camera control,
   #12 performance, #13 text source, #8 format, #7 audio.
3. Built on the features: #14 duplicate/export, #9 virtual camera, #16 backups and Renovate, #18 releases, #5 README.
4. Full long-run test of the whole application; every defect becomes a GitHub issue and is fixed.

## #3 Rename FlowStudio → StudioFlow

1. The abbreviation `fs` becomes `sf` (selectors `sf-*`, renderer classes `sf-r-*`, cookie `sf_session`,
   E2E compose project `sf-e2e`, browser hooks `window.__sf…`).
2. Example domain: `studioflow.opten.ch`.
3. Hard switch without migration: only test and demo stacks exist. New volume names, database and user `studioflow`,
   new `localStorage` keys `studioflow.*` (paired phones pair again).
4. The GitHub repository rename `OPTEN/FlowStudio` → `OPTEN/StudioFlow` is a repository setting and is left to the
   owner; GitHub redirects the old URLs afterwards.

## #6 English

1. English is the source language. A small typed i18n layer (`packages/i18n`) carries English messages and German
   (`de-CH`) as the first translation; the locale follows a user setting with the browser language as default.
   Number and date formatting use the active locale.
2. The internal planning document `plan/*.html` moves unchanged to `docs/history/` as a historical German document.

## #7 Audio

1. MVP sources: one audio station (mixing desk feed), screen audio and video asset audio. Device microphones are
   available but muted by default.
2. The proxy is assumed to be an OBS browser source with "Control audio via OBS"; the runbook says so.
3. One global mixer per production plus "follows the picture" per channel. Levels per scene later.
4. No separate preview mix in studio mode, only PFL per channel.
5. Silence detection: a warning (not an incident) when an audible channel has been silent for more than 10 s.

## #8 Format and resolution

1. Formats from a fixed list (16:9, 9:16, 1:1, 4:3) with fixed target resolutions per format.
2. Fixed list, no free values.
3. One format per production.
4. Default for new productions: 16:9 · 1080p.

## #9 Virtual camera

1. Stage 1 only (OBS as the bridge: guide, ready-made OBS scene collection). Stage 2 only with a concrete reason.
2. Audio for Teams keeps coming from the mixing desk for now.
3. Several named output links per production, each individually revocable with its own IP restriction.
4. OBS and Teams run on a separate machine, not on the Regie laptop; the runbook recommends this.

## #10 Light mode

1. Default "Dark".
2. Switching is allowed during a broadcast (display setting only).

## #11 Remote camera control

1. Implemented now with capability detection (`MediaStreamTrack.getCapabilities()`); controls the device does not
   support are hidden. A spike with real phones is a manual test (`docs/testing.md` section 4).
2. Phones only, no PTZ webcams.
3. The last command wins, wherever it comes from; the Regie always shows the actual value.
4. Settings per device, no per-scene presets.

## #12 Performance

1. Measure first with a reproducible harness (fake devices, fixed source counts), then optimise by measurement.
2. Preloading: the preview scene is immediate; other scenes may take about 0.5 s.
3. Scene thumbnails as still images are fine.

## #13 Text and lower thirds

1. Three fixed styles plus production colours.
2. Custom fonts later (separate issue); the built-in font first.
3. No timer or countdown here.
4. No global overlays yet; text items live in scenes.

## #14 Duplicate and export/import

1. Device items become placeholders.
2. "Duplicate" only; a template is a production named "Template …".
3. Export always includes media.

## #15 CI

1. E2E smoke runs in every PR and on `main`.
2. The nightly full run runs on working days only while the repository is private.
3. No self-hosted runner; device and latency tests stay manual.

## #16 Backups and dependency updates

1. The second target is optional and configured as an `rclone` remote; without it the backup stays local and the
   readiness check warns.
2. Database daily, media incrementally with `rclone` (only new files).
3. Renovate.

## #17 Audit log

1. Retention 365 days; IP addresses in login entries are removed after 90 days.
2. Own page, not a dock.

## #18 Releases

1. Every commit on `main` publishes images `:main` and `:sha-…`; the release itself (version, tag, GitHub release)
   comes from an automatically maintained release PR (release-please).
2. Conventional Commits, enforced by a PR title check.
3. Registry: GHCR.
4. Images are published only under the new name (after #3).
5. amd64 only; arm64 can be added to the build matrix later.

## #19 Drag and drop

1. The Scenes dock gets the same drag-and-drop list component.
2. No layer dragging in the monitor.
