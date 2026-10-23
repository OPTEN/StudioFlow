# Status and handover (2026-10-23)

Interim state of the work on issues #3–#19, written so a new session can continue without the previous conversation.
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
| #15 CI | implemented; first runs red only because of #20 and slow (#22) | 8a67eb5 .. 0734128, b09d8bf |
| #18 releases | implemented, unverified on GitHub (#22, #23) | 9071db5 .. 2ddf143 |
| #6 English/i18n | foundation, docs, prototype, ops scripts, API texts done; see below | 2790d08 .. 335793a, 91e62c2, 2d905a8, 2983344, 9271d2f, af74d56 |

## In progress at the time of writing

Sonnet agents were running in worktrees under `.claude/worktrees/` (not merged, partly uncommitted):

- **#6 P1** sender, output, media-client, scene-renderer, realtime-client (branch `worktree-agent-a0ad59657b7680a36`)
- **#6 P2** Regie shell, stage, monitoring (`worktree-agent-a634762f46bff2f75`)
- **#6 P3** Regie docks (`worktree-agent-a5457a3af1c107201`)
- **#16** backups + Renovate (`worktree-agent-ac0e22c28f498b691`, 9 commits, backed up as `origin/wip/issue-16-backups`)

If they are gone: `git worktree list`, check each branch with `git log main..<branch>` and `git status` in the
worktree; the briefs are in `docs/architecture/i18n-design.md` section 8 and the common brief rules in `docs/i18n.md`.
After a package is done: `git rebase main` in its worktree, run its checks, `git merge --ff-only`, push.

## Remaining plan

1. Finish #6: P1, P2, P3, then **P7** (E2E strings module, `docs/testing.md`, `specs/i18n`; issue #20), then
   `npm run check` green and close #6. Notes for P7: `docs/i18n-e2e-notes/*.md`.
2. #16 (merge the branch above), then close #15/#16/#18 once CI is green and the first release works.
3. Features: #4 first-run setup, #10 light mode, #19 drag and drop, #17 audit log, #11 camera control,
   #12 performance, #13 text source, #8 format, #7 audio, then #14 duplicate/export, #9 virtual camera, #5 README.
   New texts go through `@studioflow/i18n` from the start (en + de-CH catalogue files, `npm run i18n:index`).
4. Final full-application test and bug fixing as described in "Working mode".

## Known open bugs

- #20 E2E suite asserts German texts (smoke red on `main`)
- #21 flaky `DeviceReportLatencyTests.Report_TenDevicesAtOnce_StayPrompt`
- #22 CI runtime above 15 min, artifact digest warning, runner kernel/netem unverified
- #23 owner actions (secrets, branch protection, repo rename)
- Fixed and recorded: #24 #25 #26
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
