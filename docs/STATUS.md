# Status and handover (2026-10-26)

Interim state of the work on issues #3–#27, written so a new session can continue without the previous conversation.
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
  `export PATH="/c/Users/nicom/AppData/Roaming/nvm/v22.22.3:$PATH"` (installed via nvm). A new worktree needs `npm ci`.
- .NET SDK 10, Docker Desktop 29 (start it first), Playwright browsers installed (chromium, firefox, webkit).
- No `pwsh`; PowerShell scripts are parsed with Windows PowerShell 5.1 (scripts are ASCII-only English, see D9).
- E2E: `tests/e2e/stack.sh up|test|down <n>` with the numbered stacks 1-5 (avoid port clashes), see
  `tests/e2e/README.md`. The harness performs the first-run setup (#4) of a fresh stack itself.
- No Python on the machine; use Node for scripted edits.

## Done and pushed to `main`

| Issue | State | Commits |
|---|---|---|
| #3 rename to StudioFlow | done, closed (GitHub repo rename is an owner step, #23) | afb7f85, 8207a0a |
| #15 CI | implemented; green run pending (#20) | 8a67eb5 .. 0734128, b09d8bf |
| #18 releases | implemented, three images (api, caddy, backup); unverified on GitHub (#23) | 9071db5 .. 2ddf143, 85945af |
| #16 backups + Renovate | merged; backup image in the release pipeline | 7ae0be2 .. 796eb9a, 85945af |
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
| #27 zero-config install | decisions recorded only | bfb6e41 |

## In progress (2026-10-26)

Sonnet agents in worktrees under `.claude/worktrees/agent-*` (branch `worktree-agent-<id>`):
#20 E2E texts (stack 1), #12 performance (stack 2), #8 format and resolution (stack 3), #7 audio (stack 4),
#9 output links and OBS virtual camera (stack 5). Merge procedure: `git rebase main` in the worktree, run the checks,
`git merge --ff-only` in the main checkout, push.

## Remaining plan

1. Finish and merge #20, #7, #9, #8, #12; close #6 with #20 and #15 once CI is green.
2. #14 duplicate/export (needs the data of #7, #8, #9, #13), #27 zero-config install (changes the E2E harness and all
   ops scripts, so after the agents above), then #5 README (describes the #27 install).
3. Final full-application test and bug fixing as described in "Working mode".

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
- The Regie menu and the output `?debug=1` overlay do not show the API version yet (#18 follow-up).

## Known open bugs

- #20 E2E suite asserts German texts (smoke red on `main`)
- #23 owner actions (the owner runs `tools/github-repo-settings.sh`; repo rename later)
- Fixed and recorded: #21 #24 #25 #26

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
