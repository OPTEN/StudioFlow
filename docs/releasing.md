# StudioFlow - Releases

How StudioFlow is versioned, built, published and released (issue #18, decisions in `docs/decisions.md`). For
operators who install a release: `docs/runbook.md`, section 14.

## 1. Overview

| When | What happens | Result |
|---|---|---|
| A pull request is opened or edited | The check **Conventional Commits title** (`.github/workflows/pr-title.yml`) | The title must follow the rules in section 2, or the check is red |
| A pull request is merged (squash) into `main` | **CI** (`ci.yml`) runs on the new commit. When it is green, the workflow **Release** (`release.yml`) runs for exactly that commit | Images `studioflow-api`, `studioflow-web`, `studioflow-livekit` and `studioflow-backup` with the tags `:sha-1a2b3c4` and `:main`; the release pull request is opened or updated |
| The release pull request is merged | CI and Release run for the merge commit | Git tag `vX.Y.Z`, GitHub release with notes and files, the same images also tagged `:X.Y.Z`, `:X.Y` and `:latest` |

Every commit on `main` therefore has images; a version only exists when somebody clicks "merge" on the release pull
request. Nothing is built on the servers: they pull the images (`docker compose pull`).

## 2. Versions and Conventional Commits

There is **one version for everything** (lockstep): the API, the frontends and all four images are built from one
commit, and a sender in version X must meet an API in version X when a contract changes. Semantic Versioning, `0.x.y`
until the first production use, then `1.0.0`.

The version is written in these files, all changed by the release pull request and checked by
`node infra/release/check.mjs` (CI, job `lint-typecheck`):

| File | Used for |
|---|---|
| `.release-please-manifest.json` | The version release-please starts from (the last release) |
| `package.json`, `package-lock.json` | The version of the repository |
| `apps/api/Directory.Build.props` (`<Version>`) | The API: `GET /api/system/info` reports it as `0.1.0+1a2b3c4` (version and commit; the Docker build passes the commit) |

`docker-compose.release.yml` carries no version: the image tag defaults to `latest` (`STUDIOFLOW_IMAGE_TAG`), so it is the same
file in every release, and `check.mjs` fails when a version marker appears in it. A server pins a version in its `.env`.

The frontends have no file of their own. The Regie shows the version the **API** reports, in the last row of the
settings (gear) popover. The output page is served without a session, so it cannot ask the API: its build writes the
`version` of `package.json` plus the commit (the Docker build argument `STUDIOFLOW_REVISION`, the same one the API
image gets) into the bundle, and the `?debug=1` overlay prints `StudioFlow 0.1.0+1a2b3c4` as its last line (just
`0.1.0` where the build does not know the commit, like the plain `docker compose build` of development). CI and the
Release workflow pass the commit to every image alike.

Before the first release every file says `0.0.0`. `release-please-config.json` holds the rules (`node` release type,
tags `vX.Y.Z`, before 1.0 a breaking change raises the minor version only, and `initial-version` `0.1.0`: without a
release tag release-please would otherwise start at `1.0.0`).

### Rules for commit messages

The squash merge turns the **pull request title** into the commit message on `main`, so the title is what counts. The
format is `type(scope): subject` or `type!: subject`; the scope is optional (`api`, `studio`, `sender`, `output`,
`ops`, `deps` ...). The subject says what changed, in the imperative, without a full stop.

| Type | Use for | Next version | Release notes |
|---|---|---|---|
| `feat` | A new capability for users or operators | minor (`0.1.0` -> `0.2.0`) | Features |
| `fix` | A bug fix | patch (`0.1.0` -> `0.1.1`) | Bug Fixes |
| `perf` | A speed or memory improvement | patch | Performance Improvements |
| `revert` | Reverts an earlier change | patch | Reverts |
| `feat!`, `fix!` ... or a `BREAKING CHANGE:` line in the description | A change that breaks existing installations, contracts or `.env` | major (before 1.0.0: minor) | with a "BREAKING CHANGES" note |
| `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `style` | Everything that changes nothing for users | none | not listed |

A release pull request only appears when at least one commit of the first four rows (or a breaking one) came in since
the last release. Examples:

```text
feat(studio): add light mode
fix(api): keep the login after an API restart
feat!: rename the environment variables of the API
chore(deps): update postgres to 17.12
docs: describe the update procedure
```

- Several commits in one pull request: only the title is used. Squash merge is the repository default (section 8).
- To force a version (for example `1.0.0` when the product goes into production), put `Release-As: 1.0.0` on its own
  line at the end of the description of a commit on `main`.
- Renovate (#16) writes `chore(deps): ...` titles; its configuration must keep that format.

## 3. Images

| Image | Content |
|---|---|
| `ghcr.io/opten/studioflow-web` | Caddy with the DNS modules, the Caddyfile and the three built frontends (Regie, sender, output), plus the licence files (`/licenses/LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `/3rdpartylicenses.txt`). Built from `infra/caddy/Dockerfile` with the repository as context |
| `ghcr.io/opten/studioflow-api` | The ASP.NET Core API including its commands (`reset-admin`, `broadcast-status`). Built from `apps/api/Dockerfile` |
| `ghcr.io/opten/studioflow-livekit` | The LiveKit server (exact version pinned in `infra/livekit/Dockerfile`, moved by Renovate together with `livekit-client`) and a small supervisor that restarts it when the API writes a new `livekit.yaml` (the media address). Built from `infra/livekit/Dockerfile` |
| `ghcr.io/opten/studioflow-backup` | The backup service (scheduled backups, `backup-now`, `list`, `restore`; runbook section 7). Built from `infra/backup/Dockerfile` on the PostgreSQL image pinned in `docker-compose.yml` (the `plan` job reads the pin), so `pg_dump` matches the server |

`postgres` is a third-party image with a fixed version in the Compose files; `netem` (tests) has no published image. The
LiveKit and backup images are released like the other two: same tags, SBOM, provenance, signature and scan.

| Tag | Moves | For |
|---|---|---|
| `sha-1a2b3c4` | never (one commit) | tests, rollback, finding out what runs |
| `main` | with every verified commit on `main` | trying out the newest state |
| `0.4.2` | never | servers (recommended) |
| `0.4` | with every patch release of 0.4 | |
| `latest` | with every release | the default of `docker-compose.yml` of a release: `docker compose pull && docker compose up -d` |

There is no `:0` tag: before 1.0 a minor version may break things. Only `linux/amd64` is built (decision 5); `arm64`
is one line in the `platforms` list of the `images` job plus a runner or QEMU.

Each image carries OCI labels (`title`, `description`, `vendor`, `source`, `url`, `documentation`, `revision`,
`version` as `0.4.2+1a2b3c4`, `licenses` as `MIT`, `created`), an SBOM and a SLSA provenance attestation
(`mode=max`) in the image index, and a keyless **cosign** signature made by the Release workflow.

## 4. How the Release workflow works

`release.yml` is triggered by `workflow_run`: it starts when the workflow **CI** completed successfully for a push to
`main` and works on the commit CI tested (`head_sha`). It was chosen over calling `ci.yml` as a reusable workflow
because the gate "CI is green on this commit" is stated exactly, `ci.yml` keeps its job names (the required checks)
and the tests do not run a second time. Consequences: the workflow only takes effect on `main`, and it checks out
`head_sha` explicitly.

CI (`ci.yml`) builds the same four images from the same Dockerfiles and writes the Docker layer cache (GitHub Actions
cache, scopes `api`, `caddy`, `livekit`, `backup`); `release.yml` only reads those scopes, so the build of a release normally takes
the time of the push and the upload. Every workflow runs on `ubuntu-24.04` instead of `ubuntu-latest`, so that a new
default image of GitHub cannot change a release; the pin is moved on purpose. The timing budget of CI and the layout of
its jobs are in `docs/testing.md`, section 6.1.

```text
plan -> images (api, web, livekit, backup) -> smoke (release commits) -> main-tag
                          -> scan                                   -> release-please -> release (release commit)
```

**What runs (issue 57).** `plan` asks the GitHub API two things: did the CI run of this commit run `e2e-smoke` green
(CI only runs it when something that reaches the stack changed, `docs/testing.md` 6.1), and does the commit change
`.release-please-manifest.json` (then it is a release commit). Images are built when either is true. So:

| Commit | Jobs |
|---|---|
| Docs only | `plan`, `release-please`; `:main` stays on the last code commit |
| Code (not a release) | `plan`, `images`, `scan`, `main-tag`, `release-please`. The smoke set is not run again: CI smoke-tested images of the same commit built from the same Dockerfiles and the same layer cache |
| Release commit | everything: the smoke set runs against the pushed images and the scan must be green before they get a version tag. A release runs the smoke set twice: in CI on the release pull request, and here against the pushed images. CI skips `build-images` and `e2e-smoke` for the release commit itself (a push that changes `.release-please-manifest.json`), and `release-please` creates the tag only after `smoke` |

| Job | Does | Permissions beyond `contents: read` |
|---|---|---|
| `plan` | Names: registry path (owner in lower case), tag `sha-xxxxxxx`, version | none |
| `images` | Builds each image once, pushes `:sha-xxxxxxx` with SBOM and provenance, signs the digest. Skips the build when the tag exists (re-runs never change a sha image) | `packages: write`, `id-token: write` |
| `smoke` | Release commits only: the E2E smoke set (`tests/e2e`, project `smoke`) against the pushed sha images, not against locally built ones | `packages: read` |
| `scan` | Trivy: a fixable CRITICAL vulnerability in any of the four images fails the job | `packages: read` |
| `main-tag` | After `images` (and `smoke` when it ran): points `:main` at the sha images, but only while the commit is still the tip of `main` | `packages: write` |
| `release-please` | On every commit, after `images` and `smoke` when they ran: tags and publishes a release when a release pull request was merged, otherwise opens or updates the release pull request. Then looks for a tag on this commit | `contents`, `issues`, `pull-requests: write` |
| `release` | Only when this commit carries a release tag, after `smoke` **and** `scan`: tags the same manifests `:X.Y.Z`, `:X.Y` (while it is the newest patch of its minor) and `:latest` (while it is the newest release), compares the digests with the sha image, verifies the signature, builds the release files, attaches them | `contents: write`, `packages: write` |

A critical vulnerability therefore blocks a release (no version tags, no files) but never `:main`.

Every step can be repeated. After a failure use **Re-run failed jobs** (or **Re-run all jobs**): sha images are not
rebuilt, re-tagging copies the same manifest, uploads use `--clobber`, and a release is found again by its tag.
Runs of different commits do not wait for each other (the concurrency group is the commit), so a release commit is
never cancelled by a later push.

## 5. Making a release

1. Look at the open pull request **chore(main): release X.Y.Z**. It lists the commits since the last release, with the
   new `CHANGELOG.md` and the changed version files.
2. Put the label **`needs-full-e2e`** on it: the workflow **E2E full** runs every Playwright project against the stack
   built from the pull request. Wait until it is green.
3. Merge it when the full run, CI on the pull request (`ci-ok`) and the latest **Release** run on `main` are green. It
   is a deliberate click; use **Squash and merge**.
4. CI and then Release run for the merge commit. When they finish, the GitHub release `vX.Y.Z` has notes and files, and
   the images carry the version tags.
5. Servers update with `docker compose pull && docker compose up -d` (runbook, section 14).

To skip a release, do not merge the pull request: it grows with the next commits.

### Release files (attached to the GitHub release)

| File | Content |
|---|---|
| `studioflow-X.Y.Z.tar.gz` | The install folder: `docker-compose.yml` (the release file; its image tag is `latest`, the same file in every release), `.env.example` (optional overrides), `docs/runbook.md`, `docker-compose.override.example.yml`, `QUICKSTART.md`, `VERSION`, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`. **No script**: `docker compose` installs, updates, backs up and restores (the Compose file is all a server needs) |
| `docker-compose.yml`, `env.example` | The same two files on their own (GitHub drops the leading dot of `.env.example`) |
| `QUICKSTART.md` | One page: install, update, roll back |
| `studioflow-prototype.html` | The clickable Regie prototype as **one file**: `prototype/regie.html` with the fonts inlined as base64 (`tools/build-prototype.mjs`), works offline, shows a note that all data is synthetic. The name has no version, so the README links `https://github.com/OPTEN/StudioFlow/releases/latest/download/studioflow-prototype.html` |
| `SHA256SUMS` | Checksums of the files above: `sha256sum -c SHA256SUMS --ignore-missing` |

The Caddy files are not separate assets: they are inside the `studioflow-web` image, nothing of them is mounted at
run time.

`infra/release/build-bundle.sh X.Y.Z OUTPUT_DIR` builds the same files from a working tree (needs `node` for the
prototype); the version must match the one in the files. `npm run build:prototype` builds the prototype file alone
(`dist/studioflow-prototype.html`).

## 6. Verifying an image

```bash
# The signature belongs to the Release workflow of this repository on main (the regular expression covers the rename):
cosign verify ghcr.io/opten/studioflow-api:0.4.2 \
  --certificate-identity-regexp '^https://github.com/OPTEN/(FlowStudio|StudioFlow)/\.github/workflows/release\.yml@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# Both platforms/attestations and the digest (the version tag and the sha tag of the commit show the same digest):
docker buildx imagetools inspect ghcr.io/opten/studioflow-api:0.4.2
docker buildx imagetools inspect ghcr.io/opten/studioflow-api:0.4.2 --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/opten/studioflow-api:0.4.2 --format '{{ json .Provenance }}'
docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' ghcr.io/opten/studioflow-api:0.4.2
```

While the repository is private, signing writes the repository name and workflow path to the public Sigstore
transparency log (Rekor); the images themselves stay private.

## 7. Testing the release flow

- Locally: `node infra/release/check.mjs` (versions and compose twins), `infra/release/build-bundle.sh`, and
  `docker buildx build --platform linux/amd64 ...` with the arguments of the `images` job.
- On GitHub, **before** the first merge nothing of `release.yml` can run: `workflow_run` only exists for the file on
  `main`. The first checks after merging: the Release run of that merge commit pushes both sha images and `:main`; the
  first `feat:` creates the release pull request; merging it produces `v0.1.0` (the trial release of the issue:
  install on a clean machine with only the release files and `docker compose up -d`, then `STUDIOFLOW_IMAGE_TAG` forward and back).

## 8. Set-up by the owner (repository settings, one time)

`bash tools/github-repo-settings.sh` applies the first three rows and reports whether the optional token is set (it
needs `gh` signed in as an administrator). Administrators may still push directly to `main` (`enforce_admins` is off);
everybody else goes through a pull request.

| Setting | Why |
|---|---|
| Settings > General > Pull Requests: allow **squash merging**, set "Default commit message" to **Pull request title**; switch off merge commits and rebase merging | The title becomes the commit message |
| Settings > Branches > rule for `main`: the checks **`ci-ok`** and **Conventional Commits title** | `ci-ok` aggregates the CI jobs: a red job blocks the merge, a job skipped by the path filters does not |
| Settings > Actions > General > Workflow permissions: **Allow GitHub Actions to create and approve pull requests** | release-please opens the release pull request |
| Secret `RELEASE_PLEASE_TOKEN` (optional, **not set by decision**): fine-grained personal access token (or GitHub App token) with *Contents* and *Pull requests* write access to this repository | Without it release-please opens the release pull request with the default token, and GitHub holds its workflows: a maintainer clicks **Approve workflows to run** on the release pull request (again after every force push of release-please) and merges once CI is green. With the secret CI starts by itself, the price is a personal token that has to be renewed |
| Packages: after the first Release run, open the packages `studioflow-api`, `studioflow-web`, `studioflow-livekit` and `studioflow-backup` and check that the repository has access ("Manage Actions access") | The smoke test and the scan pull the images with the workflow token |
| Packages: make them **public** when the repository becomes public (#5) | Then servers need no `docker login` |
| Organisation: packages may be created with the visibility "private" | |

The repository was renamed from `OPTEN/FlowStudio` to `OPTEN/StudioFlow` on 2026-10-27 (GitHub redirects the old URLs).
Nothing else had to change: the image names do not contain the repository name and the registry path is the owner (`ghcr.io/opten`). The `cosign` identity expression in
section 6 covers both names. Signatures made after the rename carry the new repository name.

## 9. When something goes wrong

| Situation | What to do |
|---|---|
| A job of Release failed (network, registry, flaky test) | **Re-run failed jobs** of that run. Nothing is rebuilt or duplicated |
| `scan` failed on a commit | Update the base image or dependency (Renovate), or add the CVE with a reason to `.trivyignore`. Nothing is blocked except releases |
| `scan` failed on a **release commit** | The tag and the GitHub release already exist, but the images are not tagged and no files are attached. Do not re-run: the sha image is immutable. Fix it on `main` and ship the next version (`fix:`); delete the empty GitHub release and its tag if it confuses |
| The release pull request was merged but the Release run was cancelled | **Re-run all jobs** of that run. `release-please` finds the merged pull request and the release job promotes the images |
| A released version is bad | Do not delete tags or images. Merge a `fix:` and release it; servers go back with `STUDIOFLOW_IMAGE_TAG=<good one>` in their `.env` and `docker compose pull && docker compose up -d` meanwhile |
| A new image is added (like the LiveKit and backup images) | Add an entry to the matrix of `images` (and of `build-images` in `ci.yml`), add the name to the list in `scan`, to the pulls of the smoke job and to the loops in `main-tag` and `release`, to `IMAGES` in `infra/release/check.mjs`, and an `image:` line `${STUDIOFLOW_IMAGE_REGISTRY:-ghcr.io/opten}/studioflow-<name>:${STUDIOFLOW_IMAGE_TAG:-latest}` (no version marker) to `docker-compose.release.yml` |
| The two Compose files drift | `node infra/release/check.mjs` names the difference; change `docker-compose.release.yml` like `docker-compose.yml` |

### Housekeeping

Every commit on `main` leaves two `sha-` images in the registry (a few hundred megabytes each). When the storage
becomes a problem, delete old `sha-` versions that no release uses (GitHub package settings, or the
`actions/delete-package-versions` action on a schedule). Version tags are never deleted.

## 10. Not done yet

- `arm64` images.
- The E2E harness still builds its images itself (CI and Release pass prebuilt images with `E2E_NO_BUILD=1`).
