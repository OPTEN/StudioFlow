# StudioFlow E2E harness

Playwright suite for the stack as a user runs it: Caddy, API, LiveKit and PostgreSQL in Docker (compose project
`sf-e2e`, or `sf-e2e-N` for a numbered stack), driven over REST, SignalR, WebRTC, the real frontends and the operations
scripts. The catalogue and the pass criteria are in `docs/testing.md`; test titles start with the catalogue ID
(`E2E-AUTH-01 [api] ...`).

## Run

```
npm run test:e2e                                   # everything, in the order smoke > main > short-ttl > disruptive
npx playwright test -c tests/e2e/playwright.config.ts --project=smoke
npx playwright test -c tests/e2e/playwright.config.ts --project=disruptive specs/net
npx playwright test -c tests/e2e/playwright.config.ts --grep "@p0"
npx playwright test -c tests/e2e/playwright.config.ts --project=desktop-chromium --grep @ui-fixture   # the UI fixture smokes
```

Global setup writes `tests/e2e/.env.e2e` (git-ignored, throwaway credentials, TLS `internal`, node IP = LAN IPv4,
fallback 127.0.0.1), checks that the ports and the subnet of the stack are free, builds and starts the project `sf-e2e`
and waits for all four healthchecks. Teardown removes containers and volumes. Logs of every service go to
`tests/e2e/.output/logs`, reports to `.output/html`, `.output/junit.xml` and `.output/results.json`.

| Variable | Effect |
| --- | --- |
| `E2E_KEEP_STACK=1` | do not tear the stack down at the end |
| `E2E_REUSE_STACK=1` | use the running stack of the selected project (implies keeping it) |
| `E2E_NO_BUILD=1` | `up -d` without `--build` (images from the last run) |
| `E2E_BUG_REPORT=1` | run the tests of open known bugs as plain tests (raw failures as evidence) |
| `E2E_NODE_IP` | node IP instead of the detected LAN IPv4 |
| `E2E_STACK=N` (1-5) | one of the five numbered stacks that run side by side, see "Parallel stacks" |
| `E2E_PROJECT` | compose project (default `sf-e2e`, with `E2E_STACK=N` `sf-e2e-N`); `E2E_PROJECT=sf-e2e-N` (N = 1-5) alone also selects numbered stack N |
| `E2E_HTTPS_PORT`, `E2E_HTTP_PORT`, `E2E_API_PORT`, `E2E_LIVEKIT_PORT`, `E2E_POSTGRES_PORT`, `E2E_SUBNET` | move the test stack when the defaults are taken (each one overrides a value of `E2E_STACK`) |
| `E2E_RTC_TCP_PORT`, `E2E_RTC_UDP_PORT` | LiveKit media ports (passed on as `STUDIOFLOW_RTC_TCP_PORT` / `STUDIOFLOW_RTC_UDP_PORT`; host and container port are the same number) |
| `E2E_BASE_URL` | origin the Playwright `baseURL` points at, if it is not `https://localhost[:E2E_HTTPS_PORT]` |
| `E2E_BASH` | bash that runs `setup.sh`/`backup.sh`/`restore.sh`/`update.sh` (default: Git Bash on Windows) |

Requirements: Docker with Compose v2, Node 22, the Playwright browsers (`npx playwright install chromium firefox
webkit`), Git Bash on Windows for the OPS specs, ports 80 and 443 free (or moved with the variables above).

## Parallel stacks

Five independent stacks can run on one machine, each with its own compose project, ports, subnet, env file, output
directory, containers, volumes, network and images. `E2E_STACK=N` selects a set; every other `E2E_*` variable still
overrides one value of it. Without `E2E_STACK` / `E2E_PROJECT` nothing changes: project `sf-e2e`, ports 80/443,
7881/7882, 18081, 17880, 15432 and subnet `172.31.250.0/24`, files in `tests/e2e/.env.e2e` and `tests/e2e/.output`.

| N | project | https | http | media tcp / udp | api | livekit | postgres | subnet | env file, output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `sf-e2e-1` | 8491 | 8091 | 7901 / 7902 | 18091 | 17891 | 15491 | 172.31.201.0/24 | `.env.e2e.sf-e2e-1`, `.output/sf-e2e-1` |
| 2 | `sf-e2e-2` | 8492 | 8092 | 7903 / 7904 | 18092 | 17892 | 15492 | 172.31.202.0/24 | `.env.e2e.sf-e2e-2`, `.output/sf-e2e-2` |
| 3 | `sf-e2e-3` | 8493 | 8093 | 7905 / 7906 | 18093 | 17893 | 15493 | 172.31.203.0/24 | `.env.e2e.sf-e2e-3`, `.output/sf-e2e-3` |
| 4 | `sf-e2e-4` | 8494 | 8094 | 7907 / 7908 | 18094 | 17894 | 15494 | 172.31.204.0/24 | `.env.e2e.sf-e2e-4`, `.output/sf-e2e-4` |
| 5 | `sf-e2e-5` | 8495 | 8095 | 7909 / 7910 | 18095 | 17895 | 15495 | 172.31.205.0/24 | `.env.e2e.sf-e2e-5`, `.output/sf-e2e-5` |

The table lives in `support/env.ts` (`numberedStack`). The services take the addresses `.10` (LiveKit), `.11` (API),
`.12` (PostgreSQL) and `.13` (Caddy) of the subnet, `STUDIOFLOW_PUBLIC_BASE_URL` carries the https port
(`https://localhost:8492`), `STUDIOFLOW_RTC_TCP_PORT` / `STUDIOFLOW_RTC_UDP_PORT` the media ports. Global setup refuses to
start a stack whose port or subnet is taken and names what holds it.

```
# PowerShell
$env:E2E_STACK = 2; npx playwright test -c tests/e2e/playwright.config.ts --project=smoke
.\tests\e2e\stack.ps1 up 2                       # start stack 2 and leave it running
.\tests\e2e\stack.ps1 test 2 --project=smoke     # run Playwright against it (a fresh stack, removed at the end)
.\tests\e2e\stack.ps1 down 2

# bash
E2E_STACK=2 npx playwright test -c tests/e2e/playwright.config.ts --project=smoke
tests/e2e/stack.sh up 2
E2E_REUSE_STACK=1 tests/e2e/stack.sh test 2 --project=desktop-chromium    # use the stack that is up
tests/e2e/stack.sh down 2
```

Two stacks at the same time are two shells (or two background jobs), each with its own `E2E_STACK`. The Docker layer
cache is shared, so the second stack builds in seconds once the first one has built. Stacks are independent of
`sf-e2e`, so the default stack and the numbered ones can run together; the only shared resource is the Docker daemon.
Keep the browsers apart as well: cookies are per host name, not per port, so one browser context talks to one stack.
`H-STACK-02` (smoke) checks that the stack under test is the selected one: compose project label, network and subnet,
fixed addresses, published ports, public URL and volumes.

## CI

GitHub Actions runs the harness as numbered stack 1 (`docs/testing.md` 6.1). `ci.yml` (every pull request and push to
`main`) loads (and checks the revision label of) the images that its `build-images` jobs built, sets `E2E_NO_BUILD=1`, starts the stack with
`tests/e2e/stack.sh up 1` and runs `E2E_REUSE_STACK=1 tests/e2e/stack.sh test 1 --project=smoke`; `e2e-full.yml`
(nightly on working days, and on demand) lets the harness build the images and runs every project except `soak`.
`CI` is set, so Playwright retries a failed test once and refuses `test.only`. A failed run uploads `tests/e2e/.output`
(report, traces, `logs/<service>.log`) as artifact. To reproduce a CI failure locally, run the same two commands (with
`E2E_NO_BUILD` unset the harness builds the images itself).

## UI fixtures

`support/ui/` holds the page objects and helpers of the UI tests; `import { test, expect } from
'../../support/ui/fixtures'` extends the harness `test` (so `config`, `api`, `production`, `onCleanup` are all there)
with `regie`, `openRegie`, `openPhone`, `openLaptop`, `openOutput`, `embedOutput` and a `context` that has the UI init
installed. Smoke tests for every piece are in `specs/ui/ui-fixtures.spec.ts` (tag `@ui-fixture`, test IDs `H-UI-nn`) and
`ui-fixtures.mobile.spec.ts`; they show how each one is used.

| Module | What it gives |
| --- | --- |
| `init.ts` | `installUiInit(context, options)`: sets `localStorage['studioflow.testHooks'] = '1'` before any app script runs (the read-only state views `window.__sfStudio` / `window.__sfSender` exist only then), the init script (WebSocket and RTCPeerConnection registries, media counters) and the fake sources; `newUiContext(browser, { profile })` with `pixel7`, `iphone15` or `desktop` profiles (Chromium, `en-US`, camera and microphone permissions); `serveFakeOrigin` for pages served with `page.route`; `clientIp` (see below); `EMBED_ORIGIN` (`https://embed.test`, in `STUDIOFLOW_FRAME_ANCESTORS` of the test env) and `FOREIGN_ORIGIN`; `openTimecodeTab` for native screen capture |
| `regie.ts` | `RegiePage`: `loginViaUi`, `loginViaApi` (session cookie injected into the context), `waitReady` (hub live: hooks, then `data-testid`, then what the DOM shows), `hooks()` / `waitForRevision` / `waitForConvergence` against the API snapshot, scene and Take locators, stations, the pairing dock (`openPairing`, `readPairingQr` with `jsqr`), knock cards (`approveKnock`, `knockCheckCode`) |
| `sender.ts` | `PhoneSender` / `LaptopSender` in a context of their own or in an existing one: pairing form, check code, connection / tally / slot states through `data-testid`, `window.__sfSender`, stored credentials, camera and screen-share buttons, `browserStopsSharing()` (what the browser's «Stop sharing» does) |
| `pairing.ts` | `pairPhoneViaQr(regie, phone)`: QR read from the dock, URL opened in the phone, station row waited for; `pairLaptopViaKnock(regie, laptop, name)`: `/join/`, check code on both screens, «Zulassen»; `pairViaApi(pairContext, sender)`: the fast path for tests that are not about pairing (REST pairing, credentials handed to the sender, it resumes into its station) |
| `output.ts` | `OutputPage.open` (directly) and `OutputPage.embed` (iframe on `https://embed.test`, `allow="autoplay; fullscreen"`): `waitForPlayingVideos`, `slateText`, `items`, `stagePixels` (screenshot of the stage, canvas coordinates), `collectLatency` and `latencyStats` over `window.__studioflowLatency` (`?latency=1`) |
| `stamp-camera.ts` | the latency stamp publisher: `installStampCamera` / `{ camera: 'stamp' }` replaces `getUserMedia({ video })` by a canvas that draws the stamp of `latency-codec.js`, so the real sender publishes stamped frames |
| `counters.ts` | `CdpCounters`: heap, nodes, listeners, documents, plus `<video>` / `<canvas>` / `<iframe>` and the sockets and peers of the init script; `growth`, `slopePerMinute` |
| `a11y.ts` | `runAxe`, `expectNoSeriousViolations` (tags `wcag2a`, `wcag2aa`; accepted rules are named with a reason; the summary is attached to the test) |
| `pixels.ts`, `video.ts`, `diagnostics.ts` | `PixelImage` (pngjs) with `mean`, `shareOfColor`, `decodeQr`; `expectVideoPlaying`; `watchPage` (page errors, CSP violations, failed requests) |

Rate limits and lockouts: a pairing request is limited to 10 per client address and 10 minutes, a redeem to 20, and five failed
logins lock an address. A browser reaches the stack through Caddy, so all UI tests would share the address of the machine
and use the allowance up (a second run within 10 minutes is refused). Every context made by `installUiInit` /
`newUiContext` (and the `context` fixture) therefore gets an address of its own (`clientIp: 'unique'`, the default): its
`POST /api/pairing/requests`, `POST /api/pairing/invites/{token}/redeem` and `POST /api/auth/login` go to the direct API
port with that `X-Forwarded-For` (`route.fetch`); everything else stays on Caddy. `clientIp: 'real'` leaves them alone,
an address shares an allowance between contexts. Tests that are not about pairing should still prefer `pairViaApi`.

Fake sources (`support/browser/fake-sources.js`): `screen: 'canvas'` (default) makes `getDisplayMedia()` return a canvas
stream with a flat colour per screen (S1 red, S2 green, S3 blue, S4 yellow, S5 violet; `SCREEN_COLORS`), a large label and
the stamp bar, so a test tells the screens apart by pixels; `screen: 'native'` keeps Chromium's capture (open
`openTimecodeTab` first, `--auto-select-tab-capture-source-by-title`). The camera is Chromium's fake device unless
`camera: 'stamp'`. `preferCurrentTab` is no option for the laptop sender (it asks livekit-client for
`selfBrowserSurface: 'exclude'`), so the canvas override is the deterministic mode and the native one is a smoke only.

## Layout

- `playwright.config.ts` projects and run order; `global-setup.ts` / `global-teardown.ts` stack lifecycle.
- `docker-compose.e2e.yml` test-only additions (127.0.0.1 ports, fixed addresses); `docker-compose.short-ttl.yml` the
  short-TTL profile (the specs recreate the API/LiveKit with it and back).
- `stack.ps1`, `stack.sh` numbered stacks (`up`, `test`, `status`, `down`).
- `support/` typed API client with CSRF (`api.ts`), hubs and the Regie/sender/output stand-ins (`hubs.ts`,
  `sync-client.ts`, `sim.ts`), pairing and production fixtures (`production.ts`, `fixtures.ts`), LiveKit helpers
  (`livekit.ts`, `livekit-browser.ts` with the latency stamp codec), fault injection (`docker-ctl.ts`, `net.ts`,
  `tcp-proxy.ts`), isolated script copies (`ops.ts`), stack settings and names (`env.ts`), start checks (`preflight.ts`),
  the English texts the specs share (`text.ts`; the German ones for the `i18n` project are in `text.de.ts`), error codes
  and thresholds (`constants.ts`), UI fixtures (`ui/`, `browser/`).
- `specs/<area>/` the tests. File suffixes choose the project: `*.disruptive.spec.ts`, `*.short-ttl.spec.ts`,
  `*.mobile.spec.ts`, `*.firefox.spec.ts`, `*.webkit.spec.ts`, `*.soak.spec.ts`; everything else runs in `smoke`
  (tag `@smoke`) or `desktop-chromium`. `specs/i18n/` and `*.de.spec.ts` run in the `i18n` project only.
- `known-bugs.json` registry of confirmed product bugs and documentation differences (each open entry carries steps, expected, actual and evidence).

## Conventions

- The suite runs in `en-US` (the product follows the browser language). Texts are literals: the specs never import the
  product catalogue, so a changed product text fails the suite. The `i18n` project (`locale: 'de-CH'`) runs the
  German checks; a fixture such as `openRegie` takes the locale of the project, `newUiContext` defaults to `en-US`.
- A confirmed product bug keeps its full assertions and calls `knownBug('BUG-nn', ...)`: while the entry is `open` the
  test is expected to fail and turns red the day the product is fixed; then set the entry to `fixed`.
- Tests that depend on a tool (netem, pause, disconnect) call `requireTool()`: the canary `E2E-NET-00` decides. The
  canary result is written per stack (`.output/<project>/canary.json`), so a numbered stack needs its own canary run
  first: include `--project=smoke` (or at least `specs/net`) when the first run on a stack contains such tests.
- The hub stand-ins (`support/hubs.ts`, `sim.ts`, `sync-client.ts`) reconnect like the product's `ResilientHub`: with
  the backoff of the product and also after a clean close by the server (SignalR's own automatic reconnect only answers
  a lost connection); a 401/403 ends the loop. Register reconnect handlers with `hub.onReconnected(...)`, not with
  `hub.connection.onreconnected(...)`.
- Failed logins and anonymous calls use a fake client address on the direct API port (`X-Forwarded-For`), so rate
  limits and lockouts never leak between tests.
- Disruptive specs restore the stack themselves (`ensureHealthy()` after every test).
- Nothing in a spec names `sf-e2e`, a port or a subnet: take names from `support/env.ts` (`PROJECT`, `containerNameOf`,
  `volumeNameOf`, `imageNameOf`, `stackConfig()`), so a spec runs on every numbered stack. The origin of the stack is
  `config.baseURL` (`https://localhost:849N` on a numbered one), and an Origin check compares with it, not with
  `https://localhost`.
- UI tests read state through the hooks or the API, wait with `expect.poll` / locators (never `waitForTimeout` for
  state), and prefer roles and the English labels; `data-testid`s only where docs/testing.md 1.7 lists them.
