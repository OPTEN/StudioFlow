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

Implementation notes (2026-10-26): the resolution is named after the short side and the list is 720p and 1080p for every
format (16:9 1280×720 / 1920×1080, 9:16 720×1280 / 1080×1920, 1:1 720×720 / 1080×1080, 4:3 960×720 / 1440×1080). Item
bounds stay absolute (they cover every canvas). A change of format scales and centres the existing elements instead of
re-applying templates, because a scene does not remember its template; it is refused with 409 `broadcast_live` while the
broadcast is live and asks first in the Regie when scenes have elements. The publish resolution of phones does not depend
on the format: the output asks the sources for the size of an element on screen. 4:5 and the 1440p/4K resolutions of the
issue text are not offered (decision 1 fixes the list).

## #9 Virtual camera

1. Stage 1 only (OBS as the bridge: guide, ready-made OBS scene collection). Stage 2 only with a concrete reason.
2. Audio for Teams keeps coming from the mixing desk for now.
3. Several named output links per production, each individually revocable with its own IP restriction.
4. OBS and Teams run on a separate machine, not on the Regie laptop; the runbook recommends this.

Pinned details of the implementation: at most 10 links per production (`409 limit_reached`), names 1–40 characters and
unique ignoring case; "revoke" deletes the link (its key is invalid at once and only its pages are disconnected); the old
single key of a production became its first link "Proxy" in the migration; the OBS scene collection is generated in the
Regie (browser) from the link URL, so no endpoint is needed and the key is not handled anywhere new; its size comes from
one function (`obsCanvasSize()`), so the production format of #8 can replace 1920 × 1080 there; the target is OBS Studio
31 and 32.

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

Implementation details fixed with the work on #13 (spec 4.4, 8.3, 9.1):

5. A text is a source of its own (kind `text`, code `T1`, id `txt_…`, stored with the production), shown by scene items
   like a camera, so one lower third can be in several scenes and its content is edited in one place. Show and hide is the
   item's `hidden` flag.
6. A new text item starts **hidden**: the content is prepared before it goes on air, a typo never reaches the output by
   accident. Showing and hiding is an operation, not an edit: it also works on the live scene in Studio Mode and leaves no
   undo step.
7. Deleting a text removes it from every scene (the Regie says how many); there is no `text_in_use` conflict like for media.
8. The colours belong to the production (`textTheme`), not to a text; a contrast below 4.5 : 1 is a warning, never a block.
9. Not built in this step, as the issue marks them optional: hiding a text automatically after N seconds, a list of entries
   with "next" for one lower third, and a keyboard shortcut for show/hide (the digits are scenes and a hidden text has no
   focus target). Follow-ups if the operators ask for them.

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
3. Implementation: the page is `/audit` (production menu). The retention (`Audit:RetentionDays` 365, `Audit:IpRetentionDays`
   90) runs hourly in batches and waits while a broadcast is live. Exports are refused above 50 000 rows instead of cut
   short, and are rate limited. The phone QR invite, renewed every half hour, is no longer audited. The details are in
   spec 4.9 and runbook 17.

## #18 Releases

1. Every commit on `main` publishes images `:main` and `:sha-…`; the release itself (version, tag, GitHub release)
   comes from an automatically maintained release PR (release-please).
2. Conventional Commits, enforced by a PR title check.
3. Registry: GHCR.
4. Images are published only under the new name (after #3).
5. amd64 only; arm64 can be added to the build matrix later.
6. Where the version is shown: the Regie prints the version the **server** runs (`GET /api/system/info`) in the last row
   of the settings popover; the output page, which has no session, carries a build-time version
   (`package.json` plus the Docker build argument `STUDIOFLOW_REVISION`, `0.1.0+1a2b3c4`) and prints it as the **last**
   line of the `?debug=1` overlay, so that the lines above keep their positions. A build without a commit shows just the
   version. CI and the release workflow pass the commit to the `api` and `web` images alike (the same arguments, so the
   layer cache of CI serves the release build); the plain `docker compose build` of development passes none.

## #19 Drag and drop

1. The Scenes dock gets the same drag-and-drop list component.
2. No layer dragging in the monitor.

## #27 Zero-config install

Taken on 2026-10-26, following the recommendations of the issue.

1. Caddy gets its configuration from the API through the Caddy admin API, reachable only on the internal network.
   LiveKit runs in a thin wrapper image that watches `livekit.yaml` in a shared volume and restarts the server process
   on change. No Docker socket anywhere.
2. Default HTTPS port `8443` (tcp and udp), overridable with `STUDIOFLOW_HTTPS_PORT`; nothing listens on port 80.
3. `docker-compose.yml` (build from source) stays for development and is zero-config as well; `.env` is optional in
   both files.
4. The wizard covers account, media address, address and certificate, embedding. The backup schedule and the off-site
   `rclone` target are only in "Server settings", to keep the first run short.

### #6 pinned details

The details below were fixed for the parallel work on #6 (design: [architecture/i18n-design.md](architecture/i18n-design.md),
working guide: [i18n.md](i18n.md)). D3 and D5 are the two the owner should confirm.

1. **D1 Locales.** `en` (source) and `de-CH`. A browser tag `en` or `en-*` gives `en`; `de` or `de-*` (DE, AT, LI) gives
   `de-CH`; anything else gives `en`.
2. **D2 Setting.** `'auto' | 'en' | 'de-CH'` in `localStorage['studioflow.locale']`, the absent key meaning auto. Regie,
   `/monitoring` and sender share the key (one origin); a `storage` event switches other open tabs live. The output page
   ignores storage: `?lang=`, then `navigator.languages`, then `en`.
3. **D3 Decimal comma.** `Intl.NumberFormat('de-CH')` writes a point ("2.8", "1'234.5"), but the product convention is
   the comma. So `LOCALES['de-CH'].numberTag` is `de-DE` while `dateTag` stays `de-CH`. No thousands separators anywhere
   (the old formatting had none). One field changes if the owner prefers CLDR.
4. **D4 Clock.** Always 24 h (`hourCycle: 'h23'`), also in English (`numberTag 'en'`, `dateTag 'en-GB'`).
5. **D5 "Control room".** The English UI says "Control room" for the Regie; code, docs and file names keep "Regie" as a
   proper noun, glossed once as "Regie (control room)". The word is exempt from the German check.
6. **D6 Quotation marks.** English uses “…” and ’, German « » and ’; both live inside catalogue strings, never in code.
7. **D7 API texts.** English; clients localise by `code`. The UI never shows the server `detail` or field messages, except as
   a last resort for an unknown code. `ApiError.detail` stays for diagnostics.
8. **D8 Server defaults.** English, no contract change: scenes "Welcome", "Presentation", "Break"; slates "Starting soon" and
   "Thanks for watching"; label suffix "· Camera". A documented limitation; a follow-up can add optional seed texts to
   `CreateProductionRequest`.
9. **D9 Scripts.** Ops scripts, `.env.example`, compose messages and CLI output are English and ASCII only (no « », `…` or
   `–`), because Windows PowerShell 5.1 mangles UTF-8 without BOM. They have no i18n layer.
10. **D10 URLs.** `/join/warten` becomes `/join/waiting` and `/o/_uhr` becomes `/o/_clock`: a hard switch without redirect, like
    #3. The PWA manifest gets `lang: "en"` and an English description.
11. **D11 Catalogues** are eager and single: both locales are bundled in every app. Lazy-loading `de-CH` only if the budgets fail.
12. **D12 E2E.** Runs in `en-US` plus a small `de-CH` project (`specs/i18n`). E2E text lives in `tests/e2e/support/text.ts` as
    literal strings and does not import the product catalogue.
13. **D13 Exempt from the German check:** `.impeccable/**`, `docs/history/**`, generated files, the `de-CH` catalogue and the
    German test files (`*.de.spec.ts`).

Results of the foundation spikes:

- **Template typing.** `t('key', params)` is type-checked inside templates under `strictTemplates`: an unknown key, a missing
  parameter, a wrong parameter name and a template-literal key with an impossible member all fail `ng build`. No `| t`
  pipe fallback was needed.
- **`satisfies Namespace<'prefix'>`** rejects keys outside the prefix and non-message values at compile time
  (`packages/i18n/src/types.spec.ts` pins this with `@ts-expect-error`).
- **Reactivity.** A `computed()` and an OnPush template that call `t()` re-render on a language switch without a reload
  (`language-select.component.spec.ts`), as does the document title.
- **Bundles** (production build, raw size, before the work packages add their catalogue files): Regie initial 395 kB
  (warning budget 900 kB, error 1.5 MB), sender initial 319 kB (warning 800 kB, error 1.5 MB). The output bundle stays
  free of Angular (`apps/output/vite.config.ts` aliases only the framework-free `@studioflow/i18n`): 122 kB main chunk
  and 34 kB shared-package chunk.
