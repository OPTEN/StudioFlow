# Contributing to StudioFlow

Thank you for your interest in StudioFlow, a browser-based live production studio for webinars. Bug reports, ideas,
documentation fixes and code are welcome. This page tells you how to get a development environment running, how to test
a change and what a pull request has to look like.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Vulnerabilities are **not** reported in public
issues: see [SECURITY.md](SECURITY.md).

## Before you start

- **Small fixes** (typos, a clear bug with a test, documentation) can go straight to a pull request.
- **Larger changes** (a feature, a new dependency, a change of behaviour or of a contract): open an issue first and
  describe the problem, so that nobody builds something that cannot be merged. `PRODUCT.md` says what the product is for
  and what it is not.
- The decisions that bind the implementation are in [docs/decisions.md](docs/decisions.md), the specification in
  [docs/architecture/implementation-spec.md](docs/architecture/implementation-spec.md). A change that contradicts them
  needs a reason in the pull request and an update of the document.

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22.22.3 or newer (`.nvmrc`; `package.json` `engines` lists the accepted ranges) | the frontends, the shared packages, the tools |
| .NET SDK | 10 (`global.json`) | the API |
| Docker | with Compose v2 | PostgreSQL, LiveKit and Caddy for development, the API integration tests (Testcontainers), the end-to-end tests, the release images |

For the end-to-end tests you also need the Playwright browsers (`npx playwright install chromium firefox webkit`,
Microsoft Edge for one project) and `ffmpeg`. Windows needs Git Bash for the scripts; the PowerShell scripts exist as
well.

## Getting the code running

```bash
npm ci                       # once, and after every change of package-lock.json
```

The API, LiveKit and PostgreSQL run as containers, the frontends run with their dev servers and a proxy to the API
(`proxy.conf.json`). The header of [docker-compose.override.example.yml](docker-compose.override.example.yml) has the
exact steps, [docs/runbook.md](docs/runbook.md) explains the stack. The first start prints a setup code in the API log;
the Regie asks for it to create the account.

| Command | Starts |
|---|---|
| `npm run start:studio` | the Regie (control room) on <http://localhost:4200> |
| `npm run start:sender` | the sender PWA (phones and laptops) on <http://localhost:4201> |
| `npm run start:output` | the output page on <http://localhost:4202> |
| `dotnet run --project apps/api/src/Opten.StudioFlow.Web` | the API on <http://localhost:5298> (needs PostgreSQL and LiveKit) |

### Project structure

| Path | Content |
|---|---|
| `apps/studio`, `apps/sender` | Angular 22: the Regie and the sender PWA |
| `apps/output` | the framework-free output page (Vite) |
| `apps/api` | ASP.NET Core 10 API (`src`) and its tests (`tests`); EF Core, PostgreSQL, SignalR |
| `packages/*` | shared TypeScript: `scene-model`, `scene-renderer`, `media-client`, `realtime-client`, `i18n` |
| `infra` | Caddy, backup, release and script helpers |
| `tests/e2e` | the Playwright end-to-end suite and its harness |
| `docs` | specification, decisions, runbook, test plan, release process |
| `prototype` | the clickable Regie prototype that the design started from |

## Contracts between the API and the frontends

The OpenAPI document `apps/api/openapi/studioflow.json` and the TypeScript types
`packages/scene-model/src/generated/api.ts` are **generated** from the API code. After a change to a route, a DTO or an
error code run

```bash
npm run gen:contracts
```

and commit both files; CI fails when they differ. Never edit them by hand. A change of the database model needs an EF Core
migration; the tool is pinned in `apps/api/dotnet-tools.json`:

```bash
cd apps/api
dotnet tool restore
dotnet ef migrations add <Name> --project src/Opten.StudioFlow.Infrastructure --startup-project src/Opten.StudioFlow.Web
```

## Tests

Every change comes with tests, and every test carries the ID of its entry in the [test plan](docs/testing.md).

| Command | What it runs |
|---|---|
| `npm run check` | i18n checks, the German-text check and the TypeScript type check of packages, output page and E2E harness |
| `npm run format:check` | Prettier (run `npx prettier --write <file>` to fix) |
| `npm run check:links` | Relative links and heading anchors of all Markdown files (no network) |
| `npm run test:unit` | Vitest: the shared packages, the output page, the tools |
| `npm run test:studio` / `npm run test:sender` | Angular unit tests of the Regie / the sender |
| `npm run build:web` | production build of the three frontends |
| `dotnet build apps/api/StudioFlow.slnx -warnaserror` | the API (warnings are errors) |
| `dotnet format apps/api/StudioFlow.slnx --verify-no-changes` | C# formatting |
| `npm run test:api` | xUnit: domain tests and the integration tests (start PostgreSQL with Docker) |
| `node infra/release/check.mjs` | one version in every file, the two Compose files agree |
| `tests/e2e/stack.sh up N`, `E2E_REUSE_STACK=1 tests/e2e/stack.sh test N --project=smoke`, `tests/e2e/stack.sh down N` | the end-to-end tests against a stack in Docker (numbered stacks run side by side); see [tests/e2e/README.md](tests/e2e/README.md) |
| `npm run test:e2e` | the whole end-to-end suite (long) |

Run the checks that cover what you changed before you open a pull request; CI runs all of them
(`.github/workflows/ci.yml`). A test must never be weakened to make it pass: find the cause.

## Code style

- **TypeScript** is strict. Angular code uses standalone components, signals and `OnPush`. Match the code around you;
  `.editorconfig` and `.prettierrc` set the formatting.
- **C#** follows `.editorconfig` (file-scoped namespaces, nullable, `TreatWarningsAsErrors`, XML docs on public APIs).
  The `Opten.StudioFlow.*` namespaces keep the `Opten.` prefix of the organisation that started the project; do not
  rename them.
- Comments say **why**, not what. Keep the density of the surrounding code.
- Validate all input on the server, keep secrets out of logs and responses, and follow
  [docs/security-review.md](docs/security-review.md).

## Texts and translations (i18n)

English is the source language, German (Switzerland, `de-CH`) the first translation. **Every text the user sees** lives
in `packages/i18n/src/messages/en/*.ts` and `.../de-CH/*.ts`, never in a template or a component. Add the key in both
catalogues, use it with `t('area.feature.key')`, and run `npm run check` (it also looks for German text outside the
`de-CH` catalogue). The rules, the glossary and the checks are in [docs/i18n.md](docs/i18n.md). Code, comments,
documentation and commit messages are English; German only inside the `de-CH` catalogue and the `*.de.spec.ts` tests.

## Commits and pull requests

- Work on a branch and open a pull request against `main`. Keep it focused: one logical change.
- The **pull request title** must follow [Conventional Commits](https://www.conventionalcommits.org/) in the form
  `type(scope): subject`, in English, imperative, without a full stop. A check enforces it, because the squash merge makes
  the title the commit message and the release notes and the next version are derived from it.

  | Type | Use for |
  |---|---|
  | `feat` | a new capability for users or operators (next minor version) |
  | `fix`, `perf` | a bug fix, a speed or memory improvement (next patch version) |
  | `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `style` | changes nothing for users (no release) |
  | `feat!`, `fix!` or a `BREAKING CHANGE:` line | breaks existing installations, contracts or `.env` |

  Examples: `feat(studio): add light mode`, `fix(api): keep the login after an API restart`,
  `docs: describe the update procedure`. The full rules are in [docs/releasing.md](docs/releasing.md).
- In the description say **what** and **why**, what you tested and how, and reference the issue (`Fixes #123`).
- Update the documentation your change touches: the specification, the runbook, the test plan, `docs/decisions.md`.
- A pull request is merged with **squash**, once CI is green and a maintainer approved it.

## Licence of contributions

StudioFlow is licensed under the [MIT License](LICENSE). By submitting a contribution you agree that it is licensed
under the same terms ("inbound = outbound"): you license your contribution to everybody under the MIT License and
confirm that you have the right to do so. The MIT License has no clause on contributions of its own, so this paragraph
is that agreement; no separate one (CLA, DCO sign-off) is needed.

**Header policy.** Source files do **not** need a licence or copyright header: the `LICENSE` and `NOTICE` files at the
top of the repository apply to every file that has no notice of its own, and git records who wrote what. Do not add
per-file headers. Keep an existing licence notice when you copy code from another project, and only copy code whose
licence allows it to be shipped inside an MIT project with its notice kept (MIT, ISC, BSD, Apache-2.0; no GPL or AGPL). A new runtime dependency is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): run `npm run notices` after you change `dependencies` or the NuGet
packages, and say in the pull request why the dependency is needed.

## Where to find more

[README.md](README.md) · [PRODUCT.md](PRODUCT.md) · [DESIGN.md](DESIGN.md) · [docs/architecture/implementation-spec.md](docs/architecture/implementation-spec.md) ·
[docs/testing.md](docs/testing.md) · [docs/runbook.md](docs/runbook.md) · [docs/releasing.md](docs/releasing.md) ·
[docs/i18n.md](docs/i18n.md)
