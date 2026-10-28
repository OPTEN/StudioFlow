# Status and handover (2026-10-28)

> **Internal working log.** This file is the hand-over of the maintainer's working sessions until the first release. It
> is not user documentation and may be removed afterwards; the lasting content is in `docs/decisions.md`,
> `docs/testing.md` and `CONTRIBUTING.md`.

Interim state of the work on issues #3–#58, written so a new session can continue without the previous conversation.
Decisions for all open questions: `docs/decisions.md`. Binding i18n design: `docs/architecture/i18n-design.md`,
rules in `docs/i18n.md`.

## Working mode (user instructions)

- Work directly on `main`; commit and push after every intermediate goal.
- Delegate planning, translation and testing to Sonnet/Haiku subagents (Agent tool, `model: "sonnet"`) to save usage;
  parallel packages run in git worktrees (`isolation: "worktree"`) and are fast-forwarded into `main` after a rebase.
- One coordinating session only (the user confirmed this on 2026-10-26); other sessions do not merge into `main`.
- Document everything important in the repo.
- At the very end: test the whole application thoroughly (long-run test with simulated devices, simulated outages,
  the complete Regie dashboard); every defect becomes a GitHub issue (label `bug`); then fix them all.

## Local environment

- Windows 11, Git Bash. Node 22 is not on the PATH: prefix commands with
  `export PATH="/c/Users/<user>/AppData/Roaming/nvm/v22.22.3:$PATH"` (installed via nvm). A new worktree needs `npm ci`.
- .NET SDK 10, Docker Desktop 29 (start it first), Playwright browsers installed (chromium, firefox, webkit).
- No `pwsh`; PowerShell scripts are parsed with Windows PowerShell 5.1 (scripts are ASCII-only English, see D9).
- E2E: `tests/e2e/stack.sh up|test|down <n>` with the numbered stacks 1-5 (avoid port clashes), see
  `tests/e2e/README.md`. The harness completes the first-run wizard (#4, #27) of a fresh stack itself.
- No Python on the machine; use Node for scripted edits.

### Cloud container (Claude Code on the web, from 2026-10-26 evening)

The coordinating session moved to a Linux cloud container (4 CPUs, 15 GB). What it needs, all local and never committed:

- `dockerd` is started by hand; `/etc/docker/daemon.json` sets the registry mirror `https://mirror.gcr.io`, because
  anonymous Docker Hub pulls from the shared egress address get `429 Too Many Requests`.
- All outbound HTTPS is intercepted by an egress proxy with its own CA. The base images of the Dockerfiles are re-tagged
  locally with that CA added (a scratchpad script), so `apk`, `npm`, `dotnet restore` and `go` work inside builds. This
  only works with the engine's built-in Dockerfile frontend: a `# syntax=docker/dockerfile:1` line makes BuildKit
  resolve base images from the registry and skip the local ones (the line was removed from the Dockerfiles; it also
  saved a rate-limited Docker Hub pull on every CI build).
- .NET 10 SDK under `/root/.dotnet` (dotnet-install with `global.json`); Playwright browsers of the pinned version under
  `PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright` (the pre-installed ones are another version).
- The kernel has no `sch_netem`/`ifb`/`act_mirred`: `E2E-NET-00 [lk-pause/netem/disconnect]` fails locally only; it is
  green on the GitHub runners (`load-netem-modules.sh` prints `Loaded: sch_netem ifb act_mirred`).
- Agent worktrees live in `.claude/worktrees/` (git-ignored).

## Done and pushed to `main`

| Issue | State | Commits |
|---|---|---|
| #3 rename to StudioFlow | done, closed (GitHub repo rename is an owner step, #23) | afb7f85, 8207a0a |
| #15 CI | done, closed | 8a67eb5 .. 0734128, b09d8bf |
| #18 releases | implemented, four images; Release runs green on GitHub; closes with 0.1.0 | 9071db5 .. 2ddf143, 85945af |
| #16 backups + Renovate | done, closed | 7ae0be2 .. 796eb9a, 85945af |
| #6 English/i18n | P1-P4 merged; P7 (E2E texts) is #20 | 2790d08 .. 0a96f06 |
| #21 flaky latency test | done, closed | 772f79b |
| #22 CI runtime | parallel image matrix (about 25 s per image with cache), verified hand-over, netem loader, `ubuntu-24.04`; all non-E2E jobs green on GitHub | 001eb98, 3aa750d |
| #23 owner actions | `tools/github-repo-settings.sh` scripts everything except the repo rename; the owner runs it | 70813ed, 1671cba |
| #10 light mode | done, closed | b93deff .. 92c616d |
| #19 drag and drop | done, closed | 677c5a3 .. a3eca62 |
| Contrast and flaky test follow-ups | A11Y-02/03 fixed, `control-edge` token, `theme-color` follows the theme, `switcher.service.spec.ts` deterministic | 80744be and parents |
| #4 first-run setup | done, closed | 0f00de0 .. 993a1b5 (rebased) |
| #11 camera control | done, closed (tap-to-focus and pinch-zoom not built; real-phone test MAN-14 is manual) | up to bead7c6 |
| #13 text and lower thirds | done, closed | d59adbd .. 65288d3 |
| #17 audit log | done, closed | 401f95d .. 921e9e2 |
| #27 zero-config install | done: `docker compose up -d` and the first-run wizard, no host scripts, port 8443, four images; the runbook, the spec section 10 and the catalogue are rewritten | merge of the branch, a1f43cc |
| #14 duplicate, export, import | done, closed | up to 6cb2d16, c55dcc0 |
| #15 #16 #22 #30 #31 #32 | done, closed (CI green on GitHub) | see the issues |
| #34–#47 (bugs of the first full E2E run) | done, closed | 5984f88 and parents, 0143f5d (#45) |
| #44 #49 #51 #52 #58 | done, closed | a1f43cc, 6f57aab, 8987a8f, bd1da4a |
| #33 API crash under 30 parallel connections | fix pushed (GSS encryption off, 4f4eb7a); stays open until CI runs prove it | 4f4eb7a |
| #12 performance | done: measured, budget in `docs/testing.md` 5.1, H.264 screens, pausing, visibility, still thumbnails, hold-frame budget, load warnings, `perf` project and `perf.yml` | up to af40467 (also #39, #50) |
| #7 audio | done: audio station, microphones, screen and video sound, mixer, Audio dock, Web Audio on the output page, "Audio blocked" | the 25 commits after af40467 |
| #57 CI minutes | path filters (`changes` job), aggregate check `ci-ok`, weekly `audit.yml`, Release builds only after a CI smoke run, second smoke only for release commits, `needs-full-e2e` label | e57babb, e0acbd5, 7a99793, 63b0f9a |
| #53 #54 #56 | E2E harness: presence poll, SWITCH-15 on one clock, collision-free `uniqueIp()` | 2da04dc .. 51e395b |
| #55 | Regie in-flight guard until the hub event, refused switch shown | aa116d5 |
| #5 README, #59 MIT, #61 sponsor note, #62 logo | English README with real screenshots; licence MIT; "Sponsored by OPTEN" in the Regie header; "Programm" logo everywhere | a4a62d5, 35b4712, 4caa1f8 .. 7465213 |
| #48 LiveKit 1.13.11, #65 netem probe | one upstream x/net finding left (Renovate) | e0acbd5, 3e5ecf9 |
| #63 #66 + SRC-12 | no settings request before login, focus after failed login, monitoring cells by column name | 62aaa17 .. 20b44d4 |
| #14 #33 | verified and closed (XFER specs; 18 green smoke runs since the GSS fix) | |
| #67 #69 | landing page on Pages and product video: separate session, PR #72 | c7e92c5 |
| #70 #71 #73 #74 (security audit 2026-10-28) | Caddy admin API on a unix socket only for caddy+api, networks `studioflow`/`backend`; TLS key 640, no typed user name in the audit log, absolute session lifetime 7 days with stored revocations, PBKDF2 210,000 with rehash; operator CLI reads the DB password from the secrets volume; flaky apply-status test | d83223d .. b883b3d |

## Current state (2026-10-28)

Everything up to #74 is on `main` except what the table and the list below name. Local verification of the security
work (#70, #71, #73) on stack 4: smoke, desktop-chromium and disruptive over `specs/ops`, `specs/auth`, `specs/net`,
`specs/output`: 199 passed; the remaining failures are E2E-NET-05/09 and E2E-OPS-28 (green on a re-run, load) and two
that fail on `main` as well on Docker Desktop for Windows: INT-AUTH-22 (a 5 MB body to the published API port answers
400 instead of 413) and E2E-OPS-35 (taken port). Both still need a decision (test or product) and an issue.

Open:

- A full local E2E matrix (all projects incl. Firefox, WebKit and the mobile descriptors) was started and interrupted by
  a usage limit; its triage files issues for every product or test defect.
- #60 repository clean-up (last before the public release), #64 closes with the first release (or the copy of the
  prototype on Pages from #67), #18 closes with 0.1.0, #23 owner actions (branch protection to `ci-ok`, GHCR package
  access; the Pages source is set), #69 product video (rendered locally and committed in `site/public/media`, PR #76).

## Remaining plan

1. Finish the E2E matrix triage; fix and file what fails. Run the workflow **E2E full** on GitHub (label
   `needs-full-e2e` on the release pull request) and `perf.yml`.
2. #60 clean-up.
3. Merge release PR #29 (0.1.0) once CI, E2E full and Release are green; check the release run (images, signatures,
   scan, smoke, files) and install the bundle once on a clean stack.

## Follow-ups for the final pass

- #21: the final thresholds are not yet re-stressed 20 times on a quiet machine.
- #22: check the Playwright cache hit, "Loaded" from the netem step, three release images and the total wall time.
- #19: the Studio-Mode refusal to reorder the live scene is only unit-tested; `moveSceneOrder` and `moveEntry` overlap
  in `scene-list.ts`.
- A spec of the studio unit tests leaks DOM focus into later specs (probably `sortable-list`, `sources-dock.reorder`
  or `properties-dock`); `switcher.service.spec.ts` now protects itself.
- `a11y-axe.spec.ts` still calls `knownBug('A11Y-02'|'A11Y-03')` and mentions the old red `#f85149`.
- E2E-SRC-19: after switching to 720p the station showed 270p (test or product bug, being checked with #20).
- #13: in Studio Mode a text of the program scene can only be shown/hidden through the preview.
- `apps/output/src/latency-probe.spec.ts` timed out once under load.
- `stack.sh up` smoke H-STACK-01 timed out at 60 s under heavy machine load.

## Known open bugs

- #33 (open until CI proves the fix), #48, #53, #54, #55, #56; #23 owner actions; #5 README; #18 closes with 0.1.0.
- E2E-I18N-11: the settings popover covers the button the test clicks (test bug, no issue yet).
- `AuditExportStreamingTests` times out in the cloud container now and then (green on GitHub).

## Gotchas learned

- Do not run `git stash`; worktrees share it. Rebase agent branches onto `main` before merging; conflicts so far were
  only in `package.json`, `vitest.config.ts`, `*/tsconfig.spec.json`, `README.md` (keep both sides) and generated
  contracts (regenerate with `npm run gen:contracts`).
- Generated files: `apps/api/openapi/studioflow.json` and `packages/scene-model/src/generated/api.ts` must be
  regenerated, never hand-edited; CI checks them. EF migrations of parallel branches are ordered by timestamp.
- New executable scripts need `git update-index --chmod=+x` (Windows commits them as 100644).
- Pushing from a worktree (`git push origin HEAD:main`) does not move the local `main` branch: fast-forward it in the
  main checkout afterwards, otherwise agents rebase onto a stale `main`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or Sonnet 5.5 when Sonnet commits).
