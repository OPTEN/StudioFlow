# Open-source checklist (issue #5)

What has to be true before the repository is switched to **public**, what is done, and what is left for the owner.
Decisions: `docs/decisions.md`, section "#5 Open source". Nothing in this list deletes a history document; where it says
"remove" or "move", the owner decides.

## 1. Done in the repository

| Item | Where |
|---|---|
| Licence Apache-2.0, copyright holder "OPTEN AG and the StudioFlow contributors", header policy (no per-file headers) | `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `package.json` (`license`), OCI label `licenses` in `release.yml` |
| Third-party notices: fonts, services, main libraries, generated npm and NuGet lists | `THIRD_PARTY_NOTICES.md`, `tools/third-party-notices.mjs` (`npm run notices`, `npm run check:notices`) |
| Contributing guide, Code of Conduct (Contributor Covenant 2.1), security policy | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` |
| Logo: light and dark variant (wordmark as outlines, no font needed) and the square mark | `docs/assets/logo-light.svg`, `logo-dark.svg`, `logo-mark.svg` |
| Standalone prototype as one offline file, attached to every release | `tools/build-prototype.mjs`, `infra/release/build-bundle.sh`, `docs/releasing.md` |
| Secret scan of the full history: 17 findings, all test fixtures, none real; allowlist `.gitleaks.toml`, result recorded | `docs/security-review.md`, `.gitleaks.toml` |
| `Opten.` namespace prefix: kept | `docs/decisions.md` #5, 3 |
| Examples use `studioflow.example.com` and `example.com` instead of `studioflow.opten.ch` and a personal address | code comments, unit tests, prototype, `docs/testing.md`, `docs/architecture/implementation-spec.md`, generated contracts (regenerated) |
| `studioflow.opten.ch` in the installation material replaced by `studioflow.example.com` (zone `example.com`) | `.env.example`, `docs/runbook.md` (sections 2 to 5 rewritten by #27), `README.md`, the generated contracts; the scripts are gone |
| Personal local path and the name of the audit agent removed | `docs/STATUS.md`, `docs/security-review.md` |

The README logo block, for the README rewrite:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img alt="StudioFlow" src="docs/assets/logo-light.svg" height="60">
</picture>
```

`logo-light.svg` has dark ink for light backgrounds, `logo-dark.svg` has light ink for dark backgrounds.

## 2. Waits for other work (nothing is left)

| Item | Why | What to do afterwards |
|---|---|---|
| ~~**README rewrite**~~ **Done** (English, logo, screenshots, features, prototype download, quick start, architecture, development, configuration, roadmap, badges). Screenshots: `docs/assets/screenshot-*.png`, made by `tests/e2e/specs/ui/ui-readme-screens.spec.ts` (see its header; opt-in with `E2E_README_SCREENSHOTS=1`) | The quick start of #27 (zero-config install) was kept; the planning-phase text and the private claude.ai links are gone | Nothing; when the product looks different, run the capture spec again |
| Defaults of `tools/github-repo-settings.sh` | Done: the default is `OPTEN/StudioFlow` since the rename (2026-10-27) | |

## 3. Review of the internal material

Reviewed on 2026-10-26. "Recommendation" is what we suggest; the owner decides.

| Item | What it is | Recommendation |
|---|---|---|
| `.impeccable/` (4.9 MB) | State of the design tool: `design.json` (design tokens with German names), `decision-payload.json` and `questions/` (the German design decision round "Inspizientenpult"), `surfaces/prototype-regie-html.md` (German brief), `qualitybar/` and `review/` (screenshots of the prototype and of both themes). No secrets, no personal data, but internal process material in German | **Move to `docs/history/design/`** (keep) or drop the screenshots (`review/`, `qualitybar/`: about 4.9 MB of binary files that every clone downloads). If it moves, change `tools/capture.ps1`, `tests/e2e/specs/ui/ui-theme-screens.spec.ts` (writes `review/themes`), `tools/german-allowlist/foundation.json`, `.dockerignore` and `.prettierignore` |
| `docs/history/` (760 KB) | The German architecture plan (draft 2) and draft 1, three screenshots. The plan links five **private claude.ai artifacts** (they do not open for outsiders), names `flowstudio.opten.ch` and the client id `opten` | Keep (history, unchanged by decision #6). Optional: replace the artifact links and the domain by plain text, because outsiders get dead links. It states that it is historical and in German |
| `docs/STATUS.md` | Internal hand-over of the working sessions: working mode of the AI sessions, local environment of the maintainer, commit trailer rule, follow-ups | **Move to `docs/history/` or delete** before going public; the contents that matter are in `docs/decisions.md`, `docs/testing.md` and `CONTRIBUTING.md`. The personal path was already anonymised |
| `README.md` (planning-phase status) | Replaced by the English README (done). The `.impeccable/` table of the old README is gone, so moving `.impeccable/` no longer touches it | Nothing |
| `tools/make-artifact.ps1`, `tools/capture.ps1`, `tools/mobile-wrap.html` | Helpers of the design phase: turn HTML into a Claude artifact, capture review screenshots with Edge | Move to `docs/history/` with `.impeccable/` or delete; not needed for development |
| `PRODUCT.md` | Product brief: said the operator is "internal to OPTEN" | Reworded for a public audience (done with the README) |
| `docs/architecture/implementation-spec.md` line 68 | "OPTEN standards apply (read the instruction files listed in your CLAUDE.md ...)" refers to internal instruction files | Reword: the conventions are in `CONTRIBUTING.md` and `.editorconfig` |
| Comments "OPTEN C# standard/convention" in `.editorconfig`, `apps/api/Directory.Build.props`, the test projects | Name the organisation's coding standard | Harmless; keep, or say "the C# conventions of this repository" |
| `docs/security-review.md` | The audit report of an automated agent (22 October 2026) with an "Umbraco hardening" section that does not apply | Keep as the published review of the design; the local path and the agent name were removed. Optionally move the "not applicable" sections out |
| Author e-mail addresses in the commits | Three personal addresses of the maintainer (`swissonline.ch`, `opten.ch`, a GitHub noreply) are in every commit and become public with the history | Accept, or rewrite the history with `git filter-repo --mailmap` **before** the first public push (changes every commit id; coordinate with open branches and tags) |
| Names in sample data | The prototype, the E2E harness and the tests use made-up names (Lea, Jonas, "Handy Lea", "Webinar Headless with Umbraco") | No real customer data was found; keep. `PRODUCT.md` already requires synthetic and labelled sample data |
| Remaining mentions of OPTEN | Image registry path `ghcr.io/opten`, OCI label `vendor=OPTEN`, release workflow identity `OPTEN/(FlowStudio|StudioFlow)`, `NOTICE` | Correct: OPTEN is the owner of the repository and the images |

## 4. Repository settings and owner decisions (not in code)

- **Visibility:** public, after the points above. Re-run the secret scan right before (`docs/security-review.md`) and
  enable **secret scanning with push protection**, **private vulnerability reporting** (Security tab; `SECURITY.md`
  depends on it) and Dependabot alerts (Renovate needs them, runbook section 15).
- **Description, topics, website, social preview image** (GitHub: Settings > General). A 1280 x 640 PNG can be made from
  `docs/assets/logo-mark.svg` and the wordmark.
- **Packages:** make `studioflow-api`, `studioflow-web` and `studioflow-backup` public when the repository is (then
  servers need no `docker login`; `docs/releasing.md` section 8).
- **Contact for the Code of Conduct.** It points to the private report form of the repository. A mailbox of the
  organisation (for example `conduct@...`) would be better; put it into `CODE_OF_CONDUCT.md` ("Enforcement") if there is
  one.
- **Review the wording of `SECURITY.md`:** the response times (5 and 10 working days, 30 days for a fix) and the sentence
  that research following the policy is not pursued legally are commitments of OPTEN AG.
- **Confirm the copyright line** ("OPTEN AG and the StudioFlow contributors", year 2026) in `NOTICE` and decide whether
  contributions need more than the Apache-2.0 section 5 licence (a CLA or DCO sign-off is not required by the files).
- **Repository rename** `OPTEN/FlowStudio` to `OPTEN/StudioFlow` (#3): done on 2026-10-27. `RELEASE_PLEASE_TOKEN`, branch protection and
  squash merging: `docs/releasing.md` section 8, `tools/github-repo-settings.sh`.
- **Licence texts in the shipped frontends (done).** The Angular production build writes `3rdpartylicenses.txt` next to,
  not inside, `dist/<app>/browser`; the web image now copies it to `/3rdpartylicenses.txt` (Regie) and
  `/join/3rdpartylicenses.txt` (sender) and serves `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` under `/licenses/`. The
  Vite build of the output page has no such file; `THIRD_PARTY_NOTICES.md` covers it. The API image cannot carry the
  files without a change of its build context (`apps/api`); it has the OCI label `licenses` and an SBOM.
