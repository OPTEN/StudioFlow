# Status and handover (2026-10-26)

Interim state of the work on issues #3–#23, written so a new session can continue without the previous conversation.
Decisions for all open questions: `docs/decisions.md`. Binding i18n design: `docs/architecture/i18n-design.md`,
rules in `docs/i18n.md`.

## Working mode (user instructions)

- Work directly on `main`; commit and push after every intermediate goal.
- Delegate planning, translation and testing to Sonnet/Haiku subagents (Agent tool, `model: "sonnet"`) to save usage;
  parallel packages run in git worktrees (`isolation: "worktree"`) and are fast-forwarded into `main` after a rebase.
- Document everything important in the repo.
- At the very end: test the whole application thoroughly (long-run test with simulated devices, simulated outages,
  the complete Regie dashboard); every defect becomes a GitHub issue (label `bug`); then fix them all.

## Local environment

- Windows 11, Git Bash. Node 22 is not on the PATH: prefix commands with
  `export PATH="/c/Users/nicom/AppData/Roaming/nvm/v22.22.3:$PATH"` (installed via nvm). `npm ci` is done.
- .NET SDK 10.0.301, Docker Desktop 29 (start it first), Playwright browsers installed (chromium, firefox, webkit).
- No `pwsh`; PowerShell scripts are parsed with Windows PowerShell 5.1 (scripts are ASCII-only English, see D9).
- E2E: `tests/e2e/stack.sh up|test|down <n>` (numbered stacks avoid port clashes), see `tests/e2e/README.md`.
- Old local `.env` files use `FLOWSTUDIO_*` names: re-run `setup.sh`/`setup.ps1`.

## Done and pushed to `main`

| Issue | State | Commits |
|---|---|---|
| #3 rename to StudioFlow | done, closed (GitHub repo rename is an owner step, #23) | afb7f85, 8207a0a |
| #15 CI | implemented; green run pending (#20, #22) | 8a67eb5 .. 0734128, b09d8bf |
| #18 releases | implemented, three images (api, caddy, backup); unverified on GitHub (#22, #23) | 9071db5 .. 2ddf143, 85945af |
| #16 backups + Renovate | merged; backup image now in the release pipeline | 7ae0be2 .. 796eb9a, 85945af |
| #6 English/i18n | P1-P4 merged; P7 (E2E texts) is #20 | 2790d08 .. 0a96f06 |
| #21 flaky latency test | done, closed: functional assertions + 5 s stall ceiling, the 100 ms budget is only reported | 772f79b |
| #22 CI runtime | parallel image matrix, verified image hand-over, Playwright cache, netem loader, `ubuntu-24.04`; verify on GitHub | 001eb98, 3aa750d |
| #10 light mode | done, closed | b93deff .. 92c616d |
| #19 drag and drop | done, closed | c4058cb .. a3eca62 |

## In progress (2026-10-26)

Sonnet agents in worktrees under `.claude/worktrees/agent-*` (branch `worktree-agent-<id>`); their brief repeats the
"Working mode" above plus `docs/i18n.md`: #20 (E2E texts, stack 1), #4 (first-run setup, stack 2), #11 (camera
control, stack 5), #13 (text source, stack 6), #7 (audio, stack 7). Merge procedure: `git rebase main` in the worktree,
run the checks, `git merge --ff-only`, push. Two coordinator sessions push to `main`: both rebase onto `origin/main`
right before pushing and push fast-forward only.

## Remaining plan

1. Finish and merge #20, #4, #11, #13, #7.
2. Then #17 audit log (after #4), #8 format (after #13), #12 performance, #14 duplicate/export, #9 virtual camera,
   #5 README; close #6 with #20 and #15/#16/#18 once CI is green.
3. Final full-application test and bug fixing as described in "Working mode".

## Follow-ups for the final pass

- A11Y-02/A11Y-03: dark-theme PGM tag and Take hint contrast; dark red text on `raised-2` is 4.30:1; dark
  `seam-strong` control borders about 1.5-1.7:1 (all below AA, older than #10).
- `theme-color` meta stays `#0d1117` in the light theme.
- Flaky studio unit test `switcher.service.spec.ts` under load (5 s timeout, missing `/take` request).
- #21: the final thresholds are not yet re-stressed 20 times on a quiet machine.
- #22: on the next GitHub run check the parallel `build-images` matrix, the revision-label check, the Playwright cache
  hit, "Loaded" from the netem step, three release images and the total wall time (estimate 9:30).
- #19: the Studio-Mode refusal to reorder the live scene is only unit-tested; `moveSceneOrder` and `moveEntry` overlap
  in `scene-list.ts`.
- `stack.sh up` smoke H-STACK-01 timed out at 60 s under heavy machine load.

## Known open bugs

- #20 E2E suite asserts German texts (smoke red on `main`)
- #22 to be verified on GitHub
- #23 owner actions (secrets, branch protection, repo rename)
- Fixed and recorded: #21 #24 #25 #26
- Smaller notes: `README.md` still says "There is no product code yet" (rewritten by #5); the Regie menu and the
  output `?debug=1` overlay do not show the API version yet (#18 follow-up).

## Gotchas learned

- Do not run `git stash`; worktrees share it. Rebase agent branches onto `main` before merging; conflicts so far were
  only in `package.json`, `vitest.config.ts`, `*/tsconfig.spec.json`, `README.md` (keep both sides) and generated
  contracts (regenerate with `npm run gen:contracts`).
- Generated files: `apps/api/openapi/studioflow.json` and `packages/scene-model/src/generated/api.ts` must be
  regenerated, never hand-edited; CI checks them.
- New executable scripts need `git update-index --chmod=+x` (Windows commits them as 100644).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or Sonnet 5.5 when Sonnet commits).
