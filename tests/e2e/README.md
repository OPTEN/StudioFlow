# FlowStudio E2E harness

Playwright suite for the stack as a user runs it: Caddy, API, LiveKit and PostgreSQL in Docker (compose project
`fs-e2e`), driven over REST, SignalR, WebRTC and the operations scripts. The catalogue and the pass criteria are in
`docs/testing.md`; test titles start with the catalogue ID (`E2E-AUTH-01 [api] ...`).

## Run

```
npm run test:e2e                                   # everything, in the order smoke > main > short-ttl > disruptive
npx playwright test -c tests/e2e/playwright.config.ts --project=smoke
npx playwright test -c tests/e2e/playwright.config.ts --project=disruptive specs/net
npx playwright test -c tests/e2e/playwright.config.ts --grep "@p0"
```

Global setup writes `tests/e2e/.env.e2e` (git-ignored, throwaway credentials, TLS `internal`, node IP = LAN IPv4,
fallback 127.0.0.1), builds and starts the project `fs-e2e` and waits for all four healthchecks. Teardown removes
containers and volumes. Logs of every service go to `tests/e2e/.output/logs`, reports to `.output/html`,
`.output/junit.xml` and `.output/results.json`.

| Variable | Effect |
| --- | --- |
| `E2E_KEEP_STACK=1` | do not tear the stack down at the end |
| `E2E_REUSE_STACK=1` | use the running `fs-e2e` stack (implies keeping it) |
| `E2E_NO_BUILD=1` | `up -d` without `--build` (images from the last run) |
| `E2E_BUG_REPORT=1` | run the tests of open known bugs as plain tests (raw failures as evidence) |
| `E2E_NODE_IP` | node IP instead of the detected LAN IPv4 |
| `E2E_SUBNET`, `E2E_HTTPS_PORT`, `E2E_HTTP_PORT`, `E2E_API_PORT`, `E2E_LIVEKIT_PORT`, `E2E_POSTGRES_PORT` | move the test stack when the defaults are taken |
| `E2E_BASH` | bash that runs `setup.sh`/`backup.sh`/`restore.sh`/`update.sh` (default: Git Bash on Windows) |

Requirements: Docker with Compose v2, Node 22, the Playwright browsers (`npx playwright install chromium firefox
webkit`), Git Bash on Windows for the OPS specs, ports 80 and 443 free (or moved with the variables above).

## Layout

- `playwright.config.ts` projects and run order; `global-setup.ts` / `global-teardown.ts` stack lifecycle.
- `docker-compose.e2e.yml` test-only additions (127.0.0.1 ports, fixed addresses); `docker-compose.short-ttl.yml` the
  short-TTL profile (the specs recreate the API/LiveKit with it and back).
- `support/` typed API client with CSRF (`api.ts`), hubs and the Regie/sender/output stand-ins (`hubs.ts`,
  `sync-client.ts`, `sim.ts`), pairing and production fixtures (`production.ts`, `fixtures.ts`), LiveKit helpers
  (`livekit.ts`, `livekit-browser.ts` with the latency stamp codec), fault injection (`docker-ctl.ts`, `net.ts`,
  `tcp-proxy.ts`), isolated script copies (`ops.ts`), German strings and thresholds (`constants.ts`).
- `specs/<area>/` the tests. File suffixes choose the project: `*.disruptive.spec.ts`, `*.short-ttl.spec.ts`,
  `*.mobile.spec.ts`, `*.firefox.spec.ts`, `*.webkit.spec.ts`, `*.soak.spec.ts`; everything else runs in `smoke`
  (tag `@smoke`) or `desktop-chromium`.
- `known-bugs.json` registry of confirmed product bugs and documentation differences (each open entry carries steps, expected, actual and evidence).

## Conventions

- A confirmed product bug keeps its full assertions and calls `knownBug('BUG-nn', ...)`: while the entry is `open` the
  test is expected to fail and turns red the day the product is fixed; then set the entry to `fixed`.
- Tests that depend on a tool (netem, pause, disconnect) call `requireTool()`: the canary `E2E-NET-00` decides.
- Failed logins and anonymous calls use a fake client address on the direct API port (`X-Forwarded-For`), so rate
  limits and lockouts never leak between tests.
- Disruptive specs restore the stack themselves (`ensureHealthy()` after every test).
