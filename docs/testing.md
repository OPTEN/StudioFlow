# StudioFlow – Test plan

Authoritative, concrete test plan for StudioFlow. Later test agents implement the tests exactly as written here.
Source of truth for behaviour: `docs/architecture/implementation-spec.md` (binding), `apps/api/src/Opten.StudioFlow.Web/Endpoints/ApiSurface.cs`
and `apps/api/src/Opten.StudioFlow.Core/Contracts/*.cs` (wire contract), `docs/history/FlowStudio Architekturplan.html` (sections 4–7),
`DESIGN.md` (responsive rules, outage language), `prototype/regie.html` (Regie behaviour and UI texts).
Where the sources are silent or contradict each other, this plan **pins** an interpretation and marks it `[GAP-nn]`; all gaps are listed in
section 7 and must be resolved by the implementers (fix the code to the pinned value, or change the pin here deliberately).

Status: version 1, written 2026-10-22 against `docs/architecture/implementation-spec.md` (repository HEAD `00a6deb`) and the work in progress in the working tree (`docker-compose.yml`, `.env.example`, the ops scripts, `apps/api/src/Opten.StudioFlow.Core/Domain` and `Application`).
Where the working tree already fixes a name or behaviour that is consistent with the spec, this plan follows it; where it deviates from the spec, the deviation is listed as a gap in section 7.
Version 2 (2026-10-22, after the first full E2E run): aligned with implementation-spec 4.3, 4.5 and 12 and with the findings of `tests/e2e/known-bugs.json` (DOC-01 … DOC-07,
BUG-05/08/10/16/18/19/20/21/22, OBS-01; summary in 7.2): paused/ended semantics, template z-order, 5 s hub timeout, LiveKit token TTL 10 min, crash method and healthcheck method under Docker 29,
storage keys and opt-in test hooks as implemented, the final UI texts reported by the implementers (GAP-27).
Language: this document is English. UI strings are quoted as the English UI text in curly quotes (“Take”, “Scene A”, “0.3 s”, “2.8 Mbit/s”); the German text of any string is in
`packages/i18n/src/messages/de-CH/`. The E2E suite runs in `en-US` plus a small `de-CH` project (`tests/e2e/specs/i18n`, decision D12 in `docs/decisions.md`, tests in 2.14).
A string the spec does not define is written as a regular expression or a `data-testid` and listed in GAP-27.

Contents: 1 Test levels, tools and the E2E harness · 2 Test catalogue · 3 Browser and device matrix · 4 Manual tests · 5 Acceptance thresholds ·
6 Execution, tags and reporting · 7 Spec gaps and pinned decisions.

## 0. Conventions

### 0.1 Test IDs, levels, priorities

`<LEVEL>-<AREA>-<NN>`; `LEVEL` is the test level, `AREA` the functional area, `NN` a two-digit number that is never reused.

| Level | Meaning | Runner (stated in each header) |
|---|---|---|
| `UNIT` | Pure logic, no network, no database, no browser | `xunit` (Core, `apps/api/tests/Opten.StudioFlow.Core.Tests`), `vitest` (`packages/*`, `apps/output`), `ng` (`ng test studio`, `ng test sender`) |
| `INT` | API in-process with real PostgreSQL, real SignalR, fake LiveKit | `xunit` (`apps/api/tests/Opten.StudioFlow.Web.Tests`) |
| `E2E` | Real docker compose stack, real browsers | `pw` (Playwright, `tests/e2e`) |

Areas: `AUTH` auth and security · `PAIR` pairing · `SCENE` scenes and editing · `SWITCH` switching, broadcast, tally · `SRC` sources, stations, incidents ·
`OUT` output page · `NET` resilience and network · `DEV` devices, viewports, accessibility · `DOCK` dock layout and persistence · `MEDIA` assets · `OPS` operations ·
`SYNC` realtime protocol and state model · `LK` LiveKit integration · `TXT` texts and lower thirds · `AUDIT` audit log · `LINK` output links · `FMT` format and resolution · `XFER` duplicate, export and import · `AUD` audio · `I18N` language and formats.

Priority: **P0** blocks every merge and every release (smoke set, see 6.2); **P1** must pass before a release (full run, on demand); **P2** robustness and polish
(weekly or on demand, a failure is a defect but not a blocker).

### 0.2 Entry format

```
**<ID>** · P<n> · <runner> — <title>
- Pre: preconditions (omitted when none)
- Steps: numbered or semicolon separated actions
- Expect: observable results (UI text, API status/body, event sequence, video playing, tally colour, timing against a threshold T-…)
```

Expected values quoted in `“…”` are literal UI strings: the English text of the catalogue `packages/i18n/src/messages/en/` (the German text of the same string is in `packages/i18n/src/messages/de-CH/` and is asserted only by the `i18n` project, see 2.14). `T-…` refers to section 5; the constants of the spec (limits, windows, durations, timeouts) are asserted exactly (`T-LIMITS`). `[GAP-nn]` refers to section 7. A test that depends on a
hook (`data-testid`, `window.__fs…`, localStorage key) uses the names fixed in 1.7.

### 0.3 Common terms

- **Error codes** (`ProblemDetails.code`, `ErrorCodes.cs`): `validation_failed` (400), `unauthorized` (401), `forbidden` (403, also `device_blocked`), `not_found` (404), `conflict`, `transition_running`, `broadcast_live`, `scene_is_live`, `asset_in_use`, `limit_reached` (409), `pairing_expired` (410), `unsupported_media` (415), `rate_limited` (429), `internal_error` (500).

- **Station**: one device slot source as listed in the Stations dock (K1, S1, …), identified by its slot code.
- **Six places** (outage language, DESIGN.md): header health chip, message strip, monitor element (Program/Preview), scene list row, Sources dock row,
  Stations dock row. A helper `regie.expectOutage(code, kind)` asserts all six (1.5).
- **Fake camera / fake screen**: a source produced by the Chromium fake device flags or the timecode canvas override (1.3).
- **Short-TTL profile**: the stack started with the overrides of 1.2.6 (invite 20 s, request 20 s, credentials window 15 s, empty room 10 s, token TTL 60 s).

---

## 1. Test levels, tools and the E2E harness

### 1.1 Levels and tools

| Level | Tooling | Where | Command |
|---|---|---|---|
| .NET unit | xUnit v3 (`xunit.v3` 4.0.2), `Microsoft.Extensions.TimeProvider.Testing` (`FakeTimeProvider`; **add to `Directory.Packages.props`**), hand-written fakes (no mocking framework required) | `apps/api/tests/Opten.StudioFlow.Core.Tests` | `dotnet test apps/api/StudioFlow.slnx` (`npm run test:api`) |
| .NET integration | `WebApplicationFactory<Program>` (`Program` must be `public partial class Program`), `Testcontainers.PostgreSql` (image `postgres:17-alpine`), `Microsoft.AspNetCore.SignalR.Client`, fake `ILiveKitRoomService`, fake `TimeProvider`, `IMediaStore` on a temp dir | `apps/api/tests/Opten.StudioFlow.Web.Tests` | same |
| TypeScript unit (packages, output) | Vitest 5, projects `model` (node) and `dom` (happy-dom) from `vitest.config.ts`, `vi.useFakeTimers()`, fake hub/room classes | `packages/*/src/**/*.spec.ts`, `apps/output/src/**/*.spec.ts` | `npm run test:unit` |
| Angular unit | `ng test studio --watch=false`, `ng test sender --watch=false` (Vitest builder), `TestBed`, signals | `apps/studio`, `apps/sender` | `npm run test:studio`, `npm run test:sender` |
| E2E | Playwright `@playwright/test` ^1.64, real stack, Chromium (default), Edge channel, Firefox, WebKit | `tests/e2e` | `npm run test:e2e` |
| Static | `npm run typecheck`, `dotnet build` with `TreatWarningsAsErrors`, `dotnet format --verify-no-changes`, `npx prettier --check` | repo root | CI jobs `lint-typecheck` and `api` (6.1) |

**Harness-only dev dependencies to approve** (root `package.json` is orchestrator-owned): `@axe-core/playwright`, `jsqr`, `pngjs`, `pixelmatch`,
`ws` (raw WebSocket with custom `Origin`), `jose` (decode/verify LiveKit JWTs). Test-only NuGet: `Microsoft.Extensions.TimeProvider.Testing`.

**Integration test recipe (`INT-*`).**
- One `PostgreSqlContainer` per test class (xUnit class fixture), one database per test method (`CREATE DATABASE t_<guid>`) so tests run in parallel; migrations applied by the factory.
- Factory environment `Testing` (cookie `Secure` policy `SameAsRequest`, see spec 5), but all clients use `https://localhost` base addresses so `Secure` is emitted. Configuration overrides (the names `docker-compose.yml` passes as `STUDIOFLOW__…`, `LIVEKIT__…`, `MEDIA__…`, `DATAPROTECTION__…`, `FORWARDEDHEADERS__…` environment variables): `StudioFlow:PublicBaseUrl=https://studioflow.test`, `LiveKit:ApiKey`, `LiveKit:ApiSecret`, `LiveKit:InternalUrl=<fake server>`, `ConnectionStrings:StudioFlow=<Testcontainers database>`, `Media:Path=<temp>`, `Media:MaxImageBytes=1048576`, `Media:MaxVideoBytes=2097152`, `DataProtection:KeysPath=<temp>`, `ForwardedHeaders:KnownNetworks:0=<test proxy network>`.
- Replaced services: `TimeProvider` → `FakeTimeProvider` (all expiry/lockout/rate-limit/fade-guard code must read `TimeProvider`, [GAP-01]); `ILiveKitRoomService` → recording fake (`RemoveParticipant`, `ListParticipants` calls captured, scripted failures); remote IP → test middleware that sets `HttpContext.Connection.RemoteIpAddress` from header `X-Test-Remote-IP` (and forwarded-header trust configured for the test proxy network).
- SignalR: `HubConnectionBuilder().WithUrl(new Uri(server.BaseAddress, "/hubs/studio"), o => { o.HttpMessageHandlerFactory = _ => server.CreateHandler(); o.WebSocketFactory = (ctx, ct) => server.CreateWebSocketClient().ConnectAsync(ctx.Uri, ct); o.Headers["Cookie"] = cookie; })`, JSON protocol with the same camelCase/enum options as the server. Helper `HubRecorder` stores every `event`, `tally`, `presence`, `telemetry`, `resync` message with arrival time.
- Webhook helper `LiveKitWebhookSigner.Sign(body)` builds the HS256 JWT (`iss`=API key, `sha256` claim = base64 SHA-256 of the body) exactly like LiveKit.
- Assertions on DB state use a scoped `DbContext` from the factory; assertions on files use the temp media root.

### 1.2 E2E harness: stack under test

#### 1.2.1 Layout of `tests/e2e`

```
playwright.config.ts          projects (1.4), workers: 1, reporters, global setup/teardown
.env.e2e[.<project>]          written by global setup, git-ignored: only overrides, no secret (1.2.3)
docker-compose.e2e.yml        override file (1.2.2); docker-compose.short-ttl.yml and docker-compose.short-livekit.yml for the short-TTL profile
global-setup.ts               build/start stack, wait healthy, pull sidecar images, generate fixtures, smoke login
global-teardown.ts            docker compose logs to results/, down -v (unless E2E_KEEP_STACK=1)
fixtures/                     test.extend(): stack, apiClient, production, adminPage, adminPage2, pairPhone, pairLaptop, openOutput, embedHost, net, docker, lk, clock
helpers/                      video.ts, timecode.ts, screencast.ts, metrics.ts, regie.ts (page object), sender.ts, output.ts, api.ts (typed from generated OpenAPI), shell.ts
assets/                       generated at setup: tiny.png/.jpg/.webp/.mp4/.webm, spoof files, timecode.html, camera.y4m (ffmpeg)
specs/<area>/*.spec.ts        one file per catalogue group, test titles start with the test ID
results/                      gitignored: junit.xml, latency-*.json, soak-*.csv, logs, traces
```

#### 1.2.2 Starting the stack

The stack is started as an operator starts it (issue #27): `docker compose up -d`, no secret and no script. The harness
(`tests/e2e/global-setup.ts`, `support/stack.ts`, `stack.sh`, `stack.ps1`) writes an env file that holds only overrides and runs

```
docker compose -p sf-e2e --env-file tests/e2e/.env.e2e \
  -f docker-compose.yml -f tests/e2e/docker-compose.e2e.yml up -d --build --wait --wait-timeout 600
```

`docker-compose.e2e.yml` (the production `docker-compose.yml` is never edited by tests):
- publishes `127.0.0.1:18081:8080` (api: direct access that bypasses Caddy for header-trust tests), `127.0.0.1:17880:7880` (livekit admin/Twirp for the `lk` helper), `127.0.0.1:15432:5432` (postgres for audit and DB assertions), as `docker-compose.override.example.yml` does for development;
- the HTTPS port is `STUDIOFLOW_HTTPS_PORT` (443 for the unnumbered stack, 8491 to 8495 for the numbered ones, `tests/e2e/README.md`); nothing listens on port 80;
- sets `STUDIOFLOW_SUBNET=172.31.250.0/24` (the variable the base file uses for the network and for the API's trusted forwarded-header network) and `STUDIOFLOW_BACKEND_SUBNET=172.31.251.0/24` (the second network, ten third octets up for the numbered stacks) and gives each service a fixed `ipv4_address` on its networks (`studioflow`: livekit `.10`, api `.11`, caddy `.13`; `backend`: api `.11`, postgres `.12`) so `docker network connect --ip` restores the same address after a disconnect; with `-p sf-e2e` the networks are `sf-e2e_studioflow` and `sf-e2e_backend`;
- sets `ASPNETCORE_ENVIRONMENT=Production` for the api (cookie flags are asserted in their production form; INT tests cover `Testing`);
- keeps the image pins, healthchecks and restart policies of the base file (they are part of the system under test, see OPS).

Profiles:
- **default** (all OS, Docker Desktop included): the domain `localhost`, the media address of the machine (the detected LAN IPv4, fallback `127.0.0.1`; `E2E_NODE_IP`), browsers run on the host.
- **netns** (Linux CI only, `E2E_PROFILE=netns`, tests tagged `@netns`): the domain `sf.e2e.test` (all browsers use `--host-resolver-rules="MAP sf.e2e.test 172.31.250.1"`), the media address `172.31.250.1` (bridge gateway, reachable from the host and from containers), and sender browsers run in **phone host containers** (`mcr.microsoft.com/playwright:v<pw-version>-noble`, `npx playwright run-server --port 3000`, joined to the compose network, connected with `chromium.connect()`). This gives each phone its own network namespace, so netem/disconnect on the *phone container* impairs hub and media of that phone only (real uplink loss).
- **short-ttl** (project `short-ttl`, tests tagged `@short-ttl`): `docker-compose.short-ttl.yml` and `docker-compose.short-livekit.yml` set the TTL keys of [GAP-01]; the project recreates the api and LiveKit at its start and end.

#### 1.2.3 Test environment (`tests/e2e/.env.e2e`, written by global setup, git-ignored)

```
STUDIOFLOW_HTTPS_PORT=443                    # numbered stacks: 8491 ... 8495
STUDIOFLOW_RTC_TCP_PORT=7881                 # STUDIOFLOW_RTC_UDP_PORT=7882
STUDIOFLOW_SUBNET=172.31.250.0/24
MEDIA__MAXIMAGEBYTES=...  MEDIA__MAXVIDEOBYTES=...   # small limits so the size tests stay fast
E2E_NODE_IP=<the media address>  E2E_API_PORT=...  E2E_LIVEKIT_PORT=...  E2E_POSTGRES_PORT=...  E2E_IP_*=...
```

There is **no secret** in the file. The stack makes its own (the `init` service); the harness reads the LiveKit key pair and the
database password from the running containers into `.output/<project>/stack-secrets.json` (`writeStackSecrets`). The server is
set up the way an operator does it in the wizard, through the admin API (`ensureHarnessAccount`, `ensureHarnessConfigured`):
global setup, and every `ensureHealthy`, reads the setup code from `docker compose logs api`, `POST`s `/api/auth/setup` on the
direct API port (user `e2e-admin`, a fixed test-only password), logs in, and, if the server is not configured yet, saves the
media address (`E2E_NODE_IP`), the local certificate with the domain `localhost` and the embedding origins
`https://embed.e2e.test https://embed.test`, then waits until Caddy, LiveKit and the backup service run the saved settings
(`GET /api/settings/status`). A reused stack that has the account and the settings is left alone. The values are never used
outside tests; the production checks (E2E-OPS-31, -34) assert that no script exists and that the secrets are made by the stack.

#### 1.2.4 Resetting state and isolation

- **One stack per run** (per CI shard). `workers: 1`, `fullyParallel: false`: the *active production* is global (`/join` pairs into it, spec 4.6), so two tests that
  pair by code or open the Regie cannot run concurrently in one stack. CI scales by sharding over runners (`--shard=i/n`), each runner with its own stack.
- **Per test**: fixture `production` creates `POST /api/productions {name: "e2e <testId> <rand6>"}` (unique slug), activates it, and seeds the scenes the test asks for
  (`production.seed({ scenes: ['Scene A','Scene B','Scene C'] })` renames the three default scenes “Welcome”, “Presentation”, “Break” that every created production gets, and adds more on request [GAP-02]). `production.id`, `production.slug`, `production.outputKey`
  (from `GET …/output`) are available.
- **After each test** (auto fixture): `POST …/broadcast/reset`; delete every device the test created (`DELETE …/devices/{id}` kicks the sender); close all contexts;
  restore `allowedIps` to `[]`; restore the name of the production when the test renamed it (a name like “… renamed” would make `getByRole('button', { name: 'Rename' })` ambiguous in the production menu, which lists every production: its locators use `exact: true`); if the test was `@disruptive`, `stack.ensureHealthy()` (waits until all four containers are healthy, `/health/ready` is 200 and the admin login works).
- There is no production delete endpoint; productions accumulate within a run and are removed by `down -v` in global teardown.
- **Project order**: `smoke` (P0 non-disruptive) → `main` (all non-disruptive) → `short-ttl` → `disruptive` (restarts, kills, lockout, rate limits; runs last) → `soak` (manual or nightly only). Tests tagged `@perf` are in none of these: `main` leaves them out and the project `perf` runs them on demand (6.8).
- **Lockout and rate-limit tests** change process-wide counters keyed by client IP (all E2E traffic shares one IP behind Caddy). They are tagged `@disruptive`
  and end with `docker compose restart api` (counters live in memory, [GAP-03]); no other project may follow them without that restart.

#### 1.2.5 Typed API client and fixtures

`apiClient` wraps Playwright's `APIRequestContext` with the admin cookie (obtained once in global setup, stored in `storageState`) and the header `X-StudioFlow: 1` on every unsafe
request. Method names equal the `operationId`s of `ApiSurface.cs` (`switchProgram`, `take`, `addSceneItem`, …) and use the generated types of
`packages/scene-model/src/generated/api.ts`. `apiClient.raw` gives untyped access (wrong headers, malformed bodies).

```ts
// fixtures/index.ts (signatures; implementations are part of the harness work)
type Fixtures = {
  stack: Stack;                      // worker scope: baseURL, ports, admin credentials, compose project, dockerCompose(...args)
  apiClient: ApiClient;              // admin session + CSRF header
  production: Production;            // test scope: created, activated, seeded
  adminPage: Regie;                  // Page object, logged in via storageState, waited for [data-testid=regie-ready]
  adminPage2: Regie;                 // second operator (separate context, own login)
  pairPhone(o?: { name?: string; via?: 'ui' | 'api'; device?: 'pixel7' | 'iphone14' | 'iphone15' | 'ipad'; autoStart?: boolean;
                  timecodeCamera?: boolean; container?: boolean /* @netns */ }): Promise<PhoneSender>;
  pairLaptop(o?: { name?: string; via?: 'code' | 'link' | 'api'; screens?: number; withCamera?: boolean }): Promise<LaptopSender>;
  openOutput(o?: { key?: string; slug?: string; bg?: 'transparent'; debug?: boolean; size?: { w: number; h: number };
                   embed?: boolean; browser?: 'chromium' | 'firefox' | 'webkit' }): Promise<OutputView>;
  embedHost: EmbedHost;              // serves host pages at https://embed.e2e.test and https://other.e2e.test via page.route
  net: NetworkControl;               // 1.6
  docker: DockerControl;             // restart/stop/start/kill/pause/unpause/networkDisconnect/networkConnect/logs/stats per service
  lk: LiveKitAdmin;                  // listParticipants/removeParticipant via Twirp on 127.0.0.1:17880 with a self-signed roomAdmin JWT
  clock: TimecodeSource;             // opens the "StudioFlow Timecode" tab
};
interface PhoneSender { deviceId: string; code: string /* K1 */; page: Page; context: BrowserContext;
  startCamera(): Promise<void>; stopCamera(): Promise<void>; tally(): Promise<'program'|'preview'|'off'>;
  connection(): Promise<'connected'|'reconnecting'|'blocked'|'replaced'>; goOffline(): Promise<void> /* net.cut */; goOnline(): Promise<void> /* net.restore */;
  reload(): Promise<void>; duplicateTab(): Promise<Page>; close(): Promise<void>; }
interface LaptopSender extends Omit<PhoneSender,'startCamera'|'stopCamera'> { shareScreen(n?: number): Promise<void>; endShare(n?: number): Promise<void>;
  addScreen(): Promise<number>; removeScreen(n: number): Promise<void>; reshare(n?: number): Promise<void>; startCamera(): Promise<void>; }
interface OutputView { page: Page; frame: FrameLocator | null; sceneId(): Promise<string|null>; slate(): Promise<{kind:'standby'|'end'|'denied'|null;title?:string;subtitle?:string}>;
  item(idOrSource: string): Locator; state(idOrSource: string): Promise<'live'|'hold'|'held'|'fallback'|'missing'|'connecting'>;
  stats(): Promise<{fps:number;items:number;videos:number}>; readTimecode(idOrSource: string): Promise<number|null>;
  startScreencast(): Promise<Screencast>; }
```

`pairPhone(via:'ui')` opens the phone invite URL in a fresh context (device descriptor + fake media args) and waits for “Connected”; `via:'api'` redeems through REST and writes the
credentials to localStorage key `studioflow.sender.v1` (fast path for tests that are not about pairing). `pairLaptop` is analogous (`code`: `/join` form + approval through the
admin API; `link`: `/j/{token}`).

#### 1.2.6 Short-TTL overrides (keys to be provided, [GAP-01])

`Pairing:InviteTtl=00:00:20`, `Pairing:RequestTtl=00:00:20`, `Pairing:CredentialsWindow=00:00:15`, `Pairing:RedeemIdempotencyWindow=00:00:10`, `Pairing:Limits:PendingTotal=3`,
`LiveKit:TokenTtl=00:01:00`, `Admin:Lockout:*` unchanged; LiveKit's own `room.empty_timeout` (300 s in the `LIVEKIT_CONFIG` block of the compose file) is set to 10 in the override. `docker-compose.test.yml` forwards the keys as `PAIRING__…`/`LIVEKIT__…` environment variables of the api (the base file does not know them). Spec defaults are 30 min / 10 min / 5 min / 5 min / 10 min / 300 s.

### 1.3 Browser launch configuration and fake media

**Chromium (default, also Pixel 7 and Edge)** – `launchOptions.args`:

```
--use-fake-device-for-media-stream        # synthetic camera (moving pattern), any requested resolution
--use-fake-ui-for-media-stream            # auto-accept camera permission
--auto-select-tab-capture-source-by-title=StudioFlow Timecode   # getDisplayMedia() picks the tab titled "StudioFlow Timecode" without a picker
--allow-loopback-in-peer-connection --disable-features=WebRtcHideLocalIpsWithMdns   # ICE host candidates 127.0.0.1
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
--enable-precise-memory-info              # performance.memory
--ignore-certificate-errors               # Caddy internal CA, also for service workers
```
Optional: `--use-file-for-fake-video-capture=tests/e2e/assets/camera.y4m` (generated in global setup with `ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 10 -pix_fmt yuv420p camera.y4m`)
for a deterministic camera picture. Never pass `--autoplay-policy=no-user-gesture-required` (it would hide autoplay defects of the output page).

**Fake screen share.** `E2E_SCREEN_MODE=tab` (default on Chromium): `clock.open()` opens a tab titled `StudioFlow Timecode` in the same browser; the sender's `getDisplayMedia()` captures it.
Closing that tab ends the capture and fires `ended` on the track (this is the automatable equivalent of the browser's “Stop sharing” button, `laptop.endShare(n)`).
Fallbacks if the flag misbehaves in a Chromium version: `--auto-accept-this-tab-capture` (shares the sender tab itself), or `E2E_SCREEN_MODE=canvas` (init script replaces
`navigator.mediaDevices.getDisplayMedia` with a `canvas.captureStream(30)` of the timecode canvas; `endShare` then calls `track.stop()` and dispatches `ended` manually). `canvas` mode is
the only mode on Firefox and WebKit. The first harness test `E2E-NET-00` verifies the mode in use.

**Timecode canvas (`assets/timecode.html`, also injected as a camera).** 1280×720 canvas redrawn every `requestAnimationFrame`: the lower 40 bits of `Date.now()` (ms) plus an 8-bit XOR checksum
of its 5 bytes, encoded as 48 black/white blocks (16 columns × 3 rows, each 80×80 px at the top-left, bit 0 = most significant, white = 1), plus the decimal value as text for humans.
`timecodeCamera: true` makes the init script return this canvas stream from `getUserMedia({video})`, so a *camera* path with known content exists (the fake device has none).
`readTimecode()` (helper) draws the received `<video>` into a 2D canvas, samples the centre 20×20 px of each block at `videoWidth/16` pitch, thresholds at luminance 128, verifies the checksum
(frames that fail are counted and discarded), and returns `Date.now() % 2^40` of the source paint time. Latency = `(Date.now() % 2^40) − decoded` (wrap safe). Both clocks are the host clock, so there is no skew.

**Init script (all projects, `helpers/init-script.ts`, `context.addInitScript`).** Wraps `WebSocket` and `RTCPeerConnection` to keep registries `window.__sfNet.sockets/peers` and `window.__sfNet.counts()`; records every `getUserMedia` constraint object in `window.__sfMedia.userMediaCalls` and counts `getDisplayMedia` calls in `window.__sfMedia.displayCalls`; optionally replaces `getUserMedia({video})`/`getDisplayMedia` with the timecode canvas streams (`timecodeCamera`, `E2E_SCREEN_MODE=canvas`); can make `getUserMedia` reject (`window.__sfMedia.failCamera = true`); stubs `navigator.getBattery` and `navigator.wakeLock` when a test asks for it; installs the `window.__xss` canary check. None of this ships in the product.

**Fake sound and the audio probe (issue #7, `support/browser/fake-audio.js`, `audio-probe.js`, options `mic`, `screenAudio`, `audioProbe`,
`audioGate` of `newUiContext`).** Chromium's fake microphone beeps at an unknown pitch, so the audio specs replace it: `getUserMedia({audio})` without
video returns a **sine tone of a known frequency and level** (`mic: { frequency, level, channels }`), `getDisplayMedia({audio: true})` adds a second tone when
`screenAudio` is set (a context without it models a browser that shares no sound: the request is answered with a picture only). The tone is written
into a `MediaStreamTrackGenerator` (an audio track made of `AudioData`), not into an `AudioContext`, because the audio station starts its microphone
at load, before anybody touched the page, and an audio context made then stays suspended. `window.__sfAudioFake` changes the live tones (`setTone('mic',
{ level: 0 })` is silence, another frequency tells sources apart), pulls the microphone out and puts it back (`unplugMic()` ends the tracks, makes the next
request fail with `NotFoundError` and fires `devicechange`; `replugMic()`). Every source records `stats.maxGapMs`, the longest pause between two chunks: a
starved machine drops a few hundred milliseconds of a tone now and then, which is a fact of the test machine, not of the product.
`window.__sfAudioProbe` (installed with `audioProbe: true`) is connected to **everything that a page sends to its speakers** (every node connected to the
destination of an `AudioContext` also feeds an analyser): `measure()` returns the peak and RMS of the last 1024 samples (21 ms), the dominant frequency
and the spectral peaks of the last 8192 samples (170 ms, 5.9 Hz per bin; the peaks are interpolated); `waitFor(test)`, `series(n, ms)`,
`toneDb(f)` and `toneSeries([f…], n, ms)` measure over time. A frequency in the output page proves that a source went through LiveKit, the output page
and the mixer, and silence that it did not; the level checks use unity gain at -6 dBFS (a tone of amplitude 0.5). **Autoplay:** Playwright's own
evaluations and navigations count as user activation in Chromium and the output page asks the browser again every two seconds, so a page that was
touched by the test is never "blocked"; `audioGate: true` makes every audio context of the context wait for the first **trusted** click, key press or
touch (`resume()` stays pending, `state` is `suspended`), which is what a browser window that a person opened does. Specs that need a started output
page click it once (`unlockSound`, `page.mouse.click`); the one that tests the block does not touch it.

**Firefox** (`firefoxUserPrefs`): `media.navigator.streams.fake=true`, `media.navigator.permission.disabled=true`, `media.peerconnection.ice.loopback=true`,
`media.peerconnection.ice.obfuscate_host_addresses=false`, `media.getusermedia.screensharing.enabled=true`. Camera works; screen share only in `canvas` mode. H.264 may be unavailable
(OpenH264), VP8 fallback is acceptable there.

**WebKit**: Playwright WebKit does not offer the Chromium flags. Whether it exposes mock capture devices must be verified by `E2E-DEV-08` first; if `getUserMedia` is unavailable, WebKit
projects run the **UI-only subset** (pairing forms, redeem, layout, tally rendering through API-driven `tally` messages, screen-reader/touch checks) and media is covered by MAN-01.

### 1.4 Playwright projects

| Project | Browser / device | Used for |
|---|---|---|
| `chromium-desktop` | Desktop Chrome 1440×900 + Chromium args | Regie, output, laptop sender (default for everything not listed) |
| `edge-desktop` | `channel: 'msedge'` | smoke subset (login, switch, share) |
| `firefox-desktop` | Desktop Firefox + prefs | Regie smoke, output rendering, laptop pairing, camera sender |
| `webkit-desktop` | Desktop Safari (WebKit) | Regie smoke, output rendering (Safari embeds), CSS/layout |
| `pixel7` | `devices['Pixel 7']` + Chromium args, portrait and landscape | phone sender |
| `iphone14`, `iphone15` | `devices['iPhone 14']`, `devices['iPhone 15']` (WebKit) | phone sender (UI-only subset unless fake capture works) |
| `ipad` | `devices['iPad (gen 7)']` landscape and portrait (WebKit) | sender kind detection, layout |
| `regie-1280x720`, `regie-1440x900`, `regie-1920x1080`, `regie-1180`, `regie-900`, `regie-390x844` | Chromium with fixed viewport | responsive Regie tests (`E2E-DEV-01…06`) |
| `small-320` | 320×568, touch, Chromium | sender at the narrowest width |
| `i18n` | Chromium with `locale: 'de-CH'` | `specs/i18n` (2.17: the tests set the browser language they need), the German rules audit of `E2E-DEV-17`, files `*.de.spec.ts` |
| `short-ttl`, `disruptive`, `soak` | Chromium | see 1.2.4 |
| `perf` | Chromium, three instances per test (senders, Regie, output) | every test tagged `@perf`, in any spec: `*.perf.spec.ts` (2.20, CPU, decoders and encoders per role against the performance budget, 5.1), the latency, many-sources, CPU-throttling and switching-time tests (6.8); on a machine with at least 4 cores and nothing else running; never in `smoke` or `main` (so not in the nightly run), never retried; run by hand or with the workflow `perf.yml` |

```ts
// tests/e2e/playwright.config.ts (skeleton)
export default defineConfig({
  testDir: './specs', outputDir: './results/artifacts',
  timeout: 60_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  globalSetup: './global-setup.ts', globalTeardown: './global-teardown.ts',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'results/html' }], ['junit', { outputFile: 'results/junit.xml' }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'https://localhost', ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'Europe/Zurich',
         trace: 'retain-on-failure', video: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 15_000 },
  projects: [ /* smoke -> main -> short-ttl -> disruptive (dependency chain), soak (manual), plus the device/viewport projects above */ ],
});
```

All projects set `locale: 'en-US'` (only the `i18n` project sets `locale: 'de-CH'`), `timezoneId: 'Europe/Zurich'`, `ignoreHTTPSErrors: true`, `permissions: ['clipboard-read','clipboard-write']` (Chromium), trace/video/screenshot `retain-on-failure`.

### 1.5 Waiting, pixels and page objects

**Never `waitForTimeout` for state.** Use `expect.poll`, `locator.waitFor`, `page.waitForFunction`, and the helpers:

```ts
// helpers/video.ts
export async function expectVideoPlaying(video: Locator, { minFps = 15, timeout = 10_000 } = {}) {
  await expect.poll(() => video.evaluate(async (el: HTMLVideoElement, min) => {
    if (el.videoWidth === 0 || el.readyState < 2 || el.paused) return false;
    const q0 = el.getVideoPlaybackQuality().totalVideoFrames, t0 = el.currentTime;
    await new Promise(r => setTimeout(r, 1000));
    return el.getVideoPlaybackQuality().totalVideoFrames - q0 >= min && el.currentTime > t0;
  }, minFps), { timeout }).toBe(true);
}
export async function expectVideoFrozen(video: Locator, ms = 1500) { /* totalVideoFrames unchanged over ms while the element stays attached and visible */ }
```

(Static screen shares produce few frames; tests use the animated timecode source, or assert `currentTime` only.)

- `startScreencast(page)` (CDP `Page.startScreencast`, JPEG, `everyNthFrame: 1`) returns frames with timestamps; `meanLuminance(frame, rect)` is computed with `pngjs`/`sharp`-free JPEG decode in the page (`createImageBitmap` + canvas) or in Node. Used for black-frame and fade-continuity checks (item rect mean luminance ≥ 20 on the timecode/fake sources).
- `Regie` page object: `scene(name)`, `clickScene(name)`, `key(n)`, `studio.toggle()/isOn()`, `take()`, `transition.set('cut'|'fade')`, `duration.up()/down()/value()`, `station(code)`, `source(code)`, `openPairing('phone'|'laptop'|'link')`, `output.open()`, `expectOutage(code,'reconnecting'|'ended'|'lost'|'blocked')` (six places), `expectRecovered(code)`, `ack(code)`, `expectNoOverflow()`, `expectInViewport(locator)`.
- Locators are role-based first (the prototype's `aria-label`s are the contract), `data-testid`/`data-*` only where 1.7 lists them.

### 1.6 Network impairment and fault injection (`net`, `docker`, `lk`)

| Helper | Effect | Affects | Does not affect |
|---|---|---|---|
| `net.browserOffline(ctx, on)` → `context.setOffline` | fetch, XHR and new WebSocket connections of that browser context (existing sockets are closed or stall in current Chromium – verified by `E2E-NET-00`) | REST, SignalR hubs, LiveKit signalling | established WebRTC media (UDP) |
| `net.cut(ctx)` / `net.restore(ctx)` (what `phone.goOffline()/goOnline()` and the Regie equivalents use) | closing every tracked `WebSocket` and `RTCPeerConnection` (the init script keeps the registries `window.__sfNet.sockets/peers`) **first** and waiting for the close handshake, then `setOffline`; from the first moment the page cannot open new sockets or peers (`__sfNet.blocked`), so an app cannot reconnect in the gap. With `setOffline` first the emulated offline mode swallowed traffic of the open sockets now and then (in a probe under load the server's Close reply never reached the page in 4 of 7 cuts, and in one cut the hub connection outlived the cut): the server saw a silent loss, the Regie showed the outage after 3.8-4 s instead of 0.1-0.5 s (issue 30) and the test measured `T-DETECT-SILENT` instead of `T-DETECT-CLEAN`. `cut` returns `{ at, clean }`: `at` is `Date.now()` inside the page when the connections were closed (start a detection time there), `clean` that every socket finished its close handshake. `restore` lifts the block, then clears offline so the browser fires `online` | hub **and** media of that page: the closest software equivalent of "the Wi-Fi is gone" | other pages, the server |
| `net.cdpThrottle(page, profile)` → CDP `Network.emulateNetworkConditions` | latency and throughput of HTTP requests (WebSocket frames are not reliably throttled by Chromium, so hub behaviour under throttling is judged on negotiate/REST) | REST, uploads, page load | WebRTC media, WebSocket frames |
| `net.routeFault(page, urlGlob, { status \| delayMs \| abort })` → `page.route` | selected requests | one page | others |
| `lk.pause()/unpause()` → `docker pause <livekit>` / `docker unpause <livekit>` | process frozen, sockets stay open, no RST: **silent loss** for all media and the signalling WebSocket | all browsers | api, hubs |
| `lk.disconnect()/connect()` → `docker network disconnect sf-e2e_studioflow <livekit>` / `docker network connect --ip 172.31.250.10 --alias livekit sf-e2e_studioflow <livekit>` | container unreachable (no RST for new packets) | all browsers | — (published ports can need a restart after reconnect; the canary checks it) |
| `lk.netem({ delayMs, jitterMs, lossPct, rateKbit })` → `docker compose -p sf-e2e --profile chaos run --rm netem apply <delay_ms> <jitter_ms> <loss_pct> [rate]` (e.g. `apply 200 20 0`, `apply 0 0 5`, `apply 0 0 0 1mbit`), `lk.clearNetem()` → `… netem clear`, `… netem show`: the `netem` service of the base compose file (`infra/netem/netem.sh`) shares LiveKit's network namespace and shapes **egress and ingress** (ingress mirrored to `ifb0`). Fallback without that service (egress only): `docker run --rm --net container:<livekit> --cap-add NET_ADMIN nicolaka/netshoot tc qdisc replace dev eth0 root netem delay 200ms 20ms loss 5% rate 1mbit`, clear with `tc qdisc del dev eth0 root` | all traffic of LiveKit in both directions: phone uplink, subscriber downlink, signalling through Caddy, and the LiveKit → API webhooks | media and signalling of every client at once | browser ↔ API/Caddy HTTP traffic |
| `phone.netem(...)`, `phone.disconnect()` (profile `netns`) | same on the phone host container: real silent loss, real uplink loss | that phone's hub **and** media | other phones |
| `docker.restart(svc)`, `docker.stop(svc)`, `docker.start(svc)`, `docker.kill(svc)` with `svc` in `api`, `livekit`, `postgres`, `caddy` → `docker compose -p sf-e2e <cmd> <service>`; `kill` = crash: `kill -TERM 1` inside the container (`kill -QUIT 1` for PostgreSQL), relies on `restart: unless-stopped` – since Docker 29 a `docker kill` counts as a manual stop and the restart policy does not bring the container back [DOC-04] | container lifecycle | per service | — |
| `docker.logs(service, since)`, `docker.stats(service)` (`docker stats --no-stream --format json`) | evidence and memory | — | — |

CPU and memory: `cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })`; `cdp.send('HeapProfiler.collectGarbage')` before each sample, then `Performance.getMetrics`
(`JSHeapUsedSize`, `Nodes`, `JSEventListeners`, `Documents`, `TaskDuration`); the same init script exposes `window.__sfNet.counts()` (live `RTCPeerConnection`s and open `WebSocket`s) and tests count `document.querySelectorAll('video').length`.

`netem` needs the kernel modules `sch_netem`, `ifb` and `act_mirred` (CI: `tests/e2e/load-netem-modules.sh` runs `sudo modprobe sch_netem ifb act_mirred`, installs `linux-modules-extra-$(uname -r)` if that fails, and sets `E2E_NETEM=unavailable` with a warning annotation if the kernel still lacks them, which makes the canary record the tool as skipped; WSL2/Docker Desktop kernels normally have them). **`E2E-NET-00` (canary) must pass before any impairment test runs**: if a tool does not work, the
dependent tests fail with a clear message instead of passing vacuously.

### 1.7 Required test hooks (contract with the implementers)

The spec defines no DOM hooks; the following are required so tests do not depend on layout or CSS ([GAP-15]).

**Opt-in for the global state views (spec 12).** `window.__sfStudio` and `window.__sfSender` exist only when `localStorage['studioflow.testHooks']` is exactly `'1'`
when the app starts (Regie: when the production store is created; sender: when the station starts); E2E sets the flag with an init script before any page script runs. Without the flag
(also `'0'`, `'true'`, `' 1'`, or storage blocked) the properties do not exist (`'__sfStudio' in window === false`). With it they are frozen, non-enumerable and non-writable objects whose
getters read the live state; assignments throw in strict mode; they live as long as the page (removed when the Angular service is destroyed; after a sign-out `__sfStudio` reports `revision: null`, `hub: 'idle'`). No other global debug object exists in a
production build except the output page's `?latency=1` aid (`window.__studioflowLatency`).

**Regie** (`apps/studio`): the roles/names of the prototype are the contract (`Studio Mode` switch (`role=switch`), group `Transition type` with `Cut`/`Fade`, group `Fade duration` with
`Shorter fade`/`Longer fade`, `Take` with `aria-keyshortcuts="Space"`, scene buttons `<name>[, live on Program][, in Preview][, K2 disrupted]` with `aria-pressed`, `Docks and layout`, `Pair device`,
grips `Move dock <title> with the arrow keys`, separators `Height of the docks at the bottom` / `Width of the docks on the left|on the right` / `Size of A and B` / `Size of Preview and Program`, station rows with `aria-expanded` and
`<code> <name>[, on Program|in Preview][, <state>]`, canvases `role=img` `Program monitor: <scene>, matches the output`, toast `role=status`). Additionally:
`[data-testid=regie-ready]` (set after the first snapshot), `[data-testid=connection-state][data-state=connected|reconnecting|disconnected]` (hub state, visible indicator), `[data-testid=toast]`,
`[data-scene-id]` on scene buttons, `[data-code]` on station rows, `[data-item-id]` on Sources rows and overlay boxes, `[data-testid=monitor-program|monitor-preview]`, `[data-testid=overlay]`.
`window.__sfStudio = { revision: number|null, lastSync: 'delta'|'snapshot'|null, hub: 'idle'|'connecting'|'connected'|'reconnecting'|'unauthorized'|'stopped' }` (read-only, opt-in; `revision` null before the first snapshot, `lastSync` = kind of the last `Subscribe` answer).

**Sender** (`apps/sender`): `[data-testid=tally][data-tally=program|preview|off]`, `[data-testid=connection-state][data-state=connected|reconnecting|blocked|replaced]`,
`[data-testid=check-code]`, `[data-testid=pairing-denied|pairing-expired]`, `[data-testid=slot-<slot>][data-state=starting|live|paused|ended|failed]`, `[data-testid=message-banner]`.
`window.__sfSender = { slots(): Record<string,string>, rtc(): string, sessionId: string }` (read-only, opt-in). Storage as implemented [GAP-15]: localStorage `studioflow.sender.v1` =
`{"deviceId","secret","productionId"}` once paired (before that only `{"clientId"}`, the redeem client id); localStorage `studioflow.sender.settings` =
`{"facing","resolution","dark","cameraOn","sharedScreens","techCheck"}`; sessionStorage `studioflow.pairing` = `{"requestId","pollToken","checkCode","expiresAt","name","kind"}`.

**Output** (`apps/output`): stage element `[data-scene-id]`; per item `[data-item-id][data-source][data-state=live|hold|held|fallback|missing|connecting]`;
slate `[data-slate=standby|end|denied]` with `[data-testid=slate-title]`, `[data-testid=slate-subtitle]`; debug overlay `[data-testid=debug-overlay]` (one `key: value` per line);
No `window.__sfOutput` (spec 12): tests read the DOM attributes above and the `debug=1` overlay; `?latency=1` collects latency samples in `window.__studioflowLatency`.

**localStorage (Regie)**: `studioflow.studio` = `'1'|'0'`; `studioflow.layout` = JSON v1 (prototype shape); `studioflow.transition` = `{"kind":"cut"|"fade","durationMs":300}` [GAP-34].

### 1.8 Test data

Generated in global setup into `assets/` (not committed): `tiny.png` (1×1), `photo.jpg` (progressive, 640×360), `photo.webp`, `clip.mp4` (H.264, 3 s, `ftyp isom`), `clip.webm` (VP8, 3 s, EBML doctype `webm`), `big.png` (> `Media:MaxImageBytes`),
`big.mp4` (> `Media:MaxVideoBytes`), spoofs: `svg-as-png.png` (SVG text), `svg-with-xml.svg`, `gif-as-png.png` (GIF89a), `exe-as-png.png` (`MZ…`), `html-as-png.png`, `png-with-js-trailer.png` (valid PNG + `<script>` trailer),
`jpeg-with-script-comment.jpg`, `heic.mp4` (`ftypheic`), `avif.mp4` (`ftypavif`), `mkv.webm` (EBML doctype `matroska`), `png-bomb.png` (IHDR 60000×60000, 100 bytes), `traversal-names` (list), `empty.bin`.
XSS payload set `XSS = ['<img src=x onerror="window.__xss=1">', '"><script>window.__xss=1</script>', "'><svg/onload=window.__xss=1>", '{{constructor.constructor("window.__xss=1")()}}', '\u202eevil\u202c', 'a'.repeat(200)]`.

### 1.9 Reporting inside the harness

Every E2E test title starts with its ID. Timing tests attach their samples as JSON (`testInfo.attach('latency-<profile>.json', …)`) and write `results/*.json|csv`; the run summary
(`results/summary.md`) lists p50/p95/max of every `T-…` metric next to its threshold. Numbers are recorded even when the test passes.

---

## 2. Test catalogue

Counts per area and level are in 2.0 (generated from this file). Unless a test says otherwise, E2E tests run in the `chromium-desktop` project (browser language `en-US`) with the `production`
fixture (fresh active production with scenes `Scene A`, `Scene B`, `Scene C`) and a logged-in `adminPage`.

### 2.0 Summary

<!--SUMMARY-->
| Area | Unit | Integration | E2E | Total | P0 | P1 | P2 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `AUTH` Auth and security | 12 | 29 | 31 | 72 | 36 | 29 | 7 |
| `PAIR` Pairing | 8 | 17 | 20 | 45 | 19 | 21 | 5 |
| `SCENE` Scenes and editing | 20 | 7 | 24 | 51 | 19 | 26 | 6 |
| `SWITCH` Switching, broadcast, tally | 9 | 6 | 20 | 35 | 18 | 12 | 5 |
| `SRC` Sources, stations, incidents | 9 | 7 | 27 | 43 | 20 | 19 | 4 |
| `OUT` Output page | 12 | 0 | 25 | 37 | 16 | 17 | 4 |
| `NET` Resilience and network | 4 | 6 | 27 | 37 | 13 | 16 | 8 |
| `DEV` Devices, viewports, accessibility | 0 | 0 | 23 | 23 | 7 | 13 | 3 |
| `DOCK` Dock layout | 6 | 0 | 11 | 17 | 6 | 6 | 5 |
| `MEDIA` Media assets | 3 | 12 | 10 | 25 | 10 | 10 | 5 |
| `OPS` Operations | 2 | 0 | 27 | 29 | 13 | 13 | 3 |
| `SYNC` Realtime protocol and state model | 4 | 8 | 0 | 12 | 5 | 5 | 2 |
| `LK` LiveKit integration | 1 | 2 | 4 | 7 | 3 | 2 | 2 |
| `TXT` Texts and lower thirds | 5 | 3 | 5 | 13 | 4 | 8 | 1 |
| `AUDIT` Audit log | 6 | 7 | 4 | 17 | 10 | 7 | 0 |
| `LINK` Output links and the camera | 5 | 4 | 3 | 12 | 9 | 2 | 1 |
| `FMT` Format and resolution | 5 | 3 | 3 | 11 | 6 | 4 | 1 |
| `XFER` Duplicate, export and import | 6 | 6 | 8 | 20 | 12 | 8 | 0 |
| `PERF` Performance | 6 | 1 | 1 | 8 | 3 | 5 | 0 |
| `AUD` Audio | 7 | 3 | 17 | 27 | 14 | 12 | 1 |
| `I18N` Language and formats | 0 | 0 | 13 | 13 | 0 | 13 | 0 |
| **Total** | **130** | **121** | **303** | **554** | **243** | **248** | **63** |
<!--/SUMMARY-->

Areas: [2.1 AUTH](#21-auth--auth-and-security) · [2.2 PAIR](#22-pair--pairing) · [2.3 SCENE](#23-scene--scenes-and-editing) · [2.4 SWITCH](#24-switch--switching-broadcast-tally) · [2.5 SRC](#25-src--sources-stations-and-incidents) · [2.6 OUT](#26-out--output-page) · [2.7 NET](#27-net--resilience-and-network) · [2.8 DEV](#28-dev--devices-viewports-accessibility) · [2.9 DOCK](#29-dock--dock-layout-and-persistence) · [2.10 MEDIA](#210-media--assets) · [2.11 OPS](#211-ops--operations) · [2.12 SYNC](#212-sync--realtime-protocol-and-state-model) · [2.13 LK](#213-lk--livekit-integration) · [2.14 TXT](#214-txt--texts-and-lower-thirds) · [2.15 AUDIT](#215-audit--audit-log) · [2.16 LINK](#216-link--output-links-and-the-camera) · [2.18 FMT](#218-fmt--format-and-resolution) · [2.17 I18N](#217-i18n--language-and-formats) · [2.19 XFER](#219-xfer--duplicate-export-and-import) · [2.20 PERF](#220-perf--performance-issue-12) · [2.21 AUD](#221-aud--audio)


### 2.1 AUTH – Auth and security

**Route policy matrix (pinned, [GAP-04]).** `INT-AUTH-09` enumerates all endpoints from `EndpointDataSource` and fails when a route is not in this table.

| Route(s) | Policy | Without credential |
|---|---|---|
| `POST /api/auth/login` | anonymous, lockout-protected | – |
| `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/system/info` | Admin cookie (+ CSRF on POST) | 401 ProblemDetails |
| `/api/productions/**` (all verbs, snapshot, changes, telemetry, incident ack, livekit-token) and `/api/productions/{id}/(scenes\|devices\|pairing\|assets\|output)/**` except asset content | Admin cookie (+ CSRF on POST/PUT/PATCH/DELETE) | 401 |
| `GET /api/audit`, `GET /api/audit/export.csv`, `GET /api/audit/export.json` | Admin cookie (exports are rate-limited) | 401 |
| `GET /api/productions/{id}/assets/{assetId}/content` | Admin cookie **or** `?k={key}` of any output link of that production | none: 401; wrong/other key: 403 |
| `POST /api/pairing/requests`, `GET\|DELETE /api/pairing/requests/{id}` (header `X-Pairing-Token`), `POST /api/pairing/invites/{token}/redeem` | anonymous, rate-limited | – |
| `/api/device/**` | Device bearer | 401; blocked → 403 `device_blocked` |
| `/api/output/{slug}/**` | Key of an output link (`X-Output-Key`) + the IP list of that link | 403 (also unknown slug and revoked key) |
| `POST /api/livekit/webhook` | LiveKit JWT (HS256, `sha256` claim) | 401 |
| `GET /health/live`, `GET /health/ready` | anonymous | – |
| `/hubs/studio` · `/hubs/device` · `/hubs/output` | Admin cookie · device bearer in `access_token` · output link key in `access_token` | 401 · 401/403 · 403 |
| `/openapi/**` | not mapped in Production | 404 |

**UNIT-AUTH-01** · P0 · xunit — Password hash verification
- Steps: hash `"s3cret-Pass"` with `AdminPasswordHasher` (Identity v3); verify correct, wrong, empty, 10 kB password, unicode password (`"P\u00e4ssw\u00f6rd-\u00fc"`), hash with wrong version byte, truncated hash, non-base64 hash.
- Expect: only the correct password succeeds; malformed hashes return failure without throwing; a hash starts with `AQAAAA` and two hashes of the same password differ.

**UNIT-AUTH-02** · P0 · xunit — Account state and password rules [GAP-23]
- Steps: `AdminAccountState` with a fake store: no account, an account, an account deleted or changed elsewhere (`RefreshAsync`), a refresh whose database read started before a use case finished; `Verify` with the right and wrong pairs (also wrong user name: a hash is still checked); `IsCurrent` with the right and an old security stamp. `AdminAccountRules`: user names (1–64 of `A-Za-z0-9._@-`), passwords of 11/12/256/257 characters, the user name in any case, common passwords in any case.
- Expect: no account → the first-run setup is open and a setup code is issued once and logged; an account closes it and clears the code; a change elsewhere is reported (`RefreshAsync` returns true) and ends old stamps; a stale read never overwrites a newer state; every rule reports its code (`username_invalid`, `password_too_short`, `password_too_long`, `password_equals_username`, `password_too_common`); no message contains a password.

**UNIT-AUTH-10** · P0 · xunit — Setup code
- Steps: issue many codes; match with different case, spaces and hyphen placement, wrong, empty, `null`; clear; issue again.
- Expect: `XXXX-XXXX` from the 32-character alphabet without I, O, 0, 1; all different; only the current code matches (constant-time comparison via `Secrets.FixedTimeEquals`); nothing matches before the first issue or after `Clear`.

**UNIT-AUTH-03** · P1 · xunit — Constant-time secret comparison
- Steps: compare equal strings, strings differing in the first/last char, different lengths, empty, null; verify device secrets through `SecretHasher.Verify(secret, storedSha256)`.
- Expect: results correct, no exception on length mismatch; the implementation uses `CryptographicOperations.FixedTimeEquals`; an architecture test (source scan) fails when `==` or `string.Equals` is used to compare secrets, hashes or keys in `Opten.StudioFlow.*`.

**UNIT-AUTH-04** · P0 · xunit — Login lockout state machine (FakeTimeProvider) [GAP-03]
- Steps: same IP: failures 1–4; the 5th failure; the next attempt with the correct password; advance 14:59 / 15:00; failures spread over > 15 min; success after 3 failures; different IPs interleaved; 20 failures for one username across 20 IPs.
- Expect: failures 1–4 return "failed"; the 5th failure itself returns "locked" (the lock starts with it, `RetryAfter` 15:00); every attempt during the lock, even with the correct password, is "locked" with the remaining time (rounded up to seconds); unlock at exactly 15:00 and the counter restarts; failures older than 15 min do not count (sliding window); a success clears the IP counter; IPs are independent; the 20th failure for a user name (from any IPs) starts a 15 min lock of that name for all IPs.

**UNIT-AUTH-05** · P2 · xunit — Lockout key normalisation
- Steps: `::ffff:203.0.113.5` vs `203.0.113.5`; username `Admin` vs `admin` vs ` admin `; IPv6 `2001:db8::1` vs expanded form.
- Expect: same key for equivalent forms (IPv4-mapped IPv6 collapses; username case-insensitive and trimmed; IPv6 canonical).

**UNIT-AUTH-06** · P0 · xunit — Output IP list matching (spec 11)
- Steps: list `["10.1.2.3"]`, `["10.1.2.0/24"]`, `["10.1.2.3/32"]`, `["0.0.0.0/0"]`, `["2001:db8::/32"]`, `["::1"]`; candidates `10.1.2.3`, `10.1.2.4`, `10.1.3.3`, `::ffff:10.1.2.3`, `2001:db8:1::5`, `2001:db9::1`, `null`; empty list; whitespace around entries; duplicate entries.
- Expect: exact/CIDR logic correct, IPv4-mapped IPv6 equals its IPv4, empty list allows everyone, `null` remote address is denied when the list is not empty, trimmed entries work, invalid entries (`999.1.1.1`, `10.0.0.0/33`, `abc`, ``) are rejected by the parser with a precise message; host bits of a range are ignored (`10.1.2.7/24` ≡ `10.1.2.0/24`) and the canonical text is `10.1.2.0/24`; a single address is stored without `/32`; at most 50 rules.

**UNIT-AUTH-07** · P0 · xunit — LiveKit webhook signature verification
- Steps: valid token+body; wrong secret; tampered body (1 byte); wrong `iss`; expired `exp`; `nbf` in the future; `alg=none`; `alg=HS512`; missing `sha256` claim; missing `Authorization` header; `Bearer` prefix present/absent.
- Expect: only the valid combination passes (the `Authorization` value is accepted with and without a `Bearer ` prefix); every other case fails closed with a distinct reason code (logged, not returned).

**UNIT-AUTH-08** · P1 · xunit — Id and secret generators
- Steps: generate 100 000 ids per prefix (`prd_ scn_ itm_ dev_ ast_ inv_ prq_ inc_ cmd_`) and 10 000 secrets.
- Expect: server-generated ids match `^<prefix>[a-z2-7]{16}$`, no duplicates (ids accepted from clients and paths are validated by the looser `^<prefix>[a-z0-9]{4,40}$`, because the TypeScript clients create item ids themselves); secrets are 43 chars `[A-Za-z0-9_-]` (32 bytes base64url, no padding), no duplicates; generator uses `RandomNumberGenerator`.

**UNIT-AUTH-09** · P2 · xunit — Device bearer parsing
- Steps: `dev_x.secret`, `dev_x.`, `.secret`, `dev_x`, `dev_x.sec.ret`, empty, 10 kB, non-ASCII, `Bearer` casing, `Basic …`.
- Expect: a single well-formed `{id}.{secret}` yields the pair; everything else yields `null` (never throws); tokens longer than 512 characters are rejected before hashing.

**UNIT-AUTH-10** · P1 · xunit — Origin comparison for hubs
- Steps: request host `localhost:18443` vs Origin `https://localhost:18443`, `http://localhost:18443`, `https://LOCALHOST:18443`, `https://localhost`, `https://localhost.evil.com`, `https://evil.com`, `null`, empty, `javascript:alert(1)`, malformed.
- Expect: allowed only when scheme-agnostic host:port equals the request's host:port (case-insensitive); everything else denied; a missing Origin header is allowed (non-browser clients).

**UNIT-AUTH-11** · P1 · ng — Regie HTTP interceptor and route guard
- Steps: HttpClient `GET/POST/PUT/PATCH/DELETE` to same-origin `/api/...` and to a foreign URL; 401 responses from several calls at once; navigation to `/`, `/monitoring`, `/login` with and without a session.
- Expect: `X-StudioFlow: 1` is added to POST/PUT/PATCH/DELETE to same-origin `/api` only (never to GET, never to foreign hosts); a 401 from any call except the login call clears the session state and navigates to `/login` exactly once (no loop); the guard lets `/` and `/monitoring` through only after `GET /api/auth/me` succeeded; `returnUrl` is ignored unless it is a same-origin path.

**INT-AUTH-01** · P0 · xunit — Login success and cookie
- Steps: `POST /api/auth/login {username, password}` over `https://localhost`.
- Expect: 200 `SessionDto{username}`; exactly one `Set-Cookie: sf_session=…` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`; no `Domain`; cookie value is opaque (not containing the username or password); response `Cache-Control: no-store`.

**INT-AUTH-02** · P1 · xunit — Login failures do not enumerate
- Steps: wrong password for the real user; unknown user; empty body; missing fields; `username` 10 kB; malformed JSON; wrong content type.
- Expect: wrong password and unknown user → identical 401 body and headers (no `Set-Cookie`); malformed input → 400 `validation_failed` / 415; nothing differs between "unknown user" and "wrong password" except timing (not asserted).

**INT-AUTH-03** · P0 · xunit — Lockout over HTTP [GAP-03]
- Steps: 4 wrong passwords from remote IP A; the 5th wrong password; the right password right after; advance `FakeTimeProvider` 15 min; right password again; remote IP B with the right password during A's lock.
- Expect: attempts 1–4 → 401; attempt 5 → 429 `code: rate_limited` with `Retry-After` 899–900 (the lock starts with the 5th failure); the right password during the lock → 429 and no cookie; after 15 min → 200; IP B is unaffected; the response is RFC 7807 ProblemDetails.

**INT-AUTH-04** · P1 · xunit — Username lock across IPs
- Steps: 20 wrong passwords for `e2e-admin` from 20 different remote IPs (never 5 from one IP); then the right password from a 21st IP.
- Expect: 429 `rate_limited` for the right password until 15 min pass.

**INT-AUTH-05** · P1 · xunit — Login audit entries
- Steps: one success, one failure, one lock.
- Expect: `audit_entries` rows `login.succeeded` (actor `admin`), `login.failed`, `login.locked`; `details` jsonb contains remote IP and, only when the typed name is the account's, that username, never a typed text that is not the account's (it may be a password: `LoginAuditAndRehashTests`, also in both exports), a password or a hash; the entry of an unknown name reads "Sign-in failed for an unknown user name"; the migration `AddRevokedAdminSessions` removes the typed name from older entries (`RevokedSessionsMigrationTests`).

**INT-AUTH-06** · P0 · xunit — Session endpoints and logout
- Steps: `GET /api/auth/me` with/without cookie; `POST /api/auth/logout` with and without `X-StudioFlow: 1`; reuse the old cookie value after logout.
- Expect: 200 with username / 401 ProblemDetails (never a redirect, no `Location`); logout without header → 403, with header → 204 and `Set-Cookie: sf_session=; expires=Thu, 01 Jan 1970…`; the old cookie value is rejected (401) after logout [GAP-04: server-side invalidation].

**INT-AUTH-07** · P1 · xunit — Sliding 12 h expiration
- Steps: login at t = 0; call `me` at t = 6 h; call `me` again at t = 17 h (11 h after the last use); then advance 12 h 1 min without any call.
- Expect: both calls succeed (the expiration slides with use); after 12 h of inactivity the cookie is rejected (401).

**INT-AUTH-07a** · P0 · xunit — Absolute session lifetime and a logout that survives a restart [issue 71]
- Steps: `Admin:AbsoluteSessionLifetime` of 3 s: use the session every 0.7 s, then wait; a cookie without the time of issue (an older version's); a password change; two sessions, one signed out, the API restarted on the same database and Data Protection keys; the table of revocations unreachable at the logout; the cleanup (`AdminSessionLifetimeTests`).
- Expect: activity does not extend the absolute limit (401 after it, a new sign-in works); the cookie without the time is 401; the renewed cookie of a password change keeps the time of the sign-in; after the restart the signed-out cookie is 401 and the other one 200; the logout does not fail while the database is down, the revocation holds in memory and is stored later; only expired revocations are removed.

**INT-AUTH-07b** · P0 · xunit — Password hash iterations and renewal [issue 71]
- Steps: hash a password; verify hashes made with 100 000 and with more than the current iterations; log in with an account whose stored hash has 100 000 iterations (right and wrong password); change the password (`AdminPasswordHasherTests`, `LoginAuditAndRehashTests`, `AdminAccountStateTests`).
- Expect: new hashes carry 210 000 iterations in the hash itself; older hashes still verify and ask for a renewal; a wrong password changes nothing; the right one stores a new hash, keeps the security stamp (no session ends) and never overwrites a password changed meanwhile; a database failure does not fail the login.

**INT-AUTH-07c** · P1 · xunit — Mode of the uploaded TLS key [issue 71]
- Steps: write a certificate and key (`CaddyCertificateFiles`); an existing key with mode 644 and the same content (`SharedVolumeFileModeTests`, Linux only).
- Expect: the key is `rw-r-----`, the certificate `rw-r--r--`, the rclone configuration `rw-------`; a key that was written as 644 is corrected without being rewritten.

**INT-AUTH-08** · P0 · xunit — CSRF header matrix
- Steps: for every Admin POST/PUT/PATCH/DELETE endpoint (generated from endpoint metadata) send with the cookie and: no header; `X-StudioFlow: 0`; `X-StudioFlow: true`; empty value; `x-studioflow: 1` (case-insensitive name) ; value `1`. Also GETs without header. Also `POST /api/auth/login` and Device/Output/Pairing endpoints without the header.
- Expect: no header / wrong value → 403 ProblemDetails before any handler side effect (DB unchanged); `1` passes CSRF (handler result, e.g. 404/409/200); GET never needs the header; login, device bearer, output key and anonymous pairing routes are exempt; the asset upload (`DisableAntiforgery`) still requires the header with a cookie.

**INT-AUTH-09** · P0 · xunit — Unauthenticated access matrix
- Steps: reflect all endpoints; request each (valid route values, minimal body) without any credential.
- Expect: result equals the "Without credential" column of the route policy matrix (401 `unauthorized`, 403 `forbidden`); a route missing from the matrix fails the test; response bodies are ProblemDetails without stack traces.

**INT-AUTH-10** · P0 · xunit — Cross-credential misuse
- Steps: device bearer on Admin routes and `/hubs/studio`; admin cookie on `/api/device/**` and `/hubs/device`; output key (header, query, bearer) on Admin and Device routes; device bearer on `/api/output/{slug}/**`; valid device of production A on a route addressed to production B.
- Expect: 401 (admin/device routes) or 403 (output routes) in every case; no cross-production data in any response.

**INT-AUTH-11** · P0 · xunit — Device bearer variants
- Steps: wrong secret; secret truncated by 1 char; id of another device; unknown id; missing dot; `bearer` lowercase; `Basic`; token in `?access_token=` on a REST route; two `Authorization` headers; token with trailing whitespace.
- Expect: all 401 with identical body; `access_token` in the query is honoured only on `/hubs/*`; lookup time does not depend on whether the id exists (not asserted numerically).

**INT-AUTH-12** · P0 · xunit — Blocked device
- Steps: block a device; call `GET /api/device/me`, `POST /api/device/livekit-token`, `POST /api/device/report`, negotiate `/hubs/device`; unblock.
- Expect: 403 `device_blocked` on every call (hub negotiate returns 403 so the SignalR client stops); after unblock all calls succeed again; a request in flight during the block still completes or fails with 403, never 500.

**INT-AUTH-13** · P0 · xunit — Hub Origin check
- Steps: `POST /hubs/{studio|device|output}/negotiate` and the WebSocket upgrade (`ClientWebSocket` with explicit `Origin`) with Origin `https://evil.example`, `null`, same host, same host other port, no Origin; each with otherwise valid credentials.
- Expect: foreign/`null`/other-port Origin → 403 before the hub is reached; same host and absent Origin → 200 / 101.

**INT-AUTH-14** · P0 · xunit — Hub authentication
- Steps: negotiate each hub with no credential, wrong credential, wrong-role credential, right credential.
- Expect: studio 401 without cookie (also with `access_token` = device bearer); device 401 without/with wrong bearer, 403 when blocked; output 403 for wrong key, wrong slug-key pair, missing key; right credentials → connected.

**INT-AUTH-15** · P0 · xunit — Output key checks [GAP-06]
- Steps: `GET /api/output/{slug}/snapshot` with right key, wrong key, no header, key of another production, unknown slug, key in `?k=`; `POST …/livekit-token`, `POST …/report`.
- Expect: right key → 200; every other case → 403 `forbidden` with byte-identical ProblemDetails (unknown slug is indistinguishable from wrong key); `?k=` is ignored for these routes.

**INT-AUTH-16** · P0 · xunit — IP restriction and forwarded headers
- Steps: `allowedIps=["10.1.2.3"]`; direct requests with remote `10.1.2.3` and `10.1.2.4`; with `10.1.2.0/24`; a request from the trusted proxy network carrying `X-Forwarded-For: 10.1.2.3` (as set by the proxy); the same where the client forged the first entry and the proxy appended the real peer (`X-Forwarded-For: 10.1.2.3, 203.0.113.7`); the forged header sent from an *untrusted* peer.
- Expect: allowed/denied as listed (403 on deny); behind the trusted proxy the effective client address is the right-most entry added by the proxy (`203.0.113.7` in the forged case, so denied); `X-Forwarded-For` from an untrusted peer is ignored; hub negotiate and the asset `?k=` path enforce the same list.

**INT-AUTH-17** · P0 · xunit — Output link key regeneration
- Steps: connect an output hub client with the key of a link; `POST …/output/links/{linkId}/regenerate-key`; reuse the old key; connect again with the new key (issue #9: per link; the other links are covered by `INT-LINK-02` and `INT-LINK-03`).
- Expect: old key 403 immediately on REST and negotiate; the connected hub connection of that link is closed within 2 s; the fake LiveKit service received `ListParticipants(room)` and `RemoveParticipant(room, identity)` for every identity matching `output_{slug}_{linkId}_*` and none other; the response carries the new URL; `KeyCreatedAt` advanced; audit `output.key.regenerated`; an `outputStatusChanged` event follows.

**INT-AUTH-18** · P1 · xunit — Allowed IP list validation and effect
- Steps: `PUT …/output/access` with valid/invalid entries (`999.1.1.1`, `10.0.0.0/33`, `abc`, empty string, duplicates, 51 entries); change the list while an output hub is connected from an IP that is no longer allowed.
- Expect: invalid or more than 50 rules → 400 `validation_failed` with the offending index in `errors`; valid → 200, canonical entries returned, audit `output.access.changed` (log “Output access changed”); the now-forbidden connection is closed within 2 s [GAP-06].

**INT-AUTH-19** · P0 · xunit — Path traversal in ids and names
- Steps: ids `../../etc/passwd`, `..%2f..%2fx`, `%2e%2e%2f`, `..\..\x`, `/etc/passwd`, `C:\windows\win.ini`, `x%00`, 10 kB string, `ast_` + 16 uppercase chars, unicode look-alikes as `productionId`, `assetId`, `sceneId`, `itemId`, `deviceId`, `{slug}`, `{slot}`, `{token}`; upload file names `../../evil.png`, `..\..\evil.png`, `C:\evil.png`, `x.png\0.exe`, 300 chars, `...`, `CON.png`, `\u202egnp.exe`.
- Expect: unknown/malformed ids → 404 (never 500), ids are validated against `^<prefix>[a-z0-9]{4,40}$` before any file or DB access, the fake `IMediaStore` is never called with a path outside `{root}/{productionId}/{assetId}{ext}`; stored name sanitised (see UNIT-MEDIA-01); the temp media root contains only the generated files.

**INT-AUTH-20** · P0 · xunit — Secrets never logged
- Steps: attach an in-memory `ILoggerProvider` at `Trace`; run: login (ok/failed/locked), pairing by QR/code/link, approve, device calls, block, output hub connect, key rotation, webhook (valid/invalid), LiveKit token issue, asset upload with `?k=`.
- Expect: no log line (message, structured state, exception text) contains the admin password/hash, device secret, poll token, invite token, output key, LiveKit secret, any issued JWT, or the `access_token` value; request-path logging redacts `access_token`/`k`.

**INT-AUTH-21** · P1 · xunit — Response hardening
- Steps: sample 1 response of each route class; force an unhandled exception through a test-only endpoint.
- Expect: `X-Content-Type-Options: nosniff` on all API responses (through Caddy exactly once: Caddy sets it for every response and drops the upstream copy of proxied API, hub and `/rtc` responses, BUG-18); credentials-bearing responses (`login`, `redeem`, pairing poll with credentials, `livekit-token`) send `Cache-Control: no-store`; 500 returns ProblemDetails `internal_error` with `traceId` only (no exception type/message/stack) in Production; `Server` header not revealing version.

**INT-AUTH-22** · P1 · xunit — Request size limits
- Steps: JSON body of 256 KB, 256 KB + 1, 10 MB on a normal route; bandwidth test with 4 MB and 4 MB + 1; chunked body without length > limit; `Content-Length` larger than the actual body.
- Expect: ≤ limit accepted (or validation error), above → 413 ProblemDetails, handler never runs for oversize bodies, server memory stays flat (no full buffering above the limit).

**INT-AUTH-23** · P2 · xunit — Data Protection keys persistence
- Steps: login; dispose and rebuild the factory with the same `DataProtection:KeysPath`; then with an empty keys directory.
- Expect: the cookie from the first host is accepted by the second (same keys); rejected (401) with new keys; the keys directory contains key XML and is not world-readable (Linux file mode test where supported).

**INT-AUTH-24** · P2 · xunit — No CORS
- Steps: `OPTIONS /api/auth/login` and `GET /api/system/info` with `Origin: https://evil.example`.
- Expect: no `Access-Control-Allow-*` header on any response.

**INT-AUTH-25** · P1 · xunit — Webhook endpoint authentication
- Steps: missing/invalid/expired JWT, body hash mismatch, body > 1 MB, right signature with `application/webhook+json`, with `application/json`.
- Expect: 401 for all invalid cases without parsing the body; 413 for oversize; valid → 200 with either content type (LiveKit sends `application/webhook+json`, BUG-05), another content type → 415; no state change on failure.

**INT-AUTH-26** · P1 · xunit — Secrets at rest
- Steps: pair a device, create an invite, regenerate the output key; dump all tables (`pg_dump --data-only`) and the Data Protection directory.
- Expect: the plaintext device secret and poll token do not appear (device secrets and poll tokens are stored as lowercase-hex SHA-256 hashes; poll tokens only in memory); invite tokens and the output key are stored in clear because the Regie must show their URLs (one-time and revocable, documented in the security review); the Data Protection directory is not part of any API response.

**INT-AUTH-27** · P0 · xunit — First-run setup [issue 4]
- Steps: app without an account. `GET /api/auth/setup`; login; an admin route; setup with a wrong, empty, missing code; five wrong codes from one address; user names and passwords that break the rules (valid code); setup with the valid code (`  regie  ` as user name); setup again with the old, a wrong and an empty code; eight concurrent setups with the valid code; a restart on the same database with and without an account; the app with `Admin:Username`/`Admin:Password` set.
- Expect: `{"setupRequired":true}` and nothing else, the code is in the log (`Setup code: …`) and in no response; login 401, admin routes 401; wrong/missing code 403 `setup_code_invalid` and nothing created; the fifth wrong code 429 with `Retry-After` and then the right code from that address is 429 too; rule violations 400 `validation_failed` with the codes in `errors` and the code stays valid; the valid code → 200 `SessionDto{regie}` with a cookie, the account row has an Identity hash (no plain password), the audit entry `account.setup` has user name and address and no secret, the snapshot log shows `accountSetUp`, the status is `false` and the code is gone; every further attempt → 409 `setup_closed`; exactly one of the concurrent setups wins (one `admin_account` row, one audit entry) and the others get 409; the database refuses a second row; after a restart with an account the setup stays closed and no code is logged, without an account there is a new code and the old one is 403; the old `Admin:*` settings are ignored with a warning that names the keys and not the values.

**INT-AUTH-28** · P0 · xunit — Password change [issue 4]
- Steps: two sessions with a studio hub connection each; the first changes the password (`POST /api/auth/password`); wrong current password (once, then five times); new passwords that break the rules; without a session; without the CSRF header.
- Expect: 204 and a renewed cookie for the caller; the second session is refused (401) and its hub connection is closed, the caller's old cookie is refused and the renewed one works, its hub connection stays; the old password no longer logs in, the new one does; the audit entry `account.password.changed` has no password; the snapshot log shows `passwordChanged`; wrong current password 400 `password_incorrect`, nothing changes, the fifth failure locks like a login (429); rules 400 with the codes in `errors.newPassword`; 401 without a session; 403 without the header.

**INT-AUTH-29** · P1 · xunit — reset-admin [issue 4]
- Steps: `reset-admin --yes` against the database of a running app; without `--yes` with the input `no`, empty and `yes`; no account; database unreachable; a restart afterwards.
- Expect: the account is deleted and the audit entry `account.reset` (actor `system`) written; the running app opens the setup within the 5 s maintenance tick, ends the old session (401), closes its hub connection and logs a new code that works; unconfirmed → exit 2 and nothing deleted; no account → exit 0 with a message; unreachable database → exit 1 without the connection string; a restart of the app finds the setup open with a new code; `hash-password` is no command any more.

**E2E-AUTH-01** · P0 · pw — Login via UI and cookie flags
- Steps: open `/` unauthenticated; land on `/login`; fill username/password (`getByLabel(/username/i)`, `getByLabel(/password/i)`, `getByRole('button', {name: /sign in/i})` [GAP-27]); submit.
- Expect: URL `/`, `[data-testid=regie-ready]` within `T-LOAD`; `context.cookies()` shows `sf_session` with `httpOnly:true, secure:true, sameSite:'Strict', path:'/'`; `document.cookie` does not contain `sf_session`; header shows production name and a clock.

**E2E-AUTH-02** · P1 · pw — Login failure
- Steps: wrong password; unknown user.
- Expect: stays on `/login`; a generic error (“Wrong username or password.”, `role=alert`, same text for both cases, no hint which field is wrong); no cookie; focus returns to the password field.

**E2E-AUTH-03** · P1 · pw (`@disruptive`) — Lockout in the UI [GAP-03]
- Steps: 5 wrong logins; then the right password; afterwards `docker compose restart api`.
- Expect: the 5th failed login already shows a lock message with the remaining time (`/\d+ minutes?/i`, [GAP-27]); the right password is still rejected (429 with `Retry-After`); after the restart login works.

**E2E-AUTH-04** · P1 · pw — Logout
- Steps: open the Regie in two tabs of one context; logout in tab 1 (header action, name `/sign out/i`).
- Expect: tab 1 on `/login`; `GET /api/auth/me` 401; the server closes the hub connections of the revoked session [GAP-04], so tab 2's hub goes to `disconnected` and tab 2 leaves the Regie for `/login` within 10 s (no endless reconnect: ≤ 3 negotiate attempts logged); browser back does not show Regie content.

**E2E-AUTH-05** · P0 · pw — Protected pages redirect
- Steps: unauthenticated `goto('/')`, `/monitoring`, `/some/deep/link`.
- Expect: redirected to `/login` before any Regie data is requested (no request to `/api/productions/**` except `/api/auth/me`); no flash of Regie UI.

**E2E-AUTH-06** · P0 · pw — Unauthenticated API access through the proxy
- Steps: with a cookie-less `request` context call every Admin route in the policy matrix (list generated from the OpenAPI JSON), plus `/hubs/studio/negotiate`, `/api/system/info`, `/openapi/v1.json`.
- Expect: 401 for Admin routes and the studio hub; `/openapi/**` not JSON (404 or SPA HTML); no route answers 200 with data; public routes respond as specified.

**E2E-AUTH-07** · P0 · pw — CSRF header through Caddy
- Steps: with the admin cookie `POST …/take` without `X-StudioFlow`, with `X-StudioFlow: 1`.
- Expect: 403 without; with the header the request reaches the API (409 `conflict` because there is no preview) – proves Caddy forwards the custom header.

**E2E-AUTH-08** · P1 · pw — Hub Origin check through Caddy
- Steps: with `ws`/`request`: negotiate and upgrade `/hubs/studio`, `/hubs/device`, `/hubs/output` with `Origin: https://evil.example` and valid credentials; same with the stack origin.
- Expect: 403 for the foreign origin, success for the own origin (proves Caddy forwards `Host`/`Origin` unchanged).

**E2E-AUTH-09** · P0 · pw — Security headers on every entry point
- Steps: `GET` `/`, `/login`, `/join/`, `/join/i/x`, `/o/webinar?k=x`, `/api/system/info` (authenticated), a hashed asset, `index.html`, `ngsw.json`, `/j/x`.
- Expect: `Strict-Transport-Security` with `max-age` = `STUDIOFLOW_HSTS_MAX_AGE` (default 31536000, i.e. ≥ 1 year, for a site with a trusted certificate; 3600 for the local certificate unless the variable is set - the test env sets it to one year); `X-Content-Type-Options: nosniff`; `Referrer-Policy: no-referrer`; exactly one `Content-Security-Policy` fulfilling the invariants **I-CSP**: no `unsafe-eval`; `script-src` without `unsafe-inline`, `*`, `data:`, `http:`; `object-src 'none'`; `base-uri` `'self'` or `'none'`; `form-action 'self'`; `default-src` `'self'` or `'none'`; `connect-src` contains `'self'` and the explicit `wss://<host>` (Safari); `img-src` contains `data: blob:`; `media-src` contains `blob:`; no external host anywhere except the frame-ancestors list [GAP-14]. `Permissions-Policy`: `/join/*` allows `camera=(self)`, `microphone=(self)`, `display-capture=(self)` (spec 10 and the Caddyfile; no audio track is published) [DOC-01]; all other paths disable `camera`, `display-capture`, `microphone`; `/o/*` does not disable `autoplay` or `fullscreen`. `frame-ancestors 'none'` everywhere except `/o/*` (`'self'` plus the embedding origins of the server settings); `/o/*` sends no `X-Frame-Options`. Cache: hashed files `immutable`, `index.html` and `ngsw*.json` `no-cache`.

**E2E-AUTH-10** · P0 · pw — Embedding limited by frame-ancestors
- Steps: `embedHost` serves a page at `https://embed.e2e.test` (allowed) and `https://other.e2e.test` (not allowed) each containing `<iframe src="https://localhost/o/{slug}?k=…" allow="autoplay; fullscreen">`; also iframes of `/`, `/join/`, `/login`.
- Expect: allowed origin: slate `Starting soon` visible inside the frame; other origin: the frame does not load (console `Refused to frame … frame-ancestors`, no slate); `/`, `/join/`, `/login` framed from any origin: blocked.

**E2E-AUTH-11** · P0 · pw — XSS in the Regie
- Pre: for each payload in `XSS`: scene name (≤ 80 chars: use first five; the 200-char payload is truncated or rejected 400, never rendered unescaped), device name (rename), asset name (upload filename), production name, Regie message, standby slate title/subtitle.
- Steps: open the Regie; visit every surface: scene list, monitors, inspector (input `value`), Sources, Stations (collapsed and expanded), message strip, toasts (switch to the scene), log, production menu, Docks popover, output popover.
- Expect: `window.__xss` undefined; no `dialog` event; no new `<script>`/`<img src="x">`/element with `onerror|onload` attributes; each payload is visible as literal text where its entity is shown and inside `aria-label`/`title` attributes as literal text; `document.title` unchanged; the app does not crash.

**E2E-AUTH-12** · P1 · pw — XSS on the sender
- Pre: device name, production name and a Regie message set to payloads.
- Steps: open `/join/station` as that device (pixel7); trigger the message banner.
- Expect: payloads rendered as text in header, station name, banner; no execution (same checks as -11).

**E2E-AUTH-13** · P1 · pw — XSS on the output page
- Pre: production name (slate subtitle), standby/end slate title, scene name, asset name with payloads; `debug=1`.
- Expect: slates and debug overlay show literal text; no execution.

**E2E-AUTH-14** · P0 · pw — XSS through anonymous pairing input
- Steps: `POST /api/pairing/requests {name: payload, kind: 'laptop', platform: payload}` for each payload (names > 60 → 400; use ≤ 60 and platform ≤ 80); open Regie Stations dock, pairing dock (laptop tab) and approve the request.
- Expect: knock card, `aria-label` of the code, toast “… wants to join” show literal text; after approval station row, log entry and source label are literal; no execution.

**E2E-AUTH-15** · P1 · pw — No CSP violations in a normal session
- Steps: listen to `securitypolicyviolation` events and console errors in Regie, sender (phone) and output (iframe) while running login, pairing, camera publish, switch, drag, upload, key rotation.
- Expect: zero violations and zero CSP console errors (proves the policy does not break Angular, LiveKit, `blob:` video, service worker).

**E2E-AUTH-16** · P1 · pw — Device credentials handling on the sender
- Steps: redeem an invite; inspect URL history, storage, cookies, service worker caches, network log.
- Expect: credentials only in localStorage `studioflow.sender.v1`; URL `/join/i/{token}` replaced by `/join/station` (`history.replaceState`) so the invite token is not in history; `document.cookie` empty; no secret in any URL; service worker cache contains no `/api`, `/hubs`, `/rtc` responses; `Referer` on later requests has no token (`Referrer-Policy: no-referrer`).

**E2E-AUTH-17** · P1 · pw — Asset content access
- Steps: upload `tiny.png`; request `…/assets/{id}/content` without credentials, with the admin cookie, with `?k=<key>`, with a wrong `k`, with the key of another production, `HEAD`.
- Expect: none → 401; cookie → 200; right `k` → 200; wrong or foreign `k` → 403; `HEAD` mirrors `GET` status and headers without a body (BUG-16); response `Content-Type: image/png`, `X-Content-Type-Options: nosniff` (exactly once).

**E2E-AUTH-18** · P1 · pw (`@disruptive`) — Rate limits on public pairing routes [GAP-01]
- Steps: 11 × `POST /api/pairing/requests` from the same IP within 10 min; 21 × `redeem` with random tokens (the pending cap of 20 cannot be reached from one IP because the per-IP limit of 10 hits first: `INT-PAIR-08` covers it, and `E2E-PAIR-16` runs it with `Pairing:Limits:PendingTotal=3`).
- Expect: 11th request → 429 `rate_limited` + `Retry-After`; 21st redeem → 429; earlier responses are 201/410 as specified; `docker compose restart api` afterwards clears counters.

**E2E-AUTH-19** · P2 · pw — HTTP to HTTPS and HSTS
- Steps: `GET http://localhost:<http-port>/` without following redirects; HTTPS response headers; try login over HTTP.
- Expect: 308/301 to `https://…`; HSTS present on HTTPS; no cookie is ever set over HTTP.

**E2E-AUTH-20** · P2 · pw — TLS versions
- Steps: Node `tls.connect` with `maxVersion: 'TLSv1.1'`, `minVersion: 'TLSv1.2'`, default.
- Expect: TLS 1.0/1.1 refused; TLS 1.3 negotiated by default.

**E2E-AUTH-21** · P1 · pw — Open redirect and header injection
- Steps: `/login?returnUrl=https://evil.example` then login; `/j/abc%0d%0aSet-Cookie:x=1`; `/j/..%2f..%2fapi`; `/join/i/%00`.
- Expect: after login the app stays on the own origin; `/j/*` redirects only to `/join/i/<url-encoded token>`; no CR/LF in any `Location`; no `Set-Cookie` injected.

**E2E-AUTH-22** · P1 · pw — Caddy access log redaction
- Steps: run flows with `access_token`/`?k=` (hub connects, asset load, output page); read `docker compose logs caddy`.
- Expect: no occurrence of any device secret, output key, `access_token=<value>`, `k=<value>`; invite tokens are reported as informational (may appear in `/join/i/…` and `/j/…` paths; consumed tokens are harmless).

**E2E-AUTH-23** · P0 · pw — IP restriction through the proxy
- Steps: open one output page; read its address from `OutputStatusDto.Addresses` via the Regie output popover; set `allowedIps` to `["203.0.113.9"]`; reload the output; then set `[<that address>]`.
- Expect: with the foreign IP the output page shows the `No access` slate, the hub is refused, status chip becomes “not connected”; the connected page is kicked within 2 s of saving; with the observed address the page works again.

**E2E-AUTH-24** · P0 · pw — Output link regeneration
- Steps: output page connected and playing; Regie header output chip → popover → “Regenerate link” → box text “The old link stops working immediately. The proxy needs the new one afterwards.” → “Regenerate”.
- Expect: toast “New output link created. The old one is no longer valid.”; the old page shows `No access` and stops video within `T-KEY`; `lk.listParticipants` has no `output_*` identity of the old key; reloading the old URL → `No access`; the new URL plays; log entry “Output link regenerated”; “Cancel” in the confirm box changes nothing.

**E2E-AUTH-25** · P2 · pw — Two operators and session persistence
- Steps: log in twice (two contexts); reload both; check header presence.
- Expect: both stay logged in across reload; presence shows two operators in both (`.sr` text “2 people in the control room”); closing one decrements within 8 s.

**E2E-AUTH-26** · P1 · pw — Session expiry while the Regie is open [GAP-27]
- Steps: Regie open; delete the `sf_session` cookie from the context; trigger an action; wait.
- Expect: within 10 s the app is on `/login`; the hub does not retry forever (≤ 3 negotiate attempts after the first 401); no uncaught exception in the console.

**E2E-AUTH-27** · P1 · pw — Server surface is not exposed
- Steps: request `/openapi/v1.json`, `/swagger`, `/metrics`, `/health/live` and `/health/ready` through Caddy and `/appsettings.json`, `/.env`, `/Opten.StudioFlow.Web.dll`.
- Expect: OpenAPI/swagger/metrics/appsettings/.env/dll are 404 (or SPA HTML, never their content); health endpoints answer only the status document (no connection strings, versions or exception text).

**E2E-AUTH-30** · P0 · pw — reset-admin reopens the first-run setup [issue 4]
- Steps: sign in over the API; `docker compose exec api dotnet Opten.StudioFlow.Web.dll reset-admin --yes`; poll `GET /api/auth/setup`; use the old session; log in; read the API log.
- Expect: within 60 s `setupRequired` is `true`; the old session is 401; the login is 401; the log has a new `Setup code: XXXX-XXXX` that differs from the last one.

**E2E-AUTH-31** · P0 · pw — First-run setup in the browser [issue 4]
- Steps: with no account open `/` and `/login`; submit a short password; submit a wrong code with a good password; submit the right code (typed in lower case) with the good password.
- Expect: both pages lead to `/setup` ("First-run setup", labelled fields); a short password is explained next to the field without a request; the wrong code is 403 and explained next to the code field; the right code is 200, the browser lands in the Regie and it is ready; the status is `false`, the code is gone from the log's newest line, the account signs in over the API.

**E2E-AUTH-32** · P0 · pw — The account survives a restart [issue 4]
- Steps: `docker compose restart api`; status, log, a `POST /api/auth/setup`, `/setup` in the browser, a login.
- Expect: `setupRequired` is `false` and the newest log line says the account exists; the setup answers 409 `setup_closed`; `/setup` leads to `/login`; the login works.

**E2E-AUTH-33** · P1 · pw — Password change in the production menu [issue 4]
- Steps: signed in in the browser and over the API; production menu › "Change password" with the current and a new password; use the other session, the old and the new password, the browser session; change back.
- Expect: 204 and a toast "Password changed."; the other session is 401; the old password is 401; the new password logs in; the browser session continues; the harness password is restored.

### 2.2 PAIR – Pairing

Strings: knock card “{Name} wants to join”, “Does the laptop show the same check code? Then allow.”, buttons “Allow” / “Deny”, log “Request from {Name} denied”, check code shown as “47 12”,
“Check code for the control room”, QR tab “Phone as a camera” (“Valid once, mm:ss min left.”, “Generate new code”, toast “New QR code, the old one is no longer valid”), laptop tab “Laptop without a QR code”, link tab “Invite link”
(“Create link”, “Valid once and expires in 30 minutes. Whoever opens it is paired straight away.”, “Revoke link”, toast “Invite link revoked”), “Waiting requests”.

**UNIT-PAIR-01** · P0 · xunit — Invite state machine (FakeTimeProvider)
- Steps: create → redeem (clientId A) → redeem (clientId B); redeem with A again at +4:59 and +5:01 after first redeem; redeem at 29:59.999 and 30:00.000 after creation; revoked; unknown token.
- Expect: first redeem succeeds; B → `pairing_expired` (used); A again within 5 min → same device id and a **new** secret, the previous secret no longer verifies; A after 5 min → `pairing_expired`; valid up to but excluding 30:00.000; revoked/unknown/used/expired return the same error object (no information leak).

**UNIT-PAIR-02** · P1 · xunit — Phone invite renewal invariants
- Steps: `GetPhoneInvite` twice; redeem; renew; let it expire; random sequences of (get, renew, redeem, advance time) (property test, 1000 sequences).
- Expect: at any moment at most one valid `phoneQr` invite exists; get returns the valid one or creates one; redeem and renew remove the old one and create the next immediately (`inviteRemoved` + `inviteUpserted` in that order); laptop-link invites are independent of the phone invite.

**UNIT-PAIR-03** · P1 · xunit — Check code allocation
- Steps: allocate 20 codes with a seeded RNG; force a collision by an RNG returning a pending code; remove a request and allocate again; format codes.
- Expect: 4 digits `0000–9999` (leading zeros kept, formatted “00 47”), unique among pending requests (collision re-draws), reusable after removal, drawn from a CSPRNG abstraction.

**UNIT-PAIR-04** · P0 · xunit — Pairing request lifecycle
- Steps: create → poll → approve → poll ×5 → +5:00 / +5:01 → poll; create → deny → poll; create → +10:00 → poll and approve; approve twice; wrong poll token; unknown id; cancel (DELETE).
- Expect: pending until approved/denied/expired at 10:00; after approval each poll within 5 min returns identical credentials (same device id and secret), after 5:01 `expired` without credentials; deny → `denied`; approve after expiry → expired error (410); second approve → not found (request already removed) and no second device [GAP-09]; wrong token or unknown id → `expired` (indistinguishable); cancel removes the request and is idempotent.

**UNIT-PAIR-05** · P0 · xunit — Pairing limits
- Steps: 10 and 11 requests from one IP in 10 min; the 11th after 10:00; 20 pending from 20 IPs then a 21st from a new IP; free one slot (approve/deny/expire) and retry; 20 and 21 redeem attempts (valid and invalid tokens mixed) from one IP in 10 min.
- Expect: 11th request → `rate_limited` (window slides); 21st pending → `rate_limited` [GAP-05]; slots free up when requests leave pending; the 21st redeem attempt → `rate_limited` (all attempts count, successful or not).

**UNIT-PAIR-06** · P2 · xunit — Device naming
- Steps: redeem without name ×3; with name `"  Anna  "`, `""`, 60 chars, 61 chars, control chars, only whitespace; remove “Phone 2”, redeem again.
- Expect: default “Phone {n}” for phones and “Laptop {n}” for laptops with the lowest free n among the existing names of that stem; given names are trimmed and cleaned of control characters, 1–60 text elements (emoji count once); empty after cleaning falls back to the default on a redeem and is `validation_failed` on `POST /api/pairing/requests`.

**UNIT-PAIR-07** · P1 · xunit — Slot code allocation (spec 4.4)
- Steps: pair phones, laptops (screen-1, screen-2, camera), upload assets; delete K2/S1/M1; allocate again; 20 parallel allocations.
- Expect: lowest free number per letter at creation time (K cameras incl. laptop cameras, S screens, M media); freed numbers are reused; codes never change while the source exists; parallel allocation yields distinct codes.

**UNIT-PAIR-08** · P1 · ng — Sender pairing state machine
- Steps: fake timers and fake API: form validation (name trimmed 1–60), kind detection (`getDisplayMedia` present, mobile UA), `POST requests` then polling; statuses `pending → approved|denied|expired`; network error during polling; reload with `studioflow.pairing` in sessionStorage; invite redeem with `clientId` generation and a lost response; stored credentials → `GET /api/device/me` (200, 401, 403 `device_blocked`); URL clean-up after redeem.
- Expect: states `form → waiting → paired|denied|expired`; polling every 1.5 s (±0.2 s), stopped after a terminal status and cancelled with `DELETE` when the user leaves; the `clientId` is generated once per invite attempt and reused on retry; credentials are written to `studioflow.sender.v1` only after success; 401 clears them and shows the pairing form, 403 shows the blocked state; no secret in URL, console or DOM.

**INT-PAIR-01** · P0 · xunit — QR flow over REST and events
- Steps: connect a studio hub client and `Subscribe`; `GET …/pairing/phone-invite`; redeem with `{clientId, kind:'phone', platform:'Pixel 7 · Chrome'}`; `GET /api/device/me`.
- Expect: invite `Url` = `https://studioflow.test/join/i/{token}`, `ExpiresAt` ≈ +30 min; redeem → `DeviceCredentialsDto` (device id `dev_…`, 43-char secret, production id); `me` lists slot `camera` code `K1`; hub events in revision order (as implemented, DOC-02): `inviteRemoved` (the redeemed invite), `deviceUpserted`, `sourceUpserted` (camera K1, status `offline`), `logAppended` “K1 Phone 1 paired”, `inviteUpserted` (the next phone invite); revisions strictly consecutive (the reducer accepts any order).

**INT-PAIR-02** · P0 · xunit — Redeem idempotency
- Steps: redeem with clientId A twice (simulating a lost response), then use the first secret; redeem with clientId B afterwards.
- Expect: both calls return the same `DeviceId`; the secrets differ, the first secret → 401, the second works; exactly one device in the snapshot and one `device.paired` audit row; clientId B → 410 `pairing_expired`.

**INT-PAIR-03** · P0 · xunit — Invalid invites
- Steps: redeem expired (advance 30 min), used, revoked, random 43-char, empty, 10 kB, wrong-case tokens.
- Expect: always 410 `pairing_expired` with identical bodies (never 404/500); rate limiter counts these attempts.

**INT-PAIR-04** · P0 · xunit — Laptop code flow
- Steps: `POST /api/pairing/requests {name:'Laptop Anna', kind:'laptop', platform:'Windows · Edge'}`; poll; hub client sees the request; `POST …/pairing/requests/{id}/approve`; poll repeatedly.
- Expect: 201 `{requestId prq_…, pollToken (43 chars), checkCode ^\d{4}$, expiresAt ≈ +10 min}`; poll with `X-Pairing-Token` → `pending`; hub: `pairingRequestUpserted` (same code, name, platform); approve → 200 `DeviceDto` (kind laptop, `pairingMethod: code`), source `screen-1` code `S1` created; `pairingRequestRemoved(outcome: approved)`; poll → `approved` + credentials, identical on every poll; audit `device.paired`.

**INT-PAIR-05** · P1 · xunit — Deny
- Steps: create, `POST …/deny`, poll.
- Expect: 204; poll → `denied` without credentials; `pairingRequestRemoved(denied)`; audit `pairing.denied`; no device, no source.

**INT-PAIR-06** · P0 · xunit — Poll token security
- Steps: poll with no header, wrong token, token of another request, valid token for unknown id; `DELETE` with wrong token.
- Expect: missing header → 400; unknown id or wrong token → 200 `{status:'expired'}` (no oracle for existing ids); wrong-token DELETE → 204 without effect; tokens compared in constant time.

**INT-PAIR-07** · P1 · xunit — Credential window and cancel
- Steps: approve; poll at +4:59 and +5:01 (FakeTimeProvider); separate request: `DELETE` by the requester.
- Expect: credentials present until 5:00 after approval, then `expired`; cancel → request disappears from the snapshot, `pairingRequestRemoved(expired)`.

**INT-PAIR-08** · P0 · xunit — Limits and validation over HTTP [GAP-05]
- Steps: 11 requests/IP/10 min with `X-Test-Remote-IP`; 21 pending; 21 redeem attempts; body validation: name empty/61 chars/control chars, `kind` invalid enum, `platform` 81 chars, unknown extra fields, body 300 KB.
- Expect: 429 `rate_limited` with `Retry-After` for each limit; 400 `validation_failed` with field names (`name`, `kind`) for invalid bodies – also when the body cannot be bound (an unknown enum text such as `"kind":"tablet"`, a wrong JSON type, broken JSON): `errors` names the camelCase field path (`kind`, `items[0].fit`; `body` for the body as a whole) with “Invalid value.”, never the serializer message or a .NET type name (BUG-08); a `platform` longer than 80 characters is truncated to 80 (accepted); 413 for oversize; extra fields ignored; limits are per IP, not global, except the pending cap.

**INT-PAIR-09** · P0 · xunit — Laptop invite link
- Steps: `POST …/pairing/invites {kind:'laptopLink'}`; redeem `kind:'laptop'`; second redeem; create another and `DELETE …/invites/{id}`; redeem the revoked.
- Expect: 201 `InviteDto.Url` = `https://studioflow.test/j/{token}`; redeem → device with method `link` and `screen-1`; second redeem 410; revoked 410; events `inviteUpserted`/`inviteRemoved`; audit `invite.created`, `invite.revoked`; creating `{kind:'phoneQr'}` through this endpoint behaves exactly like `phone-invite/renew` [GAP-19].

**INT-PAIR-10** · P1 · xunit — Redeem kind vs invite kind [GAP-19]
- Steps: redeem a `phoneQr` invite with body `kind:'laptop'` and a `laptopLink` invite with `kind:'phone'`.
- Expect: the invite kind decides the device kind (phone → `camera` K slot; laptop → `screen-1`), body `kind` is ignored for the decision; no 500.

**INT-PAIR-11** · P1 · xunit — Re-recognition after restart
- Steps: pair; restart the factory with the same database; `GET /api/device/me`; delete the device; block another device and unpair a third (`POST /api/device/unpair`).
- Expect: device still recognised after restart; after delete or unpair → 401; blocked → 403 `device_blocked`.

**INT-PAIR-12** · P0 · xunit — Block, unblock, delete lifecycle
- Steps: device with a live camera, a device hub connection, an open incident and the source in a scene; block; unblock; block again; delete.
- Expect: block → `deviceUpserted(state: blocked)`, `sourceUpserted(status: blocked)`, `incidentRemoved` for its incident, fake LiveKit `RemoveParticipant(room, deviceId)`, the device hub receives `self` (state blocked) then is closed, log “K1 Phone 1 blocked” (codes and device name, `LogTexts`; intended deviation from the prototype's “K1 blocked”, BUG-10), audit `device.blocked`; unblock → `device.unblocked`, log “K1 Phone 1 unblocked”, status `offline`/`connecting` until it reconnects (no incident); delete → `deviceRemoved` + `sourceRemoved` per slot + `device.removed` (log “K1 Phone 1 removed”), the scene keeps the item (source ref now dangling, [GAP-35]).

**INT-PAIR-13** · P2 · xunit — Rename device
- Steps: `PATCH …/devices/{id}` with valid, trimmed, 60/61 chars, XSS strings, empty.
- Expect: 200 with new name; `deviceUpserted` and `sourceUpserted` (labels “{name} · Screen 1”, “{name} · Camera” or “{name}” for phones) events; the connected device hub receives `self` with the new name; 400 `validation_failed` for empty/61 chars; XSS strings stored verbatim.

**INT-PAIR-14** · P1 · xunit — Slot allocation and release [GAP-19]
- Steps: laptop `POST /api/device/slots {kind:'screen'}` ×9 then a 10th; `{kind:'camera'}` twice; phone allocates a screen; `{kind:'image'}`; `DELETE /api/device/slots/screen-2`; delete a non-existing slot; delete `camera` of a phone.
- Expect: screens `screen-2…screen-9` with codes lowest-free S, the 10th and the second camera → 409 `limit_reached`; phone screen request and invalid kind → 400 `validation_failed`; release → 204, `sourceRemoved`, code freed; non-existing slot → 404; releasing a phone's only camera slot → 409 `conflict`.

**INT-PAIR-15** · P0 · xunit — Concurrency
- Steps: 20 parallel redeems of one invite with 20 distinct clientIds; 20 parallel redeems of one invite with one clientId; two parallel approvals of one request; 30 parallel pairings (distinct invites).
- Expect: exactly one 200 and 19 × 410; all 20 return the same device and exactly one device row; one approval 200 and one 404 with exactly one `device.paired` row; all slot codes distinct. The E2E variant (`[stack]`, bursts of 20 and 30 concurrent connections to the direct API port) names the request in a transport error of the harness' HTTP client: error code, elapsed time and whether the response headers had arrived (issue 33: a bare “socket hang up” flaked on the CI runner and could not be reproduced locally in about 200 runs under CPU contention, a CPU-limited API, API restarts before the test and bursts of up to 800 connections). The logs of the failed CI run show why the connection was cut: the API container died without a word in its log during the burst of 30 (no shutdown message, the PostgreSQL log full of “Connection reset by peer” in the same 120 ms, 502 from Caddy, “Application started” again about 4 s later). The cause of that death is not known yet; `logs/docker-events.jsonl` (below) records the next one with its signal or exit code.

**INT-PAIR-16** · P1 · xunit — Production scoping [GAP-36]
- Steps: approve a request through another production's route; redeem an invite of an inactive production; `activate` another production while a request is pending.
- Expect: approve via the wrong production → 404; an invite always pairs into its own production; pending knock requests of the previously active production are removed with outcome `expired` and are no longer pollable as pending.

**INT-PAIR-17** · P2 · xunit — Audit of pairing
- Steps: run the QR, code, link, deny and block flows.
- Expect: audit rows `device.paired` (actor `admin` for approve, `device:{id}` for redeem), `pairing.denied`, `invite.created`, `invite.revoked`; details contain ids and names, never secrets or tokens.

**E2E-PAIR-01** · P0 · pw (`pixel7`) — QR pairing of a phone
- Steps: Regie “Pair device” (Stations dock header) → tab “Phone”; decode the QR (`jsqr` on a screenshot of the `role=img` “QR code for pairing a phone”) and compare with `GET …/phone-invite`; open that URL in a Pixel 7 context.
- Expect: QR decodes to the invite URL; countdown shows “Valid once, 30:00 min left.” and decreases; phone shows name “Phone 1”, `connection-state=connected` (“Connected”) within 3 s; Regie lists station K1 “Phone 1” within `T-PAIR` and the QR in the dock has been replaced by a different one.

**E2E-PAIR-02** · P0 · pw (`pixel7`) — Phone camera goes live
- Steps: after E2E-PAIR-01 start the camera (auto-start or button); add K1 to scene A and make it program.
- Expect: K1 lamp ok (green); station line shows `x.x Mbit/s` and `NN ms`; Program monitor `<video>` satisfies `expectVideoPlaying`; `T-VIDEO-START` met.

**E2E-PAIR-03** · P0 · pw — Laptop pairing by check code
- Steps: laptop context opens `/join` (also `/join/` and `/join/waiting` deep link), enters “Laptop Anna”, submits; compare codes; in the Regie click “Allow” on the knock card.
- Expect: laptop shows `check-code` matching `^\d{2} \d{2}$` and the caption “Check code for the control room”; Regie knock card “Laptop Anna wants to join” appears within `T-PAIR` with the same code; after “Allow” the laptop reaches `/join/station` with `connection-state=connected` within `T-PAIR`; Stations shows S1 “Laptop Anna · Screen 1”.

**E2E-PAIR-04** · P1 · pw — Laptop request denied
- Steps: as -03 but “Deny”.
- Expect: Regie log entry “Request from Laptop Anna denied”, card gone; laptop shows `pairing-denied` with an option to request again; no device was created.

**E2E-PAIR-05** · P1 · pw (`@short-ttl`) — Request expiry
- Steps: laptop requests; nobody answers for 25 s.
- Expect: laptop shows `pairing-expired` with a retry action; the knock card disappears from the Regie without reload; a new request gets a new code.

**E2E-PAIR-06** · P1 · pw (`@short-ttl`) — Approving after expiry
- Steps: laptop requests; the Regie goes offline (`net.cut`) so the card stays on screen; wait for expiry; Regie back online (`net.restore`) and click “Allow” on the stale card before the delta arrives (or on a frozen copy of the page).
- Expect: no crash; card removed after the delta sync or the 410 response; a notice (`/expired/i`, [GAP-27]); no device created.

**E2E-PAIR-07** · P1 · pw (`@short-ttl` for the expiry half) — Polling survives and window ends
- Steps: laptop requests and waits; the laptop goes offline (`net.cut`); the Regie approves; the laptop comes back 5 s later and polls; separately: reload the tab on `/join/waiting` while pending; separately: approve, then wait beyond the credentials window (15 s in the profile) before the laptop polls.
- Expect: reload keeps the same request and the same check code (state in sessionStorage `studioflow.pairing`); credentials are obtained when polling resumes inside the window; after the window the laptop shows `pairing-expired` and offers a new request.

**E2E-PAIR-08** · P1 · pw — Unique codes, identical names
- Steps: create 8 pending requests through the API and one through the real `/join` form of a laptop context, all named “Laptop” (9 in total, under the 10-per-IP limit); open the pairing dock.
- Expect: 9 cards with 9 distinct codes; approving the card whose code equals the code shown on the real laptop's page pairs exactly that laptop, the other 8 requests stay pending.

**E2E-PAIR-09** · P0 · pw — Double approve race
- Steps: two Regie sessions show the same card; `Promise.all([A.click('Allow'), B.click('Allow')])`.
- Expect: exactly one device (Stations count +1, one `device.paired` audit row); the losing operator sees no error toast, the card disappears for both within 1 s; the laptop is paired once.

**E2E-PAIR-10** · P0 · pw — Invite link for laptops
- Steps: Regie “Pair device” → tab “Link” → “Create link”; copy with “Copy”; open `/j/{token}` in a laptop context; open the same link in a second context.
- Expect: URL box shows `https://…/j/{token}` (mono), clipboard contains it, text “Valid once and expires in 30 minutes. Whoever opens it is paired straight away.”; the first context is redirected to `/join/i/{token}` and paired without approval (token then absent from the URL); the second context shows the expired page (`pairing-expired`) with a link to `/join`.

**E2E-PAIR-11** · P1 · pw — Revoke link
- Steps: create link; “Revoke link”; open the link.
- Expect: toast “Invite link revoked”; the link opens the expired page; no invite listed in the Regie; log entry “Invite link created” present.

**E2E-PAIR-12** · P1 · pw — New QR code
- Steps: tab “Phone” → “Generate new code”; open the old QR URL, then the new one (two phone contexts).
- Expect: toast “New QR code, the old one is no longer valid”; old → expired page; new → pairs; countdown restarts at 30:00.

**E2E-PAIR-13** · P0 · pw — Re-recognition on reload
- Steps: paired phone; reload `/join/`; then clear localStorage and reload.
- Expect: reload goes straight to the station state with the same device id/code (K1), no duplicate station in the Regie; after clearing storage the pairing form appears and the old station stays listed as offline (not auto-removed).

**E2E-PAIR-14** · P1 · pw — Lost redeem response
- Steps: phone opens the invite URL while `net.routeFault` lets the first `redeem` request reach the server but aborts the response.
- Expect: the sender retries with the same `clientId`, ends up paired exactly once (one new device in the Regie); the invite was not consumed by the lost attempt.

**E2E-PAIR-15** · P1 · pw — Kind detection and platform text
- Steps: open `/join` with Desktop Chrome, Pixel 7, iPhone 14, iPad, Desktop Firefox; switch kind manually; submit.
- Expect: default kind: laptop for desktop browsers (have `getDisplayMedia`), phone for Pixel 7, iPhone and iPad; the toggle changes it; the platform text sent matches `^[\w .()-]+ · (Chrome|Edge|Firefox|Safari)$` (e.g. “Pixel 7 · Chrome”, “Windows · Edge”).

**E2E-PAIR-16** · P1 · pw (`@short-ttl`) — Pairing limit message on the sender
- Steps: the profile sets `Pairing:Limits:PendingTotal=3`; create 3 pending requests through the API, then submit the `/join` form.
- Expect: the form shows a rate-limit notice (`/later/i`, “Too many attempts. Please try again later.”, [GAP-27]) and does not spin forever; works again after a slot frees up.

**E2E-PAIR-17** · P0 · pw — Probe-webinar fleet (phase 1 acceptance)
- Steps: pair 3 phones (QR) and 2 laptops (1 by code, 1 by link); start the 3 cameras and one screen share per laptop; build scene “Probe” with all five sources; make it program.
- Expect: codes K1–K3, S1–S2; header chip “All 5 stations ok”; five playing `<video>` elements in the output within `T-VIDEO-START`; no incident.

**E2E-PAIR-18** · P2 · pw — Second operator sees pairing live
- Steps: operator A and B open the pairing dock; a laptop requests; A approves.
- Expect: the card appears in B within 1 s; after A approves it disappears in B within 1 s; the new station appears in both.

**E2E-PAIR-19** · P2 · pw — Pairing while the Regie reconnects
- Steps: Regie A offline (`net.cut`); a laptop requests; A back online (`net.restore`).
- Expect: after resubscription (delta) the card is shown; no duplicate cards.

**E2E-PAIR-20** · P1 · pw — Short URL entry points
- Steps: request `/join`, `/join/`, `/join/waiting`, `/join/station`, `/join/i/abc`, `/j/abc`.
- Expect: all return the sender app shell (200) except `/j/abc` (3xx to `/join/i/abc`); unknown deep links render the pairing form rather than a server error; the shell works offline after the first load (service worker).

### 2.3 SCENE – Scenes and editing

**UNIT-SCENE-01** · P0 · xunit — Scene name and background validation
- Steps: names `""`, `"  "`, 1 char, 80 chars, 81 chars, emoji/surrogate pairs at the 80 boundary, with leading/trailing spaces; colours `#a1B2c3`, `#abc`, `red`, `#12345g`, `#12345678`, `javascript:x`; background asset = image, video, unknown, other production's.
- Expect: trimmed 1–80 accepted (length counted in text elements, so an emoji counts once; control characters are removed before the check); invalid names/colours → `validation_failed` with `errors.name` / `errors.background.color`; background asset must exist, belong to the production and be an image.

**UNIT-SCENE-02** · P0 · xunit — Item geometry bounds (inclusive/exclusive)
- Steps: for x,y,w,h test min−1, min, max, max+1 (x −3841/−3840/3840/3841; y −2161/−2160/2160/2161; w 15/16/3840/3841; h 15/16/2160/2161); fractional numbers (1.5), numbers beyond int32, strings, `null`, NaN literal (`"NaN"`).
- Expect: boundaries inclusive as in spec 4.3; fractional/oversized/non-numeric → rejected at deserialisation (`NumberHandling.Strict`) as 400 with field path; no clamping on the server.

**UNIT-SCENE-03** · P1 · xunit — Crop, radius, rotation, border, hold, fallback
- Steps: crop sides −0.01/0/0.45/0.4501; top+bottom 0.45+0.45, 0.45+0.44; left+right likewise; radius −1/0/200/201; rotation 0/90/180/270/45/−90/360; border width 0/1/40/41 and colour invalid; `holdMs` null/0/600000/600001/−1; fallback = own source / unknown / other production / media asset / device slot.
- Expect: valid combos pass; every invalid one → `validation_failed` naming the field (`items[i].crop.top`, …); fallback must exist in the production and differ from the item's source; opposite crop sides must sum to < 0.9.

**UNIT-SCENE-04** · P0 · xunit — Item limit and ids
- Steps: scene with 32 items; add the 33rd (`AddSceneItem`); replace with 33; duplicate item ids; client-supplied ids with wrong shape (`../x`, `<script>`, empty, 10 kB) [GAP-17].
- Expect: 33rd item → 409 `limit_reached` in both paths [GAP-05]; duplicates and malformed ids → `validation_failed`; client-supplied ids are validated against `^itm_[a-z0-9]{4,40}$` (`EntityIds.IsValid`).

**UNIT-SCENE-05** · P1 · xunit — New item defaults
- Steps: `AddSceneItem` for camera, screen, image, video sources, with no geometry, partial geometry (only `X`), explicit `Fit`/`Radius`.
- Expect: defaults x 1240, y 680, w 600, h 338, radius 12, fit `contain` for screens and `cover` otherwise, crop 0, rotation 0, mirror false, hidden false, locked false, `onLost {holdMs:3000, fallbackSource:null}`; explicit fields override, the rest default; new item id `itm_…` appended last (front).

**UNIT-SCENE-06** · P1 · xunit — Source existence rules [GAP-17]
- Steps: add item with unknown source, other production's source, malformed source (`../../x`, `dev_x/screen-10`, `dev_x/microphone`); replace items keeping a source whose device was deleted; replace adding a *new* item with a deleted source.
- Expect: unknown/malformed/foreign → `validation_failed`; keeping an item whose source vanished later is allowed (renders “Source missing”); introducing a missing source through `ReplaceSceneItems` is rejected.

**UNIT-SCENE-07** · P0 · xunit — Version and events per mutation
- Steps: create, rename, add item, update item, remove item, replace items, change layout mode, change background.
- Expect: `Version` increments by exactly 1 per mutation; each emits exactly one `sceneUpserted` with the full scene (and `logAppended` only where the spec has a log text); revision increments are consecutive.

**UNIT-SCENE-08** · P1 · xunit — Clone
- Steps: clone a scene with 5 items (2 hidden, 1 locked, auto grid, background asset).
- Expect: new scene id, name as requested (validated), `Version` 1, all items copied with **new** item ids and identical properties, layout mode and background copied, `SortOrder` last; cloning an unknown scene → 400 `validation_failed` (`errors.cloneFromSceneId`); cloning at 99 scenes → 409 `limit_reached`.

**UNIT-SCENE-09** · P1 · xunit — Reorder
- Steps: reorder with the exact set permuted; missing id; duplicate id; unknown id; empty list.
- Expect: valid → `SortOrder` 0…n−1 contiguous, `scenesReordered` lists all ids; invalid → `validation_failed`; keys 1–9 map to the new order.

**UNIT-SCENE-10** · P0 · xunit — Delete rules
- Steps: delete the program scene; delete the preview scene; delete a normal scene; delete the first of three; delete unknown.
- Expect: program → 409 `scene_is_live`; preview → removed, `sceneRemoved` followed by `programSwitched` with `previewSceneId: null`, transition cut, program unchanged; `SortOrder` compacted; unknown → 404; audit `scene.deleted`.

**UNIT-SCENE-11** · P1 · xunit — 99 scene limit
- Steps: create scenes up to 99 (default production has 3), then a 100th, then delete one and create again; adding a scene to a production that has no scenes (domain-level case).
- Expect: 100th → 409 `limit_reached`; works again after a delete; a scene added to a production without program becomes the program scene [GAP-02].

**UNIT-SCENE-12** · P0 · vitest — Layout templates produce the prototype rectangles
- Steps: for each of the 8 template ids `full two pip col onetwo grid grid3 auto` apply to 1…10 visible items of mixed kinds (screen, image, video, camera) plus hidden items.
- Expect: slot rectangles exactly equal `LAYOUT_TEMPLATES` (and the prototype `PRESETS`); items ordered by kind rank screen < media < camera, stable inside a rank; hidden items and items beyond the slot count keep their geometry; `fit: 'contain'` only for a screen in slot 0 unless template is `two`, `grid`, `grid3`; `radius: 0` for slots with `w === 1920` else 12; `auto` returns items unchanged (same order) with `layoutMode: 'autoGrid'`; all others `'free'`; the item order is the z-order, so a template re-orders the items (spec 4.3): the placed items first in slot order (slot 0 at the back, later slots in front, e.g. the small picture-in-picture window above the full-screen one), then every item without a slot (hidden items and items beyond the slot count) in front of them in their previous relative order; undo restores the previous order; the input array is not mutated.

**UNIT-SCENE-13** · P1 · vitest — Auto grid slot function
- Steps: `autoGridSlots(n)` for n = 0…12.
- Expect: 0 and 1 → the `full` slot (n ≤ 1, as in the prototype; with 0 available items nothing is rendered), 2 → `two`, 3 → `[[79,40,871,490],[970,40,871,490],[525,550,871,490]]`, 4 → `grid`, ≥ 5 → the 9 `grid3` slots; items beyond 9 are not rendered in Auto grid [GAP-11].

**UNIT-SCENE-14** · P2 · vitest — `clampItem` / `validateItem` / `itemDefaults`
- Steps: out-of-range geometry, crop, radius, rotation; NaN/Infinity; `validateItem` messages.
- Expect: client clamps exactly like the server bounds (radius 0…200, not 80 [GAP-11]); messages are the English texts of `model.scene.validation.*`; NaN becomes the previous value or default; defaults equal `NEW_ITEM_RECT`.

**UNIT-SCENE-15** · P0 · vitest — Renderer: fit, crop, radius, border, mirror, rotation, z-order
- Steps: render items with each property in a happy-dom container.
- Expect: one absolutely positioned element per visible item in array order (first = back), `hidden` not rendered; `object-fit` cover/contain; contain bars `#0a0d12`; crop implemented by an inner wrapper scaled so the cropped part fills the item (scale = 1/(1−left−right) horizontally, 1/(1−top−bottom) vertically, translate by the crop fractions); radius via `border-radius` + `overflow:hidden`; border as inset `box-shadow`; mirror `scaleX(-1)`; rotation 90/270 swaps the inner box width/height; only transforms (no canvas); missing source → background `#121821`.

**UNIT-SCENE-16** · P0 · vitest — Renderer: update in place, no flicker
- Steps: `show(scene)`, keep references to item and `<video>` nodes, call `update(scene')` with moved/resized/reordered items, an added item, a removed item.
- Expect: existing item elements and their `<video>` are the same DOM nodes (no re-creation, no `srcObject` reset), styles change in place, z-order follows the new array via order changes not re-creation, removed elements are detached once.

**UNIT-SCENE-17** · P0 · vitest — Renderer: Auto grid availability and reflow
- Steps: 4 camera items; statuses live → one `lost` inside hold time → one `lost` past hold → source back; media items; hidden item; call `refresh()` / provider events.
- Expect: arranged rectangles = `autoGridSlots(n)` with `n` = visible items whose source is live, or lost-inside-hold, or media; the dropped camera disappears from the grid when its hold expires (reflow to 3), returns to its item order position when back; `effectiveRects()` reports the computed rectangles per item id; geometry stored in the scene is untouched.

**UNIT-SCENE-18** · P1 · ng — Editor math (studio)
- Steps: snap to canvas edges (0, 1920), safe margin (40, 1880), centre (960/540), other items' edges/centres within 7 screen px; Alt disables snapping; corner resize with locked ratio (default), Shift free; min size; Alt+drag crop on edge/corner; keyboard nudge 1 px / Shift 10 px; clamp to bounds.
- Expect: results equal the prototype algorithm (`snapLines`, `snap1`, threshold `7/scale` canvas px); ratio preserved ±1 px after rounding; crop clamps 0.45 / 0.9; nudge never leaves −3840…3840; all outputs integers.

**UNIT-SCENE-19** · P1 · ng — Undo/redo store
- Steps: 65 edits on one scene; undo ×70; redo; edit after undo; switch scene; delete scene; reload store.
- Expect: stack depth 60 per scene (oldest dropped); undo emits one `ReplaceSceneItems` restoring the snapshot; redo available until a new edit; stacks are per scene; deleting a scene drops its stack; empty undo → message “Nothing to undo”; undo is refused for a scene that is live in Studio Mode (“This scene is live and stays unchanged”); after undo selection is cleared if the item vanished.

**UNIT-SCENE-20** · P0 · ng — Edit coalescing queue
- Steps: feed 200 drag updates for one item at 5 ms intervals while the fake API resolves after 40–400 ms random; feed updates for two items interleaved; fail one request (500) mid-drag.
- Expect: never more than one request in flight per item; after each response the newest state is sent (intermediate states skipped); the last request carries the final geometry; requests are issued in order; on error the store re-adopts the last server state for that item and reports one error (no retry storm).

**UNIT-SCENE-21** · P1 · ng — Sortable list (`sortable-list.component.spec.ts`, `sortable-geometry.spec.ts`, `reorder.spec.ts`, issue #19)
- Steps: drag with mouse, pen and touch emulation (handle, row, press and hold, a swipe), below and above the 4 px threshold, to the ends, to the own position, away from the list; Escape; pointer cancel; the list changing (another tab) or the held entry vanishing mid-drag; two drags in a row; a second pointer; auto-scroll near both edges and after the drag ended; keyboard (Space/Enter, arrows, Home/End, Escape, blur, Alt+Up/Down, Alt+Shift, no Alt, at the ends, focus kept); a single entry; German announcements; pure helpers (`moveEntry`, `stepTarget`, `isPermutation`, `sortByOrder`, drop index, shifts, line, edge speed).
- Expect: one `reorder` with the complete new order per finished move and none for a cancelled or unchanged one; the click that ends a drag is swallowed and a short click still reaches the row; the held row is lifted, the others make room, the line shows only for a changed target; touch scrolling and the context menu are suppressed only while a held row is dragged; announcements read “… moved to position 2 of 5.”; no listener is left after the component is destroyed.

**UNIT-SCENE-22** · P1 · ng — Reordering in the docks and the editor (`editor.service.spec.ts`, `sources-dock.reorder.spec.ts`, `scenes-dock.reorder.spec.ts`, `scene-commands.service.spec.ts`, `properties-dock.component.spec.ts`)
- Steps: drop a row; short click; Escape; request fails (409/400); Alt+Arrow; hidden and locked items; a session adds an item meanwhile; rapid reorders; geometry edit queued behind a reorder; live scene in Studio Mode; Auto grid; undo; file drop onto the Sources dock; Move up/down in the scene menu; “Bring to front” / “Send to back”.
- Expect: the new order is shown at once and one `PUT …/items/order` (ids only) or `PUT …/scenes/order` follows (later moves merged into one follow-up); a failed request restores the server's order with a toast; the dragged row is neither selected nor switched; the live scene in Studio Mode refuses with the toast and sends nothing; the Auto grid keeps its layout mode and the dock says the order is the cell; undo is one step through `ReplaceSceneItems`; the file drop still uploads or reports a rejected file.

**INT-SCENE-01** · P0 · xunit — Scene CRUD, events and audit
- Steps: via REST create, rename (`PATCH`), change layout mode and background, add/update/remove items, `PUT items`, reorder, delete; a studio hub client records events.
- Expect: each call returns the documented type/status (201 created, 200 scene, 204 delete/order); one event per mutation in order; audit `scene.created`, `scene.deleted`; ProblemDetails `errors` use JSON paths (`items[0].x`).

**INT-SCENE-02** · P1 · xunit — Validation error shape and malformed JSON
- Steps: bodies with wrong types, nulls, unknown enum strings (`fit:"stretch"`), `items:null`, duplicate JSON keys, 10 000 items (body 256 KB limit), huge strings (1 MB name), deep nesting.
- Expect: 400 `validation_failed` (or 413 above 256 KB) with `errors`; unknown JSON properties ignored; no 500; no partial change (scene `Version` unchanged).

**INT-SCENE-03** · P0 · xunit — Concurrent writers, last writer wins per item
- Steps: 50 parallel `PUT …/items/{id}` with different `x`; 40 parallel `POST …/items`; 120 parallel scene creations; interleaved updates of two different items.
- Expect: the final item state equals the update with the highest revision; exactly 32 adds succeed (rest 409 `limit_reached`); exactly the free count of scene creations succeed; different items never overwrite each other; hub events are strictly consecutive revisions, delivered once, in revision order; `Version` equals the number of successful mutations.

**INT-SCENE-04** · P2 · xunit — Locked/hidden flags are data
- Steps: update a `locked` item's geometry; hide/unhide.
- Expect: the server does not enforce `locked` (client concern); hidden items stay in the scene, are ignored by tally.

**INT-SCENE-05** · P1 · xunit — Assets referenced by scenes
- Steps: scene background = image asset; fallback = image asset; delete the asset; clear references; delete again.
- Expect: 409 `asset_in_use` while referenced (background, item source, fallback, slate), 204 afterwards.

**INT-SCENE-06** · P1 · xunit — Stale sources keep rendering path
- Steps: delete a device that has items in two scenes; read scenes; `PUT items` with unchanged list; `PUT items` after editing geometry of the stale item.
- Expect: scenes still contain the items (source ref dangling), `GET snapshot` has no source entry for it; edits of its geometry are accepted [GAP-17].

**INT-SCENE-07** · P2 · xunit — Scene list order and clone placement
- Steps: create, clone, reorder, delete; read `SortOrder`.
- Expect: new and cloned scenes are appended (cloned scenes do not jump next to the source); `SortOrder` always 0…n−1.

**INT-SCENE-08** · P1 · xunit — Reorder the items of a scene (`PUT …/scenes/{sceneId}/items/order`, issue #19)
- Steps: reorder with the exact set of item ids; the same order again; a single item and an empty scene; missing, extra, unknown and duplicate ids; no list; unknown scene; reorder after another session changed an item's geometry; three parallel reorders; reorder the program scene with a Regie hub and an output hub subscribed. Domain level (`Scene.ReorderItems`): the same cases plus hidden and locked items.
- Expect: a valid order is stored, the version increases by one and `sceneUpserted` carries the new order; the same order changes nothing (no version, no event); a list that is not exactly the scene's ids is 409 `conflict` with nothing changed, a missing list is 400 `validation_failed`, an unknown scene 404; the other session's geometry edit survives (the request carries ids only); parallel requests are serialised (distinct versions, the last one stored); the Regie hub and the output hub both receive the new order of the program scene.

**E2E-SCENE-01** · P1 · pw — Rename a scene
- Steps: select the scene in the Scenes dock (inspector shows “Scene”), change field “Name”, blur.
- Expect: scene row, monitor header, thumbnail label and API show the new name within 1 s; reload keeps it; empty or whitespace name is not sent (field reverts, hint shown); 81 characters are cut or rejected, never saved.

**E2E-SCENE-02** · P1 · pw — Create and clone a scene [GAP-37]
- Steps: Scenes dock header “+ Scene” (accessible name “Add scene”; new scenes are called “New scene N”); inspector “Duplicate” on a scene with three items (the copy is called “<name> (copy)”).
- Expect: new scene appended with a default name; clone has the same items with different item ids and is editable independently; both operators see them within 1 s; at 99 scenes the control is disabled or shows an error.

**E2E-SCENE-03** · P0 · pw — Delete a scene
- Steps: select a non-program scene; “Delete scene” → confirm box ““Scene B” will be deleted. This cannot be undone.” → “Delete scene”; also “Cancel”; select the program scene.
- Expect: toast “Scene “Scene B” deleted” and log entry; scene gone for both operators; keyboard keys re-map; “Cancel” keeps it; program scene: delete button `disabled` with hint “The live scene cannot be deleted. Edit other scenes in Studio Mode.” (Studio Mode off) or “The live scene cannot be deleted.” (on); API `DELETE` of the program scene → 409 `scene_is_live`.

**E2E-SCENE-04** · P0 · pw — Add a source to a scene
- Steps: Sources dock “+ Source” → menu “Add to “Scene A”” → pick K1; repeat until all sources are in; block one device first.
- Expect: menu lists only sources not yet in the scene and not blocked; new item at 1240/680 600×338, radius 12 (contain for screens), selected, toast “K1 added to “Scene A””; empty menu shows “All sources are already in this scene.”; an empty scene shows “This scene is empty.” with “Add a source or apply a template.”.

**E2E-SCENE-05** · P0 · pw — Apply layout templates (parametrised over 8)
- Pre: scene with S1 (screen), K1, K2, K3 (cameras) plus one image (M1); for `full` one item, `two` two items, `pip` two, `col` three, `onetwo` three, `grid` four, `grid3` five, `auto` four.
- Steps: inspector “Apply template” → click the template (names Full screen, Side by side, Picture in picture, Screen + camera column, One plus two, 2 × 2, 3 × 3, Auto grid [GAP-11]).
- Expect: item rectangles equal the `LAYOUT_TEMPLATES` slots after kind ordering (read via API snapshot and via the inspector X/Y/B/H fields); toast “Template “<Name>” applied” with “Undo”; `auto` sets `layoutMode: autoGrid` and the Program monitor/output arrange the live items; a scene without visible items shows “Add a source first”; in Studio Mode on the live scene the buttons are disabled.

**E2E-SCENE-06** · P1 · pw — Auto grid reflow when a camera drops
- Pre: 4 phones live in an Auto grid scene that is program; output open.
- Steps: phone 4 goes offline (`goOffline`); wait past its hold (3 s); phone 4 comes back.
- Expect: output initially shows four 871×490 tiles (2 × 2); after the hold expiry three tiles (two on top, one centred below at 525/550); when K4 is live again four tiles; no layout flicker of the other three videos (same `<video>` elements, playing throughout); `data-state` of K4 goes `hold` → `held`/absent → `live`.

**E2E-SCENE-07** · P0 · pw — Drag to move with snapping
- Steps: select an item; drag it with the mouse (`page.mouse`) by (+300, +150) canvas px; drag until within 5 screen px of x = 0, then of the safe margin 40, centre, another item's edge; hold Alt while dragging near a snap line.
- Expect: free move: final x/y = start + delta (±1 px for rounding); near a line: x/y equal the line value exactly and a blue guide (`.guide`) is visible during the drag and gone after `mouseup`; with Alt no snapping and no guide; dot raster only while dragging; one undo step for the whole drag.

**E2E-SCENE-08** · P1 · pw — Resize
- Steps: drag the south-east handle by (+200, 0); with Shift; to below the minimum; beyond the canvas.
- Expect: default keeps the aspect ratio (w/h unchanged ±0.01), Shift frees it; minimum honoured (UI minimum, server minimum 16 [GAP-11]); values stay in −3840…3840 / 16…3840; label tab shows `K1 · <w> × <h>` live.

**E2E-SCENE-09** · P1 · pw — Crop with Alt+drag
- Steps: Alt+drag the right edge inwards by 20 % of the item width, the top edge, a corner.
- Expect: API `crop` values ≈ 0.2 / top / both sides; item rectangle unchanged; rendered picture is cropped (output wrapper transform matches UNIT-SCENE-15); crop stops at 0.45; undo restores.

**E2E-SCENE-10** · P1 · pw — Keyboard nudge and deselect
- Steps: click an item; ArrowRight ×3; Shift+ArrowDown; Escape; click empty monitor area.
- Expect: x +3, y +10 (API values), key repeat is one undo step, Escape deselects (inspector back to “Scene”), clicking empty area deselects.

**E2E-SCENE-11** · P1 · pw — Inspector number fields and bounds
- Steps: type into X, Y, B, H, radius: `5000`, `-5000`, `0`, `abc`, `1.5`, empty, `99999999999`, radius `300`.
- Expect: values clamp to server bounds (x 3840, y −2160, w 16, h 16, radius 200 [GAP-11]); non-numeric input is ignored; decimals are rounded; empty restores the previous value; persisted values equal what the fields show after reload; the label tab updates while typing.

**E2E-SCENE-12** · P0 · pw — Undo/redo
- Steps: move, resize, apply template, toggle fit, delete item; Ctrl+Z each time; Ctrl+Shift+Z; 65 edits then 70 undos; undo with empty stack; undo button in the Sources header; switch scene and undo.
- Expect: each undo restores the previous geometry/list through one `PUT items`; toast “Undone”; empty stack → “Nothing to undo”; only the last 60 edits revert; undo applies to the scene it was recorded for (not the selected scene); redo works until a new edit; after reload the stack is empty.

**E2E-SCENE-13** · P1 · pw — Layers
- Steps: “Bring forward” / “Send backward” on the middle of three items; check at ends.
- Expect: array order in the API changes by one position (clamped at ends); Sources list order (front first) and renderer DOM order follow; Program/output stacking changes visibly (overlap region shows the front item's pixel colour).

**E2E-SCENE-14** · P1 · pw — Hide and lock items
- Steps: eye button (“Hide: …” / “Show: …”, `aria-pressed`); lock button (“Lock: …” / “Unlock: …”); try dragging and arrow keys on a locked item.
- Expect: hidden item disappears from Program monitor and output DOM and gives no tally; the Sources row is greyed and not selectable; a locked item can be selected but neither dragged nor nudged; inspector remains usable; both states persist for both operators.

**E2E-SCENE-15** · P1 · pw — Remove item with undo toast
- Steps: “Remove from scene” (inspector danger zone), then toast “Undo”.
- Expect: toast “K1 removed from “Scene A””; item gone; “Undo” restores the item with the same id, position and z-order.

**E2E-SCENE-16** · P1 · pw — Fit, mirror, corners, hold
- Steps: “Fill” / “Show all”; “Mirror”; corner radius 0/24/200; “On failure” options.
- Expect: output `<video>` computed `object-fit` cover/contain; mirror → transform `scaleX(-1)`; radius → `border-radius` = value × stage scale; options map to `holdMs` 3000 / 10000 / null with the labels “Freeze frame 3 s, then dim”, “Freeze frame 10 s, then dim”, “Hold freeze frame”.

**E2E-SCENE-17** · P0 · pw — Two operators edit concurrently
- Steps: A drags item 1 while B types a new X for item 2 of the same scene; then both change item 1's X at the same moment (A types 100, B types 200).
- Expect: different items: both changes survive and both UIs converge within 1 s; same item: both UIs end at the same value, equal to the API value (the later write); no operator ever sees a stale value after 1 s; no error toast.

**E2E-SCENE-18** · P0 · pw — Coalesced drag updates, no out-of-order final state
- Steps: record all `PUT …/items/{id}` requests (start/end timestamps); drag for 2 s with ~120 pointer events; `net.routeFault` delays each PUT randomly 0–400 ms; release.
- Expect: no two PUTs for the same item overlap in time; request count ≥ 2 and ≤ `ceil(dragMs / minDelay) + 2`; final server geometry equals the geometry at pointer release (±0 px); both operators and the output show it; no request after release carries an earlier position.

**E2E-SCENE-19** · P1 · pw — Live-scene protection and live editing
- Steps: Studio Mode on with preview == program (select the program scene in the preview); then Studio Mode off and drag an item of the program scene.
- Expect: on: banner “This scene is live right now. Editing is possible once another scene is on Program.”, overlay inert, controls disabled, actions toast “This scene is live. Switch another scene to Program first.”; off: Program header shows “Changes go live immediately”, the output follows the drag within `T-SWITCH` plus one request round trip.

**E2E-SCENE-20** · P2 · pw — Boundary behaviour at the limits
- Steps: via UI drag an item far outside the canvas; add the 32nd item (32 image assets uploaded via API); try a 33rd; create scenes up to 99, then the 100th.
- Expect: position clamps to −3840…3840; item partially outside the canvas is allowed and clipped by the stage; 33rd: control disabled or toast `/32/`; 100th scene: control disabled or toast `/99/`; no unhandled errors.

**E2E-SCENE-21** · P1 · pw — Reorder scenes
- Steps: change scene order (drag the row handle, or keyboard `Alt+ArrowUp/Down` on the row [GAP-37]); press keys 1–3.
- Expect: API `SortOrder` updated; the other operator's list reorders; key 1 selects the new first scene; reload keeps the order.

**E2E-SCENE-22** · P1 · pw — Missing source
- Steps: scene with S1 and K1; `DELETE` the laptop device through the API.
- Expect: the item stays; Program/Preview monitor and thumbnail show the dark placeholder `#121821` with the label tab “Source missing” (Regie only); output shows the dark placeholder without text; the Sources row is selectable and removable; no console errors.

**E2E-SCENE-23** · P2 · pw — Thumbnails and inspector context
- Steps: move an item; select an item vs nothing.
- Expect: scene thumbnails (renderer `thumbnail` mode) update within 1 s; inspector title “Item” with sub “K1 · <name>” when an item is selected and “Scene” with the scene name otherwise.

**E2E-SCENE-24** · P2 · pw — Scene background colour and image [GAP-37]
- Steps: set background colour `#102030` and an image asset through the API.
- Expect: output stage shows the colour under items (and the image cover-fitted on top when set); invalid colour rejected by the API; with `bg=transparent` see `E2E-OUT-04`.

**E2E-SCENE-30** · P1 · pw — Reorder the sources by dragging (issue #19)
- Steps: three overlapping flat-colour images (red back, blue front); start the broadcast and open the output and a second Regie; drag the back row to the top of the Sources dock with the mouse; Ctrl+Z.
- Expect: nothing is sent while dragging, a blue insertion line shows the target; one `PUT …/items/order` on drop (no `PUT …/items`), no element changed, dragging does not select; the Program monitor and the output show red in front (pixels, z-index = array position), the other operator's list follows within 4 s; undo restores the order everywhere.

**E2E-SCENE-31** · P1 · pw — A click is a click, Escape and a drop away from the list restore the order
- Steps: click a row; start a drag and press Escape; start a drag and drop far to the side of the list.
- Expect: the click selects; Escape and the drop away put the row back, leave the selection and send no request.

**E2E-SCENE-32** · P1 · pw — Reorder from the keyboard, announced [a11y]
- Steps: Space on a handle, ArrowUp twice, Space; Enter, ArrowDown, Escape; Alt+ArrowDown and Alt+Shift+ArrowUp on a row.
- Expect: the live region says “picked up at position 3 of 3”, “moved to position 1 of 3”, “Move cancelled”; the order in the API follows only the drops; Alt+Arrow moves one place or to the very front and the focus stays on the same control.

**E2E-SCENE-33** · P1 · pw — Auto grid: the order is the cell
- Steps: Auto grid scene with three items; drag the first item to the top of the Sources dock.
- Expect: the dock shows the Auto grid hint; the item moves to the last cell and the others move up; the layout mode stays Auto grid.

**E2E-SCENE-34** · P1 · pw — Reorder the scenes by dragging
- Steps: drag the last scene to the top of the Scenes dock; press key 1.
- Expect: one `PUT …/scenes/order`, no switch of the dragged scene, API order, keycaps and the other operator follow; key 1 puts the new first scene live.

**E2E-SCENE-35** · P1 · pw — Reorder on a touch screen (`pixel-7`, `iphone-15`, `ipad`)
- Steps: with a finger: drag from the handle; start a swipe at once; press and hold on a row, then drag.
- Expect: the handle drags at once, the swipe drags nothing and sends nothing, the held row is lifted after the hold and dropped at the new place; also on the small `iphone-15` screen, where the page has scrolled to the list first (the list measures its scroll area by the window, not by `<body>`).

### 2.4 SWITCH – Switching, broadcast, tally

Strings: toast ““Scene B” is live”, log “Scene “Scene B” is live”, toasts “Studio Mode on: Preview and Take” / “Studio Mode off: scenes switch live directly”, hints “Click a scene to switch it live directly.” /
“Click a scene to load it into Preview. Take switches it live.”, “Preview off” + “With Studio Mode the Preview appears here.”, Program header “Changes go live immediately”, button “Take” with hint “Space”,
header “READY” / “LIVE” + `hh:mm:ss` / “ENDED”, buttons “Start broadcast” / “End broadcast”, slates “Starting soon” (subtitle = production name) / “Thanks for watching” / “No access”.

**UNIT-SWITCH-01** · P0 · xunit — Program switch
- Steps: switch to another scene (cut and fade 300); to the current program; to an unknown id; with preview set; with broadcast standby/live/ended [GAP-09].
- Expect: `ProgramSceneId` updated, `LastTransition` = request, `LastSwitchAt` = now, one `programSwitched` event carrying `PreviousProgramSceneId`; same scene → 200, no event, no state change; unknown → 404 `not_found`; the preview is unchanged unless the target scene is the current preview, in which case program and preview swap (like a take; implemented in `Production.SwitchProgram`, not in spec 4.2, [GAP-09]); allowed in every broadcast state (output keeps showing the slate until start).

**UNIT-SWITCH-02** · P0 · xunit — Transition guard (FakeTimeProvider)
- Steps: fade 300 ms at t0, then request at t0+299, t0+300, t0+301; cut then immediate request; fade 2000 then `take`, `program`, `setPreview`; two requests in the same millisecond.
- Expect: `now < LastSwitchAt + DurationMs` → 409 `transition_running`; at exactly t0+300 allowed; cut (0 ms) never blocks; take and program share the guard; `setPreview` is not guarded [GAP-09]; the guard uses the server clock only.

**UNIT-SWITCH-03** · P0 · xunit — Take
- Steps: take with preview null; preview == program; preview ≠ program; take twice after the guard; take after the preview scene was deleted.
- Expect: preview null or equal to program → 409 `conflict`; otherwise program and preview swap and one `programSwitched` event carries both ids and the transition; ping-pong takes work; deleted preview → 409 `conflict`.

**UNIT-SWITCH-04** · P1 · xunit — Transition validation [GAP-10]
- Steps: `{cut,0}`, `{cut,300}`, `{fade,300}`, `{fade,250}`, `{fade,0}`, `{fade,2001}`, `{fade,200}`, `{fade,2000}`, missing transition, unknown kind.
- Expect: valid: cut/0, all seven fade durations (200, 300, 500, 800, 1000, 1500, 2000); `cut` with a non-zero duration is normalised to 0 (stored and echoed as 0); every other combination → 400 `validation_failed` with `errors.transition.durationMs`.

**UNIT-SWITCH-05** · P0 · xunit — Broadcast state machine [GAP-09]
- Steps: standby→start→end→start→reset; start while live; end while ended; end while standby; reset from each state; timestamps.
- Expect: `start` (standby|ended → live) sets `LiveSince` = now and clears `EndedAt`; `end` (live → ended) sets `EndedAt`; `reset` (any → standby) clears both; start while live, end while ended and reset while already in standby are idempotent no-ops (200, no event, no audit row); `end` while standby → 409 `conflict` (“The broadcast is not running.”) [GAP-09]; each effective transition emits `productionChanged`; audit rows `broadcast.started`/`broadcast.ended` exist for start/end (spec 4.9 lists none for reset); log texts “Broadcast started”, “Broadcast ended”.

**UNIT-SWITCH-06** · P0 · xunit — Tally computation
- Steps: matrix over: item in program/preview/both/neither; hidden item; same device with camera in program and screen in preview; media source; broadcast live/standby/ended; preview null; Auto grid scene; device with 9 slots.
- Expect: per slot `program` if a non-hidden item with that source is in the program scene, else `preview` if in the preview scene, else `off`; overall = max over slots (program > preview > off); media never produce tally; standby and ended → every slot and overall `off`; Auto grid counts items regardless of availability.

**UNIT-SWITCH-07** · P1 · xunit — Tally push policy
- Steps: change program, preview, item hidden flag, item added/removed, broadcast state, device connects (`Hello`); change unrelated scene.
- Expect: a `tally` message is produced only for devices whose per-slot map or overall value changed, always on `Hello`; none for unrelated changes; messages carry all slots of the device.

**UNIT-SWITCH-08** · P1 · xunit — Preview rules [GAP-18]
- Steps: `setPreview` with existing scene, same as program, null, unknown scene; delete the preview scene.
- Expect: existing/equal/null accepted (200), unknown → 404; deleting the preview scene clears it; the server stores the value only (no Studio Mode knowledge).

**UNIT-SWITCH-09** · P1 · ng — Regie switching and keyboard logic
- Steps: store with scenes; direct mode `chooseScene`; Studio Mode on/off; `take`; local transition guard derived from the event `At` + `durationMs` and the server offset; keys 1–9, Space (on body, on button, in input), Escape order, Ctrl+Z; toggling Studio Mode with `presence` 1 and 2.
- Expect: no request while a transition is running locally; Take disabled when preview is null or equals program; payloads are exactly `SwitchProgramRequest{sceneId, transition}` / `TakeRequest{transition}` with the selected transition; key handling equals the prototype (typing excluded, modifier keys ignored); toggling on sets the preview to the next scene (wrapping), toggling off clears the preview only when `presence ≤ 1`; settings written to `studioflow.studio` / `studioflow.transition`.

**INT-SWITCH-01** · P0 · xunit — Switch over REST with the guard
- Steps: `POST …/program {sceneId, transition:{fade,300}}` then immediately again; wait 300 ms (real time, margin 20 ms) and again; 10 parallel switches to 10 scenes with fade 500.
- Expect: first 200 `ProductionDto` (`lastTransition` echoed), second 409 `transition_running`, third 200; of the 10 parallel requests exactly one succeeds and nine return 409; `LastSwitchAt` is server time.

**INT-SWITCH-02** · P0 · xunit — Event order and output filtering for a switch
- Steps: studio hub and output hub clients subscribed; switch.
- Expect: studio receives `programSwitched` then `logAppended` (“Scene “X” is live”) with consecutive revisions; output receives `programSwitched` (identical payload) and `revisionOnly` for the log revision (same revision numbers); audit `scene.live`.

**INT-SWITCH-03** · P0 · xunit — Tally over the device hub
- Steps: device hub `Hello`; switch program/preview; take; start/end/reset broadcast; hide the item.
- Expect: `Hello` answer contains the current `TallyDto`; a `tally` message follows each relevant change within 500 ms (`T-TALLY`); standby/ended → `off`; no message for irrelevant changes; two devices receive only their own slots.

**INT-SWITCH-04** · P0 · xunit — Broadcast endpoints
- Steps: start, start, end, end, start, reset, reset; `end` on a production in standby; read `OutputSnapshot`.
- Expect: 200 with `ProductionDto` for repeated calls (no new event), 409 `conflict` for `end` in standby; fields as in UNIT-SWITCH-05; snapshot reflects `broadcast`, `liveSince`, `endedAt`; unknown production 404.

**INT-SWITCH-05** · P1 · xunit — Slates
- Steps: `PATCH production {standbySlate:{title,subtitle,backgroundAssetId}}`; title empty/81 chars; background = video asset/unknown; delete the asset.
- Expect: valid change → `productionChanged`; title 1–80 (trimmed), a longer subtitle is truncated instead of rejected; background must be an image of the production; delete of the used asset → 409 `asset_in_use`; null fields leave the slate unchanged; defaults “Starting soon” (subtitle = production name) and “Thanks for watching”.

**INT-SWITCH-06** · P2 · xunit — Server time
- Steps: read `ProductionSnapshot.ServerTime` repeatedly.
- Expect: monotonic, within ±1 s of the test clock; `LastSwitchAt` and incident timestamps use the same clock.

**E2E-SWITCH-01** · P0 · pw — Direct switch (Studio Mode off)
- Steps: click scene “Scene B” in the Scenes dock.
- Expect: Program monitor header shows the new name; toast ““Scene B” is live”; log entry “Scene “Scene B” is live” in the message strip; scene button `aria-pressed=true`, label ends “, live on Program”, tag PGM; API `programSceneId`; output scene id changes within `T-SWITCH`; Program screen gets the `is-flash` outline once; clicking the already-live scene does nothing (no toast, no request).

**E2E-SWITCH-02** · P0 · pw — Cut and fade
- Steps: choose “Cut”, switch; choose “Fade” (0.3 s), switch; instrument the output with `Element.prototype.animate` and `document.getAnimations()`.
- Expect: cut: no opacity animation, next frame shows the new scene only; fade: exactly one opacity animation of `duration: 300` (± 1 ms) on the new layer, the old layer disappears when it ends; the API event carries `transition {kind, durationMs}` and the output uses it (not the Regie's local setting); `T-FADE`.

**E2E-SWITCH-03** · P1 · pw — Fade duration stepper
- Steps: press “Longer fade” up to the end and “Shorter fade” down to the start; switch to “Cut”; reload.
- Expect: values in order “0.2 s”, “0.3 s”, “0.5 s”, “0.8 s”, “1 s”, “1.5 s”, “2 s”; minus disabled at “0.2 s”, plus disabled at “2 s”; both disabled and the value muted under “Cut”; selection persisted in `studioflow.transition`; the request body carries the matching `durationMs`.

**E2E-SWITCH-04** · P0 · pw — A fade always completes; switches during a fade are ignored
- Steps: duration 2 s; operator A clicks “Scene B”, 300 ms later clicks “Scene C” and presses key `3`; operator B (separate Regie) clicks “Scene C” 500 ms after A's switch; a REST client posts a switch at once. The three actors work at the same time, each at its moment: a click costs a loaded machine several hundred milliseconds of round trips, and one after the other they ran past the end of the 2 s fade (the REST client got 200 instead of 409 in 12 of 20 runs at a load of 25). The two clicks skip the actionability checks of Playwright (`force`): its “stable” check needs two animation frames of the page and took 1.5 s at a load of 25, so that the click of A reached the Regie 2.7 s after the switch, when the UI guard was gone (A sent two requests in 1 of 36 runs). The guard of the UI follows the event of the switch and not the response of the request (the store of the Regie is fed by events only), so each Regie waits until its Program monitor shows “Scene B” before it is tested with a click; earlier the request goes out and the server refuses it with 409, which is no error toast either. The same holds for Take: the test waits for the Program monitor to show the new scene before it presses Space (a second Take went out 57 ms after the first in 1 of 61 runs, the answer was 409).
- Expect: A's second click and key send no request (UI guard) and show no error; B's request returns 409 `transition_running` (if a request goes out nevertheless, the Regie shows the notice “A fade is still running”; since issue 55 a Regie sends nothing between its own request and the hub event, and B knows the fade from the event, so B's click is not sent at all); the Take button is `disabled` during the fade; after 2 s program = “Scene B” in both Regies and the output; at no moment does the output show a half state after the fade ended (opacity of the new layer 1, old layer removed); a switch after the fade works. The animation reports its own end (`finished`, not cancelled): the renderer's stall guard does not cut a fade short that is only late with its frames (issue 31); `T-FADE` is judged without the frame stall of the page.

**E2E-SWITCH-05** · P0 · pw — Studio Mode
- Steps: toggle the `Studio Mode` switch on; click “Scene C”; toggle off; reload with it on.
- Expect: toast “Studio Mode on: Preview and Take”; Preview monitor and Take appear, docks and control column do not move (bounding boxes unchanged ±0 px, E2E-DOCK-09); preview defaults to the scene after the program (wrapping to the first after the last) when none is set [GAP-18]; clicking a scene only changes the preview (program and output unchanged); “Changes go live immediately” hidden; hint “Click a scene to load it into Preview. Take switches it live.”; off: toast “Studio Mode off: scenes switch live directly”, Preview area shows “Preview off”; state persists in `studioflow.studio`.

**E2E-SWITCH-06** · P0 · pw — Take
- Steps: Studio Mode on, preview “Scene C”, program “Scene A”; press `Space` with focus on the page body; click “Take”; Space with focus on a button; Take with preview == program.
- Expect: Take swaps (program “Scene C”, preview “Scene A”), transition per settings, toast ““Scene C” is live”; Space on a focused button/link activates that control instead of Take; Take is `disabled` when preview == program and while a transition runs; forcing the API call returns 409 `conflict`; second Take swaps back after the fade.

**E2E-SWITCH-07** · P1 · pw — Number keys
- Steps: with 12 scenes press `1`, `5`, `9`, `0`, `a`; Ctrl+3, Alt+3, Meta+3; focus in the scene-name input and press `2`; Studio Mode on and off.
- Expect: Studio off: key n switches scene n directly; on: key n sets the preview; keys beyond the scene count, `0`, letters, modified keys, and keys typed into input/select/textarea do nothing; scenes 10–12 have no key.

**E2E-SWITCH-08** · P0 · pw — Output follows the program (latency)
- Steps: 30 cuts alternating A/B with a 1.5 s pause; page-side `MutationObserver` on the output stage `data-scene-id` records `Date.now()`; Regie records the click time with `Date.now()` at `pointerdown`.
- Expect: p50 ≤ 150 ms, p95 ≤ 300 ms (`T-SWITCH`); samples attached as `switch-latency.json`.

**E2E-SWITCH-09** · P0 · pw — No black frame when switching (preload)
- Pre: scene A = K1 full screen, scene B = K2 full screen, both cameras live (timecode or fake pattern, mean luminance ≥ 40), output open at 1920×1080.
- Steps: `startScreencast`; 50 alternating cuts every 700 ms and 20 fades of 300 ms, the target of every cut being the preview scene (Studio Mode: the next Take; decision #12 keeps only the preview scene ready, so that is the case this test measures); analyse frames. A second run of cuts to a scene that is **neither in the program nor in the preview** (6 cuts 8 s apart, so its sources are paused again): the cold case.
- Expect: preview scene: in every frame after a switch the item rectangle has mean luminance ≥ 20 (no black or empty frame); at switch time the target `<video>` already has `readyState ≥ 2` and `videoWidth > 0` (preloaded); the first picture is on screen ≤ 150 ms after the new layer and never below the LOW layer; `T-SWITCH` unaffected. Cold scene: the layer is in the DOM within `T-SWITCH` and the picture follows with the next keyframe, ≤ 1.5 s after the layer (`T-SWITCH-COLD`, about 0.5 s expected). The LOW layer is 320 px wide when the sender has CPU to spare; a sender that adapts to its CPU (`qualityLimitationReason = cpu`) sends smaller layers (240 px = 3/4 × 320), and the floor of that cut is the lowest layer the sender sends (read with `getStats` before the cut; the annotation `sender-cpu-limited` counts those cuts). The times (picture ≤ 150 ms, layer p95 ≤ 300 ms, cold ≤ 1.5 s) are enforced when the machine was at 60 % CPU or less; on a busier one a failure ends in a skip `not-comparable` (6.8).

**E2E-SWITCH-10** · P1 · pw — Preview scene sources are preloaded at high quality, other scenes are paused
- Steps: output with `debug=1`; Studio Mode on; select a preview scene whose camera is not in the program; read the frames decoded and the width of the camera's inbound stream on the output's peer connection.
- Expect: before the selection the camera (only in another scene) is paused: no frames are decoded and no bytes arrive (decision #12); after the selection it is delivered at the highest simulcast layer (≥ 1280 px wide for a 1080p publisher) within 3 s; a program switch to the scene of a paused camera decodes its first frame within 3 s.

**E2E-SWITCH-11** · P0 · pw — Tally on devices
- Pre: phone K1 in program scene A; phone K2 in preview scene B (Studio Mode on); laptop with S1 in A and a camera slot in B; phone K3 in no scene.
- Steps: read `tally` of each sender; take; hide K1's item; switch; “End broadcast”; “Start broadcast”; open K1 in dark mode.
- Expect: K1 `program` (red, text “LIVE”), K2 `preview` (green, “Up next”), K3 `off` (neutral); laptop overall `program`; take flips K1/K2 within `T-TALLY`; hidden item → `off`; standby and ended → `off` for all even when in the program scene; after start red again; dark mode: black screen with thin tally frame in the tally colour; `data-tally` attribute and computed colours agree.

**E2E-SWITCH-12** · P0 · pw — Broadcast lifecycle and slates
- Steps: header shows “READY” (production standby), output slate; click “Start broadcast”; wait 5 s; “End broadcast” (confirm) ; “Start broadcast” again; reset (header production menu action “Back to Ready” [GAP-27]).
- Expect: before start the output shows the standby slate “Starting soon” with subtitle = production name, program scene not visible; after start header “LIVE” + runtime `00:00:0x` increasing each second (from `LiveSince`, server-corrected), slate fades out (300 ms) to the program; end requires confirmation, header “ENDED”, output end slate “Thanks for watching”; start again restarts the runtime at `00:00:00`; reset → “READY” and standby slate; operator B sees every state within 1 s; tally follows (E2E-SWITCH-11).

**E2E-SWITCH-13** · P2 · pw — Switching in standby
- Steps: standby; switch program to “Scene B”; start.
- Expect: output keeps the standby slate (no flash of scene B); after start it shows “Scene B”.

**E2E-SWITCH-14** · P1 · pw — Two operators and Studio Mode presence [GAP-18]
- Steps: A Studio Mode on with preview P; B (Studio Mode off) switches program; B toggles Studio Mode on then off while A is connected; B leaves; A toggles off alone.
- Expect: B's direct switch does not change A's preview; toggling off in B does not clear the preview while A is connected (`PUT preview` not sent, presence 2); when A toggles off as the only operator the preview is cleared (`previewSceneId: null`); A's Program monitor updates ≤ 500 ms after B's switch.

**E2E-SWITCH-15** · P1 · pw — Fade synchronisation Regie vs output
- Steps: fade 1 s with Regie Program monitor and output open; record animation start times via WAAPI hook.
- Expect: both animate 1000 ± 50 ms, starts within 100 ms of each other (`T-FADE`). The length is judged with `expectFadeTiming()` / `fadeDeviationMs()` (frame stalls excluded); the two start times are taken on one clock: each page's `performance.now()` hook stamp plus that page's `performance.timeOrigin` (absolute epoch ms), not two `Date.now()` readings. Threshold unchanged (100 ms).

**E2E-SWITCH-16** · P1 · pw — Reduced motion in the Regie [GAP-28]
- Steps: Regie context with `reducedMotion: 'reduce'`; switch with a 1 s fade; open the output in a separate default context.
- Expect: Regie monitors and thumbnails cut immediately (no opacity animation) while the stepper keeps its value; the request still sends the fade; the output page ignores the OS setting and plays the full fade; CSS transition/animation durations in the Regie are 0 s.

**E2E-SWITCH-17** · P1 · pw — Rapid clicking
- Steps: 20 clicks on alternating scenes in 1 s with a 300 ms fade; both operators clicking.
- Expect: no error toasts (the notice “A fade is still running” for a click that the other operator's fade refused with 409 is allowed), no exception; successful switches ≤ 4; the final program is the scene of the last accepted click and identical in Regie A, B and the output; no stuck half-fade; Take/stepper re-enable.

**E2E-SWITCH-18** · P2 · pw — Empty, broken and missing scenes on air
- Steps: switch to a scene with no items; to a scene containing a blocked source and a deleted source.
- Expect: empty → output shows the scene background colour only; broken → placeholders, no exception, switch still works and the toast appears.

**E2E-SWITCH-19** · P2 · pw — Slates editable from the Regie [GAP-37]
- Steps: production menu → slates: change standby title/subtitle, pick an uploaded image as background; end slate likewise.
- Expect: output standby slate shows the new texts and the image (cover); the asset cannot be deleted while used; changes propagate without reload.

**E2E-SWITCH-20** · P2 · pw — Keyboard focus rules around Take
- Steps: Tab to “Take”, press Enter; click on the monitor then Space.
- Expect: Enter on the focused button takes once (no double take from Space handler); `aria-keyshortcuts="Space"` present; hint “Space” visible.

**E2E-SWITCH-21** · P1 · pw — A second click, key or Take during the request of a switch sends nothing (issue 55)
- Steps: Cut; the POST of the switch is held back by the test for 1.5 s (route), so request, response and hub event all come late. Studio Mode off: click “Scene B” twice, click “Scene C”, press key `3`. Then (guard released) click “Scene C”. Studio Mode on: click Take, click the disabled Take again (`force`), press Space, with the POST of Take held back the same way. Requests are counted with `page.on('request')`.
- Expect: exactly one `/program` request for the first group (the double click, the other scene and the key send nothing) and the program becomes “Scene B”; after the event the next switch goes out (two in total); Take is `disabled` while its request is in flight and exactly one `/take` request is sent; Take is enabled again after the event; no error toast, no page error. Unit tests (`switcher.service.spec.ts`): request → event releases, request → error releases and shows the notice, the safety timeout (`IN_FLIGHT_TIMEOUT_MS`, 5 s) releases a lost event, a double Take sends one request.

### 2.5 SRC – Sources, stations and incidents

Strings (exact): state words “reconnecting”, “sharing stopped” (screen) / “camera stopped” (camera), “blocked”, “connecting…”, “no picture”, “not connected”; recovered “back” + “was gone for N s”; places “on Program” / “in Preview” / “not live”;
button “Seen”; “Ask to share again”; strip with no incident “No open messages” + “Recent events”; health chip “All N stations ok” (“1 station ok” for a single station) / “1 incident” / “N incidents”; station recovered box “The station is back. Confirm to dismiss the message.”;
block box “K1 will be disconnected immediately and cannot connect again until you unblock it.” with “Block now” / “Cancel”, “Block device”, “Unblock”; toasts “K1 blocked and disconnected”, “K1 unblocked”, “Request sent to {Name}: “Share screen again””;
log “K2 reconnecting”, “K2 is back, was gone for 9 s”, “S1 sharing stopped”, “K1 camera stopped”, “K1 no picture”, “K1 Phone 1 blocked”, “K1 Phone 1 unblocked”, “K1 Phone 1 removed” (codes and device name, BUG-10; the prototype's “S1 asked to share again” and “K2 acknowledged” do not exist); sender “Share again”, “The control room asks you to share the screen again”, “Blocked”, “Opened in another tab”, “Continue here”, “Connected”, “Reconnecting…”, “Share screen”, “+ Another screen”, “Stop sharing”, “Remove”.

**UNIT-SRC-01** · P0 · xunit — Source status state machine, all transitions [GAP-08]
- Steps: drive the `SourceStatusTracker` with events (`DeviceConnected/Disconnected`, `TrackPublished/Unpublished`, `ParticipantLeft`, `Report(slot states, rtc)`, `Block/Unblock`, `SlotRemoved`) through this table:
  `offline→connecting` (device online, no track); `connecting→ok` (track published); `ok→reconnecting` (hub disconnected; participant left unintentionally; track unpublished while report says `rtc: reconnecting`; a report `rtc: reconnecting|disconnected` alone while the hub is up, because a frozen LiveKit sends no webhook; slot reported `paused`; slot missing from the report while no track is published); `ok→ended` (report `ended`); `ok→lost` (report `failed`); `reconnecting→ok`; `ended→ok`; `lost→ok`; `reconnecting→ended`; `reconnecting→lost`; `ended` + hub disconnect; `lost` + hub disconnect; any → `blocked`; `blocked→offline` on unblock; media always `ok`.
- Expect: statuses as listed; `StatusSince` changes only on a status change; the pinned rules (they equal `SourceStatusRules` and `SourceHealth` in the working tree): a reported `ended`/`lost` wins over the connection state (sticky across hub disconnects of the same session, not across a new session); slot state `paused` (the operating system suspended the capture, e.g. the phone app in the background) is not live and expected back: `reconnecting` if the slot was live, `connecting` if it never was – never `ended`; only a deliberate stop is `ended` (“Stop sharing”, the browser's stop button, the camera stopped by the user) [DOC-06, spec 4.5]; every report replaces all earlier slot states (a slot missing from it has no state) and a new `Hello` session starts without slot and rtc states; `reconnecting→ended|lost` keeps the open incident (same id, original `StartedAt`) and only changes its kind (`incidentUpserted`, no removal); slot state `starting` has no rule of its own (a slot that was live and has no track is `reconnecting`); the device hub connection is the fast signal: `ok` needs a connected hub and a live slot; media loss that only the device report shows (`rtc: reconnecting|disconnected` while the track is still `Published` and the hub is up) must also yield `reconnecting` within `T-DETECT-SILENT` [GAP-08]; unblock goes to `offline` until the device reconnects, never opens an incident.

**UNIT-SRC-02** · P0 · xunit — Incident lifecycle
- Steps: ok→reconnecting→ok; ok→ended→ok; reconnecting→ended→ok; ack while open; ack after recovery; ack twice; block with open incident; slot removal with open incident; new outage on the same source while a recovered incident is un-acked.
- Expect: an outage from `ok` opens an incident (replacing an earlier incident of the same source: `incidentRemoved(old)` then `incidentUpserted(new)`); an escalation `reconnecting → ended|lost` updates the open incident in place; recovery sets `EndedAt` and keeps it; `ack` of a recovered incident → removed (204), `ack` of an open incident → 409 `conflict`, second ack → 404; block/slot removal remove incidents; log texts “K2 reconnecting”, “K2 is back, was gone for 9 s” (rounded seconds, minimum 1), “S1 sharing stopped”, “K1 camera stopped” (camera stopped on purpose; a paused camera is “K1 reconnecting”, and when it is then stopped the open incident keeps its id and start and only changes its kind), “K1 no picture”; an acknowledgement writes no log entry.

**UNIT-SRC-03** · P1 · xunit — Startup seed and API restart [GAP-08]
- Steps: start the tracker with empty in-memory health and `ListParticipants` returning two participants with published `camera` tracks; device hubs reconnect after 3 s and after 20 s; a third device that never returns.
- Expect: until its hub is back a seeded source is `offline` (the "was live" history is not carried over a restart), then `ok`; no incident is created for the restart itself – neither by the graceful shutdown before it (hub connections that end because the host stops are no outage: nothing is evaluated or written, BUG-20) nor after the start – so `incidentUpserted`/log entries “reconnecting” do not appear; the device that never returns: if its source was live within 12 h (`lastLiveAt`) and is used in the program or preview scene it becomes `reconnecting` with an incident (“K1 reconnecting”) once `Sources:RestartGrace` (15 s) after the start has passed (spec 12, GAP-08 b), otherwise it stays `offline` (grey, no incident).

**UNIT-SRC-04** · P1 · xunit — Telemetry aggregation [GAP-29]
- Steps: reports with battery −5, 0, 100, 101, null; loss 0–100, −1, 150; bitrate negative; unknown slot names; 200 slots; stale (> 6 s) device.
- Expect: out-of-range values become `null` (not stored); unknown slots ignored; at most 10 slots stored; a device without a report for 6 s has `Rtc = Disconnected` and no telemetry pushed.

**UNIT-SRC-05** · P1 · xunit — Command validation [GAP-30]
- Steps: `Reshare` with screen/camera/unknown slot; `SwitchCamera`; `Message` with 0/1/140/141 chars, whitespace, control chars, XSS; missing fields.
- Expect: `Reshare` needs an existing screen slot of that device; `SwitchCamera` ignores `slot`; `Message` text trimmed 1–140 chars else `validation_failed`; command ids `cmd_…`.

**UNIT-SRC-06** · P0 · vitest — Publisher (`packages/media-client`)
- Steps: fake `Room`/`LocalParticipant`: `publishCamera` (facing, 720/1080), `publishScreen` without and with a user gesture, `switchCamera`, `unpublish`, `stopAll`; camera track `ended` → re-acquire (fake timers); screen `ended`; rejoin; `getSlotTelemetry`.
- Expect: camera `ended` → `restartTrack` attempts after 0.3 / 0.6 / 1.2 s, `failed` after the third failure, `live` again on success (slot states `starting → live → failed|live`); screen `ended` → `ended`, never restarts and never calls `getDisplayMedia` by itself; `publishScreen` outside a user gesture rejects; after a rejoin all `live` slots are republished; settings: camera H.264 with simulcast layers 1080p/540p/270p (or 720p/360p/180p) and `contentHint 'motion'`, screen VP9 with H.264 backup, simulcast off, `contentHint 'detail'`, max 1440p at 15–30 fps, dynacast on, no audio track ever; `onSlotState` fires once per change.

**UNIT-SRC-07** · P1 · vitest — Technical check logic
- Steps: `runTechCheck` with fake camera settings, fake `fetch` for 5 pings and the 1 MB upload; bandwidth 6.00 / 5.99 / 3.00 / 2.99 Mbit/s; RTT outliers; low resolution/fps; upload timeout; camera permission denied.
- Expect: bandwidth ≥ 6 Mbit/s `ok`, ≥ 3 `warn`, else `bad`; RTT is the median of 5 pings; camera level from achieved size/fps; `Overall` = worst of the three; failures yield `bad` with a `Note`; result carries `At`, `UploadKbps`, `RttMs`.

**UNIT-SRC-08** · P0 · ng — Regie outage presentation (store to the six places)
- Steps: store with sources in `ok/connecting/reconnecting/ended/lost/blocked`, incidents open and recovered, scenes with those sources in program, preview, hidden.
- Expect: header chip “All N stations ok” (N = non-blocked stations; “1 station ok” for one) / “1 incident” / “N incidents”, lamp amber when only reconnecting, red when any red incident is open; strip entries sorted open first, red before amber, then by start, each with code, name, state word, place (“on Program” / “in Preview” / “not live”), timer, and only the right actions (“Ask to share again” for `ended`, “Seen” for recovered); station line text per status; scene row health = worst down source; monitor tab texts “K1 · Freeze frame mm:ss”, “S1 · sharing stopped” (small: “ended”), “blocked”; recovered incidents never count as faults.

**UNIT-SRC-09** · P0 · ng — Sender station state machine
- Steps: fake hub and media client: connect, hub drop, blocked (403), `sessionReplaced`, `self`, `tally`, `command` (`reshare`, `message`, `switchCamera`), wake lock lifecycle, report timer.
- Expect: connection states `connected / reconnecting / blocked / replaced`; blocked retries every 15 s (fake timers) and shows “Blocked”; replaced never reconnects until “Continue here” is pressed; tally maps to `data-tally` and the texts “LIVE” / “Up next”; `reshare` shows the banner “The control room asks you to share the screen again” and “Share again” which calls `publishScreen` only from the click handler; message text is rendered escaped; reports every 2 s with slot states; wake lock re-acquired on `visibilitychange`.

**INT-SRC-01** · P0 · xunit — Webhook flow to incidents
- Steps: studio hub subscribed; the device hub connects (`Hello`) and stays connected; signed webhooks: `participant_joined(dev_x)`, `track_published(camera)`, `participant_left(dev_x)`, `participant_joined`, `track_published`; then ack.
- Expect: events in order: `deviceUpserted(online)`, `sourceUpserted(connecting)`, `sourceUpserted(ok)`, `sourceUpserted(reconnecting)`, `incidentUpserted(reconnecting)`, `logAppended` (“K1 reconnecting”), `sourceUpserted(ok)`, `incidentUpserted(endedAt set)`, `logAppended` (“K1 is back, was gone for N s”), `incidentRemoved` after `POST …/incidents/{id}/ack` (204); revisions consecutive.

**INT-SRC-02** · P1 · xunit — Webhook robustness [GAP-22]
- Steps: duplicate event; `track_unpublished` before `track_published`; unknown identity; `studio_`/`output_` identities; malformed JSON; unknown event name; event for another room; huge payload.
- Expect: duplicates and out-of-order events converge to the same state (state-based, idempotent); unknown identities/events/rooms → 200 and ignored; malformed JSON → 400; > 1 MB → 413; never 500.

**INT-SRC-03** · P0 · xunit — Device report path
- Steps: `POST /api/device/report` and hub `Report` with slots `live`, `ended`, `failed`, `starting`, `paused`, rtc `connected|reconnecting|disconnected`; invalid values; flood of 100 reports/s.
- Expect: statuses per UNIT-SRC-01; telemetry relayed to the studio hub as `telemetry` (not revisioned) at most every 2 s per device (the first report at once, reports in between are held back and the newest one follows when the 2 s have passed – latest value wins, `Sources:TelemetryInterval`; state changes such as `rtc` or slot states arrive as revisioned events at once, BUG-19); a report that arrives while the database is down still counts as a sign of life of the session (no stale-report outage afterwards); invalid enum or oversize → 400; the flood is bounded (coalesced or 429), the process stays healthy.

**INT-SRC-04** · P0 · xunit — Session replacement
- Steps: device hub connection 1 (`Hello` sessionId S1); connection 2 (`Hello` S2); then connection 1 re-connects and sends `Hello` S1; connection 3 with S2 again (same tab reconnect).
- Expect: S2's `Hello` sends `sessionReplaced` to connection 1 and aborts it; a late `Hello` with the replaced S1 is answered with `sessionReplaced` and aborted, **S2 stays connected** (no ping-pong) [GAP-21]; a new connection with the *same* sessionId S2 replaces the old connection silently (no `sessionReplaced`).

**INT-SRC-05** · P1 · xunit — Commands over the hub
- Steps: `POST …/devices/{id}/commands` for each kind with the device hub connected, disconnected, blocked.
- Expect: 202 `DeviceCommandDto` (`cmd_…`, `at`) in all cases; connected → `command` message received once; disconnected/blocked → dropped (not delivered later); unknown device 404; invalid payload 400; audit not required.

**INT-SRC-06** · P2 · xunit — Telemetry endpoint and tech check
- Steps: report with `TechCheck`; `GET …/telemetry`; `POST /api/device/bandwidth-test` with 1 MB, 4 MB, 4 MB + 1.
- Expect: `deviceUpserted` carries the `TechCheck`; telemetry list contains last values per device; bandwidth result `Bytes` = body length, `ServerMs` > 0; > 4 MB → 413.

**INT-SRC-07** · P1 · xunit — Output stream hides health [GAP-07]
- Steps: change source status (offline→ok→reconnecting) with an output hub subscribed.
- Expect: the output receives `revisionOnly` for health-only changes (never a `sourceUpserted` with `status` ≠ `ok`); never `incident*`, `device*`, `logAppended` content; output snapshot sources carry `status: ok` and `statusSince: null`.

**E2E-SRC-01** · P0 · pw (`pixel7`) — Phone camera live shows as ok everywhere
- Steps: pair a phone, start the camera, put K1 into scene A (program), open Stations row K1.
- Expect: lamp green; row line `<n.n> Mbit/s` and `<n> ms`; detail list “Device” (e.g. “Pixel 7 · Chrome”), “Resolution” (e.g. `1080p`), “Paired” “today HH:MM”, “Packet loss” `0.0%` (+ a “Battery” row on Chromium, where the Battery API exists); header chip “1 station ok” (regex `^(1 station|All \d+ stations) ok$`); values change within 3 s (telemetry every 2 s); Program monitor video playing.

**E2E-SRC-02** · P0 · pw — Device loses network: outage in all six places
- Pre: K1 (phone, in the program scene and the preview scene), K2 (phone, in another scene), S1 (laptop screen) live; output open; hold 3 s.
- Steps: `phone1.goOffline()` (`net.cut`: hub and media of that phone die; the sockets close with a close handshake before the browser goes offline, `cut.clean` is asserted); sample the six places until all show the outage. `T-DETECT-CLEAN` runs from the moment the phone page closed its connections (`cut.at`) to the DOM read of the Regie that showed all six places, both stamps taken inside the browsers: the round trips of the harness are not part of the product's time.
- Expect: within `T-DETECT-CLEAN`: header chip “1 incident” with amber lamp; strip segment `K1 <name> reconnecting on Program <mm:ss>` (timer counting); Program (and Preview) monitor: element K1 with dashed amber outline and tab “K1 · Freeze frame 00:0x”; Scenes: the scene row shows an amber lamp and “K1 disrupted”; Sources row: amber lamp, “reconnecting”, timer; Stations row: amber wash, “reconnecting 00:0x freeze frame”; log “K1 reconnecting”; the output keeps K1's last frame (`E2E-OUT-06`); other stations unaffected. Test passes `regie.expectOutage('K1','reconnecting')`.

**E2E-SRC-03** · P0 · pw — Recovery stays until “Seen”
- Steps: continue after -02: `goOnline()` after 9 s; do nothing for 30 s; then “Seen”.
- Expect: within `T-RECOVER-SHORT` K1 is `ok`; strip shows a green entry `K1 <name> back was gone for 9 s` (±1 s) with button “Seen”; the Stations row shows “back · was gone 9 s” and the box “The station is back. Confirm to dismiss the message.”; the entry is still there after 30 s; header shows “All … stations ok” (recovered entries are not faults); after “Seen” the strip shows “No open messages” + “Recent events” (≤ 4 entries with `HH:mm`, newest first: “K1 is back, was gone for 9 s”, “K1 reconnecting”, …); an acknowledgement adds no log entry [GAP-08].

**E2E-SRC-04** · P0 · pw — “Seen” is shared between operators
- Steps: after a recovery both operators see the entry; A clicks “Seen” while B clicks within 100 ms.
- Expect: entry gone in both within 1 s; the second request returns 404 and produces no error toast.

**E2E-SRC-05** · P1 · pw — Incident timers use server time
- Steps: shift the Regie page clock by +5 min (`page.clock.install({ time: Date.now() + 300_000 })`, the clock keeps running) before an outage of 20 s.
- Expect: timer in strip, Sources and Stations shows 00:20 ± 2 s (derived from `StatusSince`/`ServerTime`, not from the client clock); format `mm:ss`, passing 00:59 → 01:00 correctly.

**E2E-SRC-06** · P0 · pw — Screen share ended by the user
- Pre: laptop S1 sharing the timecode tab, S1 in the program scene, output open.
- Steps: `laptop.endShare(1)` (closes the captured tab → `ended`).
- Expect: red state in all six places within `T-DETECT-CLEAN`: strip `S1 <name> sharing stopped on Program 00:0x` with button “Ask to share again”; header “1 incident” red lamp; monitor tab “S1 · sharing stopped” (small items “S1 · ended”) red dashed outline; scene row “S1 disrupted”; Sources “sharing stopped 00:0x”; Stations “sharing stopped 00:0x”; laptop sender shows the large button “Share again”; the sender did **not** call `getDisplayMedia` again (init-script counter stays 1); output holds the last frame.

**E2E-SRC-07** · P0 · pw — Reshare returns to the same place
- Steps: after -06 click “Ask to share again”; on the laptop click “Share again”.
- Expect: toast “Request sent to Laptop Lea · Screen 1: “Share screen again”” (no log entry, [GAP-08]); laptop shows “The control room asks you to share the screen again” with a prominent “Share again”; after the click the same slot `screen-1` publishes: S1 `ok`, incident “back”, the scene item is the same item (id, rectangle, z-order unchanged), no new station or source appears (counts unchanged, code S1), the output video resumes; the browser was asked exactly once more (user gesture).

**E2E-SRC-08** · P1 · pw — Ending the share on the sender (“Stop sharing”)
- Steps: laptop clicks “Stop sharing” for screen 1; then “Share screen” again.
- Expect: treated as `ended` (incident “sharing stopped”, red); sharing again returns the slot to `ok` and “back”.

**E2E-SRC-09** · P0 · pw (`pixel7`) — Camera failure becomes “no picture”
- Steps: init-script flag makes `getUserMedia` reject; stop the camera track (simulating another app grabbing the camera); wait for the 3 re-acquire attempts (backoff 0.3 / 0.6 / 1.2 s); clear the flag and restart the camera from the sender.
- Expect: after ≈ 3 s the slot is `failed` → red incident kind `lost`: strip “K1 … no picture”, station “no picture”, monitor tab “K1 · no picture”, `slot-camera[data-state=failed]` on the sender; after restart K1 `ok` and “back”; with `getUserMedia` working the re-acquire succeeds within 1.5 s: the output freezes then resumes, no `failed` (a short “reconnecting” incident that ends in “back” is acceptable).

**E2E-SRC-10** · P0 · pw — Block and unblock
- Pre: K1 live in a scene, listed in “+ Source” menus.
- Steps: Stations row K1 → expand → “Block device” → box → “Block now”; wait 45 s; “Unblock”.
- Expect: toast “K1 blocked and disconnected”, log “K1 Phone 1 blocked”; row red “blocked · cannot connect”; incidents of K1 removed; monitor element tab “K1 · blocked” red dashed; K1 no longer offered in “+ Source”; sender shows “Blocked” and stops the camera within `T-BLOCK`; LiveKit has no participant `dev_…`; during the 45 s the sender polls at most 4 times (15 s cadence: count of `GET /api/device/me` or negotiate requests ≤ 4); “Cancel” in the box does nothing; “Unblock” → toast “K1 unblocked”, log “K1 Phone 1 unblocked”; the sender reconnects within 20 s, publishes again, K1 `ok`, no incident remains.

**E2E-SRC-11** · P0 · pw — Duplicate tab, no ping-pong
- Steps: sender tab 1 live; open the sender in tab 2 of the same context; wait 30 s; click “Continue here” in tab 1; wait 30 s.
- Expect: tab 1 shows “Opened in another tab” with “Continue here” and releases camera and wake lock; tab 2 becomes live; Regie: one station, at most a brief amber blip, no permanent incident; for 30 s neither tab flips state again (exactly one `sessionReplaced` is delivered per takeover, to the replaced tab only, and the replaced tab sends no further `Hello`; LiveKit joins for the identity ≤ 2 per takeover); after “Continue here” the roles swap and stay swapped for 30 s.

**E2E-SRC-12** · P1 · pw — Telemetry in station details and `/monitoring`
- Steps: three stations live; open `/monitoring`; apply `lk.netem({lossPct:5})` on LiveKit and a battery stub (level 0.15) on one phone.
- Expect: table rows for every station with bitrate (Mbit/s), fps, resolution, encoding (codec, issue #12), packet loss (%), RTT (ms), battery (%), network type, tech check level; values update within 3 s; problem stations sorted first (same order as the Stations dock); low battery < 20 % shows “Battery 15%” in the amber state colour on the station line; battery column empty (not 0) where the API is missing (Firefox/WebKit).

**E2E-SRC-13** · P1 · pw — Technical check
- Steps: first start of a sender runs the check; repeat with `net.cdpThrottle` upload 2 Mbit/s and 4 Mbit/s; run again on demand ([GAP-27] button).
- Expect: camera level from achieved resolution/fps, network from RTT median of 5 pings, bandwidth from a 1 MB upload to `/api/device/bandwidth-test`: ≥ 6 Mbit/s `ok`, ≥ 3 `warn`, else `bad`; overall = worst; shown on the sender and in the Regie station detail; stored (`TechCheckDto.At`) and still shown after a Regie reload.

**E2E-SRC-14** · P1 · pw — Several screens and optional camera on a laptop
- Steps: `laptop.addScreen()` ×2 (3 screens), share all, end screen 2 only, “Remove” screen 3, add the laptop camera; try a 10th screen.
- Expect: sources S1…S3 (labels “Laptop Lea · Screen n”) and a K code for the camera (“Laptop Lea · Camera”); only S2 raises an incident; removing screen 3 removes the station and keeps scene items as “Source missing”; the 10th screen is refused by the UI (disabled or `/9|nine/i` notice, “At most 9 screens are possible per device.”) and the API (409 `limit_reached`).
- `[ui, quick clicks]`: two clicks on “+ Another screen” in a row while the answer to the first `POST /api/device/slots` is held back until both clicks are done (no service worker, so that the route sees the request). Expect: the sender sends the second request only after the first was answered (the server hands out the lowest free slot, so overlapping requests would swap the slots), both screens end `live` under `screen-2`/`S2` and `screen-3`/`S3`, no alert “Please click “Share screen” again”, three `getDisplayMedia` calls.

**E2E-SRC-15** · P1 · pw — Station order
- Steps: create states: S1 ended (red), K2 reconnecting (amber), K3 recovered, K4 connecting, K5 in program, K6 in preview, K7 unused.
- Expect: DOM order = red, amber, recovered, connecting, in program, in preview, rest; ties by code; order updates live when states change.

**E2E-SRC-16** · P2 · pw — Accessibility names of stations
- Steps: read the accessible name of the row button for K2 in program while reconnecting.
- Expect: `K2 Phone stage right, on Program, reconnecting` pattern (`<code> <name>[, on Program|in Preview][, <state>]`), `aria-expanded` toggles.

**E2E-SRC-17** · P1 · pw — Regie messages [GAP-30]
- Steps: station detail → send message “Live in 10 s”; 141 characters; to an offline device.
- Expect: the phone shows a prominent banner (`message-banner`) with the text; 141 characters cannot be sent (UI limit and API 400); offline device: 202 and a Regie toast that the device is offline (`/offline|not connected/i`), nothing shown later when the device returns.

**E2E-SRC-18** · P2 · pw (`pixel7`) — Switch camera command
- Steps: “Switch camera” on K1 (only offered for `ok` camera stations).
- Expect: the sender re-acquires with the opposite `facingMode` (init-script records constraints); picture continues after ≤ 3 s; button absent for screens and for non-ok cameras.

**E2E-SRC-19** · P1 · pw (`pixel7`) — Phone behaviour: wake lock, auto-start, settings, dark mode
- Steps: stub `navigator.wakeLock`; start camera; hide/show the page (`visibilitychange`); reload; switch 720p/1080p; toggle dark mode; stop.
- Expect: `wakeLock.request('screen')` called after start and again after becoming visible; reload auto-starts with the last facing/resolution (`studioflow.sender.settings`); published resolution matches (station “Resolution” `720p`/`1080p`); dark mode = black screen with thin tally frame; stop → slot `ended` → Regie `ended` (red incident, log “K1 camera stopped”); the page in the background (the OS suspends the camera) → slot `paused` → `reconnecting` (“K1 reconnecting”), back in the foreground → `ok` and “back” [DOC-06, spec 4.5].

**E2E-SRC-20** · P0 · pw — A returning source keeps its place
- Steps: scene with K1 at a custom rectangle and z-order; K1 offline 10 s and back; reload the phone.
- Expect: same item id, rectangle and z-order; Sources dock has no duplicate row; code K1 unchanged; output video back in the same rectangle.

**E2E-SRC-21** · P1 · pw — Hold frame on the Regie monitors
- Steps: K1 lost.
- Expect: Program and Preview monitor keep K1's last frame (video element frozen but visible, not black) with the dashed outline; after the item's hold time the monitor shows the blurred/dimmed frame with the label only if the item is ≥ 240 CSS px wide (monitor rule).

**E2E-SRC-22** · P2 · pw — Device removal while connected [GAP-35]
- Steps: `DELETE …/devices/{id}` while the phone is live.
- Expect: LiveKit participant removed, the phone shows a terminal state (`/removed|no longer paired/i`, [GAP-27]) and offers pairing again, does not reconnect in a loop (≤ 1 request per 15 s); the Regie station disappears; scene items keep “Source missing”.

Remote camera control (issue #11, decisions “#11” in `docs/decisions.md`; the camera is Chromium's fake device behind `support/devices/camera-stub.ts`, which answers `getCapabilities` / `getSettings` / `applyConstraints` like an Android profile; the real-phone procedure is MAN-14):

**E2E-SRC-23** · P1 · pw (`pixel7`) — Camera control hidden where unsupported
- Steps: a phone whose camera reports no capability and one lens; station detail → “Camera”.
- Expect: the panel says that the controls are not available on this device; no slider, no lens picker, no reset button.

**E2E-SRC-24** · P0 · pw (`pixel7`) — Zoom and brightness round trip, clamping, refusal
- Steps: a phone with zoom 1…8, brightness −2…+2 EV; drag the zoom slider to 3, the brightness slider to +1; `POST …/commands` with zoom 20; with an unknown lens, version 2 and an empty command.
- Expect: the camera really has zoom 3 and +1 EV, the sender shows the short note, the panel shows `3,0×` and `+1,0 EV` (the values the camera reports back); zoom 20 is accepted (202) with 8 in the answer and the camera has 8; the three invalid commands are 400.

**E2E-SRC-25** · P0 · pw (`pixel7`) — Lens switch of a live source
- Steps: put K1 into the program scene; pick the wide-angle lens; cancel; pick it again and confirm.
- Expect: a dashed red confirmation appears and nothing changes before it is confirmed; after the confirmation the camera is the other lens (one more capture, no republish: the slot is `live` again) and the panel marks it; zoom starts again at 1×.

**E2E-SRC-26** · P1 · pw (`pixel7`) — Refused change and reset
- Steps: the camera refuses `torch` (`OverconstrainedError`); switch the light on; then zoom 4, lock the focus, light on, “Reset to auto”.
- Expect: an inline message in the panel, the light stays off in the panel and on the camera, the sender stays connected; the next working change clears the message; the reset gives zoom 1, automatic focus, 0 EV, light off.

**E2E-SRC-27** · P1 · pw (`pixel7`) — Settings survive a reload
- Steps: wide-angle lens, zoom 2,5, brightness −1; reload the phone.
- Expect: after the reload the camera has the same lens, zoom and brightness again and the panel shows them.

### 2.6 OUT – Output page

Strings: “Starting soon”, “Thanks for watching”, “No access”, “Picture returns shortly”. The page has no other text and no controls; the language is the browser language or `?lang=` (E2E-I18N-07…10), the standby and end slates are texts of the production and do not change with it. Preloading without black frames is tested by `E2E-SWITCH-09`; IP restriction and key rotation by `E2E-AUTH-23` and `E2E-AUTH-24`; assets via the key by `E2E-OUT-19`. Header chip “Output” (lamp + mono latency, and the names of the connected links, e.g. “Proxy + Teams camera”), popover “State” “connected, 1 consumer”, “Consumers” (IP), “Format” “1920 × 1080 · 16:9 · 30 fps”, “Latency” “<n> ms measured”, then the list of the output links (“Proxy · connected”) with the selected link below (issue #9, area `LINK`). As an OBS browser source the page needs no click: `E2E-OUT-02` (autoplay without a gesture, in an iframe too), `E2E-OUT-06` (hold frame) and `E2E-OUT-04` (`bg=transparent`) are the checks; `E2E-LINK-03` opens the URL of the downloaded OBS scene collection (also with `bg=transparent`), and `MAN-15` repeats it in OBS itself.

**UNIT-OUT-01** · P0 · vitest — Stage scaling and letterboxing math
- Steps: container sizes 1920×1080, 1280×720, 800×600, 1680×720, 160×90, 3840×2160, 600×1000, 10×10, 0×0, fractional (1279.5×719.5).
- Expect: scale = min(w/canvas width, h/canvas height) (1920×1080 unless the production has another format, then also 1080×1920, 1080×1080, 1440×1080 and the 720p sizes: UNIT-FMT-02); stage of the canvas size centred by CSS transform; resulting box has the aspect ratio of the canvas ±0.5 px; no negative or NaN values for degenerate sizes; re-fit on `ResizeObserver`.

**UNIT-OUT-02** · P1 · vitest — Background modes
- Steps: render with default, `background: 'transparent'`; scene colour `#102030`; item contain bars; missing source; slate.
- Expect: default page/stage background black; transparent: page, stage and scene colour `rgba(0,0,0,0)` [GAP-24]; contain bars stay `#0a0d12`, missing source `#121821`.

**UNIT-OUT-03** · P0 · vitest — Hold frame timing (fake timers)
- Steps: item with `onLost.holdMs` = 3000 / 10000 / null / 0, width 1360 / 320 / 319 px; source lost at t0; advance to t0+2999, +3000; source returns at +2000 and at +5000; lost again; two items with different hold times.
- Expect: `data-state`: `live → hold` at loss (last frame kept, `video` element and `srcObject`/last frame retained) → `held` at exactly `holdMs` (null: never; 0: immediately); held style: blur ≈ 2.5 % of the item width (±1 px), overlay `rgba(13,17,23,.72)`, centred text “Picture returns shortly” only when the item is ≥ 320 px wide (319 px: no text); return in `hold` or `held` clears everything and resets the timer; independent timers per item; timers cleared on `destroy()`.

**UNIT-OUT-04** · P1 · vitest — Fallback source
- Steps: `fallbackSource` = image asset / live camera / unknown / own source; source lost beyond `holdMs`; source returns.
- Expect: after `holdMs` the fallback is rendered in the item rectangle instead of the blurred frame (`data-state=fallback`); unknown or unavailable fallback → regular held style; return restores the live source and removes the fallback.

**UNIT-OUT-05** · P0 · vitest — Transitions
- Steps: `transitionTo(scene, {fade, 300})` with mocked `Element.prototype.animate`; second `transitionTo` during the fade; `transitionTo(null)`; `{cut}`; `reducedMotion: true`; `show()` during a fade.
- Expect: one opacity animation of 300 ms on the new layer over the old one, promise resolves after `finish`; the old layer is removed afterwards; a new transition finishes the running one instantly first; cut changes without animation; `reducedMotion` turns fades into cuts; `show()` is immediate; never leaves two layers after resolution.

**UNIT-OUT-06** · P1 · vitest — Slate
- Steps: `showSlate(slate, assetUrl)` / `showSlate(null)` while a scene is shown and during a fade.
- Expect: slate layer above everything, 300 ms fade in/out, title and subtitle as text nodes (no HTML), background image cover-fitted; independent of scene transitions.

**UNIT-OUT-07** · P1 · vitest — Preload and desired sizes
- Steps: `setPreloadScenes([…])`; items of different on-screen sizes at devicePixelRatio 1 and 2; resize.
- Expect: provider receives quality LOW for sources only in preload scenes; `setDesiredSize(sourceId, w, h)` = on-screen size × dpr rounded to 16 px, one call per change (not per frame); sources appearing in several renderers use the maximum.

**UNIT-OUT-08** · P2 · vitest — Renderer lifecycle
- Steps: create/destroy 100 renderers with items; spy `addEventListener`/`removeEventListener`, `ResizeObserver.observe/disconnect`, timers.
- Expect: every listener, observer and timer is released by `destroy()`; no DOM left; `stats()` counts items/videos correctly.

**UNIT-OUT-09** · P0 · vitest — Output boot and 403 handling (`apps/output`)
- Steps: URL parsing (`/o/webinar?k=abc`, missing `k`, `bg=transparent`, `debug=1`, junk params, encoded slug); fake API returns 403 on snapshot/token/hub; advance fake timers 29 s, 30 s, 90 s.
- Expect: missing key → slate “No access” without any network request; 403 → slate “No access” (`data-slate=denied`), no retry before 30 s, then at most one attempt per 30 s; unknown params ignored; slug/key never written into the DOM or console.

**UNIT-OUT-10** · P0 · vitest — Output state handling
- Steps: snapshot then events: `programSwitched` (cut, fade), `sceneUpserted` for the shown scene, `productionChanged` (standby→live→ended→standby), `revisionOnly`, gap, hub loss, LiveKit loss.
- Expect: renders standby slate / program / end slate per `broadcast`; program switch plays the event's transition; scene updates diff in place; `revisionOnly` advances the revision without DOM change; on API/hub/LiveKit loss the last picture stays (no `show(null)`, no slate); reports every 2 s with `rendering`, `fps`, `latencyMs`, `programSceneId`; on boot with `broadcast: live` the standby slate is never shown.

**UNIT-OUT-11** · P1 · vitest — Bundle budget check (script)
- Steps: `vite build` of the output and gzip the `dist` assets.
- Expect: total initial JS+CSS+HTML ≤ 350 KB gzip including `livekit-client` (spec 9.3); no external URL strings in the bundle (`https?://` only for `www.w3.org` XML namespaces).

**UNIT-OUT-12** · P0 · vitest — `LiveKitSourceProvider`
- Steps: fake `Room` with remote participants and publications: attach `{identity}/{trackName}`; track unpublished then republished; qualities from scenes (program items → dimensions, preview → HIGH, other scenes' sources → LOW); `setDesiredSize` from several renderers; roles monitor/output; stats and latency estimate; `destroy()`.
- Expect: the video element of a source persists across track loss and reattaches the new track (no new element); `setVideoDimensions`/`setVideoQuality` called only on change with maxima rounded to 16 px; `adaptiveStream` and jitter/playout hints per role; `estimateLatencyMs` = mean over sources of (RTT/2 + jitter-buffer delay), `undefined` without data; no calls after `destroy()`.

**E2E-OUT-01** · P0 · pw — Output basics
- Steps: open `/o/{slug}?k={key}` in a 1920×1080 viewport (standby).
- Expect: slate title “Starting soon”, subtitle = production name; DOM contains no `button, a, input, select, textarea`, no text other than the slate; `<html lang="en">` (browser language `en-US`); first slate paint ≤ 1.0 s (`T-LOAD`); no console errors; page makes requests only to the stack origin.

**E2E-OUT-02** · P0 · pw — Program rendering
- Steps: start the broadcast with a scene holding K1 (camera) and S1 (screen).
- Expect: two `<video>` elements, `muted`, `playsinline`, `autoplay`, `expectVideoPlaying` for both within `T-VIDEO-START`; rectangles equal the item rectangles × stage scale (±1 px); no audio receiver on any peer connection; autoplay works without a user gesture (output inside an iframe with `allow="autoplay; fullscreen"` and standalone). The answer to "was a gesture needed" is the state of `navigator.userActivation` at the first `playing` event of the document. Any call into the page is a gesture (`Runtime.callFunctionOn` with `userGesture`), so the test must not ask early; and the report of the output (every 2 s, latency from the ICE and jitter-buffer stats) does not wait for the `playing` event of the `<video>`, so on a loaded machine one read after the report can find nothing (issue 51: `undefined` in 3 of 4 runs at a load of 35, none in 20 runs with the wait). The probe therefore writes a console line at the first `playing` and the test waits for that line (`probe.activationAtFirstPlay()`), without a call into the frame.

**E2E-OUT-03** · P0 · pw — Letterboxing in non-16:9 iframes
- Steps: `embedHost` iframe of sizes 1920×1080, 1280×720, 800×600, 1680×720, 160×90, 3840×2160 (dpr 1), 600×1000, 10×10; resize the iframe at runtime; dpr 1 and 2.
- Expect: stage box is 16:9 (±1 px), centred, scale = min(w/1920, h/1080); bars are black (corner pixel `0,0,0`); no scrollbars (`scrollWidth ≤ clientWidth`); videos undistorted (item aspect preserved) and keep playing across resizes; re-fit within one animation frame.

**E2E-OUT-04** · P1 · pw — `bg=transparent`
- Steps: open with `&bg=transparent` in an iframe on a host page with a red background; scene with background colour `#102030` and one contain-fit item; `page.screenshot({omitBackground:true})`.
- Expect: computed background of `html`, `body` and stage `rgba(0,0,0,0)`; bars and scene background transparent (pixel alpha 0, red host visible), item contain bars `#0a0d12` opaque [GAP-24]; slates are not affected by the parameter.

**E2E-OUT-05** · P1 · pw — `debug=1` overlay
- Steps: open with `&debug=1`.
- Expect: `[data-testid=debug-overlay]` in a mono font, in sections (Program, Connections, Sources, Audio) with lines `scene`, `revision`, `Server` (hub and sync), `Media server` (LiveKit), per source `<code> <w>x<h> <fps> fps <kbps> kbps`, `latency <n> ms`; updates at least every 1 s; `pointer-events: none`; absent without the parameter; values match the `<video>` elements (`videoWidth`/`videoHeight`) and the API state [GAP-24]; the last line is the build, `StudioFlow 0.1.0+1a2b3c4` (the commit is missing in a local build).

**E2E-OUT-06** · P0 · pw — Hold frame on source loss
- Pre: K1 item 1360 px wide (holdMs 3000), K2 item 300 px wide (holdMs 3000), K3 item (holdMs null), K4 item (holdMs 10000); all live; output open.
- Steps: close the K1…K4 phone pages (track unpublished); observe `data-state` and frames.
- Expect: immediately `hold`: the element stays visible with the last frame (not black; `expectVideoFrozen` for 1.5 s); K1 changes to `held` at 3.0 s ± 0.3 s (`T-HOLD`): filter blur ≈ 2.5 % of the item width (34 px at stage scale 1, i.e. an output viewport of 1920×1080; ± 1 px), overlay `rgba(13,17,23,.72)`, text “Picture returns shortly”; K2 (300 px) `held` without text; K3 stays `hold` for 60 s; K4 `held` at 10 s ± 0.3 s; every sampled frame of a lost item has a copy of its last picture (`holdFrame` of the probe) whose luminance was measured and is at least 12 (a luminance that could not be measured is reported as such, it is not counted as black; issue #50); reopening the K1 sender page within `held` (credentials in storage, auto-start) → `live` with moving frames, filter removed, no black frame in between (screencast).

**E2E-OUT-07** · P1 · pw — Fallback source
- Steps: K1 item `fallbackSource` = image asset “Break slate”; K1 offline beyond `holdMs`; K1 back; then fallback = a live camera K2; then fallback = deleted asset.
- Expect: after `holdMs` the item shows the image (`data-state=fallback`, no blur); K1 back → live; fallback camera is shown live; deleted/unknown fallback → regular held style; no exceptions.

**E2E-OUT-08** · P0 · pw — Survives API restart
- Steps: broadcast live with two cameras on air; `docker.restart('api')`; after it is healthy switch scenes from the Regie.
- Expect: during the outage videos keep playing (frames advance), no slate, no text, no blank; once the API is back (≤ `T-RESTART-API`) the output resubscribes (snapshot because revisions restarted) and reports resume (status chip `stale` → `connected`); the switch made afterwards reaches the output within `T-SWITCH`; no page reload happened (`performance.timeOrigin` unchanged).

**E2E-OUT-09** · P0 · pw — Survives LiveKit restart
- Steps: `docker.restart('livekit')` with cameras on air.
- Expect: pictures freeze on the last frame (state `hold`, later `held` per hold times), never black or empty; no page reload; within `T-RESTART-LK` after LiveKit is healthy the output and all senders have rejoined (fresh tokens), `data-state=live` again and frames advance; Regie shows `reconnecting` incidents that end in “back”.

**E2E-OUT-10** · P0 · pw — Reload
- Steps: reload the output while live (F5) ten times, once with `cache: disabled`.
- Expect: the picture is back ≤ `T-RECOVER-SHORT`; during live the standby slate is never shown; correct scene; a single `output_{slug}_*` participant remains (old ones removed).

**E2E-OUT-11** · P0 · pw — Slates
- Steps: standby → start → end → reset; rename the production; set slate title/subtitle through the API; slate with background image.
- Expect: slate text via `slate-title`/`slate-subtitle`; 300 ms fade (WAAPI duration); renamed production updates the subtitle live; background image cover-fitted; slate covers scene and videos completely; start fades the slate out to the program, end fades in the end slate over the last picture.

**E2E-OUT-12** · P0 · pw — Access denied
- Steps: wrong key; missing `k`; unknown slug; key of another production; observe for 70 s with request logging.
- Expect: slate “No access” (`data-slate=denied`), drawn as a quiet notice of the page, no video, no scene content; identical for the three refused links (no hint whether the slug exists), with the plain cause, the next step and “This page tries again by itself every 30 seconds.”; the missing key says that the link is incomplete and is never retried; at most 3 attempts in 70 s, spaced ≥ 30 s; fixing the URL and reloading works.

**E2E-OUT-13** · P0 · pw — Glass-to-glass latency
- Pre: `chromium-desktop` on the perf runner (≥ 4 cores, nothing else running); laptop shares the timecode tab (screen, VP9) and a phone publishes the timecode camera (H.264); scene “Full screen” with the source; output 1920×1080 standalone; warm-up 5 s. Tagged `@perf`: not part of the nightly run on the 2-vCPU runner (6.8).
- Steps: per source (screen, camera): read `readTimecode()` on every `requestVideoFrameCallback` for 60 s; compute latency per decoded frame; repeat with the Regie Program monitor `<video>`. The wait for a quiet machine (3 attempts, the first at 60 % CPU or less counts) is bounded by the time budget of the test: it starts no attempt that would not fit before the timeout and waits at most 30 s in all on CI, 240 s on a shared machine (6.8).
- Expect: `T-LATENCY` for the output: p50 < 200 ms and p95 < 300 ms (hard), target p50 ≤ 150 ms; checksum failures < 5 %; decoded timestamps strictly increasing; results attached as `latency-screen.json`, `latency-camera.json`, `latency-regie.json` including p50/p95/p99/max/mean, frame count, codec, resolution, and the `OutputReport.latencyMs` average (informational: |estimate − measured| < 60 ms). The thresholds are enforced when the run was taken at 60 % CPU or less (`machineCpuBusyPct` and `comparable` in the JSON); on a busier machine the figures are recorded and a failure ends in a skip `not-comparable` that names the CPU use and the first failed threshold (6.8). Checked on every machine: the stamps are decoded at least once a second and increase. **E2E-OUT-13 [latency, camera, short]** (20 s, not `@perf`, in the nightly run) keeps the stamp path and the measurement alive on the shared runner with the same rules.

**E2E-OUT-14** · P1 · pw — Latency stays stable while switching
- Steps: repeat -13 for 120 s with a cut every 5 s between two scenes both containing the source.
- Expect: p95 within +50 ms of the static case; no latency spike > 500 ms. Same rules as -13 (`@perf`, 6.8): the cuts (≥ 20) and the decoded stamps are always checked, p95 and the spike only on a machine with headroom.

**E2E-OUT-15** · P1 · pw — Output status in the Regie
- Steps: no output → open one → open a second → block the first page's main thread for 10 s (`page.evaluate` busy loop) → resume → close both.
- Expect: chip “Output to proxy” lamp grey/“not connected” → green with mono latency (e.g. “148 ms”) within 5 s; popover “connected, 1 consumer” → “2 consumers”, lists both IPs, “1920 × 1080 · 16:9 · 30 fps”, “Latency <n> ms measured”; blocked page → state `stale` after ≤ 8 s then `connected` again; closing → `none` within 8 s; link box shows the URL masked (`?k=••••••`) and “Copy” puts the full URL with the real key into the clipboard.

**E2E-OUT-16** · P1 · pw — Embedding as the proxy would
- Steps: `embedHost` page at the allowed origin with `<iframe src=… title="Webinar Q4 live" allow="autoplay; fullscreen" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0">`; request fullscreen on the iframe.
- Expect: autoplay without click; fullscreen allowed (no Permissions-Policy block); picture identical to standalone; no `sandbox` requirement.

**E2E-OUT-17** · P1 · pw (`firefox-desktop`, `webkit-desktop`) — Output in other engines
- Steps: scene with a timecode camera (Firefox canvas mode) live; open the output in Firefox and WebKit.
- Expect: video renders and plays, hold frame and slates work, letterboxing identical; WebKit autoplay muted works.
- Note: phones publish H.264 only. The Playwright build of Firefox on Linux has no OpenH264 plugin and cannot decode it
  (a desktop Firefox downloads the plugin itself), so the Firefox test asks `RTCRtpReceiver.getCapabilities('video')` and
  then uses a second laptop screen (VP9) as the moving item; the annotation `environment` of the test says which (#45).

**E2E-OUT-18** · P1 · pw — Page weight and load
- Steps: cold load with cache disabled; measure encoded bytes of `/o/…` document, JS, CSS.
- Expect: total gzip/brotli ≤ 350 KB (spec 9.3); load event ≤ 2 s, first slate paint ≤ 1 s on localhost (`T-LOAD`); zero third-party requests.

**E2E-OUT-19** · P1 · pw — Assets via the key
- Steps: scene with an image asset and a video asset on air; read the output's network log; repeat with the key changed.
- Expect: asset requests use `?k=<key>` and return 200 (video 206 with `Content-Range`), `Cache-Control: private, max-age=3600`; image visible, video playing and looping; wrong key → 403 and the item shows the dark placeholder, no broken-image icon.

**E2E-OUT-20** · P1 · pw — Reports
- Steps: observe output reports for 12 s.
- Expect: ≈ 6 reports (hub `Report` or `POST /api/output/{slug}/report`, every 2 s ± 0.5 s) with `rendering: true`, `fps` between 20 and 31, `latencyMs`, `programSceneId` equal to the current program; `outputStatusChanged` emitted at most every 5 s unless the value changes > 20 %.

**E2E-OUT-21** · P1 · pw — Simulcast layer selection from the scene
- Steps: output with `debug=1`; scene A with K1 at full canvas, scene B with K1 as a 270 px thumbnail, K2 only in scene C.
- Expect: K1 full-size item receives the highest layer (≥ 1280 px wide); in scene B (270 px) K1 drops to ≤ 360 px; K2 (not in program or preview) is paused: no frames are decoded; screens (simulcast off) have one layer; transitions between qualities happen without visible black frames.

**E2E-OUT-22** · P1 · pw — Output subscribes only to scene sources [GAP-26]
- Steps: laptop screen S1 live but placed in **no** scene; output open.
- Expect: the output peer connection has no subscribed track for S1 (`room.remoteParticipants` publications `isSubscribed === false`), receives no bytes for it (inbound-rtp count equals the number of scene sources).

**E2E-OUT-23** · P2 · pw — Several consumers stay in sync
- Steps: three output pages (one `debug=1`); 20 switches.
- Expect: all three show the same scene within 100 ms of each other (max pairwise difference of `data-scene-id` change times); consumers count 3.

**E2E-OUT-24** · P2 · pw — Audio-ready but silent
- Steps: output with a camera source; inspect media elements and console.
- Expect: videos `muted`; no `<audio>` playing; no microphone/`getUserMedia` call; no autoplay-policy console warnings; no “Sound on” button (the production has no channel that could be heard; with audio sources see AUD-05).

**E2E-OUT-25** · P2 · pw — IP restriction (see E2E-AUTH-23) and key rotation (see E2E-AUTH-24) from the output's perspective
- Steps: during both flows record the output page's visible state with screenshots.
- Expect: while denied/kicked the page shows only the “No access” slate (no stale scene content remains visible).

### 2.7 NET – Resilience and network

**UNIT-NET-01** · P0 · vitest — Backoff policy [GAP-25]
- Steps: `backoffDelay(0…10)` with `random = () => 0` and `() => 0.999`; negative and fractional counts; 1 million calls with `Math.random`.
- Expect: sequence 0, 300, 600, 1200, 2400, 4800, 5000, 5000… (+ jitter in `[0, 250)` for retries ≥ 1; first retry exactly 0 without jitter); never negative, never above 5250; counts ≤ 0 → 0.

**UNIT-NET-02** · P0 · vitest — `ResilientHub`
- Steps: fake `HubConnection` that rejects the first 100 `start()` calls; `stop()` during backoff; `markTerminal()`; retry reasons `Status code '401'`, `'403'`, `'500'`, network error; `online` and `visibilitychange` (visible/hidden) events while waiting; concurrent triggers.
- Expect: `start()` retries forever with the backoff policy (also the first connect); 401/403 retry reasons end in state `stopped` without further attempts; `stop()` and `markTerminal()` never reconnect; `online`/visible events cancel the timer and try immediately, exactly one attempt in flight; state sequence `connecting → connected → reconnecting → connected`; `onReconnected` fires once per reconnect; `invoke` while disconnected rejects fast or queues per documented behaviour.

**UNIT-NET-03** · P0 · vitest — `ProductionSync`
- Steps: events with revision local+1, ≤ local, > local+1; several gap events while a resubscribe is pending; `Subscribe` returns delta then snapshot; events arriving during the pending `Subscribe`; `resync` message; reconnect; `revisionOnly`; unknown event type; duplicate delivery; out-of-order delivery.
- Expect: apply only local+1; ignore ≤ local; a gap triggers exactly one `Subscribe(since = local)` (no storm); delta events are applied in order, a snapshot replaces the state; events buffered during `Subscribe` are applied afterwards without loss/duplication; `resync` always resubscribes; after reconnect `Subscribe(local)` is called; `revisionOnly` advances the revision only; unknown event types advance the revision and are ignored; `onGap`, `onChange`, `lastSyncAt` fire as documented.

**UNIT-NET-04** · P1 · vitest — Media session reconnect policy
- Steps: fake `Room` emitting `Disconnected` with every `DisconnectReason`; token provider failing (network, 403); `online`/visibility events; reconnect storms.
- Expect: order resume → rejoin with a fresh token → backoff wait → retry without limit; `CLIENT_INITIATED`, `PARTICIPANT_REMOVED`, `DUPLICATE_IDENTITY`, `ROOM_DELETED` and token 403 stop the session (`stopped|replaced|removed`); everything else reconnects; `stop()` cancels timers; a fresh token is requested for every rejoin.

**INT-NET-01** · P0 · xunit — Delta versus snapshot boundary
- Steps: produce N events; `Subscribe(since)` for since = current, current−1, current−500, current−501, 0, random unknown, future; same through `GET …/changes?since=`.
- Expect: since = current → `events: []`; the last 500 events available → delta equal to the real event sequence; 501 back, 0, unknown, future → `snapshot` and `events: null`; negative/missing `since` → 400; unknown production 404.

**INT-NET-02** · P1 · xunit — Subscribe under concurrent writes
- Steps: 3 hub clients subscribe while 300 parallel mutations run; each client applies the client rule; finally compare with `GET snapshot`.
- Expect: no gaps/duplicates seen by any client after the rule is applied; the three end states equal the REST snapshot (`JsonSerializer` deep equality ignoring `ServerTime`).

**INT-NET-03** · P1 · xunit — Revision across restart [GAP-20]
- Steps: note revision; dispose and recreate the factory on the same database; subscribe with the old revision.
- Expect: the first new revision is greater than any previous one (`unixTimeMs × 1000` base); the old `sinceRevision` yields a snapshot (ring buffer is empty after restart).

**INT-NET-04** · P0 · xunit — Database outage [GAP-32]
- Steps: stop the PostgreSQL container; call `/health/live`, `/health/ready`, a read, a write, hub `Subscribe` on an existing connection; restart PostgreSQL.
- Expect: `/health/live` 200 throughout; `/health/ready` 503 within 5 s; reads, writes and the login needing the DB → 503 `service_unavailable` ProblemDetails (no stack, no connection string) within 5 s, also when PostgreSQL hangs or its name resolves slowly (`Database:ConnectTimeout` 3 s, `Database:CommandTimeout` 5 s) and also for requests queued behind device reports of the same production; once the outage is known every request answers at once and a probe connection every `Database:ProbeInterval` (1 s) ends it (BUG-21); hub calls answer `service_unavailable` and existing hub connections stay open; after PostgreSQL returns, `/health/ready` is 200 again within 30 s **without** restarting the API and writes work; no state was lost.

**INT-NET-05** · P2 · xunit — Graceful shutdown
- Steps: dispose the host while hub clients are connected and a request is in flight.
- Expect: in-flight request completes; every hub connection is aborted when the host begins to stop (clients see `onclose` immediately, not after the 5 s timeout); the host stops well within `HostOptions.ShutdownTimeout` = 5 s; the maintenance loops end at once; the disconnects caused by the shutdown write no audit or log entry, no incident and no “reconnecting” (BUG-20, OBS-01); no unobserved exceptions logged at error level.

**INT-NET-06** · P2 · xunit — Unhandled exceptions
- Steps: inject a failing `IProductionRepository`; call mutating endpoints and a hub method.
- Expect: ProblemDetails 500 with `traceId` only; the coordinator lock is released (next request works); hub method failure returns `HubException` with a generic message and the connection stays open.

**E2E-NET-00** · P0 · pw — Harness canary (must pass first)
- Steps: (1) `setOffline` blocks `fetch('/health/live')` and restores it, and an open WebSocket is closed or stalls (otherwise `net.cut` closes tracked sockets explicitly); (1b) `net.cut(phone)` makes the output's `inbound-rtp` for that phone stall and the Regie show the outage, `net.restore` recovers; (2) `cdpThrottle(400 kbit/s, 400 ms)` makes a 200 KB fetch take ≥ 4 s; (3) two senders publish; `lk.pause()` stalls `inbound-rtp` `packetsReceived` of the output, `unpause()` resumes; (4) `lk.netem({delayMs:200})` raises `candidate-pair.currentRoundTripTime` to ≥ 0.3 s (both directions are shaped), `clearNetem()` fails when `docker compose run` fails and leaves no netem qdisc (`netem show`), and the plain average RTT of the STUN responses that arrive after it (`totalRoundTripTime` / `responsesReceived` between two readings, unsmoothed) falls below 0.15 s, half of what proves the shaping (issue 49: a fixed 50 ms on the smoothed `currentRoundTripTime` did not hold on a CI runner, and a `clear` that failed silently looked like an RTT that does not recover); (5) `lk.disconnect()`/`connect()` restores reachability (both signalling and media) – otherwise the harness switches `lk.disconnect` to `docker pause`; (6) `docker.restart('api')` returns to healthy; (7) screen-share mode (`tab`|`canvas`) works: a share starts and the track ends when `endShare()` runs; (8) `timecode` decode works on the received video.
- Expect: all checks pass or the run aborts with a message naming the failing tool; the used `E2E_SCREEN_MODE` and netem availability are recorded in the report; dependent tests fail explicitly ("tool X unavailable"), never silently pass; only a tool that the machine cannot provide at all (`E2E_NETEM=unavailable`, set by the CI step that loads the kernel modules) is recorded as skipped, and its tests are skipped with that reason.

**E2E-NET-01** · P1 · pw — Regie on a slow network
- Steps: CDP Slow 3G profile (400 kbit/s down/up, 400 ms RTT) on the Regie context; login, load, switch a scene, edit an item, open pairing; remove the throttle.
- Expect: the app loads (≤ 60 s) with a visible loading state, no blank screen and no JS exception; commands succeed with latency ≈ RTT and show no duplicate requests; connection indicator shows `connected` after the hub connects; after removing the throttle everything is responsive within `T-SYNC-DELTA`.

**E2E-NET-02** · P1 · pw — Sender on a slow network
- Steps: CDP Slow 3G on a phone context during pairing and technical check.
- Expect: pairing completes (≤ 60 s) without errors; bandwidth check reports `bad` (< 3 Mbit/s); the camera publish itself is not governed by CDP (media path: assert RTP still flows, documents the limitation).

**E2E-NET-03** · P1 · pw (`@linux-netem`) — 200 ms delay on LiveKit
- Steps: `lk.netem({delayMs:200, jitterMs:20})` for 60 s with a camera on air; clear.
- Expect: output latency (as in E2E-OUT-13) rises by ≈ 400 ± 100 ms (200 ms in each direction: phone → SFU and SFU → output) and returns to baseline ± 30 ms ≤ 10 s after clearing; freeze count ≤ 1 and total freeze ≤ 1 s per minute (`inbound-rtp` `freezeCount`, `totalFreezesDuration`); no incident, no Regie error.

**E2E-NET-04** · P1 · pw (`@linux-netem`) — 5 % loss
- Steps: (a) `lk.netem({lossPct:5})` (both directions) for 60 s with a camera on air; (b) only with `@netns`: `phone.netem({lossPct:5})` shapes one phone while the others stay clean.
- Expect: (a) output fps ≥ 24, downlink loss `packetsLost/(packetsReceived+packetsLost)` between 2 and 9 %, Regie station “Packet loss” (uplink, reported by the sender) between 2 and 9 %, total freeze ≤ 2 s per minute (`T-FREEZE`); (b) only the shaped phone shows loss; no `reconnecting` incident in either case; quality recovers ≤ 10 s after clearing.

**E2E-NET-05** · P1 · pw (`@linux-netem`) — 20 % loss
- Steps: as -04 with 20 %.
- Expect: picture continues (no freeze > 5 s), Regie shows high loss (≥ 10 %), the sender does not enter an endless reconnect loop (≤ 1 rejoin per 30 s; note that LiveKit's webhooks to the API are shaped as well, so incidents may appear a few seconds late); if ICE fails the standard incident “reconnecting” appears and ends in “back”; full quality ≤ 10 s after clearing.

**E2E-NET-06** · P1 · pw (`@linux-netem`) — 1 Mbit/s rate limit
- Steps: `lk.netem({rateKbit:1000})` with a camera and a screen on air for 60 s; clear.
- Expect: output receives lower simulcast layers (`qualityLimitationReason` or layer width drops), no freeze > 1 s, no incident; HIGH layers return ≤ 15 s after clearing.

**E2E-NET-07** · P0 · pw — Short and long network loss of a phone
- Steps: `phone.goOffline()` (`net.cut`) for 5 s, 30 s (and 5 min in the nightly run), then `goOnline()`; the `@netns` variant uses `phone.disconnect()` for real silent loss.
- Expect: Regie outage in six places within `T-DETECT-CLEAN`; timers read the real durations; output holds the frame, `held` after 3 s; picture back within `T-RECOVER-SHORT` (5 s outage) / `T-RECOVER-LONG` (30 s, 5 min) after `goOnline`; the strip shows “back” with “was gone for 5 s” / “was gone for 30 s” (± 1 s) until “Seen”; the station keeps its code and scene place.

**E2E-NET-08** · P0 · pw — Silent loss of the media server
- Steps: `lk.pause()` 10 s then `unpause()`; separately `lk.disconnect()` 10 s then `connect()`.
- Expect: no picture ever turns black (hold), the Regie shows incidents for every live source within `T-DETECT-SILENT` and clears them as “back” within `T-RECOVER-LONG` of restoration; senders and output rejoin on their own; no page reload; no duplicate stations.

**E2E-NET-09** · P0 · pw — API outage
- Steps: with Regie ×2, output, two phones live: `docker.stop('api')` for 30 s, then `start`.
- Expect: the Regie shows `connection-state=reconnecting` and a visible banner/indicator ([GAP-27]), stays responsive; commands fail with a toast, no unhandled rejection; hub reconnect attempts follow the backoff (5–12 negotiate attempts in 30 s, never > 20); output and phones keep streaming (media independent); phones show “Reconnecting…” for the control connection; after start everything reconnects ≤ `T-RESTART-API`, Regie revision equals the server's, and no permanent incident is left (all `back` or none).

**E2E-NET-10** · P1 · pw — Failed requests in the Regie
- Steps: `net.routeFault` returns 500 for `PUT …/items/*` during a drag, 503 for `POST …/program`, aborts `POST …/take`, delays `GET /api/auth/me` 5 s; then remove the faults.
- Expect: an error toast per failure (generic, [GAP-27]), no unhandled promise rejection or uncaught error beyond logged network errors; the item snaps back to the last confirmed geometry (UI never diverges from server state after 2 s); program/preview unchanged on failure; Take button re-enabled; no automatic retry of non-idempotent calls; after removing the faults all actions work.

**E2E-NET-11** · P0 · pw — PostgreSQL down [GAP-32]
- Steps: Regie, output, phones live; `docker.stop('postgres')` for 30 s; try to switch and edit; `start`.
- Expect: output and media unaffected; switch/edit fail with an error toast (503); already loaded Regie remains usable for viewing; `curl /health/ready` → 503, `/health/live` → 200; after PostgreSQL is back (≤ 30 s) edits work again without API restart; state (scenes, devices) intact; no incident created for senders whose hubs stayed connected; a request through Caddy is answered with a 503 ProblemDetails within `T-DB-OUTAGE` (never a 504 of Caddy) [BUG-21].

**E2E-NET-12** · P0 · pw (`@disruptive`) — Single container restarts
- Steps: for each of `api`, `livekit`, `postgres`, `caddy`: `docker.restart(svc)` (and a crash – `kill -TERM 1` inside the container [DOC-04] – once for `api` to test the restart policy) with Regie ×2, output, 3 phones and 1 laptop live.
- Expect: per service within its threshold (`T-RESTART-API`, `T-RESTART-LK`, 30 s for postgres/caddy after healthy): all clients reconnect without manual reload; Regie `connection-state=connected`; output playing; stations `ok`; no permanent incident; for `caddy` the media (UDP 7882) keeps flowing throughout; revisions of both Regies equal the server's; logs contain no unexpected errors beyond connection failures; `api`: the graceful restart takes a few seconds (`T-SHUTDOWN`, OBS-01) and writes no “reconnecting” and no incident for sources whose device comes back (BUG-20), while a source on air whose device does not come back is flagged by the restart watch (spec 12).

**E2E-NET-13** · P0 · pw (`@disruptive`) — Whole stack restart
- Steps: `docker compose -p sf-e2e restart` (then crash all containers once: `kill -TERM 1` inside each, `kill -QUIT 1` for PostgreSQL [DOC-04]); same clients as -12.
- Expect: all containers return via restart policy, healthy ≤ 90 s; all browsers return without reload within `T-RESTART-STACK`; persistent data intact: scenes, devices recognised with their old credentials, output key unchanged, admin session still valid (Data Protection keys volume), assets served, `LiveSince` unchanged so the LIVE runtime keeps counting [GAP-33]; incident history is empty.

**E2E-NET-14** · P0 · pw — Reconnect with delta and with snapshot
- Steps: (a) Regie A `setOffline` 5 s while Regie B makes 10 changes; (b) Regie A offline while B makes 520 changes (scene renames via API); (c) restart the API while A is connected; inspect hub frames with `page.on('websocket')` (parse `0x1e` delimited JSON).
- Expect: (a) A calls `Subscribe` with its last revision and receives `events` (no `snapshot`, no `GET …/snapshot`), UI converges ≤ `T-SYNC-DELTA`; (b) receives `snapshot` (501+ events behind) and converges ≤ 3 s; (c) snapshot after restart; in all cases A's final state equals the API snapshot and `window.__sfStudio.lastSync` is `'delta'|'snapshot'` accordingly.

**E2E-NET-15** · P2 · pw (`@disruptive`) — Reconnect storm
- Steps: 5 Regie contexts, 10 output pages, 6 senders; `docker.restart('api')`.
- Expect: reconnects are spread (first attempts at 0, then 300 ms + jitter…); the API never answers 5xx after start; all clients connected ≤ 30 s after healthy; CPU of the api container < 200 %.

**E2E-NET-16** · P2 · pw — Slow and hanging token endpoints
- Steps: `net.routeFault` delays `POST …/livekit-token` by 15 s for the output; abort the first call for a phone.
- Expect: the clients retry with backoff and end up connected; no double participants for one identity; UI never freezes; the output shows the last picture/slate meanwhile.

**E2E-NET-17** · P2 · pw — Failed pairing requests on the sender
- Steps: abort `POST /api/pairing/requests` once and `redeem` once.
- Expect: the sender shows a retry state with a button, no spinner forever; second attempt works; no duplicate pending requests in the Regie.

**E2E-NET-18** · P1 · pw (`soak`, nightly 30 min; weekly 60 min) — Soak
- Pre: 3 phones + 2 laptops live, Regie ×2, output ×1 (plus one `debug=1` output), scene set with fades and cuts.
- Steps: every 20 s a random program switch (alternating cut/fade); every 5 min one phone offline for 8 s; every 10 min one laptop ends and re-shares; sample every 60 s (after `HeapProfiler.collectGarbage`): per page `JSHeapUsedSize`, `Nodes`, `JSEventListeners`, `Documents`, video element count, `window.__sfNet.counts()` (WebSockets, RTCPeerConnections), console errors; api/livekit/postgres/caddy RSS (`docker stats`), `select count(*) from pg_stat_activity`, hub connection count.
- Expect: `T-MEM` thresholds met between minute 10 and the end; video element count == item count of the current scene ± 0; RTCPeerConnection count constant; WebSocket count constant; zero uncaught exceptions; no container restarts (`docker events`); latency p95 at the end ≤ start + 50 ms; revisions of both Regies equal the server's; CSV in `results/soak-<ts>.csv`.

**E2E-NET-19** · P1 · pw — Many sources
- Pre: 8 phone contexts (fake cameras 720p) + 2 laptops (screens); scenes: “3 × 3” with 9 items, Auto grid with 10, single full-screen.
- Steps: run 5 min; switch between scenes; read output `stats()` and CDP `TaskDuration`/`Performance.getMetrics`.
- Expect: `T-FPS`: output fps ≥ 24 in the 3 × 3 scene, main-thread busy ≤ 60 % of one core (4-core runner), heap ≤ 400 MB; Regie interactions (scene click → toast) ≤ 150 ms; non-program sources received at LOW only (total inbound ≤ 20 Mbit/s); no frame decode errors; no incident. `@perf` (6.8): ten senders and nine 1080p videos need the 4 cores; on a 2-vCPU runner the whole machine is at 100 % and the animation frame rate of the output falls to 1 fps while it decodes everything it is sent. The frame rate and the main-thread share are therefore enforced only when the machine was at 60 % CPU or less in the 3 × 3 phase (else recorded, skip `not-comparable`); decoding at the rate the senders send, the inbound rate, heap, drops, incidents and page errors are always enforced.

**E2E-NET-20** · P1 · pw — CPU throttling
- Steps: `Emulation.setCPUThrottlingRate` 4 on the Regie and on the output; 6 on the Regie; drag, switch, open popovers.
- Expect (`@perf`: needs a machine with headroom, 6.8): output at 4×: fps ≥ 20, not flipped to `stale`; Regie at 4×: click → visible reaction ≤ 250 ms (`T-FPS`), drag stays coalesced (requests per second bounded), long tasks > 200 ms ≤ 3 per minute while idle.

**E2E-NET-21** · P1 · pw — Reconnect cycles do not leak
- Steps: 50 × (phone offline 5 s, online 5 s) and 20 × (Regie offline 3 s, online); sample counters before/after.
- Expect: WebSocket and RTCPeerConnection counts equal before/after; Regie heap growth ≤ 10 MB; listener count growth ≤ 5 %; API connection count constant.

**E2E-NET-22** · P2 · pw — Clock skew
- Steps: Regie context clock +10 min, output context −5 min, sender +2 min (`page.clock`).
- Expect: LIVE runtime, incident timers, fade timing and slate switching unaffected (server time offset); no logout loops (cookie lifetime is not judged by the client clock).

**E2E-NET-23** · P2 · pw — Background tabs
- Steps: emulate hidden Regie tab 60 s (`visibilitychange` hidden/visible with timers throttled); same for a phone sender.
- Expect: on visible the Regie resubscribes immediately (delta) and is consistent ≤ 2 s; the phone re-acquires the wake lock and, if the control connection dropped, reconnects immediately (no wait for the backoff timer).

**E2E-NET-24** · P1 · pw — Short media blip (ICE restart)
- Steps: `lk.pause()` 2 s with a camera on air.
- Expect: SDK resume (no new participant identity creation, publication SID of the sender unchanged) or rejoin; picture back ≤ `T-RECOVER-SHORT`; at most a short “reconnecting” incident that ends in “back”.

**E2E-NET-25** · P2 · pw (`@netns`) — Uplink loss and full uplink disconnect of one phone
- Steps: `phone.disconnect()` 20 s with `docker network disconnect` of the phone container (silent loss) then reconnect; compare detection to `T-DETECT-SILENT`.
- Expect: detection within the silent threshold (hub timeout 5 s), recovery per `T-RECOVER-LONG`; the other phones unaffected.

**E2E-NET-26** · P1 · pw (`@short-ttl`) — Token expiry
- Steps: with `LiveKit:TokenTtl=60 s` keep a sender and the output connected for 5 min; then force a rejoin.
- Expect: running connections survive token expiry (LiveKit refreshes); a rejoin after expiry fetches a new token (request count increases by one per rejoin); no stale-token 401 loops.

### 2.8 DEV – Devices, viewports, accessibility

Helpers: `expectNoOverflow(page)` asserts `document.documentElement.scrollWidth <= clientWidth` (no horizontal scroll) and, where stated, `scrollHeight <= clientHeight`; no element's bounding box extends beyond the viewport horizontally.
`expectInViewport(locator)` asserts the box is inside the viewport without scrolling and that `elementFromPoint` at its centre is the element (not covered).

**E2E-DEV-01** · P0 · pw (`regie-1280x720`) — Regie at 1280×720
- Pre: 7 scenes, 5 stations, one incident.
- Steps: load, open Studio Mode on and off, open each popover.
- Expect: no page scroll (vertical and horizontal), header 50 px and message strip ≥ 38 px, monitors 16:9 without overflow, five docks side by side at the bottom (height clamp(240 px, 42 dvh, 420 px) ≥ 150 px), scene rows collapse to one line with 48 px thumbnails and dock headers 36 px (height ≤ 820 px rule), all seven scenes visible without scrolling; `expectInViewport` for: `Studio Mode` switch, `Cut`/`Fade`, duration stepper, `Take` (Studio Mode on), `Pair device`, output chip, health chip, `Docks and layout`, `+ Source`, first and last scene.

**E2E-DEV-02** · P1 · pw (`regie-1440x900`) — Regie at 1440×900
- Expect: as -01 without the compact rules (two-line scene rows, 40 px dock headers), first-viewport composition of the prototype brief (header, strip, monitors + 172 px control column, docks), no overflow, critical controls in the viewport.

**E2E-DEV-03** · P1 · pw (`regie-1920x1080`) — Regie at 1920×1080
- Expect: as -02; monitors scale up but stay 16:9 and never exceed their container; docks height ≤ 420 px; no element stretches beyond readable widths (inspector rows keep their layout); no overflow.

**E2E-DEV-04** · P0 · pw (`regie-1180`) — Stacked docks at 1180 px
- Steps: load at 1180×800, scroll through the page, try to drag a dock header and a splitter.
- Expect: docks stack in a two-column grid of hairline-separated sections below the stage, the page scrolls vertically only (no horizontal scroll), drag grips and splitters are hidden (`display:none`), pairing dock spans both columns, header wraps without overlap, Take reachable, state persisted layout is not lost.

**E2E-DEV-05** · P0 · pw (`regie-900`) — Priority stack at 900 px
- Steps: load at 900×900 in Studio Mode off and on.
- Expect: order top to bottom: Program monitor, controls (two columns; Take full width, min height 48 px), Preview monitor (Studio Mode on), then docks in one column; Scenes dock is a horizontal scroll strip of 200 px cards; message strip shows only the ok state and incidents (log hidden); no horizontal page scroll.

**E2E-DEV-06** · P1 · pw (`regie-390x844`) — Regie on a phone-sized viewport
- Steps: 390×844, touch enabled; switch a scene, open pairing, expand a station.
- Expect: as -05; no horizontal scroll; Take ≥ 48 px high, scene cards ≥ 44 px high; every control reachable by scrolling; toast fits (`max-width: calc(100vw − 32px)`); other controls keep the 26–30 px of DESIGN.md (informational list of controls < 44 px is attached) [GAP-38].

**E2E-DEV-07** · P0 · pw (`pixel7`) — Sender portrait and landscape
- Steps: Pixel 7 portrait (412×915) and landscape (915×412): pairing form, waiting screen, station (camera live), dark mode, banner; rotate while publishing.
- Expect: no horizontal scroll; start/stop and kind controls reachable without scrolling in both orientations; tally frame visible around the whole viewport; rotation keeps the same LiveKit publication (SID unchanged) and does not restart the camera.

**E2E-DEV-08** · P1 · pw (`iphone14`, `iphone15`) — Sender on iPhone profiles
- Steps: portrait and landscape: invite redeem, station UI; check whether `getUserMedia` is available (decides full vs UI-only subset); safe areas.
- Expect: no overflow; bottom controls clear of the home indicator (`env(safe-area-inset-bottom)` padding present, `viewport-fit=cover`); tap targets as in -11; in the UI-only subset the tally is driven through API-sent `tally` messages and renders red/green; media is verified by MAN-01.

**E2E-DEV-09** · P1 · pw (`ipad`) — Sender on iPad
- Steps: iPad portrait 810×1080 and landscape 1080×810.
- Expect: kind defaults to phone (no `getDisplayMedia`), layout uses the width (no oversized phone layout), targets ≥ 44 px, no overflow.

**E2E-DEV-10** · P0 · pw (`small-320`) — Sender at 320 px
- Steps: 320×568: pairing form, check code “47 12” (mono 24 px, letter spacing 0.14 em), station, laptop screen list with 60-character names and nine screens, banner with 140 characters.
- Expect: `scrollWidth ≤ 320`; long names wrap or ellipsize inside their container; the check code stays on one line; text ≥ 14 px; buttons full-width.

**E2E-DEV-11** · P0 · pw (`pixel7`, `iphone14`, `small-320`) — Tap targets on the sender
- Steps: enumerate interactive elements (`button, a, input, select, [role=button]`) on every sender state.
- Expect: min(width, height) ≥ 44 CSS px for each (inline text links inside paragraphs excepted), at least 8 px between adjacent targets; no `user-scalable=no` in the viewport meta; `touch-action: manipulation` on buttons.

**E2E-DEV-12** · P1 · pw (`chromium-desktop`, `edge-desktop`, `firefox-desktop`) — Laptop sender in desktop browsers
- Steps: pair by code, share (canvas mode on Firefox), add a second screen, end/reshare, camera.
- Expect: same behaviour in all three; Firefox has no battery value; the platform text names the operating system and the browser of the user agent: “Windows · Chrome” for Chromium (the user agent of the desktop profile), “<OS of the machine> · Edge” for Edge (Windows, macOS or Linux, as the test runs); no console errors.

**E2E-DEV-13** · P0 · pw — Keyboard-only Regie
- Steps: starting at the page top press `Tab` through the whole UI; activate with `Enter`/`Space`; open each popover (output, Docks and layout, + Source) and close with `Escape`; use keys 1–9, Space, arrows on a selected item, Escape order (dock drag → popover → pairing dock → selection).
- Expect: every interactive element is reachable in a logical order (header → strip actions → monitors/overlay → control column → docks in zone order), focus ring visible (2 px blue outline offset 2 px; separators/blue 3 px line), popovers focus their first item and return focus to the trigger on Escape, no keyboard traps, hidden/parked docks are never focusable, `Space` on a focused button activates it (not Take).

**E2E-DEV-14** · P1 · pw — Dock moves and splitters by keyboard
- Steps: focus grip “Move dock Scenes with the arrow keys” and press ArrowRight/Down repeatedly, then ArrowLeft/Up; focus separators “Height of the docks at the bottom”, “Width of the docks on the right”, “Size of Preview and Program”, “Size of Scenes and Sources”: Arrow keys, Shift+Arrow, Enter.
- Expect: dock moves left → bottom → right (and back) with toast “<Dock> is docked <on the left|at the bottom|on the right>” and action “Reset layout”; focus stays on the grip; no move beyond the ends; separators move 16 px per arrow (64 px with Shift) within their bounds, Enter resets; `aria-orientation` and `aria-label` as in 1.7; all changes persist.

**E2E-DEV-15** · P1 · pw — Screen reader semantics and automated a11y
- Steps: `page.accessibility.snapshot()`/`ariaSnapshot` and `@axe-core/playwright` (tags `wcag2a`, `wcag2aa`) on: login, Regie (Studio off/on, outage state, pairing dock open, each popover, station expanded), `/monitoring`, sender (all states), output slates.
- Expect: 0 critical/serious axe violations (colour-contrast findings reviewed individually and listed); regions `Monitors`, `Scenes`, `Sources of the scene`, `Properties`, `Stations`, status region `Messages`; switch `Studio Mode`; groups `Transition type`, `Fade duration`; scene buttons expose `aria-pressed` and the tally/health text; list `role=list` for sources; stations `aria-expanded`; canvases `role=img` with scene names; decorative lamps and icons `aria-hidden`; toast `role=status` `aria-live=polite`; presence text “2 people in the control room” reflects the real count; every button has an accessible name.

**E2E-DEV-16** · P1 · pw — Reduced motion
- Steps: `emulateMedia({reducedMotion:'reduce'})` for Regie and sender; trigger outage, expand station, dock move, scene switch.
- Expect: computed `transition-duration`/`animation-duration` 0 s on UI elements; lamp pulse and flash animations absent; `scrollIntoView` uses `behavior: 'auto'`; Regie monitors cut instead of fading; sender transitions off; the output page is not affected (E2E-SWITCH-16) [GAP-28].

**E2E-DEV-17** · P1 · pw (`chromium-desktop` and the `i18n` project) — Text audit in English and in German
- Steps: crawl visible text and `aria-label`/`title`/`placeholder`/`alt` of every state of Regie, sender, login, monitoring and output slates (test sets the states via API), once in `en-US` and once in `de-CH`.
- Expect: **English (`en-US`, `tests/e2e/specs/a11y/a11y-english.spec.ts`)**: no German anywhere in the English UI, detected with the module of `npm run check:german` (`tools/lib/german.mjs`, loaded with `await import()` by `tests/e2e/support/a11y/english.ts`); `<html lang="en">`. **German (`de-CH`, project `i18n`, `tests/e2e/specs/i18n/i18n-german-audit.spec.ts`)**: no sharp s (`ss` instead) anywhere; names quoted with the Swiss guillemets (a regex flags straight `"…"` quotes around words in UI text); durations with a decimal comma (`0.3 s`), rates `2.8` Mbit/s, clock `HH:mm:ss` 24 h; `lang="de-CH"` on the app root and toast; none of the English UI words `Loading|Error|Save|Cancel|Delete|Connect|Settings|Scene|Source|Station(s)?` appears as a whole UI word except the agreed terms (`AGREED_ENGLISH` in `tests/e2e/support/a11y/german.ts`: `Take`, `Program`, `Preview`, `Output`, `Dock`, `Slate`, `Tally` and the German product words kept there); `Intl` formats use `de-CH`.

**E2E-DEV-18** · P2 · pw — Long text does not break layouts
- Steps: scene name 80 chars, device name 60 chars, production name 80 chars, message 140 chars, asset name 80 chars; at 1280×720, 900 and 320 (sender).
- Expect: ellipsis or wrap inside rows, monitor headers, toasts, strip entries and station rows; no overflow; no overlapping controls.

**E2E-DEV-19** · P1 · pw — Browsers for the Regie
- Steps: Firefox and WebKit: login, switch, drag an item, open pairing, dock drag with pointer.
- Expect: same results as Chromium for these flows (WebKit/Firefox monitor rendering, `ResizeObserver`, pointer events); known differences recorded.

**E2E-DEV-20** · P2 · pw (`ipad` landscape 1180×820 touch) — Touch input in the Regie
- Steps: tap a scene, tap Take, drag an element with a finger (pointer events, `touch-action:none` on the overlay), pinch is ignored, tap a station row.
- Expect: actions work with touch; no double activation (tap + synthetic click); dragging the overlay element does not scroll the page; splitters/grips are inert at ≤ 1180 px.

**E2E-DEV-21** · P1 · pw — PWA and service worker of the sender
- Steps: fetch `/join/manifest.webmanifest`; register check; go offline after first load; inspect caches.
- Expect: manifest `name` “StudioFlow Sender”, `scope` and `start_url` `/join/`, `display: standalone`, `theme_color #0d1117`, icons 192/512 (+ maskable) resolvable; service worker at `/join/ngsw-worker.js` with scope `/join/`; app shell loads offline and shows “Reconnecting…”; requests to `/api`, `/hubs`, `/rtc` never come from the service worker cache; `ngsw.json` served `no-cache`.

**E2E-DEV-22** · P2 · pw — Forced colours and zoom
- Steps: `forcedColors: 'active'`; viewport 640×360 (≙ 200 % zoom at 1280×720).
- Expect: states remain distinguishable by text (not colour alone: “reconnecting”, “sharing stopped”, lamps have labels in the row text); 640 px falls into the ≤ 900 px layout without horizontal scroll.

**E2E-DEV-23** · P1 · pw — Light mode (Dark | Light | System)
- Steps: system set to light, fresh context; choose Light, System and Dark in the settings popover; reload; second tab; `emulateMedia` flips under System; abort the application bundle and reload; store an unknown value; login page and `/monitoring`; busy console with a reconnecting station in each theme; axe on login, Regie (with the settings popover) and `/monitoring`.
- Expect: no stored value means Dark even though the system prefers light; a choice applies at once, is stored in `studioflow.theme` and is kept after a reload; the head script `theme-init.js` alone sets `<html data-theme>` (no flash); an unknown value means Dark; another tab follows through the storage event; System follows the system setting live; login page and `/monitoring` follow the choice; 0 critical/serious axe violations (colour contrast included) in both themes; monitor screens, scene thumbnails and station thumbnails stay near black in the light theme; the incident row keeps its lamp with halo and a wash that differs from the panel. Contrast ratios of the tokens are checked by `tools/lib/studio-theme-contrast.spec.ts`; the theme service, the preference and the settings control by Angular unit tests.

### 2.9 DOCK – Dock layout and persistence

**UNIT-DOCK-01** · P1 · ng — Default layout
- Steps: read `defaultLayout()`.
- Expect: `{v:1, zones:{left:[], bottom:['scenes','src','insp','st'], right:[]}, weights:{scenes:0.95, src:1, insp:1.2, st:1.1, pair:2.2}, hidden:[], bottomH:null, leftW:320, rightW:340, split:0.5}`; each call returns a fresh object.

**UNIT-DOCK-02** · P0 · ng — Loading and validation (corrupted storage)
- Steps: storage values: missing, `""`, `{`, `null`, `"x"`, `[]`, `{"v":2,…}`, `{"v":1}`, zones with a duplicate dock, an unknown dock, a missing dock, non-array zones, `hidden` with unknown ids, `weights` with strings/negative/NaN, `leftW:"abc"`, `bottomH:7`, `split:5`, extra keys, 5 MB value; storage throwing on `getItem`/`setItem` (Safari private mode).
- Expect: any structural problem → default layout (never throws, no partial garbage); `hidden` filtered to known ids; numeric fields are validated and clamped (`leftW`/`rightW` 220…, `bottomH` null or 0…1, `split` 0.3…0.7, weights > 0) [GAP-34]; unknown keys dropped; storage exceptions are swallowed (layout works in memory).

**UNIT-DOCK-03** · P0 · ng — Moving docks
- Steps: `moveDock(id, zone, index)` to every zone/index incl. out-of-range; same position; keyboard traversal (`grip` arrows) at the ends; hide/show.
- Expect: dock removed from its old zone and inserted at the clamped index; no-op when nothing changes (no save, no toast); arrow traversal order left → bottom → right and reverse, no wrap; layout saved after each change; toast text “<Dock> is docked <on the left|at the bottom|on the right>” with the reset action.

**UNIT-DOCK-04** · P0 · ng — Resizing
- Steps: `splitMove` for bottom (150 px min, total − 160 max, stored as a fraction), left/right (220 px min, 42 % of workspace max), between docks (110 px vertical / 180 px horizontal min, weights sum preserved), monitors (0.3…0.7); `resetSplit` for each kind.
- Expect: clamps exactly as listed; `weights[a] + weights[b]` constant; reset restores the default of that kind only.

**UNIT-DOCK-05** · P2 · ng — Pairing dock placement
- Steps: open the pairing dock with `src`/`insp` in different zones, hidden, in left/right/bottom.
- Expect: it replaces the first visible of `src`/`insp` in zone order and hides both while open, and the Audio dock when that is in the same zone (wherever it stands in the zone; in another zone it stays); if both are hidden it sits next to `st`; closing restores the stored layout unchanged.

**UNIT-DOCK-06** · P2 · ng — Narrow mode
- Steps: viewport ≤ 1180 px with a custom layout, then widen.
- Expect: drag and split handlers inactive while narrow; stored layout untouched and re-applied on widening.

**E2E-DOCK-01** · P0 · pw — Default arrangement
- Steps: fresh context at 1440×900 and 1280×720.
- Expect: Scenes | Sources | Properties | Stations | Audio left to right in the bottom zone, left/right zones hidden, bottom height = clamp(240 px, 42 dvh, 420 px) (≥ 150 px), seams of 1 px.

**E2E-DOCK-02** · P0 · pw — Drag docks to left, bottom, right
- Steps: pointer-drag the “Stations” header to the right edge, then to the left edge, then back to the bottom between “Scenes” and “Sources”; drag with less than 5 px; Escape during a drag; `pointercancel`.
- Expect: while dragging a ghost follows the pointer, empty zones show dashed drop strips “Dock on the right”/“Dock on the left”/“Dock at the bottom”, occupied zones show a 3 px blue insertion line; drop applies the move, toast “Stations is docked on the right” + “Reset layout”; side zones default to 340 px (right) / 320 px (left); under 5 px nothing happens; Escape/cancel leaves the layout unchanged; `localStorage['studioflow.layout']` updated (v:1).

**E2E-DOCK-03** · P1 · pw — Resize with the pointer
- Steps: drag the horizontal seam above the bottom zone (±100 px, beyond limits), the vertical seam of a side zone, the seam between two docks, the Preview/Program seam (Studio Mode on); double-click each.
- Expect: sizes follow the pointer within the limits of UNIT-DOCK-04; seam turns blue 3 px on hover/focus/drag (`box-shadow: 0 0 0 1px #79c0ff`), cursors `row-resize`/`col-resize`; double-click resets that seam to default; persisted in `studioflow.layout`; stage never shrinks below 160 px.

**E2E-DOCK-04** · P1 · pw — Hide and show docks
- Steps: “Docks and layout” popover: uncheck/check each dock; hide all four; re-show.
- Expect: hidden docks leave the layout and the tab order, remaining docks reflow; hiding all leaves the stage (no error); re-showing restores the previous zone/order; `hidden` persisted; checkbox state reflects `aria`/`checked`.

**E2E-DOCK-05** · P1 · pw — Reset layout
- Steps: rearrange, resize, hide; click “Reset layout” in the popover; rearrange again and use the toast action.
- Expect: zones, sizes, weights and hidden reset to defaults, toast “Layout reset”, storage updated.

**E2E-DOCK-06** · P0 · pw — Corrupted localStorage falls back
- Steps: `addInitScript` sets `studioflow.layout` to each value of UNIT-DOCK-02, then load.
- Expect: default layout is shown, no console errors, subsequent changes overwrite the broken value with valid JSON; `studioflow.studio` invalid (`"yes"`, `"2"`) → Studio Mode off; `studioflow.transition` invalid → fade 0.3 s.

**E2E-DOCK-07** · P1 · pw — Pairing dock takes the place of Sources, Properties and Audio
- Steps: “Pair device” with default and custom layouts; close with the X button and with Escape.
- Expect: dock “Pair device” appears in the slot of the first of Sources/Properties and those two are hidden meanwhile, and so is the Audio dock of the same zone (the default layout shows Scenes, Pair device, Stations; with Audio in another zone it stays); closing restores them and returns focus to “Pair device”; knock cards show in Stations while the pairing dock is closed and in the pairing dock side column while it is open.

**E2E-DOCK-08** · P1 · pw — Studio Mode persistence and layout stability
- Steps: toggle Studio Mode with a custom layout; reload; second context.
- Expect: control column and docks keep their bounding boxes (±0 px) when the switch toggles; `studioflow.studio` persists across reload; independent per browser context.

**E2E-DOCK-09** · P2 · pw — Per browser, survives logout
- Steps: two contexts with different layouts; logout/login.
- Expect: each keeps its own layout; a layout survives logout and login; clearing site data resets.

**E2E-DOCK-10** · P2 · pw — Side zones and a hidden bottom zone
- Steps: move all docks to the right; to the left and right; hide the bottom zone docks; viewport 1280×720.
- Expect: stage height follows the monitors (no empty band), nothing overflows, program monitor still ≥ 160 px high, seams of the empty bottom zone are hidden.

**E2E-DOCK-11** · P2 · pw — Scroll-edge fades
- Steps: a dock with overflow (many scenes) and one without.
- Expect: top/bottom fade gradients exist only while more content can be scrolled in that direction.

### 2.10 MEDIA – Assets

**UNIT-MEDIA-01** · P0 · xunit — File name sanitiser [GAP-13]
- Steps: `../../etc/passwd.png`, `..\..\x.png`, `C:\x.png`, `/abs/x.png`, `x.png\0.exe`, 300-char names, `...`, `.hidden.png`, `CON.png`, `\u202egnp.exe`, emoji, empty, only dots, only spaces, HTML/JS content.
- Expect: result is a single path-free segment of 1–80 characters without control, bidi-override or path characters; empty/dot-only input yields the fallback name `Media`; extension in the *display name* is informational only; the stored file name is `{assetId}{ext derived from the verified type}`.

**UNIT-MEDIA-02** · P0 · xunit — Magic-byte detection [GAP-13]
- Steps: byte prefixes for PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`), WebP (`RIFF….WEBP`), MP4 (`….ftyp` brands `isom iso2 mp41 mp42 avc1 M4V`), WebM (`1A 45 DF A3` + DocType `webm`), and: SVG (plain, with BOM, with XML prolog), GIF87a/89a, BMP, TIFF, ICO, PDF, `MZ`, ZIP, HTML, JS, TXT, empty, 1 byte, truncated headers, `ftypheic`, `ftypavif`, `ftypqt  `, EBML `matroska`, RIFF `WAVE`.
- Expect: only the listed PNG/JPEG/WebP/MP4(brand allow-list)/WebM(DocType `webm`) are accepted with the correct kind and content type; everything else → unsupported (`unsupported_media`); truncated headers never throw.

**UNIT-MEDIA-03** · P1 · xunit — Dimension readers
- Steps: PNG IHDR, JPEG SOF0/SOF2 (baseline/progressive, with EXIF/thumbnail segments before SOF), WebP VP8/VP8L/VP8X, zero and absurd sizes (0×0, 60000×60000), corrupt segment lengths.
- Expect: correct width/height; zero or > 16384 in either dimension → rejected as unsupported [GAP-13]; corrupt data never loops forever or throws unexpected exceptions; videos report `null` dimensions.

**INT-MEDIA-01** · P0 · xunit — Upload happy paths
- Steps: upload `tiny.png`, `photo.jpg` (progressive), `photo.webp`, `clip.mp4`, `clip.webm` as multipart field `file`.
- Expect: 201 `AssetDto` (id `ast_…`, code `M1…M5`, kind, verified `contentType`, `sizeBytes`, width/height for images, `contentUrl` relative `/api/productions/{id}/assets/{id}/content`, name from the sanitised file name); file at `{root}/{productionId}/{assetId}.{png|jpg|webp|mp4|webm}`; events `assetUpserted` + `sourceUpserted`(media, `ok`); audit `asset.uploaded`; log entry.

**INT-MEDIA-02** · P0 · xunit — Rejections and spoofing
- Steps: upload every spoof file of 1.8 and the UNIT-MEDIA-02 negatives with matching and lying `Content-Type` headers (`image/png` for an SVG; `application/octet-stream` for a real PNG).
- Expect: the decision depends on the bytes only: SVG/GIF/EXE/HTML/… → 415 `unsupported_media` (ProblemDetails, nothing stored, no DB row, no event); a real PNG with a wrong header or a wrong extension is accepted as PNG; `heic.mp4`/`avif.mp4`/`mkv.webm` → 415; empty file → 415; no `file` part, wrong part name, two `file` parts, non-multipart body → 400 `validation_failed` / 415.

**INT-MEDIA-03** · P0 · xunit — Polyglots
- Steps: upload `png-with-js-trailer.png`, `jpeg-with-script-comment.jpg`, a GIF/JS polyglot, a PNG whose `tEXt` chunk holds `<svg onload=…>`; then `GET …/content`.
- Expect: GIF/JS polyglot rejected; the valid PNG/JPEG are accepted but always served with `Content-Type` equal to the verified type, `X-Content-Type-Options: nosniff` and `Content-Disposition: inline` with a sanitised file name; recommended `Content-Security-Policy: default-src 'none'; sandbox` present; the body is byte-identical to the upload (no rewriting).

**INT-MEDIA-04** · P0 · xunit — Size limits
- Steps: with `MaxImageBytes=1 MiB`, `MaxVideoBytes=2 MiB`: images/videos at limit−1, limit, limit+1; chunked body without length > limit; `Content-Length` lying low; a stream that throws if read beyond limit + 64 KiB.
- Expect: ≤ limit 201; above → 413 ProblemDetails; the request body is not read beyond limit + 64 KiB (streaming enforcement); the partial file is deleted (temp root empty of orphans); no DB row.

**INT-MEDIA-05** · P0 · xunit — Path traversal
- Steps: file names and asset ids from INT-AUTH-19; `GET …/assets/..%2f..%2fx/content`; rename to traversal strings.
- Expect: files only under `{root}/{productionId}/`; unknown ids → 404; renames sanitised; no file outside the root created or read (fake store captures every path).

**INT-MEDIA-06** · P0 · xunit — Content endpoint access and caching [GAP-13]
- Steps: admin cookie; `?k=` (right, wrong, other production's key); none; `HEAD`; conditional `If-None-Match`/`If-Modified-Since`.
- Expect: cookie → 200; right `k` → 200; none → 401; wrong or foreign `k` → 403; `Cache-Control: private, max-age=3600`; `ETag`/`Last-Modified` present and 304 on match; `Accept-Ranges: bytes`; `HEAD` answers like `GET` (status, `Content-Type`, `Content-Length`, `ETag`, `Accept-Ranges`, `Cache-Control`, `Content-Disposition`, CSP, nosniff) without a body, also with `Range` (206 and `Content-Range`) and without credentials (401) [BUG-16].

**INT-MEDIA-07** · P1 · xunit — Range requests
- Steps: `Range: bytes=0-99`, `bytes=100-`, `bytes=-50`, `bytes=0-0`, last byte, `bytes=999999999-`, `bytes=5-2`, `bytes=0-99,200-299`, garbage, `If-Range` with matching/mismatching validator; images and video.
- Expect: valid single range → 206 with `Content-Range: bytes a-b/total`, `Content-Length` = b−a+1, exact bytes; invalid/unsatisfiable → 416 with `Content-Range: bytes */total`; multi-range → first range only or 200 full (documented, not 500); garbage ignored → 200 full; `If-Range` mismatch → 200 full.

**INT-MEDIA-08** · P0 · xunit — In-use protection
- Steps: asset used as an item source, as scene background, as slate background, as fallback; delete each; remove references; delete again; delete unknown; delete while a range request is streaming.
- Expect: 409 `asset_in_use` for each reference (ProblemDetails names the usage kind), nothing deleted; afterwards 204, file removed from disk, `assetRemoved` + `sourceRemoved`, audit `asset.deleted`, code freed; unknown 404; deletion during streaming does not 500.

**INT-MEDIA-09** · P1 · xunit — Rename
- Steps: valid name, 80/81 chars, empty, whitespace, XSS strings, traversal strings.
- Expect: 200, `assetUpserted` and `sourceUpserted` (label updated); invalid → 400 `validation_failed`; sanitisation as UNIT-MEDIA-01; code unchanged.

**INT-MEDIA-10** · P2 · xunit — Concurrency and persistence
- Steps: 10 parallel uploads; restart the host on the same root/DB; list and fetch.
- Expect: unique ids/codes, intact files, `sizeBytes` matches disk; after restart listing and content unchanged.

**INT-MEDIA-11** · P2 · xunit — Storage failures
- Steps: fake store throws `IOException`/disk full mid-upload; read-only root.
- Expect: 500 ProblemDetails without paths; no orphan file or DB row; later uploads work after recovery.

**INT-MEDIA-12** · P2 · xunit — Dimension limits [GAP-13]
- Steps: `png-bomb.png` (60000×60000 header), 16384×16384, 16385×1.
- Expect: > 16384 in a dimension → 415 `unsupported_media`; at the limit accepted.

**E2E-MEDIA-01** · P1 · pw — Upload through the UI
- Steps: upload `tiny.png`, `photo.jpg`, `photo.webp`, `clip.mp4`, `clip.webm` through the Sources dock upload control or drag-and-drop ([GAP-37] “+ Source” → “Upload image or video…”).
- Expect: five sources M1…M5 appear (image/video icons) in “+ Source” menus within 2 s with thumbnails; progress state while uploading; success toast; both operators see them.

**E2E-MEDIA-02** · P1 · pw — Rejections are explained
- Steps: SVG, GIF, EXE, `exe-as-png.png`, `svg-as-png.png`, an oversize file (profile `Media:MaxImageBytes` = 1 MiB).
- Expect: no source is created; error toast per file naming the reason (`/type|allowed/i` or `/large/i`, [GAP-27]); the rest of a multi-file drop still uploads.

**E2E-MEDIA-03** · P0 · pw — Image on air
- Steps: image in a program scene (cover and contain), output open; wrong key variant.
- Expect: `<img>` natural size > 0 in Program monitor and output; requests carry `?k=` on the output and the cookie in the Regie; wrong key → dark placeholder, no broken-image icon; cached on second view (memory/disk cache or 304).

**E2E-MEDIA-04** · P1 · pw — Video on air
- Steps: 3 s video in a program scene; observe 8 s.
- Expect: `<video>` muted, `loop`, playing in Regie and output; `currentTime` wraps; requests use Range (206); no audio (a clip without sound; one with sound: AUD-15).

**E2E-MEDIA-05** · P1 · pw — Used asset cannot be deleted
- Steps: delete an asset used in a scene (control in the source/asset list [GAP-37]), then remove the item and delete again.
- Expect: blocked with a message mentioning the use (`/in use/i`), asset stays; after removal deletion works and disappears for both operators.

**E2E-MEDIA-06** · P2 · pw — Asset as fallback and slate background
- Steps: set “Break slate” as `onLost.fallbackSource`, as standby slate background, as scene background.
- Expect: output shows them as in E2E-OUT-07/-11; deletion blocked while in use.

**E2E-MEDIA-07** · P1 · pw — Large upload and body limits
- Steps: upload a 200 MB MP4 (generated with ffmpeg, MaxVideoBytes default 1 GB); watch `docker.stats('api')`; raw TLS requests (headers only) with `Content-Length: 1153433601` (`STUDIOFLOW_MAX_UPLOAD` 1100 MiB + 1) and `1073741825` (`MEDIA__MAXVIDEOBYTES` 1 GiB + 1) to the asset route; a 5 MB and an 11 MB JSON `POST` to a normal route.
- Expect: upload succeeds, API RSS grows by ≤ 100 MB (streaming); the first raw request gets 413 from Caddy before any body is sent, the second 413 from the API; the 5 MB JSON request gets 413 from the API (256 KB limit), the 11 MB one from Caddy (`STUDIOFLOW_MAX_BODY` 10 MB); the 4 MB bandwidth test still passes.

**E2E-MEDIA-08** · P2 · pw — Seeking
- Steps: seek the video in a monitor to 2 s.
- Expect: a Range request for the new offset (206), playback continues from there without downloading the file again.

**E2E-MEDIA-09** · P1 · pw — Hostile file names
- Steps: upload `"><img src=x onerror=window.__xss=1>.png` and a name with `\u202e`.
- Expect: displayed literally and sanitised per UNIT-MEDIA-01; no execution.

**E2E-MEDIA-10** · P1 · pw — Opening an asset URL directly
- Steps: navigate a tab to the content URL of `png-with-js-trailer.png` and of a video.
- Expect: image/video rendered by the browser, no script runs, no download prompt for images, `Content-Type` correct.

### 2.11 OPS – Operations

The stack is started and operated as an operator does (issue #27): `docker compose up -d` with no `.env` and no script, set up through the first-run wizard, backed up and restored with `docker compose run --rm backup ...`, updated with `docker compose pull && docker compose up -d`. The specs therefore need Docker and nothing else on the host; they call `docker compose` and `docker` through the `compose`/`docker` helpers of `tests/e2e/support/stack.ts` and `ops.ts` (the same on Linux, macOS and Windows) and use a browser only where a test says so. The harness itself starts every stack this way and completes the wizard through the admin API (`tests/e2e/README.md`); the `ops-wizard` specs start from nothing and do it by hand. Files: `ops-static.spec.ts` (compose and image contents, no stack changes), `ops-stack.disruptive.spec.ts`, `ops-backup.disruptive.spec.ts`, `ops-update.disruptive.spec.ts`, `ops-wizard.disruptive.spec.ts`, `ops-address.spec.ts`.

**E2E-OPS-01** · P0 · pw — Compose files are zero-config and consistent
- Steps: `docker compose config --format json` of `docker-compose.yml` and `docker-compose.release.yml` with an empty environment and no `.env`; compare the two; extract all `${VAR}` references and compare them with `.env.example`.
- Expect: both files are valid with no variable and no `.env` (no `${VAR:?…}`); the release file names `ghcr.io/opten/studioflow-{web,api,livekit,backup}:latest`, carries no version marker and differs from the build file only in `image`/`build` and the missing `netem`; images are pinned (`livekit/livekit-server:v…` in the LiveKit Dockerfile, `postgres:17.x-alpine`, never `latest` for third-party images); every long-running service has `restart: unless-stopped`, a `healthcheck`, `no-new-privileges` and `cap_drop: ALL` (postgres adds back only `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID` for the entrypoint of the official image, BUG-22; the backup service `CHOWN`, `DAC_OVERRIDE`, `DAC_READ_SEARCH`, `FOWNER`), and waits for `init` (`service_completed_successfully`); every variable of the Compose files is documented in `.env.example` with an empty value, and `.env.example` holds no secret and none of the retired variables (`STUDIOFLOW_DOMAIN`, `STUDIOFLOW_NODE_IP`, `STUDIOFLOW_TLS_MODE`, DNS tokens, `STUDIOFLOW_FRAME_ANCESTORS`, `COMPOSE_PROFILES`, `BACKUP_SCHEDULE`).

**E2E-OPS-02, E2E-OPS-03** — retired by #27: the `setup` scripts do not exist any more. What they covered is now E2E-OPS-31 (no script), -34 (secrets), WIZ-01 and OPS-38 to -41 (the settings and their validation).

**E2E-OPS-04** · P0 · pw — Fresh machine start
- Steps: `docker compose down --volumes`; `docker compose up -d` with no variable (images built or pulled already); measure; read the logs of `init` and of every service.
- Expect: the `init` service made `postgres-password`, `livekit-api-key` and `livekit-api-secret` (`secrets: <name> created`, no value in any log; files mode 600, owner uid 1654) and exited 0; all five services are healthy within 120 s; `GET /health/ready` 200; `/` serves the Regie (by the name `localhost` and by `127.0.0.1`, a certificate of the local CA made on demand) within a minute (Caddy answers 503 “starting” until the API has pushed its configuration); the first-run setup is open (`GET /api/auth/setup` answers `{"setupRequired":true}`, the API log has `Setup code: XXXX-XXXX`, `GET /api/settings` is 401); `/ca.crt` is downloadable before anybody has signed in.

**E2E-OPS-05** · P1 · pw — Healthchecks are real
- Steps: `docker inspect` health of each container; then show that each check exercises its service ([command] tests, DOC-07): run the healthcheck command inside the running container (exit 0) and in a container of the same image without the service (exit ≠ 0); `docker pause` of each service (reported unhealthy within interval × retries, healthy again after `unpause`); `docker compose stop postgres` then `up -d api` (ordering).
- Expect: caddy, api, livekit, postgres and backup report `healthy`, `init` has exited 0; each check fails when its service is missing (`pg_isready` over TCP, API `GET /health/live` on 127.0.0.1:8080, LiveKit `GET /` on 127.0.0.1:7880, Caddy's loopback `127.0.0.1:2020/healthz` from the image, the scheduler process of the backup service); `depends_on` ordering: with postgres stopped `docker compose up -d api` runs `init`, starts postgres first and the API only after it is healthy.

**E2E-OPS-06** · P0 · pw — Restart policy and volumes
- Steps: crash each service (`kill -TERM 1` inside the container, `kill -QUIT 1` for PostgreSQL; since Docker 29 a `docker kill` counts as a manual stop and the restart policy does not bring the container back [DOC-04]); `docker compose down` then `up -d`; restart Caddy.
- Expect: each service is running again ≤ 20 s and healthy ≤ 60 s; a restarted Caddy gets its configuration back from the API without anybody touching it; after `down`/`up` scenes, devices, assets, Data Protection keys (admin session still valid), the Caddy certificate (same serial), the secrets and PostgreSQL data persist; the volumes are `caddy_config`, `caddy_data`, `keys`, `media`, `pgdata`, `secrets` (plus `caddy_certs`, `livekit_config`, `backup_config`, `backups`, `backup_status`).

**E2E-OPS-07** · P0 · pw — Backup now
- Steps: seed data (scenes, 2 devices, image + video asset); `docker compose run --rm backup backup-now` while the stack is running and the Regie is used; twice within a minute; with PostgreSQL stopped; with a wrong database password (the job of an automatic run).
- Expect: exit 0; folder `YYYY-MM-DD_HHMM_manual/` (a second run within the same minute gets the suffix `-2`) containing `database.dump` (valid `pg_restore --list`), `keys.tar.gz`, `caddy_data.tar.gz`, `backup-info.txt` and `SHA256SUMS` (all checksums verify), and the media as an incremental copy in `media/` next to it; `backup-info.txt` names the PostgreSQL version; the Regie stays responsive during the backup; `list` shows the folder; PostgreSQL stopped → exit ≠ 0 with the reason and no partial folder; a failed run is recorded (`lastAttempt.ok` false with `pg_dump failed.`), `/health/ready` names the failure while automatic backups are on, and the next successful run clears it; the secrets of the stack are not part of the backup.

**E2E-OPS-08** · P0 · pw — Restore round trip
- Steps: seed (production with 5 scenes, 2 devices with known credentials, 2 assets, rotated output key, ended broadcast); `backup-now`; change everything; (a) `restore <folder> --yes` while the API runs; (b) `docker compose stop caddy api livekit`, restore, `up -d`; (c) `docker compose down -v`, `up -d`, stop the three, restore into the new volumes; also a corrupted dump with a matching checksum, restore without `--yes` and without a terminal, restore while a broadcast is live (without and with `--force`), invalid calls (no folder, a missing folder, a folder without `SHA256SUMS`, an unknown option).
- Expect: (a) exit 1 with “The API is running” and the exact `docker compose stop caddy api livekit` command, nothing changed; (b) snapshot JSON equal to the pre-backup snapshot (ignoring revision and server time); devices recognised with their old credentials; assets byte-identical (SHA-256), taken from the incremental copy (“Volume media from the incremental copy”); the old output URL works and the rotated one does not; the admin session from before the backup is still valid (keys volume) and the Caddy certificate is the old one; audit rows present; the settings of the wizard come back with the database; a safety backup `…_pre-restore` of the current state is written first (not with `--no-safety-backup`); (c) the same on fresh volumes with new secrets; a checksum mismatch aborts before anything is touched; a corrupted dump exits ≠ 0 with “pg_restore failed. The previous database is unchanged.” and no half-restored database; a live broadcast blocks the restore unless `--force`; without `--yes` and without a terminal the command aborts changing nothing.

**E2E-OPS-09** · P0 · pw — Update with `docker compose pull && docker compose up -d` [GAP-31]
- Steps: seed data and a paired phone; (a) `up -d --force-recreate` of all services (what an update does with new images); (b) the same while a broadcast is live; (c) `docker compose pull` against a registry that cannot be reached; (d) the release file against the running stack, with the images tagged as a release would be (`--pull never` stands in for the pull).
- Expect: (a) scenes, devices, assets, admin session, certificate, secrets, settings and backups unchanged, the volumes retained; (b) the broadcast is still live afterwards: nothing refuses or waits (the runbook says never to update during a broadcast, section 8; the operator picks the moment and checks with `broadcast-status` of the API image, exit code 3 = live); (c) the pull fails and the running stack and its images are unchanged; (d) the containers run the four release images, the same volumes, secrets and settings, no `.env`, device credentials valid.

**E2E-OPS-10** · P2 · pw — Update with a new migration
- Steps: build a variant image with an extra EF migration; `docker compose up -d`.
- Expect: migration applied at API start, data preserved, health green; a downgrade (older image on newer schema) is rejected with a clear log message rather than corrupting data.

**E2E-OPS-11** · P1 · pw — Certificate modes
- Steps: (a) local certificate: HTTPS works with Caddy's local CA by the IP address and by a saved domain, `https://<host>:<port>/ca.crt` returns the root certificate (and `root.key` is not reachable); (b) `dns-cloudflare` without a token, with a token of the wrong shape, and with an unknown field; (c) `custom` without a certificate; a mode that does not exist (`acme`, `http`, `foo`); (d) an uploaded certificate (E2E-OPS-40).
- Expect: (a) works; (b)(c) the settings are refused with 400 `validation_failed`, the field and the code, and nothing is saved; no certificate warning after trusting the CA (manual MAN-05 for real devices); HTTP-01 does not exist (nothing listens on port 80, E2E-OPS-31). Covered by E2E-OPS-38, -40 and WIZ-01/02; the DNS challenge against a real provider is manual.

**E2E-OPS-12** · P0 · pw — Network exposure
- Steps: `docker compose config` of both files and `docker port` on the stack; probes from the LAN address of the machine.
- Expect (static): caddy and livekit are on the network `studioflow` only, postgres and backup on `backend` only, the api on both; the volume `caddy_admin` (the admin socket of Caddy) is mounted by caddy, api and init only, as is `caddy_certs`; the API reaches the admin API through `INSTALL__CADDYADMINSOCKET` and no `admin` directive of the Caddy files is a TCP address.
- Expect: published ports: caddy `${STUDIOFLOW_HTTPS_PORT}` tcp and udp (HTTP/3), livekit 7881/tcp and 7882/udp only; api 8080, postgres 5432, livekit 7880 and Caddy's loopback health listener (2020) are not published, the admin API has no port at all; `init` and `backup` publish nothing; from the LAN address those ports and the ports 80 and 443 (on a stack that does not use 443) are closed, the HTTPS port and 7881 are open.

**E2E-OPS-13** · P1 · pw — Container hardening
- Steps: `docker exec api id -u`; inspect images and containers; search images, `docker history`, environments and logs for the secrets of the stack.
- Expect: the API and LiveKit run as non-root (uid ≠ 0); every container runs with `no-new-privileges` and `cap_drop: ALL` (postgres and the backup service with the `cap_add` of E2E-OPS-01 only; the server process of postgres runs as `postgres`, BUG-22); the secrets (database password, LiveKit key pair) are in files of the volume `secrets` (mode 600, owner = the API user) and in no container environment, image layer, `docker history`, log or answer; `.dockerignore` excludes `.env`, `.git`, `node_modules`.

**E2E-OPS-14** · P1 · pw — Logs after a full scenario
- Steps: run the soak-light scenario (pairing, switching, uploads, block, key rotation, restarts) and read `docker compose logs`.
- Expect: no device secret, output key, password, LiveKit secret, JWT, `access_token` or `k` value; no stack traces for expected 4xx; log level default Information; structured templates (no string concatenation of secrets); Caddy access log redacts `access_token`/`k`.

**E2E-OPS-15** · P1 · pw — Regie account commands
- Steps: `dotnet Opten.StudioFlow.Web.dll reset-admin` in the api image without `--yes` and with an empty stdin; with `--yes` and an unreachable database (the password in the connection string is a known probe); `docker inspect` of the running api container.
- Expect: the unconfirmed run prints "Type yes to continue", exits 2 and says the account was not changed; the unreachable database exits 1 and the output holds no connection string or password; the api container has no `ADMIN__USERNAME`/`ADMIN__PASSWORD` variable. The reset on the running stack is `E2E-AUTH-30`.

**E2E-OPS-16** · P1 · pw — No external requests at runtime
- Steps: run the stack on a Docker network created with `--internal` (no egress) with the local certificate; open Regie, sender, output; record all requests.
- Expect: everything works; every request (including fonts, icons, scripts, source maps) goes to the stack origin; no DNS lookups for foreign hosts from the browser; the containers make no outbound connections other than to each other (checked via `docker network inspect` / `ss` in the containers).

**E2E-OPS-17** · P2 · pw — Idle resource baseline
- Steps: 6 devices connected idle 5 min; `docker stats`.
- Expect: informational limits: api ≤ 300 MB RSS, livekit ≤ 300 MB, caddy ≤ 100 MB, postgres ≤ 300 MB, backup ≤ 100 MB; CPU idle < 10 % each; values recorded.

**E2E-OPS-18** · P1 · pw — Host header and AllowedHosts
- Steps: request the stack with `Host: evil.example` (direct to the published API port in the test override) and through Caddy with a foreign SNI.
- Expect: API answers 400 when `AllowedHosts` is restricted to the saved domain (the repository default `*` is flagged); Caddy answers a name it has no site for with the catch-all site (local certificate, same application), which is why the CSP and the LiveKit URL follow the Host the caller used (E2E-OPS-42).

**E2E-OPS-19** · P2 · pw — Time zone and clock
- Steps: compare `date` in containers with the host; Regie clock vs `ServerTime`.
- Expect: containers UTC; API timestamps ISO-8601 with offset; Regie clock shows browser local time in 24 h.

Backups (runbook section 7). The backup service is part of the stack; its schedule and its off-site target come from the server settings (the API writes them into the volume `backup_config`). The commands run in the same image: `docker compose run --rm backup backup-now | list | restore`.

**E2E-OPS-20** · P1 · pw — The backup service in the compose file; shell code and configuration files
- Steps: `docker compose config`; read the shell scripts, compose, `.env.example` and Renovate files.
- Expect: the service is part of the default stack; `restart: unless-stopped`, a healthcheck, `no-new-privileges`, `cap_drop: ALL` with `cap_add` `CHOWN`, `DAC_OVERRIDE`, `DAC_READ_SEARCH`, `FOWNER` only, a read-only root file system, publishes nothing, depends on `init` and a healthy postgres, mounts `media`, `keys` and `caddy_data` read-write (restore replaces them; no other service mounts them that way) and is built from the PostgreSQL image of the stack (`POSTGRES_IMAGE`); the API mounts `backup_status` read-only and never `backups`; all shell code and configuration are ASCII only (D9), the shell scripts pass `bash -n`, have LF line endings and the executable bit in the repository; image pins may carry a digest (Renovate).

**E2E-OPS-21** · P1 · pw (no stack) — Retention by days and weeks
- Steps: `sf_backup_expired 7 4` over 30 daily backups, a second backup on the last day and a foreign name; `2 1` over backups with gaps; empty input.
- Expect: the newest backup of each of the last 7 days and of the last 4 ISO weeks stays (here: 23 to 17 October, 11 and 4 October), the older backup of a day and everything else is listed for deletion; days and weeks without a backup are not counted; a name that is not a backup is never listed.

**E2E-OPS-22** · P0 · pw (no stack) — Checksum check and folder names
- Steps: `sf_backup_write_checksums` and `sf_backup_check_checksums` on an intact folder, with a changed file, a missing file and an entry that leaves the folder; `sf_backup_unique_dir` twice within a minute.
- Expect: the intact folder passes; the first problem is named (`Checksum mismatch: keys.tar.gz`, `File listed in SHA256SUMS is missing: ...`, `Invalid entry in SHA256SUMS: ../escape`); the second folder of a minute gets `-2`.

**E2E-OPS-23** · P0 · pw — Schedule creates a backup, status and readiness
- Steps: save the schedule `* * * * *` (time zone Europe/Zurich) through `PUT /api/settings/backup`; wait for the first backup; read the folder, the status file and `GET /health/ready`; switch the schedule off.
- Expect: the backup service takes the settings over (`GET /api/settings/status`); a folder `..._auto` with `database.dump`, `keys.tar.gz`, `caddy_data.tar.gz`, `backup-info.txt` and `SHA256SUMS` (no `media.tar.gz`); the log reports the verification of the dump; `lastSuccess` and `lastAttempt.ok` in the status file; `/health/ready` is 200 with `Degraded` and the hint that no off-site copy is configured (a warning, no outage); with the schedule empty the scheduler says “Automatic backups are off”.

**E2E-OPS-24** · P0 · pw — `restore --verify` detects damage
- Steps: a flipped byte in `database.dump`; a changed `keys.tar.gz`; a truncated dump with a rewritten checksum; a folder without `SHA256SUMS`.
- Expect: exit 1 with `Checksum mismatch: database.dump`, `Checksum mismatch: keys.tar.gz`, `The dump could not be loaded` and `SHA256SUMS is missing`; no throwaway database is left; nothing is stopped.

**E2E-OPS-25** · P1 · pw — Retention in the service
- Steps: keep 2 daily and 1 weekly backup (settings); six old `_auto` folders with `SHA256SUMS`, a manual and a safety folder, an unfinished `_auto` folder and a foreign folder; run the job.
- Expect: the new backup and the newest old one remain; the other old `_auto` folders and the unfinished folder are removed; the manual, the safety and the foreign folder stay.

**E2E-OPS-26** · P0 · pw — No automatic backup during a broadcast
- Steps: start the broadcast of a production, run the job (`--label auto`), wait; end the broadcast.
- Expect: while live no folder is created, the status file says `postponed` with `postponedSince` and `GET /api/settings/backups` says `postponed`; after the end the backup runs, exit 0, the state is `idle`. A manual backup does not wait.

**E2E-OPS-27** — merged into E2E-OPS-07 (a failed run is visible).

**E2E-OPS-28** · P1 · pw — Off-site copy with age; refusal of unsafe settings
- Steps: an rclone remote of type `local` and a generated age key; save the settings; upload an image; run the job twice; decrypt with the private key outside the stack; save a remote with no key.
- Expect: the settings with a remote and no key are refused (400, `age_recipient_required`) and never return the rclone configuration; only `.age` files and `SHA256SUMS` at the target, one dated folder (the older one pruned), the media file once and not again on the second run; the decrypted files pass `restore --verify` and the image equals the upload; `/health/ready` is plain `Healthy`.

**E2E-OPS-29** — merged into E2E-OPS-08 (restore with the media from the incremental copy).

**E2E-OPS-30** — reserved.

**E2E-OPS-31** · P0 · pw — No host scripts, no Docker socket, no port 80
- Steps: look for `setup`, `update`, `backup`, `restore` (`.sh`, `.ps1`) and `infra/scripts`; read the compose files; `docker inspect` of the running containers; probe the ports from inside the stack and the host.
- Expect: none of the scripts exists and no compose file refers to one; no service mounts the Docker socket, runs privileged or joins the host network; no running container has the socket; nothing listens on port 80, and Caddy listens only on the HTTPS port (and on the health port inside the container); there is no TCP listener on 2019.

**E2E-OPS-32** · P0 · pw — The Caddy admin API is a unix socket that only Caddy and the API can use [issue 70]
- Steps: `stat` of the socket and its folder in the Caddy container; which containers mount the volume `caddy_admin`; `GET /api/settings/status` (the API applied the configuration through the socket); `GET http://caddy:2019/config/` and `http://<Caddy's address>:2019/config/` from the LiveKit container and from a throw-away container on the `studioflow` network; `http://postgres:5432/` from both; `/config/` through the HTTPS port; port 2019 on the LAN address of the machine.
- Expect: the socket is `660 10001:10002` in a folder `770 1654:10002`; only caddy, api and init mount the volume; Caddy applied the configuration; every probe from LiveKit and from the throw-away container fails (connection refused for 2019, name not resolvable for postgres) and shows no configuration; the HTTPS port answers `/config/` with the page of the Regie (the admin routes are not part of the public site); port 2019 is closed on the LAN address.

**E2E-OPS-33** — reserved.

**E2E-OPS-34** · P0 · pw — Secrets are made exactly once
- Steps: read the hashes of the three secrets; `docker compose run --rm init`; recreate `postgres` and `api`; in a second project with new volumes run `init` with `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` set (the values of an old `.env`), then again with other values.
- Expect: three different secrets; the second run of `init` prints `secrets: ready` and creates nothing; the hashes are unchanged after every step; the database still opens with the stored password and the API reads the secrets; in the new project the first run adopts the three given values (mode 600, owner uid 1654) and the second run keeps them.

**E2E-OPS-35** · P0 · pw — A taken port is named
- Steps: stop Caddy, listen on the HTTPS port with another program, `docker compose up -d caddy`; release the port, `up -d --force-recreate caddy`.
- Expect: the start fails with Docker's own message that names the port (`address already in use` / `port is already allocated`) and Caddy is not running; after the port is free `--force-recreate` brings Caddy up and the stack answers on the port (with Docker 29 a plain `up -d` starts the container that failed without its network, runbook section 11).

**E2E-OPS-36** · P0 · pw — The settings survive restarts
- Steps: read the settings; `restart api`; `down` and `up -d`.
- Expect: the settings are equal after each step (media address, domain, embedding); the site answers under the saved address with the embedding origins in the CSP; LiveKit announces the saved media address.

**E2E-OPS-37** · P0 · pw — "Back up now"
- Steps: `POST /api/settings/backups`; wait for the folder; `GET /api/settings/backups`; `restore --verify` of the new folder.
- Expect: 202; a `_manual` folder appears and is listed with its kind; `backup.requested` is in the audit log; the backup verifies.

**E2E-OPS-38** · P0 · pw — Setup code, authentication and validation of the settings
- Steps: (stack, fresh) a wrong setup code five times from one address, then the right code; a wrong code from another address; every settings route without a session; `/internal/tls/ask` through the HTTPS port and on the compose network; (api) every input of the media, address, certificate, embedding and backup settings with invalid values (wrong IPv4 forms, unknown mode, `acme`, `http`, an IP as domain, missing or malformed credentials, an unknown credential field, a bad e-mail, custom without a certificate, malformed and too many origins, schedules, time zones, retention, remotes, rclone configurations, age keys); a change without the `X-StudioFlow` header.
- Expect: the first four wrong codes are 403 `setup_code_invalid`, the fifth is refused as well, then even the right code is 429 with `Retry-After` and no account exists, while another address is not locked out; every settings route is 401 without the admin session; the internal route is not part of the public site (the Regie page answers) and the API answers Caddy with 200 on the compose network; every invalid input is 400 `validation_failed` with the field and a code, `GET /api/settings` is equal before and after, and a change without the CSRF header is 403.

**E2E-OPS-39** · P0 · pw — Secrets of the settings are never shown
- Steps: save DNS credentials and an rclone configuration with known probe values; read every settings answer, the `server_settings` table, the logs of all services and the audit details.
- Expect: the probe values appear nowhere (the table holds them encrypted); the answers say only that a credential is stored.

**E2E-OPS-40** · P0 · pw — An uploaded certificate
- Steps: upload a certificate and key made for the test (`support/selfsigned.ts`): nonsense, a key that is no key, a key with a password, a key of another certificate, a certificate for another name, an expired and a not-yet-valid one, the mode `custom` without a stored certificate, then a valid one; look at the certificate Caddy presents for the name; switch back to the local certificate.
- Expect: each invalid upload is 400 with its field and code (`certificate_invalid`, `private_key_invalid`, `private_key_encrypted`, `certificate_key_mismatch`, `certificate_name_mismatch`, `certificate_expired`, `certificate_not_yet_valid`); the valid one is stored (subject, names and fingerprint in the answer, the key never) and, with the mode `custom`, presented by Caddy for its name (fingerprint equal) within seconds; after switching back the certificate of the local CA is presented and the stored one is gone.

**E2E-OPS-41** · P0 · pw — The media address
- Steps: save another IPv4 address; start a test and end it; start a test with an invalid address; start a test and save while a broadcast is live.
- Expect: `livekit.yaml` holds the saved address and the key pair of the secrets volume; after a save LiveKit restarts and announces the new IP (`nodeIP` in its log), `GET /api/settings/status` says it runs the saved file, and the address devices open does not change; a test announces the candidate (two tokens for two throw-away participants) and ending it brings the saved address back; an invalid address is 400; both a test and a save are refused with 409 `broadcast_live` while a broadcast is live and change nothing.

**E2E-OPS-42** · P0 · pw — The address the page was opened with (issue 44)
- Steps: log in and fetch the LiveKit tokens of the Regie and of the output through `https://localhost`, `https://127.0.0.1` and the LAN address of the machine; read the CSP of `/`, `/join/` and `/o/…` under the same names; open the Regie by `https://127.0.0.1:<port>` in a browser and watch its WebSockets and CSP violations.
- Expect: the `url` of every token is `wss://<the Host of the request>` (also for a call that arrives as plain http, such as the direct API port of the suite: the scheme comes from the public base URL; API unit tests cover IPv4, IPv6, names, ports and malformed hosts); every page names that host in `connect-src` (`https://` and `wss://`); the Regie opens its LiveKit connection on `wss://127.0.0.1:<port>/rtc` and no Content-Security-Policy violation or console error occurs.

**E2E-OPS-43** · P0 · pw — Every link starts with the saved address
- Steps: `GET /api/system/info`; create a laptop invite link and an output link; read the invites of the snapshot.
- Expect: all of them start with `https://<saved domain or media address>:<HTTPS port>` (no suffix for 443), never with a built-in default; the shipped `appsettings.json` holds no `StudioFlow:PublicBaseUrl`, `StudioFlow:FrameAncestors` or `LiveKit:PublicUrl` override (API unit test).

**E2E-WIZ-01** · P0 · pw — The first-run wizard
- Steps: on a fresh stack open the Regie by the IP address and walk through the four steps: the account with the setup code from the API log; the media address (the suggestion, an invalid value, a wrong address with “Test connection”, the right one); the address (local certificate, a domain; the warning for paired devices); the embedding origins (an invalid line, valid lines).
- Expect: each step is saved when continued and refused with the reason when invalid; the media test runs a real WebRTC round trip through the media server and names the stage that failed (signalling, transport, data) for a wrong address; the last step shows “The server is ready” and opens the Regie; the wizard never opens again (`/setup/server` leads to `/`); the settings are what the steps saved and Caddy and LiveKit run them.

**E2E-WIZ-02** · P0 · pw — Server settings
- Steps: production menu › Server settings: the services, the sections, a provider's own credential fields, the warning for paired devices, an own certificate (a key with a password is refused with the reason, then a valid one is served), switching back, “Back up now”.
- Expect: the three services show “runs the saved settings”; the sections show the saved values; a provider shows its fields and needs the domain; the uploaded certificate is presented by Caddy for its name and shown as “Current certificate”; after switching back it is not presented any more; a new manual backup appears in the list.

API unit tests (xUnit, `BackupHealthTests`): the readiness check is healthy when automatic backups are off or everything is recent, and Degraded (never an exception) for a missing, unreadable or empty status file, a failed last run, a last backup or off-site copy older than `Backup:WarnAfterHours`, a missing off-site target and no backup after the grace period; `/health/ready` prints `Healthy` alone or the status followed by one line per failing check. The other tests of the server settings are in `ServerSettingsServiceTests` (Core), `ServerSettingsApiTests` and `LiveKitTokenIssuerTests` (Web), the Studio tests in `apps/studio/src/app/server/` and the media round trip in `packages/media-client`.

### 2.12 SYNC – Realtime protocol and state model

**UNIT-SYNC-01** · P0 · vitest — Reducer applies every event type
- Steps: for each of the 20 event types (`productionChanged`, `programSwitched`, `sceneUpserted`, `sceneRemoved`, `scenesReordered`, `sourceUpserted`, `sourceRemoved`, `deviceUpserted`, `deviceRemoved`, `assetUpserted`, `assetRemoved`, `pairingRequestUpserted`, `pairingRequestRemoved`, `inviteUpserted`, `inviteRemoved`, `incidentUpserted`, `incidentRemoved`, `outputStatusChanged`, `logAppended`, `revisionOnly`) apply with revision = local+1, = local, < local, = local+2.
- Expect: +1 → `applied` and the specific change (e.g. `programSwitched` sets program, preview, `lastTransition`, `lastSwitchAt`; `sceneUpserted` replaces or inserts ordered by `SortOrder`; `scenesReordered` rewrites `SortOrder`, unknown ids ignored, missing ids appended; `logAppended` newest first capped at 20; `revisionOnly` only revision); `≤ local` → `ignored` and the state object is the same reference; `> local+1` → `gap` and the state is unchanged; inputs are never mutated; untouched slices keep identity (structural sharing).

**UNIT-SYNC-02** · P0 · vitest — Snapshots and indexes
- Steps: `stateFromSnapshot`, `stateFromOutputSnapshot`, `applyTelemetry`.
- Expect: scenes ordered by `SortOrder`; `sourcesById` index; `serverOffsetMs = serverTime − receivedAtMs`; output state has no devices/pairing/incidents; telemetry is stored per device without touching the revision.

**UNIT-SYNC-03** · P1 · vitest — Selectors
- Steps: `programScene`, `previewScene`, `sourcesInScene`, `isSourceVisibleIn`, `sceneHealth`, `tallyOf`, `incidentPlace`, `stationOrder`, `isDown`.
- Expect: `sceneHealth` returns the worst down source (red beats amber, first by item order within a class); `incidentPlace` → “on Program” | “in Preview” | “not live” (hidden items do not count); `stationOrder`: open red (0), open amber (1), recovered (2), connecting (3), in program (4), in preview (5), rest (6), ties by code (`localeCompare`); `isDown` true for `reconnecting|ended|lost|blocked`.

**UNIT-SYNC-04** · P1 · vitest — Formatting in English and German
- Steps: `formatDuration`, `formatRuntime`, `formatClock`, `formatHm`, `formatSeconds`, `formatRate`, `formatCheckCode`, `statusWord`.
- Expect: in English: `formatDuration(59_000)` “00:59”, 60 s “01:00”, 3599 s “59:59”, 3600 s “1:00:00”, negative “00:00”; `formatRuntime(3_725_000)` “01:02:05”; `formatSeconds(300)` “0.3 s”, 1000 “1 s”, 1500 “1.5 s”, 2000 “2 s”; `formatRate(2.8)` “2.8”, `formatRate(2)` “2.0”; `formatCheckCode('4712')` “47 12”, other lengths returned unchanged; `statusWord`: reconnecting “reconnecting”, ended “sharing stopped” (camera: “camera stopped”), blocked “blocked”, connecting “connecting…”, lost “no picture”, offline “not connected”, ok “”; in German (`resetLocaleForTests('de-CH')`) the same functions return the decimal comma (“0.3 s”, “2.8”, “2.0”) and the German status words; both locales use the 24 h clock.

**INT-SYNC-01** · P0 · xunit — Studio hub subscribe, presence, resync
- Steps: `Subscribe` for known/unknown production; two clients connect/disconnect (clean and TCP kill); `activateProduction` another production.
- Expect: unknown → `HubException`; snapshot equals REST snapshot; `presence` announced on connect/disconnect with the right count (abrupt disconnect decrements within 8 s); `resync` (payload = production id) sent to connected Regie sessions on activation.

**INT-SYNC-02** · P0 · xunit — Output hub filtering [GAP-07]
- Steps: subscribe an output client; trigger one action per event type (pair a device, create invite, incident, log, output status, scene change, asset upload, program switch, slate change); a second production in parallel.
- Expect: output receives the full event only for `productionChanged`, `programSwitched`, scene events, asset events and source label/code changes; devices, pairing, invites, incidents, log and output-status events arrive as `revisionOnly` with the *same* revision; the payloads never contain device names/ids, pairing names, invite URLs, incident or log text; `OutputSnapshot` has no device data; events of the other production never arrive; after key rotation the hub is closed.

**INT-SYNC-03** · P1 · xunit — JSON protocol shape
- Steps: capture raw hub frames (custom `WebSocket` transport); compare with the contracts.
- Expect: property names camelCase, enums as camelCase strings (never numbers), polymorphic events carry `type` with the exact discriminators (`programSwitched` …), timestamps ISO-8601; unknown client fields ignored; a client message > 64 KiB closes that connection without affecting others.

**INT-SYNC-04** · P2 · xunit — Keep-alive and timeouts
- Steps: raw WebSocket client that completes the handshake and then sends nothing; another that answers pings.
- Expect: server keep-alive ping every 2 s; the silent client is closed after 5 s ± 1 s; the answering client stays; options match `KeepAliveInterval = 2 s`, `ClientTimeoutInterval = 5 s` (spec 6/12, GAP-12).

**INT-SYNC-05** · P2 · xunit — Telemetry stream
- Steps: device sends reports at 10/s for 10 s; second device idle.
- Expect: the Regie receives `telemetry` at most once per device and 2 s (never two messages closer than 2 s; with 10 reports/s at most 6 messages in 10 s), the first report at once and the newest held-back values after the interval (latest value wins), not revisioned (BUG-19); none for the idle device after it is stale; payload contains only the subscribed production's devices.

**INT-SYNC-06** · P1 · xunit — `GET …/changes`
- Steps: `since` = current, 0, huge, negative, non-numeric, missing; unknown production.
- Expect: as INT-NET-01; 400 for invalid `since`; 404 for unknown production.

**INT-SYNC-07** · P1 · xunit — Event ordering inside the lock
- Steps: 100 mutations from 10 threads with 3 subscribed clients; record arrival order per client.
- Expect: arrival order equals revision order for all clients; every revision from the first to the last delivered exactly once (no holes, no duplicates).

**INT-SYNC-08** · P0 · xunit — Contract and surface completeness
- Steps: run the OpenAPI generation (`npm run gen:contracts`) and diff against the committed `packages/scene-model/src/generated/api.ts`; enumerate endpoints; call each with a minimal valid request as admin/device/output as appropriate.
- Expect: no drift between ApiSurface, `openapi/studioflow.json` and the generated TypeScript; operation ids equal the ApiSurface names; **no endpoint answers 501 `Not implemented`** (placeholders replaced); every operation id is exercised by at least one integration test (meta test scanning test names for the operation id).

### 2.13 LK – LiveKit integration

**UNIT-LK-01** · P0 · xunit — Token claims
- Steps: build tokens for sender, studio, output; decode and verify with `jose`/`JwtSecurityTokenHandler` (HS256, API secret).
- Expect: `iss` = API key; room `prd_{id}`; sender: identity = device id, `roomJoin`, `canPublish: true`, `canPublishSources: ['camera','screen_share','microphone','screen_share_audio']` (issue #7), `canSubscribe: false`, `canPublishData: false`, `hidden: false`; studio: identity `studio_{random}`, `canSubscribe: true`, `canPublish: false`, `canPublishData: false`, `hidden: true`; output: identity `output_{slug}_{random}`, same flags as studio; `exp − nbf` = 10 min ± 5 s (spec 7, `LiveKit:TokenTtl` [GAP-01], DOC-03); random parts differ per call; no secret or metadata with secrets inside the token; token never contains the API secret.

**INT-LK-01** · P0 · xunit — Token endpoints
- Steps: device, studio and output `livekit-token` endpoints: valid, blocked device, wrong key, unknown production; call twice.
- Expect: `LiveKitTokenDto { url: wss://<host>, token, identity, room, expiresAt }` where `url` is the same origin as `PublicBaseUrl`; blocked → 403; fresh token and (for studio/output) fresh identity per call, stable identity for devices; unknown production 404; `expiresAt` ≈ now + 10 min.

**INT-LK-02** · P1 · xunit — Room service calls
- Steps: block (fake HTTP server standing in for `http://livekit:7880/twirp/livekit.RoomService/…`); key rotation; startup seed; LiveKit returns 404/500/timeout.
- Expect: `RemoveParticipant` is `POST /twirp/livekit.RoomService/RemoveParticipant` with JSON `{room, identity}` and `Authorization: Bearer <JWT with roomAdmin:true, room>`; `ListParticipants` likewise; participant-not-found is tolerated; errors/timeouts are logged and do not fail the block (device state `blocked`, hub aborted; its token endpoint now 403 so it cannot rejoin); startup seed failure is retried with backoff and does not prevent the API from starting.

**E2E-LK-01** · P0 · pw — Real grants are enforced
- Steps: in a page, use `livekit-client` with: a sender token (try to subscribe, publish data, publish a microphone track (allowed since issue #7), publish into another room), a studio token (publish video), an output token (publish), a token signed with the wrong secret, an expired token; also list participants as a sender.
- Expect: sender cannot subscribe to anything, cannot publish data, may publish a microphone, cannot join another room; studio/output cannot publish (neither a camera nor a microphone); wrong-secret and expired tokens are rejected at connect; studio and output participants are hidden (they never appear in a sender's participant list but `lk.listParticipants` shows them); other senders may be listed but none of their tracks can be subscribed.

**E2E-LK-02** · P1 · pw — Codecs, simulcast, content hints, dynacast
- Steps: Chromium phone publishes the camera; laptop publishes a screen; read `RTCRtpSender.getParameters()` and `getStats()`.
- Expect: camera H.264 with three simulcast layers (`rid` q/h/f, 1080p/540p/270p or 720p/360p/180p) and `contentHint = 'motion'`; screen VP9 (backup codec H.264 present), one layer, `contentHint = 'detail'`, max 1440p and 15–30 fps; dynacast: layers nobody subscribes to stop sending (`bytesSent` stalls); no audio track unless the sender switched a microphone on or ticked “Share audio” (AUD-06, AUD-12, AUD-13).

**E2E-LK-03** · P2 · pw (`@short-ttl`) — Room lifecycle
- Steps: all participants leave; wait beyond `empty_timeout` (10 s in the profile); a sender rejoins; restart the API with participants present.
- Expect: the room is recreated on demand (`auto_create`); room name stays `prd_{id}`; after the API restart the live sources return to `ok` without incidents (UNIT-SRC-03).

**E2E-LK-04** · P2 · pw (`@linux-netem`) — TCP fallback
- Steps: drop UDP 7882 on the LiveKit container (`iptables -A INPUT -p udp --dport 7882 -j DROP` via the netshoot sidecar), start a sender.
- Expect: media flows over TCP 7881, picture plays (higher latency recorded); removing the rule lets new sessions use UDP.

### 2.14 TXT – Texts and lower thirds

Issue #13. A text is a source (kind `text`, code `T1`, id `txt_…`) with two lines, one of three fixed styles (`lowerThird`, `title`, `note`) and an alignment; the colours (accent, background, text) belong to the production. Scene items show it; the item's `hidden` flag is the show/hide switch. The Regie of the E2E tests runs in English (`en-US`) in this area.

**UNIT-TXT-01** · P0 · vitest (`scene-renderer.text.spec.ts`) — Text is drawn as HTML text, never interpreted
- Steps: render items of texts with `<img src=x onerror=…>`, `<script>`, `"><svg onload=…>`, `&lt;b&gt;`, emoji sequences, Arabic and Hebrew, empty and malformed content, 120-character lines, a title with a long text, an unknown text; resize the item and the container; change the colours (valid, invalid, missing); `refresh()` after a content change; text in an Auto-Grid scene; replace a text by a camera on the same item.
- Expect: the lines are set with `textContent` (no child elements, no `img`/`script` inside the item, `innerHTML` shows the escaped text); every line has `dir="auto"`; a lower third keeps both lines on one line with an ellipsis, a title wraps to two lines (`-webkit-line-clamp`), a word without spaces breaks (`overflow-wrap`); the font size follows the item height only (resizing the container changes the stage transform, not the font size); invalid colours fall back to the defaults; an empty or malformed text draws nothing and reports no error; `refresh()` rewrites only what changed and keeps the elements; an unknown text is "Source missing" on the monitor and nothing on the output; texts keep their own rectangle in the Auto-Grid.

**UNIT-TXT-02** · P1 · vitest (`scene-renderer.text.spec.ts`, `presence.spec.ts`) — Show and hide animation
- Steps: show a text of a new scene; toggle `hidden` with `update()` (show, hide, show–hide–show quickly); reduced motion; no Web Animations API; an animation that never reports its end; destroy while running.
- Expect: the first state of a scene is set without animation (a scene cut or fade brings its texts along); a later change fades and slides for 300 ms (lower third from the left, title up, note down) and keeps the geometry until it has ended; every animation runs to completion (a new change finishes the running one first; a 100 ms safety timer ends one the browser does not report); with reduced motion or without the API the change is a cut; nothing is left behind (`opacity`, `transform`); the final state always equals the last `hidden`.

**UNIT-TXT-03** · P1 · vitest (`packages/scene-model`, `packages/i18n`) — Text model
- Steps: `TEXT_STYLES`, `defaultTextAlign`, `styleHasAlignment`, `textItemRect` (inside the safe margin), `contrastRatio`/`hasReadableContrast` (4.5 : 1 limit, `#767676`/`#777777` on white, invalid colours), `newItem` for a text, `parseSourceRef('txt_…')`, `applyLayoutTemplate` with a text, `LOG_MESSAGE_KEYS`, `countCharacters` (emoji sequence, flag, skin tone).
- Expect: titles centre, the lower third ignores the alignment; a new text item is hidden, 0 corner radius and in the rectangle of its style; a text takes no template slot and keeps its geometry and a place in front; a theme with invalid colours is never "readable"; an emoji sequence counts once.

**UNIT-TXT-04** · P0 · xunit (`TextSourceTests`) — Text validation
- Steps: create and update with empty, whitespace, control characters, bidi overrides, line separators, a lone surrogate, 120/121 characters and 120/121 emoji, markup, Arabic/Hebrew/emoji, unknown style/alignment; 64 texts; colours `red`, `#fff`, `#ggg000`, `#ff000000`, empty; delete a text used by items in two scenes; a text as the fallback of a camera.
- Expect: lines are trimmed and cleaned (control, bidi and line-separator characters removed, a lone surrogate becomes U+FFFD) and counted in text elements; markup and any Unicode text are kept literally; field errors name `line1`, `line2`, `style`, `align`, `textTheme.accent|background|foreground`; the 65th text is `limit_reached`; the freed code is reused; deleting removes the items from every scene and bumps their versions; a text cannot be a fallback source.

**UNIT-TXT-05** · P1 · ng — Regie: Sources and Properties docks, editor service, production menu
- Steps: "+ Source" menu (Texts group, three "New text" styles), create-and-add flow, rows of hidden texts, selection of a hidden text, show/hide on the live scene in Studio Mode, undo, the text editor (preview, counter, emoji count, empty first line, style/alignment, debounce, one request at a time, external change, delete confirmation, offline), the production colour form (hex fields, contrast warning at 4.4 and 4.5, invalid colour, reset, save).
- Expect: a new text starts hidden, selected, in the rectangle of its style; a hidden text is selectable and shows the editor; show/hide of a text is allowed on the live scene in Studio Mode and records no undo step; typing is previewed at once and sent after 250 ms (or on blur/style/alignment), never while the first line is empty or a line is too long; the warning appears below 4.5 : 1 with the ratio rounded down; an invalid colour is not sent.

**INT-TXT-01** · P1 · xunit (`TextServiceTests`) — Events, audit and log
- Steps: create, update (same content, new content), delete a text used by two scenes; show and hide on the program scene, on another scene, through `ReplaceItems`, a camera; snapshot and output snapshot.
- Expect: `sourceUpserted` (kind text, `text` content, status ok) for create/update, `sceneUpserted` per changed scene then `sourceRemoved` for delete; nothing for an unchanged update or a failed request; audit `text.created`/`text.deleted`; log "T1 “Name” created/deleted"; "T1 shown"/"T1 hidden" only when the visibility of a text of the program scene changes; the snapshot and the output snapshot carry the texts and the theme; the output sees the text events.

**INT-TXT-02** · P0 · xunit (`TextApiTests`) — REST
- Steps: `POST/PUT/DELETE /api/productions/{id}/texts`; invalid content; markup; unknown style; unknown production/text; 65 texts; parallel creates and updates; add an item of a text; `PATCH` with `textTheme`; no session, no CSRF header.
- Expect: 201 with code `T1…`; 200/204; 400 `validation_failed` with field paths; markup stored as plain text; 404; 409 `limit_reached`; distinct codes and no lost update under parallel requests; a new text item is hidden; the theme validates and persists; 401/403 without session or CSRF header.

**INT-TXT-03** · P0 · xunit (`TextApiTests`) — A show and a content change reach the output
- Steps: output hub subscribed; toggle `hidden` of a text item; change the content.
- Expect: `sceneUpserted` with the new flag and `sourceUpserted` with the new content arrive at the output within 2 s; the Regie hub gets the log entry "T1 shown".

**E2E-TXT-01** · P1 · pw — Create, edit, show and hide a lower third
- Steps: set the production colours by API; Regie in English; "+ Source" › "Lower third"; edit both lines; "Show"; edit line 1 while shown; "Hide"; read the output DOM and the stage pixels.
- Expect: a hidden row `T1` with placeholder content and a preview that follows the typing; nothing on the output until "Show"; then within 2 s the text on the output (`.sf-r-text` with the typed lines, accent bar, background and letters in the production colours, no image or canvas); an edit changes the text of the same element (no recreation); "Hide" removes it and the scene shows again at the probed pixel.

**E2E-TXT-02** · P1 · pw — Text editor and deletion
- Steps: a shown text; select its row; style "Title"; alignment "Right"; empty line 1; "Delete text" and confirm.
- Expect: counter "19 of 120"; the output follows style and alignment; an empty first line shows "Enter the first line." and nothing is sent; the confirmation names the scenes ("removed from 1 scene"); afterwards the row, the item and the output text are gone.

**E2E-TXT-03** · P1 · pw — Production text colours
- Steps: production menu › "Text colours…"; background `#ffffff`, text `#777777` and `#767676`; accent `orange`; accent `#00aa55`; save.
- Expect: the warning "Contrast 4.4 : 1" at `#777777` and none at `#767676`; an invalid colour is refused and not sent; saving stores the theme and recolours the shown text on the output within 3 s.

**E2E-TXT-04** · P1 · pw — Hostile and international text on the output
- Steps: a text with `<img onerror>` and `<script>`, a 120-character second line, Arabic, Hebrew, emoji.
- Expect: the markup is text (no element, `window.__pwned` stays undefined); the long line is cut with an ellipsis, not wrapped; right-to-left lines have `direction: rtl`; emoji sequences are shown.

**E2E-TXT-05** · P2 · pw — Scales with the window
- Steps: a lower third on the output; resize the window to 960 × 540 and 1920 × 1080.
- Expect: the accent bar fills the same part of the stage at both sizes; the computed font size is a canvas value (61.2 px for a 180 px high item).

### 2.15 AUDIT – Audit log

Spec 4.9, runbook 17. E2E specs run in English (`locale: 'en-US'`) on any stack; the Web tests need Docker for PostgreSQL.

**UNIT-AUDIT-01** · P0 · xunit — CSV escaping and formula protection (`AuditCsvTests`)
- Steps: cells with the separator, quotes, line breaks, umlauts; cells that start with `=`, `+`, `-`, `@`, tab, carriage return; `=` inside a text; a device named like a formula in text, production and details; comma and semicolon.
- Expect: RFC 4180 quoting with doubled quotes and CRLF line ends; a leading `'` for the six formula starts (before quoting) and for nothing else; umlauts and quotation marks unchanged; details as readable JSON; header and row follow the column list of spec 4.9.

**UNIT-AUDIT-02** · P0 · xunit — Filter and cursor validation (`AuditFilterTests`, `AuditCursorTests`, `AuditOptionsTests`)
- Steps: empty input; unreadable times, end not after start; unknown category or action; text of 100 and 101 characters; categories and actions together; cursors round-tripped, garbled, too long, overflowing; option values at and beyond the bounds.
- Expect: validation errors name every wrong field (`from`, `to`, `category`, `action`, `q`, `production`, `actor`, `cursor`, `limit`); categories become the actions of those categories and are intersected with `action`; a cursor survives encode and parse and nothing else parses; the options refuse values outside their range and an IP retention longer than the retention.

**UNIT-AUDIT-03** · P0 · xunit — Retention with `FakeTimeProvider` (`AuditRetentionTests`)
- Steps: entries of 1, 89, 91, 364, 366 and 400 days, some with an IP; run; run again; batch size 10 with 25 and with exactly 10 old entries; a live broadcast; the broadcast ends; other periods; the clock moves two days.
- Expect: exactly the entries older than the retention are deleted, the IP is removed after the IP period and the rest of the entry stays; the second run changes nothing and writes no entry; batches continue until one is not full; nothing happens while a production is live and the next run catches up; one `audit.retention` entry (system, days, deleted, anonymised) per run that changed something.

**UNIT-AUDIT-04** · P1 · xunit — Texts, codes and categories (`LogTextsTests`, `AuditCategoriesTests`)
- Steps: every action constant; every `LogCode`; entries of unknown actions and of phone QR invites; Recent events versus the audit log.
- Expect: every action has one category and an English text with the parameters of its code; every code is produced by some action; unknown actions and phone QR invites have no text; `RecentActions` is a subset and sign-ins never reach Recent events.

**UNIT-AUDIT-05** · P1 · xunit — Services record the audit events (`AuditEventTests`)
- Steps: create, rename, activate a production; change slates; reset the broadcast; switch with a click and with Take; rename a device; switch a phone lens, move a slider, repeat the same lens; renew the phone QR; acknowledge an incident.
- Expect: one entry each with the actor and details of spec 4.9 (`via`, old and new name, slate, lens kind, code); no entry for a slider, the same lens or a phone QR code; entries that are not in Recent events do not appear there.

**UNIT-AUDIT-06** · P1 · ng, vitest — Page, store and filters
- Steps: `ng test studio` (`audit-page.component.spec.ts`, `.de.spec.ts`, `audit-log.store.spec.ts`, `audit-filters.spec.ts`, `audit-view.spec.ts`, `studio-api.service.spec.ts`); `vitest` (`log-entries.spec.ts`, `format.spec.ts`).
- Expect: rows, details on demand, filters as query parameters, debounced search, "Last broadcast" lookup, custom range check, load more and automatic loading, new entries at the top, stale answers dropped, export with the filter and a semicolon in German, errors and empty and loading states, no custom keyboard handling needed (native controls), German texts and local time.

**INT-AUDIT-01** · P0 · xunit — Authorisation
- Steps: the three routes without a session, with a device token (valid, wrong secret, blocked) and with an output key.
- Expect: 401 `unauthorized` everywhere; no export entry is written.

**INT-AUDIT-02** · P0 · xunit — Filters, validation and injection
- Steps: time range (from inclusive, to exclusive), production, `none`, category, action, actor, text (case, umlauts, `%` and `_`); SQL fragments as text, actor and production; invalid values.
- Expect: exactly the matching entries; wildcards are literal; SQL in a filter is text (the table is intact, nothing sleeps); invalid input is 400 `validation_failed` naming the field; legacy phone QR entries are hidden.

**INT-AUDIT-03** · P0 · xunit — Paging is stable
- Steps: 130 entries with equal times, pages of 7; entries added between pages (newer ones, and ones that share the time of the cursor); inserts running in parallel.
- Expect: no entry twice, none lost, ordered by time and id; the pages continue exactly after the previous one; a new first page shows the new entries.

**INT-AUDIT-04** · P0 · xunit — Exports
- Steps: CSV and JSON of a filter; semicolon; names starting with `=`, `@`, `+`; quotes and umlauts; nothing found; more rows than `Audit:ExportMaxRows`; more exports than `Audit:ExportsPerMinute`.
- Expect: UTF-8 with BOM, header, rows, dated file name; formulas neutralised; an empty export is the header; too large is 409 `limit_reached` without bytes and without an entry; 429 with `Retry-After` per client; an export writes `audit.exported` with format, rows and filter.

**INT-AUDIT-05** · P1 · xunit — 100 000 rows are streamed (`AuditExportStreamingTests`, runs alone)
- Steps: insert 100 000 entries with 300 characters of details (about 42 MiB of CSV), read the export in 64 KiB chunks, measure the live heap (full collection) every 4 MiB.
- Expect: 100 001 lines; the live heap grows by less than 24 MiB (measured about 2 MiB; with all rows buffered it grew by about 90 MiB).

**INT-AUDIT-06** · P0 · xunit — Retention on the database
- Steps: 230 old entries with a batch size of 100, entries with IP addresses at 85, 95 and 400 days, an entry at 364 days; run; run again; run with a live broadcast.
- Expect: exactly the old entries are gone, the IP is removed from the 95-day entry only and its user name stays, one `audit.retention` entry (system) counts both, the second run changes nothing, a live broadcast postpones the run; the entry is in the view with its code.

**INT-AUDIT-07** · P0 · xunit — Every action leaves an entry and no entry holds a secret
- Steps: failed sign-ins up to the lockout, sign-in, sign-out, production create/rename/slate/activate, device pair/rename/block/unblock/delete, invite link create/revoke, output key regenerate and access, upload and delete, broadcast start/switch/preview/take/end/reset; then search the table, the view and the CSV for the admin password, device secret, invite token and both output keys.
- Expect: every action of the list has an entry (Take and click are told apart); sign-ins carry the IP; none of the secrets appears anywhere; renewing the phone QR code writes nothing.

**E2E-AUDIT-01** · P0 · pw — "Last broadcast" and the CSV (smoke)
- Steps: start a broadcast, switch twice, end it; production menu → "Audit log"; choose "Last broadcast"; "Export CSV".
- Expect: exactly four rows in the order ended, live, live, started with the scene names, "Admin" and the production; the download is `studioflow-audit-YYYY-MM-DD.csv` with a UTF-8 BOM, the English header and the same four descriptions in the same order, production id and details (`via: click`); the export is then an entry of the log (one of several when the stack saw earlier runs: a retry or a repetition leaves its export entry behind). Choosing "Last broadcast" before the list of productions has arrived waits for it instead of showing an empty table (unit test of the page, issue 32).

**E2E-AUDIT-02** · P1 · pw — Filters, details and keyboard
- Steps: switch a scene and rename the production; category "Production" on, then "Access and security" on and "Production" off; clear; search for the scene name; focus the details button, Enter, Space; search for text nobody has.
- Expect: the category and text filters narrow the table; the details show `scene.live` and `via click`; `aria-expanded` follows; the empty state says "No entries match."

**E2E-AUDIT-03** · P1 · pw — More pages and 1024 px and a tablet
- Steps: 30 switches; open the log; "Load more"; viewports 1024 × 768 and 768 × 1024.
- Expect: the next page is appended; no horizontal page scroll, all filters, the export button and the columns time and what are visible.

**E2E-AUDIT-04** · P1 · pw — axe in both themes
- Steps: open the page with one entry expanded; scan in the dark theme; switch to the light theme; scan.
- Expect: no critical or serious violation (WCAG 2.1 A/AA) in either theme.

### 2.16 LINK – Output links and the camera

Several named output links per production and the output as a camera in Teams, Zoom and Webex through OBS (issue #9 stage 1, decisions “#9” in `docs/decisions.md`; spec 4.8, 9.1, 9.4; runbook section 17). The Regie runs in English (`en-US`) in the E2E specs.

**UNIT-LINK-01** · P0 · ng (`obs-scene-collection.spec.ts`) — OBS scene collection generator
- Steps: generate the collection for a link; parse it; names and URLs with quotes, backslashes, line breaks, emoji, query characters and non-ASCII text; file names of such link names.
- Expect: valid JSON with one scene `StudioFlow` and one `browser_source` `StudioFlow output` (different names), the scene item points at the source, `url` is the link byte for byte, 1920 × 1080 from `obsCanvasSize()` (the only place), 30 fps, `reroute_audio` true, `shutdown` false, `restart_when_active` false; the key appears once; the file name has no path separator.

**UNIT-LINK-02** · P0 · xunit (`OutputLinkTests`) — Output link domain rules
- Steps: create with valid, empty, blank, 40/41 character and duplicate names (ignoring case); the 10th and 11th link; rename; regenerate; IP rules (normalised, duplicates, invalid index, more than 50, missing); `OutputLinkAccess.Find` with several keys.
- Expect: 43-character keys that differ per link, names trimmed and unique per production, `limit_reached` at the limit, the IP list belongs to the link, regenerating changes only the key.

**UNIT-LINK-03** · P1 · xunit (`OutputTrackerTests`) — Output tracker per link
- Steps: two links with pages and reports; disconnect one page; `SetLinks` with a revoked and a renamed link; `TakeChange` after a state change, a rename and a metric change.
- Expect: each link has its own state, consumers, addresses, latency and fps; the summary is connected if any link is, else stale; revoked links lose their pages; a link change is published at once, metric changes keep the 5 s / 20 % rule.

**UNIT-LINK-04** · P1 · ng (`output-popover.component.spec.ts`, `header.component.spec.ts`) — Output popover and chip
- Steps: popover with two links in different states; select, add (valid, empty, blank, 41 characters, duplicate in another case, at the limit, refused by the server), rename, IP editor, regenerate and revoke with confirmation and cancel; "Use as camera …" and the download; the status event of a link; the chip with two connected links.
- Expect: “Proxy · connected” per link and “last seen” or “never connected”; nothing is requested for invalid names; each action calls its own link route; the unsaved IP list is dropped when another link is selected; the key is never shown unmasked; five steps with 1920 × 1080 and 30; the download holds the selected link; the chip names the connected links and its tooltip lists all.

**UNIT-LINK-05** · P2 · ng (`download.service.spec.ts`) — File download from the Regie
- Steps: save a text file.
- Expect: the file has the given name and type, the object URL is released, no link stays in the page, and the link is clicked inside a given element (the open popover stays open).

**INT-LINK-01** · P0 · xunit (`OutputFlowTests`) — Output link use cases
- Steps: authorise with the key of each link, wrong key, unknown slug, address outside one link's list; create (valid, invalid, duplicate, 10th, 11th); rename; regenerate and revoke with connected pages and LiveKit participants; connect after the link was revoked; last seen; a new production.
- Expect: the key of any non-revoked link opens the output, the IP list applies per link, revoked and replaced keys are invalid at once; only the pages and `output_{slug}_{linkId}_*` participants of the changed link are aborted and removed; audit entries `output.link.created`, `output.link.renamed`, `output.link.revoked`, `output.key.regenerated` and `output.access.changed` with the link name and their log texts; every production starts with the link “Proxy”.

**INT-LINK-02** · P0 · xunit (`OutputLinkApiTests`) — Output link REST
- Steps: `POST/PATCH/PUT/DELETE` of the link routes, invalid and duplicate names, 11 links, unknown links, links of another production, no session, no CSRF header; a revoked key on snapshot, changes, LiveKit token, report and the asset `?k=` route; a key of another production; `X-Forwarded-For` per link.
- Expect: 201, 200, 204, 400 `validation_failed`, 409 `limit_reached`, 404, 401, 403 as specified; a revoked or regenerated key is refused everywhere at once while the other link works; per-link status and log entries in the snapshot.

**INT-LINK-03** · P0 · xunit (`OutputLinkHubTests`) — Output hub per link
- Steps: two links connected to the output hub; revoke one; regenerate the other; narrow the IP list of one; watch the Regie hub.
- Expect: only the changed link's connections close within 15 s, the revoked key cannot reconnect (403), the Regie gets `outputStatusChanged` with the links by name and state, `lastSeenAt` is set for the link that was used.

**INT-LINK-04** · P0 · xunit (`OutputLinkMigrationTests`) — Migration of the single output key
- Steps: a database at the migration before `AddOutputLinks` with productions that have a key and an IP list and audit entries of the key; migrate up; migrate down with a second link.
- Expect: every production has one link “Proxy” with the old key and IP list, so old URLs keep working; the audit entries of key and access changes get the name “Proxy”; down restores the oldest link as the production's key.

**E2E-LINK-01** · P0 · pw — Two links, revoke one
- Steps: Regie in English; add the link “Teams camera” in the popover; open one output page per link; look at the popover and the chip; revoke “Teams camera” in the popover; reload both pages.
- Expect: “Proxy · connected” and “Teams camera · connected”, the chip reads “Output Proxy + Teams camera”; after the confirmation the page of the revoked link shows “No access” within `T-KEY` (2 s) and stays denied after a reload, the other page keeps playing and stays connected; the row of the revoked link is gone.

**E2E-LINK-02** · P0 · pw — Links on the hubs
- Steps: three output hub connections (Proxy, two new links) and a Regie hub; revoke one link; regenerate another.
- Expect: the status event lists the three links by name; only the revoked link's connection closes (within `T-KEY`), its key gets 403 on REST and negotiate; regenerating closes only that link's connection; the proxy connection stays open.

**E2E-LINK-03** · P0 · pw — Download the OBS scene collection
- Steps: Regie in English; add “Teams camera”; “Use as camera …”; “Download OBS scene collection”; parse the file; open its URL in a new page, once with `bg=transparent`.
- Expect: five steps naming 1920 × 1080; the file `StudioFlow-Teams-camera.json` is valid JSON with the browser source at 1920 × 1080, 30 fps, audio via OBS, shutdown off, refresh off, the URL of “Teams camera” (not the proxy key); the page of that URL turns the link “connected”; with `bg=transparent` the page and body are transparent.

### 2.17 I18N – Language and formats

The language of the product is the setting `localStorage['studioflow.locale']` (`en` or `de-CH`; key absent = automatic from the browser language: `en*` and every unsupported language → English, `de*` → `de-CH`; decisions D1 and D2 in `docs/architecture/i18n-design.md`). The Regie, `/monitoring` and the sender share the key, a `storage` event switches the other open tabs; the output page has no setting (`?lang=`, then the browser language, then English). API texts are English and the clients render their own texts chosen by `code` (D7). The tests are in `tests/e2e/specs/i18n/` (`i18n-language`, `i18n-output`, `i18n-formats`), tagged `@p1 @i18n`, run in the `i18n` project (browser language `de-CH`) and set the browser language each test needs. English expectations come from `tests/e2e/support/text.ts`, the German ones from `tests/e2e/support/text.de.ts` (the strings of `packages/i18n/src/messages/de-CH/`). The German rules audit (no sharp s, decimal comma, 24 h clock, Swiss quotes) is `E2E-DEV-17` in 2.8, in `i18n-german-audit.spec.ts`.

**E2E-I18N-01** · P1 · pw (`i18n`) — Browser language picks the language of the sign-in page
- Steps: for each browser language `en-US`, `en-GB`, `de-CH`, `de-AT`, `de-DE`, `fr-CH` open `/login` in a fresh context.
- Expect: `en-US`, `en-GB` and `fr-CH` (unsupported → English) show the page in English (button “Sign in”) and `<html lang="en">`; the detection stores nothing (`localStorage['studioflow.locale']` is `null`).
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect (German browser languages): `de-CH`, `de-AT` and `de-DE` show the page in German (button “Anmelden”) and `<html lang="de-CH">`; nothing is stored either.

**E2E-I18N-02** · P1 · pw (`i18n`) — The stored setting beats the browser language
- Steps: browser language `en-US`; on `/login` set the select “Interface language” to `de-CH`; reload; set it to `auto`.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: the page switches to German at once (button “Anmelden”), `studioflow.locale` = `de-CH`, `<html lang>` = `de-CH`; after the reload it is still German and the select shows `de-CH`; with `auto` the page is English again (“Sign in”, `<html lang="en">`) and the key is removed (`null`).

**E2E-I18N-03** · P1 · pw (`i18n`) — A second tab follows a language change at once
- Steps: two pages of one context (`en-US`) on `/login`; the first page sets the language to `de-CH`.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: the second page switches to German without a reload (`storage` event; button “Anmelden”, `<html lang="de-CH">`).

**E2E-I18N-04** · P1 · pw (`i18n`) — Regie: the language switch changes the open Regie live
- Pre: logged-in Regie in `en-US`; a marker on `window` and `history.length` are noted.
- Steps: “Open settings” → popover “Settings” (its last row shows the version the server runs, `0.1.0+1a2b3c4`, from `GET /api/system/info`) → select “Interface language” = `de-CH`; then switch back to `en` in the German popover.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: the region “Scenes” becomes the German region (“Szenen”) and the popover and its button get their German names (“Einstellungen”) at once, no English region name is left; `<html lang>` and `studioflow.locale` follow; the `window` marker survives and `history.length` is unchanged (no reload); after the switch back everything is English; no page errors.

**E2E-I18N-05** · P1 · pw (`i18n`, `pixel7`) — Sender pairing page: live switch, persists over a reload
- Steps: open the pairing page of the sender (heading “Pair device”); set the select “Interface language” to `de-CH`; reload.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: the heading becomes German (“Gerät koppeln”) without a reload (`window` marker survives), `<html lang="de-CH">`; after the reload the page is still German.

**E2E-I18N-06** · P1 · pw (`i18n`) — The sign-in error is rendered by the client in the page language
- Steps: wrong username and password on `/login`, once in `en-US` and once in `de-CH`.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: `role=alert` shows “Wrong username or password.” in English and “Benutzername oder Passwort ist falsch.” in German; the English `detail` of the API (“Username or password is incorrect.”) is never shown (D7).

**E2E-I18N-07** · P1 · pw (`i18n`) — Output page: `?lang=` and the browser language
- Steps: browser language `en-US`, output URL with a wrong key (slate “No access”): without `lang`, with `lang=de-CH`, `lang=de`, `lang=fr`.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: no `lang` → English (“No access”, `<html lang="en">`); `de-CH` and `de` → German slate (“Kein Zugang”, `<html lang="de-CH">`); the unknown `fr` → English.

**E2E-I18N-08** · P1 · pw (`i18n`) — Output page: a German browser, and `?lang=en` wins
- Steps: browser language `de-AT`, output URL with a wrong key, without and with `lang=en`.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: without `lang` the slate is German (“Kein Zugang”); with `lang=en` it is English (“No access”).

**E2E-I18N-09** · P1 · pw (`i18n`) — The language of the Regie does not reach the output page
- Steps: context whose origin has `studioflow.locale = 'de-CH'` (the Regie and the output page share the origin and `localStorage`); open the output with a wrong key, no `lang`, browser language `en-US`.
- Expect: slate “No access” in English, `<html lang="en">`; the key is still in storage (the output page has no setting and ignores it).

**E2E-I18N-10** · P1 · pw (`i18n`) — The standby slate is a production text, identical in both languages
- Steps: open the output of a fresh production with `lang=de-CH`.
- Expect: slate title “Starting soon” (the default text the server creates, D8) with the production name as subtitle, exactly as with `lang=en`; only texts of the page itself (for example “No access”) follow the language.

**E2E-I18N-11** · P1 · pw (`i18n`) — Fade durations: decimal point in English, comma in German, live
- Steps: Regie in `en-US`; press “Shorter fade” until it is disabled; switch the language to `de-CH` in the settings popover; press the longer-fade button until it is disabled; switch back to `en`; press “Shorter fade” once.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: “0.2 s” in English, “0,2 s” right after the switch (same value, comma); “2 s” at the longest step in both languages; “1.5 s” after one step down in English; the values `0.2 s … 2 s` are the seven steps of `E2E-SWITCH-03`.

**E2E-I18N-12** · P1 · pw (`i18n`) — 24 h clock without AM/PM in both languages
- Steps: read the header clock of the Regie in `en-US`; switch to `de-CH` in the settings popover; read it again.
- Expect: both match `^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$`, never with AM/PM (D4); elapsed times (runtime `hh:mm:ss`, outage timers `mm:ss`) have the same shape in both languages.

**E2E-I18N-13** · P1 · pw (`i18n`) — A log entry of the API is rendered in the language of the Regie
- Steps: Regie in `en-US`; pair a phone named “Phone 1” through the API (the API writes the log entry `devicePaired` with its parameters); then switch the language to `de-CH` in the settings popover.
<!-- i18n-ignore: the German text of the i18n project, asserted from tests/e2e/support/text.de.ts -->
- Expect: “Recent events” shows “K1 Phone 1 paired” in English and “K1 Phone 1 gekoppelt” after the switch, with no English text left in the entry (the Regie renders `LogEntryDto` from `code` and `params`; `text` of the API is only the fallback).

### 2.18 FMT – Format and resolution

Issue #8, decisions «#8», spec 4.2 ("Canvas"), 4.3, 8.1, 8.3, 9.3, runbook 19. A production has one format (16:9, 9:16, 1:1, 4:3) and one resolution (720p, 1080p: the short side); 16:9 at 1080p is the default and what every earlier production is. E2E specs run in English (`en-US`); the E2E stacks need Docker.

**UNIT-FMT-01** · P0 · vitest (`canvas.spec.ts`, `layout-templates.canvas.spec.ts`, `text.spec.ts`, `production-state.spec.ts`) — Canvas model of the scene model
- Steps: `canvasSize` for the 8 combinations, labels, `canvasOf`, `isLandscape`, `safeMargin`, `placeOnCanvas` (new item, texts, centred title); every template and `autoGridSlots(0…12)` on every canvas; `applyLayoutTemplate` on 9:16; the names of the templates in both languages; `productionCanvasChanged` in the state reducer.
- Expect: sizes 1280×720, 1920×1080, 720×1280, 1080×1920, 720×720, 1080×1080, 960×720, 1440×1080, all integers and inside the item bounds; the slots of 1920×1080 are those of the prototype; every slot lies inside every canvas, no two slots overlap except in Picture in picture, the slot counts are 1, 2, 2, 3, 3, 4, 9; 720p slots are 2/3 of the 1080p ones (±1 px); 4:3 narrows the 16:9 slots to 75 % with 16:9 tiles; 1:1 and 9:16 stack ("Stacked", "Screen + camera row", square grid cells); a new item keeps its shape and sits at the bottom right with scaled edge distances, a note stays in the top right corner and a title stays centred; the event replaces the production and the listed scenes in one step and keeps the identity of the others.

**UNIT-FMT-02** · P0 · vitest (`scene-renderer.canvas.spec.ts`, `stage-fit.spec.ts`, `auto-grid.spec.ts`; `program-view.spec.ts`, `output-app.spec.ts`) — Renderer and output page
- Steps: stage sizes per canvas and for unusable options; letterbox of a portrait canvas in a 16:9 window and of 16:9 in a portrait container; `setCanvas` (live, back, same, invalid, after destroy); Auto grid before and after a change; slates at 1080 and 720 pixels of short side; a text on a portrait canvas; the program view and the page on `productionCanvasChanged`; `?debug=1`.
- Expect: the stage element has the canvas size and is fitted by one scale with bars on the long side; `setCanvas` resizes and re-fits without a new renderer and lays the Auto grid out for the new shape; unusable values fall back to 1920×1080 or are ignored; slate text scales with the short side; the font size of a text follows its item height only; the page sets the canvas before it shows the rescaled scene and not at all for changes that keep the size; the overlay line reads "Canvas 1080 × 1920 · 9:16 · 1080p".

**UNIT-FMT-03** · P0 · xunit (`CanvasTests`) — Canvas domain
- Steps: size table, `Create` with and without a format, unknown enum values, `ChangeCanvas` (same canvas, other resolution, other format, to square and back, empty scenes, live, unknown values, every canvas to every canvas), default placement of new items and texts.
- Expect: `validation_failed` with the field names for unknown values; the same canvas changes nothing; another resolution scales position, size, radius and border by the ratio and leaves crop, rotation, mirror and flags; another format fits and centres the old canvas (1920×1080 → 1080×1920 gives 0/656/1080/608) and the round trip does not restore the old place; scenes without items keep their version; a live production is `broadcast_live` and unchanged; every result lies inside the new canvas and passes the item validation; the C# placement agrees with `placeOnCanvas`.

**UNIT-FMT-04** · P1 · ng — Regie
- Steps: production menu (picker, Save, resolution only, another format with and without elements, singular and plural, cancel, change after the question, live, server refusal, new production), monitors, scene thumbnails, template previews and tile names, edit overlay (percent boxes, safe area, drag in canvas pixels, snapping), editor service (new items, templates, undo history on a change), store, `monitorWidths`, output popover, OBS scene collection.
- Expect: the picker offers 16:9 | 9:16 | 1:1 | 4:3 and 720p | 1080p and starts at 16:9 · 1080p; another format asks "The elements of N scenes are scaled to fit …" and sends nothing before the confirmation; a resolution change and an empty production send at once; live: choice and Save disabled, the reason in a status line, no request; the monitors and thumbnails take the aspect ratio of the canvas (a portrait monitor is narrow and sized from the stage height, stacked monitors are at most 720 px high, thumbnails are 36 px high); templates are named and laid out for the canvas; the undo history is dropped when the canvas changes; the OBS collection and the "Use as camera" step have the canvas size.

**UNIT-FMT-05** · P1 · vitest, xunit — Names and codes
- Steps: `broadcast_live` in the error messages (both languages) and the E2E constants; the audit log text, category and message of `production.canvas.changed`.
- Expect: the toast reads "That is not possible while the broadcast is live. End the broadcast first."; the audit entry is in the category Production with the English text "Output changed from 1920 × 1080 (16:9) to 1080 × 1920 (9:16)" and is not part of "Recent events".

**INT-FMT-01** · P0 · xunit (`CanvasApiTests`) — Create and default
- Steps: the seeded production, a production without a format, with each format and resolution, with only a format, with unknown names and numbers.
- Expect: 16:9 · 1080p (1920×1080) by default; the chosen canvas in the response, the snapshot and the table; 400 `validation_failed` naming `format` or `resolution` for unknown values; a portrait production adds items without geometry at 698/1695/338/190.

**INT-FMT-02** · P0 · xunit (`CanvasApiTests`, `CanvasMigrationTests`) — Change
- Steps: `PUT …/canvas` with another resolution, another format, the same canvas, while live, after the broadcast ended, with invalid or missing fields, an unknown production, without session and without CSRF header; the migration on a database with a production from before.
- Expect: items of every scene rescaled and versions +1 (empty scenes unchanged), the Auto grid mode kept; no change and no event for the same canvas; 409 `broadcast_live` with nothing changed while live; 400 for every invalid body (a missing field is not a silent default); 404, 401, 403; one audit entry `production.canvas.changed` with `from` and `to`, none for a no-op; the migration sets `Widescreen` / `P1080` for existing rows and the model matches the migrations.

**INT-FMT-03** · P0 · xunit (`CanvasApiTests`) — Sync
- Steps: a Regie hub, an output hub and a client that reconnects with a revision, around a change; the wire format.
- Expect: exactly one `productionCanvasChanged` with revision +1 carrying the production with its canvas and the rescaled scenes, also on the output hub; the output snapshot has the canvas; a delta since the old revision contains the event; camelCase type and enums (`standard`, `p720`).

**E2E-FMT-01** · P1 · pw (`regie-format.spec.ts`) — 9:16 end to end
- Steps: Regie in English; create a production as 9:16 in the new-production form; add a shown lower third; open its output in a 1080×1920 window; start the broadcast; open "Format and resolution…" while live; end it; change to 1:1 (confirm) with the output page open.
- Expect: the Program monitor reads "1080 × 1920 · 30 fps" and is narrow (aspect ratio 0.5625); the output stage is 1080×1920 and the accent bar of the lower third is at 47/1824 in canvas pixels (pixel probe); live: the menu explains it, the controls are disabled, the API answers 409 `broadcast_live`; the confirmation names the scaling; the open output page becomes 1080×1080 without a reload, the monitor reads "1080 × 1080 · 30 fps" with aspect ratio 1, the item sits at 262/998/304/57 and the accent bar shows there; no page errors.

**E2E-FMT-02** · P1 · pw (`regie-format.spec.ts`) — Default and resolution through the API
- Steps: the default production; a shown lower third; the output at 1280×720; change to 720p; invalid bodies.
- Expect: 16:9 · 1080p, stage 1920×1080; after 720p the open output has a 1280×720 stage and the item is at 53/547/640/120; unknown format, unknown resolution, a missing field and an empty body are 400 and change nothing.

**E2E-FMT-03** · P2 · pw (`regie-format.spec.ts`) — The picker and the thumbnails
- Steps: "Format and resolution…" on the default production; 720p; then 9:16 on a production without elements.
- Expect: four formats and two resolutions, Save off until something changes; 720p is saved without a question and the monitor reads "1280 × 720 · 30 fps"; 9:16 is saved without a question when no scene has elements, the scene thumbnails are 36 px high and about 20 px wide.

### 2.19 XFER – Duplicate, export and import

Issue #14, decisions «#14», spec 4.2.2 and 4.4, runbook 7.5. A production can be duplicated inside the installation and exported as a file (`.studioflow.zip`: `manifest.json` with `formatVersion` 2 and the media under `media/`, each with its SHA-256) that another installation imports as a new production. Devices are never copied: the cameras and screens that scenes use become placeholders (code and name, "Source missing") that a source takes over with one click. E2E specs run in English (`en-US`) against the stack (Docker); the files they build are made by `support/zip.ts`.

**UNIT-XFER-01** · P0 · xunit (`ManifestTests`) — The manifest
- Steps: write and read a manifest; unknown property, missing required one, wrong type, unknown enum text, `null` for a required field; `formatVersion` 0, 1, 2, 3, 99, missing; the migration chain with a test step, the real step 1 → 2 (an empty `audioChannels`, also over a leftover value) and a file of version 1 read as the current one; an audio channel of the wrong shape (text gain, integer or unknown mode, no source, the list missing); the keys of references (`asset:`, `text:`, `placeholder:`).
- Expect: the round trip gives an equal manifest; every strictness violation is `invalid_archive` and names the path (`scenes[1].items[0].fit`); an older version is migrated step by step in memory, the current one is untouched, a newer one is `unsupported_format` without reading further; a reference without a key or with another prefix is refused.

**UNIT-XFER-02** · P0 · xunit (`ProductionTransferTests`) — Capture and plan
- Steps: capture a production with texts, media, a slate and background medium, scenes with every item field, devices (one in two scenes, one as fallback only, one removed from the production) and an existing placeholder; capture the audio channels (videos with sound and a changed channel, an audio station that stays behind, a video without sound); plan the manifest, also with channels (new id of the video, seeding with the defaults and the settings of the file, a channel of a video that has no sound here is dropped); names (`CopyOf`, `Unique`); limits (99 scenes, 32 items, 64 texts, 100 device sources); duplicate keys, unknown references, a channel of an image, an unknown or repeated video, values out of range and `always`, invalid codes, geometry errors.
- Expect: everything listed in spec 4.2.2 is in the manifest and nothing else (no device id, secret, output link, log, broadcast state); a device source becomes one placeholder with its code, name and kind, a source whose device is gone gets the next free code and no name; the export of a copy equals the export of the original apart from the time; the plan assigns new ids to everything and resolves every reference; each error carries its path; "Name (copy)", " (2)", " (3)" and the cut to 80 characters; limits are `limit_reached`.

**UNIT-XFER-03** · P0 · xunit (`PlaceholderTests`) — Placeholders
- Steps: create (valid and invalid codes, kinds, slots), reserved codes in the source catalogue, assign to a camera, screen, medium, text and unknown source, assign a device source that no scene uses and one that is used, remove, fallbacks, log texts.
- Expect: the code of a placeholder is reserved (the next device gets K2); every item and fallback that points to the placeholder points to the target afterwards and the placeholder is gone; a text or an unknown source is `validation_failed`; an unused device source of the same kind takes the code (and its health follows), a used one keeps it; removing drops the items and clears fallbacks that name it; the texts "K1 assigned to …" and "K1 removed from the scenes".

**UNIT-XFER-04** · P0 · xunit (`ImportArchiveTests`) — The ZIP checks
- Steps: `IsSafeName` for `..`, `.`, empty segments, absolute, backslash, drive, control characters, 256 characters; a name outside `manifest.json` and `media/`; a name twice; the end-of-directory probe (claims of millions of entries, ZIP64); ratio, entry count, unpacked size; a directory that understates the size of a stored entry and of a deflated one; the budget over several reads; a missing and an oversized manifest; a medium with a wrong checksum.
- Expect: every violation is `invalid_archive` or `archive_too_large` before anything is unpacked, and a lying directory is stopped while reading (never more than the declared length is read); a checksum or size that differs from the manifest is `invalid_archive`.

**UNIT-XFER-05** · P1 · ng, vitest (`placeholder-view.spec.ts`, `source-rows.spec.ts`, `placeholder-commands.service.spec.ts`, `production-store.service.spec.ts`, `studio-api.service.spec.ts`, `api-error.spec.ts`, `production-state.spec.ts`, `placeholder.de.spec.ts`) — Placeholders in the client
- Steps: names, usage and rows of placeholders; assignable groups; offers for a new station; the rows of the Sources dock for an item that points to a placeholder; the store (`placeholderOf`, `codeOf`, `sourceLabel`, `isSourceUsed`); the state reducer (`placeholders` in the snapshot, `placeholderRemoved`, none for the output); the commands (one request at a time, offline, errors, toasts); the API client (duplicate, export URL, dry run and import with progress, assign, remove); `archive_too_large` with status 413; the German texts.
- Expect: "K1 · Stage phone" (and "K1" without a name); sorted by code; texts, blocked sources and the wrong kind are never offered, a used source is not offered; the item keeps code and name and says "Source missing" (muted, idle lamp); the multipart upload is shared with the asset upload (CSRF header, progress, abort); a 413 `archive_too_large` is explained as "larger than this installation accepts", not with the media limits; the German plural forms of "in N scenes" (none, one, other).

**UNIT-XFER-06** · P1 · ng (`duplicate-production-form`, `import-production-form`, `production-menu.transfer`, `placeholder-list`, `placeholder-offer` specs) — Regie forms
- Steps: the duplicate form (default name cut to 80, hint with the number and size of the media, empty name, a refusal, a double submit, Cancel); the import form (choose, dry run with progress, preview with placeholders and warnings, import, a refused file, a newer version, too large, cancel while checking, choose another file); the production menu (entries, export link, back to the menu and a fresh list after a copy, live, offline); "Missing sources" (list, assign with one click, nothing to assign, remove after the confirmation, Cancel, the row disappears on `placeholderRemoved`); the offer in the station row (assign, sorted, at most four and a count, gone when the station is used).
- Expect: nothing is sent twice and nothing before "Duplicate" / "Import"; the name is trimmed; the preview counts, the size ("2 media files · 3 MB") and the placeholders ("K1 Stage phone", "S1 removed source") are shown before anything is created; errors are the texts of the codes under the buttons and the form stays; the menu lists the new production without switching to it; "Use as K1 · Stage phone" assigns with one request and the toast names the new source; the removal says how many elements go and sends nothing before the red confirmation.

**INT-XFER-01** · P0 · xunit (`ProductionTransferApiTests`) — Duplicate
- Steps: a rich production (scenes, items, texts, media, slates, canvas, a paired phone and laptop, an output link with an IP restriction, a log); `POST …/duplicate` with and without a name, with a taken name, an invalid name, an unknown production, without session and without CSRF header; while the broadcast is live.
- Expect: 201, not active, standby, first scene on program; scenes, media and settings equal the original without ids (media with new ids and the same bytes); no device, invite, secret, output key, IP restriction or log of the original; the devices are placeholders with code and name; "Name (copy)" / " (2)"; 400, 404, 401, 403; a live production is copied without a change of its revision and keeps its broadcast.

**INT-XFER-02** · P0 · xunit (`ProductionTransferApiTests`) — Export and import
- Steps: export a production; read the ZIP; dry run and import; the same file twice; export of the copy; audit entries.
- Expect: `application/zip` with the file name `{slug}-{date}.studioflow.zip`, `manifest.json` and `media/*` only, checksums match, no id and no secret in it; the preview counts match and nothing is created; the import gives the same scenes, items and media without ids as the original, a name with " (2)", not active; the second import " (3)"; `production.duplicated`, `.exported`, `.imported` with the names, and nothing of a file in the audit details.

**INT-XFER-03** · P0 · xunit (`ProductionImportSecurityTests`) — Refused files
- Steps: zip slip in an entry name and in the manifest (`../`, absolute, backslash); a ZIP bomb (high ratio) and a directory that lies about the size; too many entries, an end-of-directory that claims 60 000; an SVG, a GIF, a text and an HTML file as medium (and an SVG as the second medium); a wrong checksum or size; a broken manifest (not JSON, wrong types, a manifest of another program, nested too deeply, a reference to a part that is not in the file, duplicate keys and codes); `formatVersion` 2, 3, 99, 0, "1", missing; a file that is not a ZIP; more than 99 scenes, 32 items, 64 texts; each as preview and as import.
- Expect: 400 `invalid_archive`, 400 `unsupported_format`, 413 `archive_too_large`, 415 `unsupported_media`, 409 `limit_reached` as listed in spec 4.2.2; after each: no new production, no row in any table, no file under the media folder (not even `evil.png` next to it), the existing productions unchanged; a failing second medium leaves the first one's file out as well.

**INT-XFER-04** · P1 · xunit (`ProductionImportLimitsTests`) — Limits
- Steps: an app with a 1 MiB import limit, 4 MiB unpacked and 20 entries; a file above, an unpacked size above, more entries.
- Expect: 413 `archive_too_large` before the body is read (for the announced size) and while reading (for the unpacked size); the options are validated at startup (`Transfer:*`).

**INT-XFER-05** · P0 · xunit (`PlaceholderApiTests`) — Placeholders
- Steps: assign to a camera, a medium, a text, an unknown source, a placeholder of another production; a fallback that names the source of its own item; assign a phone that no scene uses and one that is used; remove; the hub events and the output hub; audit.
- Expect: 200 `{ scenes, items }`; the scenes arrive as `sceneUpserted`, then `placeholderRemoved`; the output hub sees scenes and a revision-only event, never the placeholder; the new phone becomes K1 (the device sees its new code); 400, 404; `placeholder.assigned` ("K1 assigned to …") and `.removed`.

**INT-XFER-06** · P1 · xunit (`PlaceholdersMigrationTests`, `ImportBodyLimitErrorTests`) — Migration and the streamed limit
- Steps: migrate a database from before the column; a production with placeholders round trip; Kestrel's 413 on the import endpoint, on the upload and without an endpoint.
- Expect: existing productions have `[]`; the placeholders survive the database; a streamed body over the limit is `archive_too_large` on the import and `unsupported_media` elsewhere.

**E2E-XFER-01** · P0 · pw (`xfer-api.spec.ts`) — A duplicate keeps the work and leaves the devices
- Pre: a production with three scenes, a phone (K1) and a laptop (S1) in them, a picture (M1) as item, scene background and slate, an IP restriction and a log.
- Steps: `POST …/duplicate` through Caddy; read both snapshots, the media, the output settings, the audit log.
- Expect: 201, not active (the original stays the active one); the same scenes without ids, the same slate, canvas and text colours; the picture with a new id and the same bytes; no device, source of a device, invite, pairing request, incident or secret of the devices in the snapshot; the placeholders `K1 · Stage phone` and `S1 · Lea laptop · Screen 1`; a new output link and no IP restriction; none of the original's log entries; the original unchanged (same revision); `production.duplicated` in the audit log.

**E2E-XFER-02** · P1 · pw (`xfer-api.spec.ts`) — Duplicate and export while live
- Steps: start the broadcast; duplicate with no name; export; read the original.
- Expect: "{name} (copy)" in standby, not active; the export answers 200; the original is live with the same revision as before.

**E2E-XFER-03** · P0 · pw (`xfer-api.spec.ts`) — Export, preview and import through Caddy
- Steps: `GET …/export`; read the ZIP; dry run; import; import again; audit.
- Expect: `application/zip`, a `.studioflow.zip` file name; `manifest.json` (`studioflow-production`, version 2, no audio channels) and one medium whose SHA-256 is in the manifest; no `prd_`, `scn_`, `itm_`, `dev_` id, device secret, output key or slug in the manifest; the preview says `{name} (2)`, 3 scenes, 1 medium, the placeholders and the warnings `nameChanged` and `placeholders`, and creates nothing; the import is 201, not active, with the same scenes without ids and the same picture bytes, a new output link; the second import is " (3)"; `production.exported` and `production.imported` in the audit log.

**E2E-XFER-04** · P0 · pw (`xfer-api.spec.ts`) — Refused files and what is left
- Steps: import and dry run of a text file, a ZIP without manifest, `formatVersion` 99, an entry `../evil.txt`, `/etc/evil.txt`, `other/evil.png`, a deflated ZIP bomb (40 MiB of zeros), a changed medium (wrong checksum), an SVG; then the list of productions and `find /data/media` in the api container.
- Expect: 400 `invalid_archive` (also for the first six and the checksum), 400 `unsupported_format`, 415 `unsupported_media` for the SVG, each as preview and as import; the same productions as before and the same files under `/data/media`.

**E2E-XFER-05** · P1 · pw (`xfer-api.spec.ts`) — The import route in Caddy
- Steps: raw TLS requests (headers only) to `POST /api/productions/import` with `Content-Length` 4100 MiB + 1 and 4097 MiB + 1, with the session; the import and the export without session.
- Expect: 413 from Caddy before a body is sent for the first, 413 `archive_too_large` from the API for the second; 401 for both calls without session.

**E2E-XFER-10** · P0 · pw (`xfer-ui.spec.ts`, K1) — Duplicate, pair, "Use as K1": the picture is back in every K1 scene
- Pre: a production with a real phone (stamp camera) live as K1 in two of three scenes.
- Steps: production menu → "Duplicate production…" (the name reads "… (copy)", the hint says cameras and screens become placeholders) → "Duplicate"; the copy is listed and not current; click it to switch; look at the Sources dock; pair a second real phone with the QR code of the copy; "Use as K1 · Stage phone" in its station row; start the broadcast; open the output; switch to the second scene.
- Expect: the toast "Production “… (copy)” created. It is not active …"; the active production stays the original until the click; the first item reads K1 "Source missing" and "Missing sources" lists "K1 · Stage phone in 2 scenes"; the new phone is offered "Use as K1 · Stage phone" (and is K2 until then); after the click the toast says the scenes show it in place of "K1 · Stage phone", the offer and the section are gone, the phone is K1 in the station row, in the Sources dock and in both scenes (API); the output plays one video in the first scene and one in the second.

**E2E-XFER-11** · P1 · pw (`xfer-ui.spec.ts`) — Export and import in the Regie
- Steps: "Export" in the production menu (download); "Import…" → choose the file; read the preview; "Import"; choose a text file.
- Expect: a download named `….studioflow.zip` that holds `manifest.json`, and the toast "Export of “…” started"; the preview shows the name with " (2)", "3 scenes", the placeholder "K1 Stage phone" and the warning that the name exists, and the list of productions is unchanged; after "Import" the toast "Production “… (2)” imported. It is not active …", the production is listed and not current, the original stays active, its scenes are the same and K1 is a placeholder; the text file is explained as "not a valid StudioFlow export" and creates nothing.

**E2E-XFER-12** · P1 · pw (`xfer-ui.spec.ts`) — Assign and remove in the Sources dock
- Pre: a copy (K1 in two scenes, S1 in one) as the active production with a second phone paired that no scene uses.
- Steps: "Assign K1 · Stage phone" → the phone; "Assign S1 …" → "Remove from all scenes…" → Cancel → "Remove from all scenes…" → "Remove S1 · Lea laptop · Screen 1".
- Expect: the toast "The scenes now show Spare phone in place of K1 · Stage phone."; K1 is gone from "Missing sources", the first two scenes show the phone, the placeholder list has S1 only; the confirmation says "The 1 element that shows S1 … is removed from its scene." and Cancel changes nothing; after the removal there are no placeholders and the scene has lost the screen item.

### 2.20 PERF – Performance (issue #12)

Issue #12, decisions «#12», spec 7, 8.3, 8.4, 9.1–9.3, runbook 11, DESIGN.md "Load". The work was measured first and optimised by the measurement: the budget in 5.1 holds the numbers before and after. The container the automated tests run in has no GPU (Chromium renders with SwiftShader and every codec runs in software, `power efficient` is false everywhere), so the numbers are the worst case of "no hardware acceleration" and compare two builds on one machine; what the hardware of real laptops, phones and the proxy computer does stays a manual measurement (MAN-16).

**UNIT-PERF-01** · P0 · vitest (`screen-codec.spec.ts`, `encoder-info.spec.ts`, `room-options.spec.ts`, `publisher.spec.ts`, `source-provider.spec.ts`) — Media client
- Steps: the screen codec for every answer of `MediaCapabilities.encodingInfo` (VP9 power efficient, not, unsupported, no API, an exception) and the probe once per publisher; publish options and capture constraints at 15 and 30 fps; `setScreenFrameRate` before a share and on a running one (constraint, content hint, encoder limits, no new picker); `codec`, `encoder`, `hardwareEncoder` and `qualityLimitation` in the slot telemetry; a track nobody asked for, a consumer that comes back within the grace time, resume, elements emptied during a pause and when attached to a paused source; the decoder of a stream from the stats and from `MediaCapabilities`; `decoderSummary` over two intervals.
- Expect: H.264 unless VP9 is power efficient (VP8 backup only with VP9); 15 fps, 3 Mbit/s, `detail` by default and 30 fps, 4.5 Mbit/s, `motion` with "Video in screen"; paused after 5 s (output), 10 s (Regie) and 1.5 s after a track arrives without a consumer once the page has asked for a picture of anything (before that the normal time holds: a page that is loading), resumed at once with the size asked for; no stale picture after a pause; a paused stream is not counted as decoding; a browser that hides the implementation is asked what it would choose.

**UNIT-PERF-02** · P0 · vitest (`visibility.spec.ts`, `fps-meter.spec.ts`, `snapshot-budget.spec.ts`, `desired-sizes.spec.ts`, `scene-renderer.visibility.spec.ts`, `.thumbnail.spec.ts`, `.sizes.spec.ts`, `.hold.spec.ts`, `.lifecycle.spec.ts`, `.stress.spec.ts`) — Renderer
- Steps: visible/hidden through IntersectionObserver and `visibilitychange`, without the API, dispose; the desired sizes at pixel ratios 1, 1.5 and 3, capped by the canvas, none while hidden; thumbnails as stills (one hidden video per source for all thumbnails, a snapshot every 1.5 s, none while hidden or lost, the stalest first, waiting while copies are expensive); the rolling hold frame, the copy at the loss, the blur baked once (`data-held-blur`), the time budget; a video that only knows its size, a frame of two by two pixels (a stopped sender), a frame that was never painted and a black frame are not copied, the previous copy stays and no empty hold frame is shown, a blur that fails puts the sharp picture back (issue #50); preloading of the preview scene at the size on stage and of nothing else; `FpsMeter` from `getVideoPlaybackQuality` (fps of the busiest video, cumulative presented and dropped frames, no timer without a video); a stress run with many items.
- Expect: a monitor or thumbnail that cannot be seen asks for no picture, keeps no timer and takes no copy, and asks again when it can be seen; the output never pauses; the requested size is the displayed size × at most 1.5 and never above the canvas; a thumbnail has no `<video>` of its own; the held state shows the picture blurred by 2.5 % of the item width without a CSS filter; an expensive copy delays the following ones, the first copy and the copy at the loss never wait; `stats().fps` is the video frame rate; no permanent `requestAnimationFrame` loop.

**UNIT-PERF-03** · P0 · vitest (`apps/output`: `playback-load.spec.ts`, `program-view.spec.ts`, `output-app.spec.ts`, `debug-overlay.spec.ts`, `debug-overlay.de.spec.ts`) — Output page
- Steps: the preload selection for every state (no preview, preview = program, preview ≠ program, unknown preview, Studio Mode off); the report with dropped frames, decoded and software streams over intervals, paused streams, a provider without the summary, invalid numbers; the overlay lines for decoder and dropped frames in English and German.
- Expect: the preview scene and only it is preloaded; `droppedFramesPct` is the share of dropped against received frames since the previous report, `decodedStreams` and `softwareDecodedStreams` count the streams that decoded; nothing is reported where the browser or the provider does not tell; the overlay reads the decoder per source and the dropped share.

**UNIT-PERF-04** · P1 · ng — Regie and sender
- Steps: station line and details (CPU tag, "Encoding", "Decoding here"), the station thumbnail (asks for nothing while hidden, pixel ratio cap), the output chip and popover (dropped frames, software streams, threshold 5 %, stale pages ignored), the monitoring page (column "Encoding", sorting by load, tag), the sender toggle "Video in screen" (per slot, persisted, applied to a running share, forgotten on "Remove"), all in English and German.
- Expect: "CPU at limit" only for `qualityLimitation = cpu`; "drops frames" from 5 % of a connected link; the toggle sets 30 fps and back to 15 and survives a reload.

**UNIT-PERF-05** · P1 · vitest (`tests/e2e/support/perf/budget.spec.ts`) — The budget check
- Steps: a summary within the budget, one more decoded stream, more videos, a load 20 % over and just over, `PERF_BUDGET_SCALE`, the screen codec and frame rate cap, a value that was not measured, every key of the budget against the flat table.
- Expect: counts fail on any rise; loads fail beyond budget × scale × 1.2; a missing value is a failure, not a pass; the counts and the loads (with the starvation of the senders) can be checked apart (`checkBudgetParts`), because only the loads depend on the headroom of the machine.

**UNIT-PERF-06** · P1 · vitest (`tests/e2e/support/output/quiet.spec.ts`) — Timing tests on a machine without headroom (issue #39)
- Steps: the plan of the attempts of a measurement (`planAttempt`: the first attempt always runs, a further one only if a whole run still fits before the timeout less the reserve, the wait for a quiet machine is capped for the whole test and never eats into the run), a simulated sequence for the tests of the issue (900 s and 600 s timeouts, runs of 66 s and 35 s, wait caps of 30 s and 240 s), `measureWhenQuiet` with a fake clock (a quiet run, a busy machine, a test that is running out of time), `waitForQuietMachine` (no wait without time, never longer than its timeout), `timingGate` (at most 60 % CPU, unknown load) and `judgeTiming` (a failure on a quiet machine fails, on a busy one it ends in a skip with the first failed threshold, a pass stays a pass).
- Expect: a machine that never gets quiet costs the wait cap plus the runs and ends in `quiet: false`, never in the test timeout (the old code needed 3 × 312 s for a 900 s test); thresholds are enforced exactly when the machine was at 60 % CPU or less.

**INT-PERF-01** · P1 · xunit (`RuntimeTests`, `OutputLinkApiTests`, `OutputLinkHubTests`, `HubTests`) — Reports and relay
- Steps: a device report with `encoder`, `qualityLimitation` and an unknown reason; an output report with dropped frames and decoder counts through REST and the hub, from an old page without the fields, with implausible values; the throttling of `outputStatusChanged`.
- Expect: the telemetry relayed to the Regie carries the encoder facts and `cpu | bandwidth | other` only; the per-link and summary status carry the load; implausible numbers are dropped, old pages leave the fields empty; a dropped share that crosses 5 % (the point from which the Regie warns) in either direction is published at once, other changes (a flicker from 0 to 1.7 %, 18 % to 10 %, latency or fps within 20 %, a changed decoder count) at most every 5 s.

**E2E-PERF-01** · P1 · pw (`perf-reference.perf.spec.ts`, project `perf`, tag `@perf`) — Reference scenario against the budget
- Steps: 4 phones (camera 1080p, fake media), 2 laptops (screen 1440p), 6 scenes (Host, Panel = program, Four, Slides = preview, Two screens, Everything), Studio Mode on, Regie at 1280 × 800 with a device pixel ratio of 1.5, output page at 1920 × 1080, one Chromium instance per role. After 20 s of settling: 45 s idle (CPU time per browser through `SystemInfo.getProcessInfo`, main thread through `Performance.getMetrics`, WebRTC `getStats` of every page with `decoderImplementation`/`powerEfficientDecoder`/`encoderImplementation`/`powerEfficient`/`qualityLimitationReason` or, where Chromium hides them, `MediaCapabilities`), a sampled profile of the main thread of the Regie and the output, 15 s with the picture-in-picture camera dragged in the preview monitor, then a switch to the preview scene and to a scene whose sources nobody asked for. The numbers go to `tests/e2e/.output/<stack>/results/out-perf-reference.json` and to the log (`[perf] key = value`).
- Expect: the output decodes only the sources of the program and the preview scene; no count exceeds the budget in 5.1 (exactly, on any machine) and no load by more than 20 % (when no sender was at its CPU limit and the machine was at 90 % CPU or less: otherwise the run is skipped as `not-comparable`, 6.8); screens go out as H.264 at no more than 15 fps; no sender reports a CPU limit. Run it before and after a change on the same machine and compare the table: `E2E_REUSE_STACK=1 tests/e2e/stack.sh test <N> --project=perf tests/e2e/specs/perf/perf-reference.perf.spec.ts` (`PERF_SECONDS` scales the windows, `PERF_BUDGET_SCALE` the loads).

### 2.21 AUD – Audio

Issue #7, decisions «#7», spec 4.10 and 7–9, runbook 20. One global mixer per production (fader −∞ … +10 dB, mute, mode, sync offset), sources: the audio
station, the sound of shared screens and videos, microphones of devices (muted by default); the output page mixes with Web Audio, the Regie shows the
Audio dock. The E2E specs are in `tests/e2e/specs/audio/` and run in English (`en-US`) on Chromium; the sources are the sine tones of 1.3 and the output page
(or the Regie page) is measured with the audio probe. Times are measured on a loaded 4-core machine (load average 25) and are limits with room.

**UNIT-AUD-01** · P0 · vitest (`audio.spec.ts`, `audio-silence.spec.ts`, `selectors.spec.ts`, `source-ref.spec.ts`, `log-entries.spec.ts`) — Mixer rules of the scene model
- Steps: limits, `dbToGain` / `gainToDb`, the fader scale both ways, clamps, `defaultAudioChannel` for station / device microphone / screen / video, `allowedAudioModes`,
  `followsPicture` for a screen, a video and a microphone (the whole device counts), `isChannelAudible` over broadcast × muted × gain × mode, `audioTargets`, `audioExpected`,
  `audioChannelRows`, `audioRampMs` (broadcast change, fade, cut, 10 s cap), `SilenceTracker` (10 s under −60 dBFS, reset by sound, not audible, no sound, channel removed); the reducer
  (`audioChannelsChanged` upserts only the listed channels, an empty list changes nothing, `sourceRemoved` drops the channel); the slot `mic`, the code A, the log texts.
- Expect: −100 is silence and the only number below −60 that is not a value; the useful fader range −60 … +10 dB takes 96 % of the travel; a device microphone starts muted, a station always audible, a video allows follow and off only; nothing is audible outside a live broadcast; the preview never counts; the ramp is 20 ms, 300 ms or the fade (≤ 10 s).

**UNIT-AUD-02** · P0 · vitest (`ramp.spec.ts`, `audio-graph.spec.ts`, `level.spec.ts`, `asset-audio.spec.ts`) — The Web Audio graph
- Steps: a graph with fake nodes: channels added, ramped, removed and returning (they ramp, they do not click), fader and sync offset applied, equal-power curve from 100 ms, program and PFL monitor,
  meters, state `blocked` / `running` / `unavailable`, resume on a gesture, `setSinkId` where it exists, keep-alive of remote streams, disposal; level reading; the tap of a video element (`captureStream`, once on attach, again on a new stream, detach).
- Expect: every parameter change is a sample-accurate ramp, a channel that leaves and comes back ramps from silence; the monitor bus never carries more than the chosen channel or the program; a stream of a video needs no keep-alive; nothing throws without Web Audio.

**UNIT-AUD-03** · P0 · vitest (`audio-publisher.spec.ts`, `publisher-screen-audio.spec.ts`, `source-provider.spec.ts`, `media-stats.spec.ts`) — Publishing and receiving sound
- Steps: `publishMic` with both profiles (constraints, publish options: Opus with RED, DTX off, stereo only for the station), a chosen input, switching the input, an ended track (grace, search on `devicechange` and by timer, recovery), permission denied / device missing / in use, `unpublish`, rejoin republish, telemetry; `publishScreen(slot, { audio })` with and without sound, the sound ending with the picture; the provider's audio streams per `{identity}/{track}` and `screen-n-audio`, `onAudioChange`; audio stats (bitrate, loss, jitter, buffer, codec).
- Expect: a station sends stereo with processing off, a voice microphone mono with processing on; a lost microphone is `ended` and found again by itself; a screen without sound publishes no audio track and says so; the audio of a source is reachable by its source id.

**UNIT-AUD-04** · P0 · vitest (`output-audio.spec.ts`, `output-app.audio.spec.ts`, `debug-overlay.audio.spec.ts`, `debug-overlay.audio.de.spec.ts`, `config.spec.ts`, `deferred-provider.asset.spec.ts`, `scene-renderer.asset-audio.spec.ts`) — Output page sound
- Steps: the state of the production applied to a fake mix (targets, ramps for a cut, a mute, a fade, a broadcast change), `?audio=off`, `blocked` → running after a gesture, the report (`off | running | blocked | unavailable`, peak, null below −90 dBFS, no `audio` at all before the mix exists), the mix created after the first frame and not before (it takes the state, sounds and videos noted until then), the "Sound on" button only while blocked **and** something could be heard, "No access" cuts the sound, the debug lines (English and German), the asset tap through the deferred provider and the renderer's `attachAsset`.
- Expect: the same targets and ramp rule as the Regie; no button without expectation; no audio context at all with `audio=off`; the report follows the state.

**UNIT-AUD-05** · P1 · ng (`studio-audio.service.spec.ts`, `audio-commands.service.spec.ts`, `audio-dock.component.spec.ts`, `audio-rows.spec.ts`, `control-column.audio.spec.ts`, `header.audio.spec.ts`, `asset-audio-provider.spec.ts`, `keyboard.service.spec.ts`, `dock-layout.service.spec.ts`, `station-view.spec.ts`) — Regie
- Steps: the Regie's copy of the mix and its meters (fall-back, pre-fader peaks, silence warning after 10 s), monitoring (off, program, PFL of one channel), commands (mute, fader drag as one step with `adjusting`, mode, sync offset, undo and redo of 60 steps, the M key, Ctrl+Z in the dock), rows (microphones always, screens while they share sound, videos with sound, state words), the program level above Take, "Audio blocked" in the output chip, the audio station's row without a picture, the fifth dock and the migration of a stored layout.
- Expect: a drag is one request chain and one undo step; undo sends the previous state of the channels it touched; stored layouts get `audio` at the end of the bottom zone; nothing is played unless monitored.

**UNIT-AUD-06** · P1 · ng (`device-session.service.spec.ts`, `input-level.component.spec.ts`, `station.audio.component.spec.ts`, `start.component.spec.ts`, `redeem.component.spec.ts`, `knock.service.spec.ts`, `sender-settings.service.spec.ts`, `device-report.spec.ts`) — Sender
- Steps: starting and stopping the microphone (allocation, `limit_reached`, auto-start of the audio station, off on purpose stays off after a reload, input choice, report and telemetry, removal), "Share audio" (the option reaches `publishScreen`), the microphone panel and the audio station page, the phone button, the level meter (bar, red close to clipping, silence hint after 10 s, suspended context starts with the first touch), pairing as an audio station (form, knock restored after a reload, `?station=audio`), settings parse.
- Expect: nothing is asked of the browser until the person switches the microphone on (phone, laptop); the audio station starts by itself; a live microphone counts as on air for updates.

**UNIT-AUD-07** · P0 · xunit (`AudioMixerTests`, `AudioMixerServiceTests`, `BasicsTests`, `SourceStatusTests`) — Domain
- Steps: pairing an audio station, allocating and releasing the microphone (once per device; an audio station allows nothing else and cannot remove it), codes A1…, default names, `CarriesSound`, default channels, validation (gain −100 … +10 finite, sync 0 … 500, unknown source, camera, missing channel, duplicates, video with `always`), `IsAudible` over every input, `FollowsPicture`, applying channels (only the listed ones, unchanged = no change, one invalid = nothing applied, sync and drop of stale channels), the tally of a microphone slot and `AudibleSources`.
- Expect: as in spec 4.10 and the rule table of `IsAudible`.

**INT-AUD-01** · P0 · xunit (`AudioApiTests`) — Mixer REST, events, audit
- Steps: pairing and slot use cases against the real hubs and PostgreSQL; `PUT …/audio/channels` (round trip through the database, the wire format with camelCase names and enum strings, invalid values with field paths and nothing changed, unknown mode and wrong JSON type, no session, no CSRF header, unknown production, two seats with different faders); events (one revisioned event to the Regie and the output with the same revision, replay to a client that is behind), audit (one entry per change, none while adjusting, the last request of a drag writes the gain), tally of the microphone slot, incidents of a failed or stopped microphone, snapshots with `audioChannels`, many channels, the report of the output (`audio` state reaches the Regie's status, nonsense is dropped or refused).
- Expect: 200 with the stored channels, 400 `validation_failed` naming `channels[n].field`, 401, 403, 404; exactly one event and one revision per changing request; the output sees the event; audit text “A1 muted”, “A1 gain -6.0 dB”.

**INT-AUD-02** · P0 · xunit (`AudioMixerMigrationTests`, `InfrastructureTests` container cases) — Migration and the sound of videos
- Steps: a database from before `AddAudioMixer` with productions, devices and videos migrated up (and `SyncAll` giving the channels, idempotent); MP4 (moov first or last, audio and video tracks, only video, empty moov) and WebM (track types) files, broken and truncated files, images; upload of a video with and without sound; deletion; duplicate, export and import of a production with two videos with sound (one with a changed channel), a silent video and an audio station; the import of a file as version 1 wrote it (no `audioChannels`); a manifest with a channel that points nowhere or has a gain of +40 dB (`invalid_archive`, `audioChannels[0]`), with an unknown mode.
- Expect: existing productions get an empty mixer and no sound (`hasAudio` false); the detection reads headers only and never throws; a video with sound has a channel that goes with the asset; a copy and an import have `hasAudio` and a channel for every video with sound, under its new id, with the fader, mute, mode and delay of the original, and none for the station or the silent video; a file of version 1 gives the defaults.

**INT-AUD-03** · P1 · xunit (`DeviceAndPairingApiTests`, `InfrastructureTests`) — Pairing, reports and LiveKit grants
- Steps: an invite link redeemed as `audioStation` (laptop link only; a phone QR code ignores it), a knock as an audio station, the report of a device with the slot `mic`, LiveKit tokens (a sender may publish camera, screen, microphone and screen audio; the Regie and the output may not publish).
- Expect: the kind is honoured only where specified; the token's `canPublishSources` has the four sources for senders and the Regie and the output cannot publish.

**E2E-AUD-01** · P0 · pw (`aud-chain.spec.ts`) — Audio station to the output page
- Steps: pair an audio station through the API (a laptop link redeemed as `audioStation`); its page starts the microphone (a 440 Hz tone) by itself; before the broadcast the output page (clicked once) is silent; start the broadcast; end it.
- Expect: the station is `kind audioStation`, slot `mic` code A1, one source A1 and one channel `{ 0 dB, unmuted, always }`; the page asked for stereo with echo cancellation, noise suppression and automatic gain off; the station shows a moving level and "Mic live" and its tally frame is `program` only while on air; the output plays a tone near 440 Hz at about −6 dBFS (±2.5) only while live and is silent within 800 ms of the end; `@smoke`.

**E2E-AUD-02** · P0 · pw (`aud-mixer.spec.ts`) — Mute, fader, mode and sync offset on the output
- Steps: five rounds of mute and unmute through the API; fader at −6, −20 (`adjusting`), +10, −100, 0 dB; modes off, always, follow (a microphone without a picture of its device is not audible); sync offset 250; a second output page opened later.
- Expect: mute is silent within 300 ms of the answer (measured 6–60 ms), unmute brings the tone back as fast; the peak follows the fader in dB (−12, −26, +4 dBFS), −100 is silence; `off` and `follow` without a picture are silent, `always` is audible; the offset is stored and returned without a change of level; a page opened later has the same mix.

**E2E-AUD-03** · P0 · pw (`aud-mixer.spec.ts`) — Invalid values and grants
- Steps: gain 10.5 / −100.5 / text, sync 501 / −1 / 12.5, unknown mode, wrong types, empty and missing source id, unknown source, empty and missing list, duplicates, one wrong channel next to a right one; the extremes −100, +10, 0 dB and 500, 0 ms; unknown production; no session, no CSRF header, the output key, a device bearer and the output API.
- Expect: 400 `validation_failed` and no change at all (the right channel of a mixed request is not applied, the revision does not move for refused requests); the extremes are valid; 404 `not_found`; 401 `unauthorized`; 403 without the header; neither the output key, a device nor the output API can move a fader.

**E2E-AUD-04** · P0 · pw (`aud-regie.spec.ts`) — The Audio dock
- Steps: Regie with an audio station on air: the dock in the default arrangement and its row (code, name, "PGM"), the first click and the meters, mute by mouse (second Regie seat open), undo and redo buttons, the M key on the selected row, the fader by keyboard (Home = −∞, End = +10 dB, double click resets), mode off and always, sync offset 120, the audit log.
- Expect: the dock is there with A1 "Mixing desk" and 0.0 dB; the meter and the program level above Take move after the first click; mute silences the output and sets `aria-pressed` on both seats without a reload, the row loses "PGM"; undo and redo move the output and both seats; M toggles; the dB text follows the keys (−∞ dB, +10.0 dB, 0.0 dB) and the output follows (peak 4 dBFS at +10 dB); the audit log has `audio.changed` “A1 muted”, “A1 unmuted”, “A1 mode off”, “A1 mode always audible”, “A1 sync offset 120 ms”.

**E2E-AUD-05** · P0 · pw (`aud-regie.spec.ts`) — "Audio blocked" and "Sound on"
- Steps: no output page: no warning; an output page whose audio contexts wait for a gesture (`audioGate`) with the broadcast live; one click on it; then `?audio=off`.
- Expect: the output chip says "Audio blocked" within 20 s (its tooltip names the click), the page shows the "Sound on" button; after one click the tone plays, the button and the warning go; a page with `audio=off` is not blocked, has no button and no audio context.

**E2E-AUD-06** · P0 · pw (`aud-sources.spec.ts`) — Screen sound follows its picture
- Steps: a laptop with "Share audio" ticked shares a screen whose sound is a 880 Hz tone; the screen is put in the live scene; cut to a scene without it and back; hide the item and show it again; modes always and off; end the share.
- Expect: the page explains what a browser can share before sharing and says "with sound" afterwards; the source gets the channel `{ 0 dB, unmuted, follow }` and a row in the Regie; the tone is heard while the picture is shown (cut away: silent within 900 ms), a hidden item is silent, `always` plays without the picture, `off` never; no tone source is left on the laptop after "Stop sharing".

**E2E-AUD-07** · P1 · pw (`aud-sources.spec.ts`) — A browser that shares no sound
- Steps: a laptop shares with "Share audio" ticked but the browser returns a picture only; stop, untick, share again.
- Expect: "No sound is shared with this screen." next to the screen and no row for it in the Regie; the mixer still has the channel; the second share (box off) says nothing and asks for no audio.

**E2E-AUD-08** · P1 · pw (`aud-sources.spec.ts`) — A fade fades the sound with the picture
- Steps: an audio station (440 Hz, always) and a screen with sound (880 Hz, follow); a 2 s fade to a scene without the screen and back, the strength of both tones sampled every 40 ms (170 ms window; medians over windows).
- Expect: the first third of the fade is still at the level (a fade, not a cut), the last fifth is clearly lower, and 0.8 s after the fade the tone is more than 20 dB down and gone about when the fade ends (±0.9 s); the fade in starts from silence and is back at its level 0.6 s after the end; the station is not touched.

**E2E-AUD-09** · P0 · pw (`aud-sources.spec.ts`) — Unplugged and plugged-in microphone
- Steps: the microphone of the audio station on air is pulled out (tracks end, `devicechange`) and plugged in again.
- Expect: the output is silent within 30 s of the pull (measured about one second), the page says "The microphone was disconnected.", the source is `ended` and an incident "A1" is in the status line and the snapshot; after the plug the page finds the device by itself (`live`), the tone returns, the incident heals and the log has “A1 is back, was gone for …”.

**E2E-AUD-10** · P1 · pw (`aud-regie.spec.ts`) — Silence is a warning
- Steps: the desk's tone goes to level 0 (the track stays) while on air; the signal returns; the channel is muted while the desk is quiet.
- Expect: "no signal for 10 s" in the row after 9–25 s, the row marked silent, the status line names A1; no incident, "1 station ok"; the warning goes with the signal; a muted channel is not watched (it only says "muted").

**E2E-AUD-11** · P1 · pw (`aud-sources.spec.ts`) — Four channels at once
- Steps: an audio station and three laptops with screen sound (440, 660, 880, 1100 Hz) all on air; mute one, put the station off and the third screen at −20 dB in one request, delete a device.
- Expect: the Regie lists four rows and the output spectrum has the four tones; a mute removes exactly its tone; one request moves two channels; the −20 dB tone is clearly weaker (> 8 dB); a deleted device's channel and tone disappear and the dock has three rows; no page error.

**E2E-AUD-12** · P1 · pw (`aud-sender.spec.ts`) — The audio station is paired through the form
- Steps: the pairing form with "Audio station (mixing desk)", the check code, "Allow" in the Regie; the page; the input list and a chosen input; "Switch microphone off", reload, "Switch microphone on", reload.
- Expect: the check codes match; the page has the name, the panel "Sound from the mixing desk", code A1, the note about unprocessed stereo, no screen or camera buttons, a moving level; the Regie shows the station (A1) and one `audio` source; choosing an input requests it exactly (`deviceId.exact`); off stays off after a reload (the browser is not asked), on again keeps the input, and a reload with the microphone on starts it by itself.

**E2E-AUD-13** · P1 · pw (`aud-sender.spec.ts`) — The microphone of a phone
- Steps: a paired phone: "Microphone off" is shown, the browser was not asked; switch it on; the camera is in the live scene; the Regie unmutes; a scene without the camera; switch it off, reload.
- Expect: the first press allocates `mic` and the source A…; its channel is `{ 0 dB, muted, follow }`; the output is silent although the phone is on air; after the unmute the tone (550 Hz) plays and the phone shows "Mic live"; a scene without the phone's camera silences it and the tag goes; off stays off after a reload.

**E2E-AUD-14** · P1 · pw (`aud-monitor.spec.ts`) — PFL and monitoring
- Steps: the Regie page measured with the probe: nothing played by default; PFL on the channel off air, with the channel muted and the fader at −30 dB; PFL off; Monitor → Program with the broadcast off and live; a mute on air; Monitor → Off, PFL, reload.
- Expect: the Regie is silent until the operator listens; PFL plays the channel at its own level (−6 dBFS) before fader and mute and the Monitor button is active; Program is silent until the channel is audible and then equals the output page (±3 dB); after a reload nothing is played and no PFL is on.

**E2E-AUD-15** · P1 · pw (`aud-assets.spec.ts`) — Sound of a video
- Steps: a WebM (VP8 + Opus, 1000 Hz) and a WebM without sound uploaded; both in the live scene; broadcast; cut away and back; fader −12; mute; delete the clip.
- Expect: `hasAudio` true / false; one channel `{ 0 dB, unmuted, follow }` for the clip only and a row in the Regie; silent before the broadcast, 1000 Hz at about −6 dBFS while the clip is in the program, silent in a scene without it; −12 dB gives about −18 dBFS; mute is silent; deleting the asset removes the channel.

**E2E-AUD-16** · P2 · pw (`aud-chain.spec.ts`) — Delay of the sound
- Steps: a tone that starts after silence at the audio station, five times; the time to the first audible tone at the output page.
- Expect: the median is under one second (the measurement includes about 60 ms of write-ahead of the fake source and a 21 ms probe window); the values are recorded in the report as `measurement` annotations (**T-AUDIO-DELAY**, section 5).

**E2E-AUD-17** · P2 · pw (`aud-assets.spec.ts`) — A copy and an import keep the sound of videos
- Steps: a WebM with a tone uploaded; its channel set to −9.5 dB, muted, off, 80 ms; `POST …/duplicate`; export and import of the file; read the snapshots.
- Expect: the copy and the import have the clip under a new id with `hasAudio` and the channel with exactly these values (new `sourceId`); the original keeps its channel.

---

## 3. Browser and device matrix

Legend: **●** runs and is required (priority of the test applies) · **○** runs nightly/weekly, a failure is reported but does not block · **◐** UI-only subset (no media; tally and state driven through the API) ·
**–** not applicable. "Regie browser" is always the browser of the Regie in that test; "sender" the browser of the phone/laptop. Viewport projects (`regie-*`) run only the DEV tests listed.

| E2E tests | chromium-desktop | edge-desktop | firefox-desktop | webkit-desktop | pixel7 | iphone14 / iphone15 | ipad | regie-* viewports | small-320 |
|---|---|---|---|---|---|---|---|---|---|
| AUTH-01, 02, 04, 05, 06, 07, 08, 09, 10, 15, 17, 19, 21, 22, 23, 24, 25, 26, 27 | ● | ○ (01, 02, 04) | ○ (01, 09, 10) | ○ (01, 09) | – | – | – | – | – |
| AUTH-03, 18, 20 (`@disruptive`) | ● | – | – | – | – | – | – | – | – |
| AUTH-11 (Regie XSS), 13 (output XSS), 14 (pairing XSS) | ● | – | ○ | ○ | – | – | – | – | – |
| AUTH-12 (sender XSS), 16 (credentials handling) | ● (laptop) | – | ○ | ○ | ● | ◐ | ◐ | – | ○ |
| PAIR-01, 02, 12, 14 (phone QR) | – | – | – | – | ● | ◐ | ◐ | – | ○ |
| PAIR-03…11, 16, 18, 19, 20 (laptop code/link, Regie side) | ● | ○ (03) | ○ (03, 10) | ○ (03) | – | – | – | – | – |
| PAIR-13 (re-recognition) | ● | – | ○ | ○ | ● | ◐ | ◐ | – | – |
| PAIR-15 (kind detection) | ● | ○ | ● | – | ● | ● | ● | – | – |
| PAIR-17 (probe-webinar fleet) | ● (laptops) | – | – | – | ● (phones) | – | – | – | – |
| SCENE-01…24 | ● | ○ (07, 08, 12) | ○ (07, 08, 12) | ○ (07, 08) | – | – | – | – | – |
| SWITCH-01…20 | ● | ○ (01, 06) | ○ (01, 05, 06, 07) | ○ (01, 05, 06) | – | – | – | – | – |
| SWITCH-11 (tally on devices) | – | – | – | – | ● | ◐ | ◐ | – | ○ |
| SRC-01, 09, 17, 18, 19 (phone sender) | – | – | – | – | ● | ◐ | – | – | – |
| SRC-02…08, 12…16, 20…22 (Regie side + laptop sender; phones from `pixel7` in the same scenario) | ● | – | ○ (06, 07) | – | ● | – | – | – | – |
| SRC-10, 11 (block, duplicate tab) | ● | – | ○ | – | ● | ◐ | – | – | – |
| OUT-01…25 | ● | ○ (01, 02, 03) | ○ (17) | ○ (17) | – | – | – | – | – |
| OUT-13/14 (latency) | ● (`perf` project; a short camera run in the nightly) | – | – | – | – | – | – | – | – |
| AUD-01…16 (audio: audio station, laptop, phone senders on Chromium; the output and the Regie measured with the audio probe) | ● (`@smoke`: 01) | – | – | – | ● (13, phone) | – | – | – | – |
| NET-00…26 | ● | – | – | – | ● (phones) | – | – | – | – |
| NET-03…06 (`@linux-netem`), NET-04b and NET-25 (`@netns`) | Linux CI only | – | – | – | – | – | – | – | – |
| DEV-01 | – | – | – | – | – | – | – | `regie-1280x720` ● | – |
| DEV-02, 03 | – | – | – | – | – | – | – | `regie-1440x900`, `regie-1920x1080` ● | – |
| DEV-04, 05, 06 | – | – | – | – | – | – | – | `regie-1180`, `regie-900`, `regie-390x844` ● | – |
| DEV-07, 11, 21 | – | – | – | – | ● | ◐ | – | – | ● (11) |
| DEV-08 | – | – | – | – | – | ● / ◐ | – | – | – |
| DEV-09, 20 | – | – | – | – | – | – | ● | – | – |
| DEV-10 | – | – | – | – | – | – | – | – | ● |
| DEV-12 | ● | ● | ● | – | – | – | – | – | – |
| DEV-13, 14, 15, 16, 17, 18 | ● | – | ○ (13, 17) | ○ (13, 17) | ○ (15, 17 sender) | – | – | ○ (15 at 900) | ○ (15 sender) |
| DEV-19 | – | – | ● | ● | – | – | – | – | – |
| DOCK-01…11 | ● | – | ○ (02…06) | ○ (02…06) | – | – | – | – | – |
| MEDIA-01…10 | ● | – | ○ (01, 03, 04) | ○ (03, 04) | – | – | – | – | – |
| LK-01…04 | ● | – | – | – | – | – | – | – | – |
| I18N-01…13 | ● (project `i18n`; 05 with the `pixel7` profile) | – | – | – | ○ (05) | – | – | – | – |
| OPS-01…19 | host shell (Linux; OPS-03 on Windows); OPS-04, 16 use `chromium-desktop` | – | – | – | – | – | – | – | – |

Device/browser facts used by the matrix: Pixel 7 runs Chromium with the fake-media flags (same engine as production Android Chrome); iPhone/iPad profiles use Playwright WebKit (an approximation of Safari,
not iOS: no real camera, no real wake lock, no real Battery API; hence MAN-01); Edge = Chromium with `channel: 'msedge'`; Firefox screen share is only exercised in `canvas` mode.

---

## 4. Manual tests (cannot be automated here)

Each procedure has a fixed evidence package: date, build/commit id, device models and OS versions, network (SSID, band, router), screenshots/screen recordings, and the measured numbers. Failures become defects with the evidence attached.

**MAN-01 · Real iPhone (Safari 17+, iOS 17+) as camera.**
Equipment: iPhone 12 or newer on 5 GHz Wi-Fi, Regie laptop, stack on LAN with a publicly trusted certificate (MAN-05). Procedure: scan the QR with the iOS Camera app; allow camera; start 720p then 1080p; switch front/back; put the phone on a charger and mount it landscape; check wake lock (screen stays on 10 min), dark mode, tally frame colours while the Regie switches program/preview; lock the screen for 10 s and unlock; receive an incoming call; switch to another app for 30 s; add to Home Screen and open as PWA; rotate; reload the page. Pass: pairing ≤ 10 s; picture at the Regie ≤ 3 s after start; tally changes ≤ 0.5 s after the switch; after lock/call/app switch the sender returns to live by itself ≤ 5 s after the app is visible again (or shows a clear “Try again” action when iOS forbids it) and the Regie shows “reconnecting” then “back”; no Battery value is shown on iOS (MAN-07); text readable without zoom.

**MAN-02 · Real Android phone (Chrome) as camera.**
Equipment: Pixel 6+/Samsung S21+ and one low-end device. Procedure: as MAN-01 plus: battery level and charging in the station detail, low battery < 20 % shown as “Battery n%”, camera switch command from the Regie, Wi-Fi ↔ mobile data toggle, 60 min continuous 1080p on a charger (temperature, throttling). Pass: as MAN-01; Battery API values correct (±5 %); no thermal shutdown in 60 min; resolution drop (if any) visible in the Regie “Resolution”.

**MAN-03 · Real Wi-Fi roaming and network change.**
Equipment: two access points (same SSID, 5 GHz), a phone sending, Regie and output open. Procedure: walk the phone from AP 1 to AP 2 while sending; toggle airplane mode 5 s and 30 s; switch Wi-Fi off/on; hop between 2.4 and 5 GHz; test a guest/captive-portal network (expected: pairing refused or unreachable with a clear message). Pass: roaming/blip < 10 s → output shows at most a still frame and the picture returns ≤ 3 s after connectivity (`T-RECOVER-SHORT`); 30 s → “reconnecting 00:30”, recovery ≤ 8 s (`T-RECOVER-LONG`); the Regie shows all six places; no manual action on the phone needed.

**MAN-04 · Real proxy and OBS Browser Source.**
Equipment: the actual proxy product or an OBS instance (CEF Browser Source), the production domain (or staging), IP of the proxy. Procedure: embed `/o/{slug}?k=…` exactly as in the plan (iframe with `allow="autoplay; fullscreen"`) and as OBS Browser Source (1920×1080; with and without `bg=transparent`); set `frame-ancestors` to the proxy's domain; set the IP restriction to the proxy's egress IP; run 60 min; rotate the key and give the proxy the new link; restart the proxy page. Pass: autoplay without interaction, letterboxing correct in a non-16:9 frame, transparent overlay shows alpha in OBS, restricted IP works (other IP gets “No access”), rotation kicks the old session ≤ 2 s, no frozen picture over 60 min, end-to-end latency measured with MAN-08.

**MAN-05 · Real certificates (DNS challenge) and device trust.**
Equipment: the real domain (e.g. `studioflow.example.com`), DNS provider API token with minimal scope, iOS/Android/Windows/macOS devices without any installed CA. Procedure: choose “Let's Encrypt through DNS: <provider>” in the wizard (or Server settings) after the first start; check issuance (staging CA first, then production), the certificate chain, HSTS; open the Regie, `/join` and an invite link on each device; restart the stack (certificate reused from `caddy_data`); simulate renewal (`caddy reload` with a near-expiry staging cert, or wait); revoke/rotate the token and confirm the failure mode is logged clearly; for `internal` mode install the Caddy root (`https://<domain>/ca.crt`) on one device per OS using the documented steps. Pass: no browser warning on any device in `dns` mode; camera/screen permissions are offered (secure context); renewal succeeds without downtime; internal-CA instructions work in ≤ 5 min per device.

**MAN-06 · Real screen-share stop UI.**
Equipment: Windows 11 + Chrome and Edge, macOS + Chrome, Safari, Firefox. Procedure: share entire screen, a window and a tab; end via the browser's “Stop sharing” bar, via the OS (macOS menu bar), by closing the shared window, by minimising it, by switching tabs; press “Share again” from the sender; share two screens; share with a laptop sleeping/waking. Pass: every end path raises a red incident “sharing stopped” ≤ 2 s (window closed/minimised may only freeze the picture – record behaviour); the browser never restarts sharing by itself; “Share again” works only from a click; the same slot and place in the scene are reused; text on screen stays sharp (`contentHint detail`).

**MAN-07 · Battery API availability.**
Procedure: open the sender on iPhone Safari, Android Chrome, desktop Chrome, Firefox. Pass: iOS/Firefox/Safari: no battery line and no “Battery 0%”; Android Chrome: value and charging state update within 10 s; the `/monitoring` column shows “–” where unavailable.

**MAN-08 · Real glass-to-glass latency.**
Equipment: a phone camera (or the sender phone) filming a running millisecond clock (stopwatch app) next to the output shown on a monitor; a 240 fps slow-motion camera (or screen capture of both at 120 fps) filming the clock and the output together; Wi-Fi 5 GHz, wired Regie/server. Procedure: collect ≥ 30 frames at random times; difference between the clock on the original and on the output = latency; repeat for camera (H.264), screen share (VP9) and via the proxy. Pass: p50 < 200 ms and p95 < 300 ms for the output (`T-LATENCY`, plan target ≈ 150 ms); record the numbers next to the automated figures of `E2E-OUT-13` and explain deviations > 50 ms.

**MAN-09 · Probe webinar (phase 1 acceptance, phase 2 go-live rehearsal).**
Equipment: 3 phones, 2 laptops, 2 operators, the proxy; 60 min. Script: pair everything with the three methods; build four scenes with templates; run with Studio Mode off and on; at minute 10 unplug one phone's Wi-Fi for 10 s; minute 20 a speaker stops sharing; minute 30 block/unblock a phone; minute 40 rotate the output key; minute 50 “End broadcast” and restart. Pass: no outage goes unnoticed (all six places), no operator-visible error text other than designed ones, picture never black, the proxy needs only the planned manual step (new link), runtime/latency numbers recorded, operators rate the Regie usable at 1440×900 and 1280×720.

**MAN-10 · Server placement: Regie laptop, Docker Desktop, VPS.**
Procedure: run the stack (a) on the Regie laptop with Docker Desktop (WSL2): check UDP 7882/TCP 7881 reachability from phones, Windows Defender prompts, correct media address (Server settings), behaviour when the laptop sleeps/changes network (expected: stack unavailable, documented); (b) on a Linux server on cable. Pass: phones send via both setups; no extra manual firewall steps beyond the runbook; load on the laptop leaves the Regie responsive (`T-FPS`).

**MAN-11 · Camera conflicts on laptops and phones.**
Procedure: laptop camera as slot while Teams/Zoom opens the camera; unplug a USB webcam; revoke the browser camera permission while live; phone: incoming call, another app takes the camera. Pass: slot becomes `failed` → “no picture” (red) after the re-acquire attempts; restarting from the sender returns “back”; no endless loop of permission prompts.

**MAN-12 · Screen readers and keyboard on real hardware.**
Equipment: NVDA/JAWS (Windows), VoiceOver (macOS and iOS). Procedure: operate login, switching, Take, outage handling, pairing and sender states with keyboard and screen reader only. Pass: an outage is announced (live region) within 2 s without moving focus; every control has a name; the order matches the visual order; Windows High Contrast keeps states distinguishable.

**MAN-14 · Remote camera control on real phones (issue #11, the spike).**
Equipment: at least one Android phone (Chrome, with an ultra-wide camera if possible, e.g. Pixel 6+ or Samsung S21+) and one iPhone (Safari 17+); Regie laptop; stack as in MAN-01. Procedure per phone: pair it, start the camera and open “Stations” → the phone → “Camera”. Write down what the panel offers (lenses, zoom range, focus, brightness range, light) next to the phone model and browser version: that is the capability matrix of the device and goes into the runbook table “Remote camera control”. Then: drag the zoom slider slowly and quickly (the picture follows, the value shown is the one the phone reports, no flood on a weak Wi-Fi: throttle the phone to 3G in the browser's network panel or move away from the access point); lock the focus and unlock it, point the phone at a close and a far object; move brightness to −2, +2 and press “Auto”; switch the light on and off; pick every lens while the station is in preview and then in the program (the confirmation appears only in the program); change the zoom on the phone's screen is not offered, so check that a second Regie operator who moves the same slider wins over the first (the last command wins) and both Regies show the value the phone reports; press “Reset to auto”; reload the phone page, lock and unlock the screen, take a call: the lens, zoom, focus and brightness come back as they were; put the phone to sleep or switch the camera to another app and send a command (the panel shows the real value or the inline message, never a stuck slider). Pass: only controls the phone supports are shown (an iPhone typically only the lens list); every value in the panel equals what the phone does; a lens switch in the program interrupts the picture for less than 1 s and the output shows the hold frame, not black; after a reload the camera is back as it was within 5 s; no console errors on the sender.

**MAN-15 · OBS virtual camera into Teams (issue #9, stage 1).**
Equipment: a computer that is not the Regie laptop with OBS Studio 31 or 32 and the new Teams app (Windows 11, and the same on macOS), a second participant on another device, the stack as in MAN-01. Procedure: runbook section 18 from the start (link “Teams camera”, download, import, Settings → Video, Start Virtual Camera, pick “OBS Virtual Camera”, background effects off); check the browser source plays without a click and survives a scene switch in OBS; check “?bg=transparent” on the same link in a second browser source; switch scenes in the Regie and watch them in Teams; switch the Wi-Fi of the camera computer off for 30 s and on again; measure glass to glass (a stopwatch or a clock in the picture, filmed together with the second participant's screen) at least ten times; revoke the link and see the page in OBS turn to “No access”. Pass: the import works without a message; the picture in Teams is the output picture, text readable at the size recommended in the runbook, no mirroring for the second participant; the picture is back within 10 s after the Wi-Fi returns without restarting the virtual camera; the latency is written down (median and worst) next to the OBS and Teams versions; revoking affects only this link.

**MAN-16 · Load on real devices (issue #12).**
Equipment: the devices of a real webinar: 3 to 4 phones (one low-end Android, one iPhone), 2 laptops (one without a discrete GPU, ideally a 4-year-old one), the Regie laptop and the computer that runs the proxy or OBS with the output page, all on one Wi-Fi 5 GHz; the stack as in MAN-01. Procedure: build the scenario of E2E-PERF-01 (4 cameras at 1080p, 2 screens, the scenes Host, Panel, Four, Slides, Two screens, Everything, Studio Mode) and run it 15 minutes. On every computer read the CPU load and the temperature (Task Manager or Activity Monitor; on Android and iOS the battery and the warmth of the case); in Chrome `chrome://gpu` and `chrome://webrtc-internals` of the Regie and of the output computer (the line `decoderImplementation` and `powerEfficientDecoder` of every inbound stream, `encoderImplementation` of the senders); the Regie station details ("Encoding", "Decoding here") and the output popover ("Decoding", "Dropped frames"). Then: share a slide deck from a laptop with and without "Video in screen" and play a video in the shared screen with the toggle on and off; switch to a scene that is in neither program nor preview (note how long the picture takes), then the same scene as the preview and take it; hide the Stations dock and look at the CPU of the Regie; put the Regie tab in the background for a minute and come back. Pass: no sender shows "CPU at limit" for longer than a few seconds; the output computer stays below 70 % CPU with no "drops frames"; screens are H.264 (hardware encoder on the laptops that have one; VP9 only where `powerEfficient` is true); the picture of a scene that is not in the preview is there within about 0.5 s after the keyframe; the Regie is usable (clicks answered within 150 ms) with the docks open; the CPU of the Regie drops when the dock is hidden or the tab is in the background; write the numbers next to the table in 5.1 and say which devices they come from.

**MAN-13 · External security scan.**
Procedure: run `testssl.sh` against the HTTPS endpoint, an OWASP ZAP baseline scan against the Regie, sender and output (authenticated and not), `nmap -p- <server>`; review the security-review document. Pass: only the published ports (80, 443, 7881/tcp, 7882/udp) are open; TLS ≥ 1.2 with modern ciphers; no ZAP findings above Low that are not documented; the CSP invariants I-CSP hold.

---

## 5. Acceptance thresholds

"Soft" = target, recorded and reported; "Hard" = the test fails. All values are measured on localhost or a wired LAN with the harness of section 1 unless stated; CI perf runner: ≥ 4 cores, no parallel load. Percentiles are over ≥ 20 samples (≥ 30 for latency). Xunit tests in the required CI job (`npm run test:api` runs next to other work) must not turn a latency into a pass/fail line; `T-REPORT` is the example: the test asserts what is independent of the machine (all 500 calls answered, one device read and no write per call, every source live) and a stall ceiling at fifty times the target, and prints the p95 against the 100 ms target. The p95 of ten clients, the server and PostgreSQL on one busy CPU was 105 and 120 ms in issue 21 (28 ms on a quiet machine); 100 ms is judged on a quiet machine, not on a loaded build agent.

| ID | Metric (measured from → to) | Soft target | Hard limit | Derived from |
|---|---|---|---|---|
| `T-REPORT` | Device hub `Report` round trip, 10 devices back to back after a warm-up, p95 | ≤ 100 ms | stall ceiling 5000 ms (`DeviceReportLatencyTests`) | — |
| `T-LOAD` | Regie: navigation → `regie-ready` (cold, p95 of 10) | ≤ 2 s | ≤ 3 s | plan §1 (light pages) |
| | Output: navigation → slate visible / `load` event | ≤ 0.5 s / ≤ 1 s | ≤ 1 s / ≤ 2 s | plan §5, spec 9.3 |
| | Output transfer size (HTML+JS+CSS, gzip/brotli) | ≤ 300 KB | ≤ 350 KB | spec 9.3 |
| | Sender: navigation → station state | ≤ 1.5 s | ≤ 3 s | — |
| `T-PAIR` | QR/link redeem → station visible in the Regie | ≤ 1 s | ≤ 2 s | plan §4 |
| | `POST /api/pairing/requests` → knock card in the Regie | ≤ 0.5 s | ≤ 1.5 s | — |
| | “Allow” → laptop connected (poll 1.5 s) | ≤ 2.5 s | ≤ 3.5 s | spec 4.6 |
| | Phone redeem → “Connected” | ≤ 2 s | ≤ 3 s | — |
| `T-VIDEO-START` | Track published → first decoded frame in a Regie monitor / the output (source already in the scene) | ≤ 2 s | ≤ 3 s | — |
| `T-DETECT-CLEAN` | Connection closed cleanly (setOffline, container stop, tab close) → outage shown in all six places | ≤ 2 s | ≤ 3 s | plan §6 (2–5 s) |
| `T-DETECT-SILENT` | Packets silently dropped (pause, disconnect, 100 % loss) → outage shown in all six places (device hub: keep-alive 2 s, timeout 5 s) | ≤ 5 s | ≤ 6.5 s [GAP-12] | plan §6, spec 6/12 |
| | Media-only loss while the hub stays up → outage shown | ≤ 6 s | ≤ 10 s | LiveKit ICE timeouts |
| `T-RECOVER-SHORT` | Outage ≤ 10 s: network back → output frames advancing | ≤ 2 s (p95) | ≤ 3 s | plan §9 phase 0 (reconnect in under 3 s) |
| | …→ Regie shows `ok` + “back” after frames advance | ≤ 0.5 s | ≤ 1 s | — |
| `T-RECOVER-LONG` | Outage ≥ 30 s (backoff at its 5 s cap + token + connect) → frames advancing | ≤ 5 s | ≤ 8 s | spec 8.2 |
| `T-SWITCH` | Regie click/key → first frame of the new scene on the output (cut), p50 / p95; the scene was in the preview or in the program (decision #12) | 150 ms / 250 ms | — / 300 ms | plan §2 |
| `T-SWITCH-COLD` | The same for a scene whose sources the output does not keep ready (neither program nor preview): layer in the DOM / first picture with the next keyframe | ≤ 300 ms / ≤ 0.5 s after the layer | ≤ 300 ms / ≤ 1.5 s after the layer | decision #12 |
| | Server: request received → event published, p95 | ≤ 20 ms | ≤ 50 ms | — |
| | REST mutation (scene item update) p95 / p99, local PostgreSQL | ≤ 50 / 150 ms | ≤ 100 / 250 ms | — |
| | Event fan-out to 10 subscribers p95 | ≤ 20 ms | ≤ 50 ms | — |
| `T-FADE` | Measured fade duration vs `durationMs` (the end is seen in the first frame after it, so the measure leaves out the part of that frame gap that exceeds one 60 Hz frame: a stalled page on a loaded runner is not the fade's error; `fadeDeviationMs` in `support/regie/kit.ts`; the frame before the one that reported the end lay less than the duration after the start, so the gap is at least the overshoot: a CI runner measured 367 ms for a 300 ms fade with 210-271 ms between two paints of the page, issue 31). What the animation engine says is checked besides, and does not depend on the frames: the fade finished by itself and was not cancelled, `effect.getTiming().duration` is the requested duration, and the end was not reported before the duration had passed (`expectFadeTiming`) | ± 17 ms | ± 50 ms | spec 4.2 |
| | Regie vs output fade start offset | ≤ 50 ms | ≤ 100 ms | — |
| | Fade left half-finished | never | never | PRODUCT.md principle 3 |
| `T-TALLY` | Switch event → `tally` applied on the device, p95 | ≤ 250 ms | ≤ 500 ms | — |
| `T-HOLD` | `data-state=hold` → `held` vs `holdMs` | ± 100 ms | ± 300 ms | spec 8.3 |
| `T-BLOCK` | “Block now” → sender “Blocked” and LiveKit participant gone | ≤ 1 s | ≤ 2 s | spec 4.6 |
| | “Unblock” → sender back (15 s retry cadence + connect) | ≤ 17 s | ≤ 20 s | spec 4.6 |
| `T-KEY` | Key regeneration → connected outputs kicked; old key REST 403 | ≤ 1 s; immediate | ≤ 2 s; immediate | spec 4.8 |
| `T-AUDIO-DELAY` | Tone at the audio station's microphone → first audible tone in the output page, median of 5 (E2E-AUD-16), localhost, loaded machine (measured 186–642 ms, median 511 ms) | ≤ 600 ms | ≤ 1000 ms | spec 4.10 |
| | Mute or fader change request answered → output silent / changed (E2E-AUD-02), median of 5 | ≤ 100 ms | ≤ 300 ms | decisions «#7» |
| | End of the broadcast → silent output (E2E-AUD-01) | ≤ 450 ms | ≤ 800 ms | spec 4.10 (300 ms ramp) |
| `T-LATENCY` | Canvas-to-canvas (timecode source → output `<video>`), 720p30, localhost: p50 / p95 / max | ≤ 150 ms / ≤ 250 ms / ≤ 600 ms | < 200 ms / < 300 ms / — | plan §2, §9 phase 0 |
| | Same for the Regie Program monitor | ≤ 150 ms | < 200 ms (p50) | spec 7 |
| | With `netem` delay 200 ms (both directions) | baseline + 400 ms | baseline + 400 ± 100 ms | — |
| `T-RESTART-API` | API healthy → Regie, output, senders connected and consistent | ≤ 6 s | ≤ 15 s | plan §6 |
| | `docker restart api` → healthy | ≤ 15 s | ≤ 30 s | — |
| `T-SHUTDOWN` | SIGTERM / `docker restart api` with hub clients connected → API process ended | ≤ 2 s | ≤ 5 s (`HostOptions.ShutdownTimeout`) | OBS-01 |
| `T-DB-OUTAGE` | PostgreSQL stopped or silent → request answered 503 ProblemDetails: direct API / through Caddy | ≤ 5 s / ≤ 5 s | ≤ 6 s / ≤ 10 s | GAP-32, BUG-21 |
| `T-RESTART-LK` | LiveKit healthy → output and senders playing again | ≤ 6 s | ≤ 10 s | spec 7, 8.4 |
| `T-RESTART-STACK` | All containers healthy → all browsers back; time to healthy after the command | ≤ 10 s; ≤ 60 s | ≤ 15 s; ≤ 90 s | plan §6 |
| `T-SYNC-DELTA` | Hub reconnected → state consistent: delta / snapshot | ≤ 1 s / ≤ 2 s | ≤ 1.5 s / ≤ 3 s | spec 6 |
| `T-FREEZE` | `totalFreezesDuration` per minute: 5 % loss / 200 ms delay | ≤ 1 s / ≤ 0.5 s | ≤ 2 s / ≤ 1 s | — |
| | 20 % loss: longest freeze | ≤ 2 s | ≤ 5 s | — |
| `T-FPS` | Output rendered fps with ≤ 9 items, 1080p, 4-core runner / at CPU throttle 4× | ≥ 28 / ≥ 24 | ≥ 24 / ≥ 20 | spec 8.3 |
| | Output main-thread busy (CDP `TaskDuration` / wall time) | ≤ 40 % | ≤ 60 % | — |
| | Regie click → visible reaction / at throttle 4× | ≤ 100 ms / ≤ 200 ms | ≤ 150 ms / ≤ 250 ms | — |
| `T-MEM` | Soak minute 10 → end (30–60 min), after forced GC: output JS heap growth | ≤ 10 MB | ≤ 20 MB | — |
| | Regie / sender JS heap growth | ≤ 25 / ≤ 15 MB | ≤ 50 / ≤ 30 MB | — |
| | DOM nodes / JS event listeners growth | ≤ 2 % | ≤ 5 % (and ≤ 100 absolute for listeners) | — |
| | `video` elements, `RTCPeerConnection`s, WebSockets | constant | constant (± 0) | — |
| | API / LiveKit / PostgreSQL container RSS growth over 60 min | ≤ 50 MB | ≤ 100 MB | — |
| | PostgreSQL connections | ≤ 10 | ≤ pool max (20) | — |
| | Uncaught exceptions, container restarts, OOM kills | 0 | 0 | — |
| `T-LIMITS` | Constants asserted exactly (no tolerance): lockout 5 failures / IP, 15 min window and lock, 20 / username; pairing 10 requests and 20 redeems / IP / 10 min, 20 pending; fade steps 200/300/500/800/1000/1500/2000 ms; scenes 99, items 32, screens 9; invite 30 min, request 10 min, credentials window 5 min, redeem idempotency 5 min; keep-alive 2 s, client timeout 5 s, ring buffer 500 events, token TTL 10 min, telemetry at most 1 message per device and 2 s | exact | exact | spec 4–7, 12 |

### 5.1 Performance budget (issue #12)

Measured with E2E-PERF-01 (2.20) in the reference scenario: 4 phones (camera 1080p), 2 laptop screens (1440p), 6 scenes, Studio Mode, fake media; Chromium without a GPU, so every codec is in software; the whole machine was busy (the harness records it: `machineBusy` ≈ 1.0, with other work on it), which makes CPU and time figures swing by a factor of two between runs. Counts (decoded streams, videos in the DOM, frame rate cap, screen codec) are exact and do not depend on the machine: any rise fails the test. Loads (CPU cores = CPU seconds per second of all processes of one browser, the share of the time the main thread is busy, dropped frames, switching time) may exceed their budget by 20 %; `PERF_BUDGET_SCALE` multiplies them for a slower or faster machine. The budget lies above the values seen after the optimisations (the time lines leave room for a busy machine, and a run in which a sender was at its CPU limit is invalid: its loads are not held against the budget and the test is skipped as not comparable, 6.8); the lines are in `tests/e2e/support/perf/budget.ts` and are checked by E2E-PERF-01 and, as arithmetic, by UNIT-PERF-05.

| Metric (reference scenario) | Before (3 runs) | After (2 runs) | Budget |
|---|---:|---:|---:|
| Output: streams decoded, idle | 6 | 3 | ≤ 3 exact |
| Output: videos in the DOM | 2 | 2 | ≤ 2 exact |
| Regie: streams decoded, idle | 6 | 6 | ≤ 6 exact |
| Regie: videos in the DOM | 26 | 16 | ≤ 16 exact |
| Regie: canvases in the DOM | 20 | 4 | ≤ 8 exact |
| Screens: codec | vp9 | h264 | = h264 |
| Output: CPU, idle (cores) | 0.43 – 0.47 | 0.25 – 0.26 | ≤ 0.5 |
| Output: CPU, Regie dragging (cores) | 0.30 – 0.38 | 0.17 – 0.26 | ≤ 0.45 |
| Output: main thread busy, idle | 0.052 – 0.108 | 0.015 – 0.017 | ≤ 0.10 |
| Output: decoded megapixels per second, idle | 37 – 73 | 10 – 16 | – |
| Output: frames dropped, idle | 0.011 – 0.024 | 0.000 | ≤ 0.05 |
| Regie: CPU, idle (cores) | 0.70 – 0.76 | 0.43 – 0.48 | ≤ 0.8 |
| Regie: CPU, dragging (cores) | 0.74 – 0.78 | 0.61 – 0.69 | ≤ 1.2 |
| Regie: GPU process, idle (cores) | 0.26 | 0.21 – 0.24 | ≤ 0.35 |
| Regie: GPU process, dragging (cores) | 0.25 – 0.26 | 0.23 – 0.28 | ≤ 0.35 |
| Regie: main thread busy, idle | 0.435 – 0.648 | 0.098 – 0.129 | ≤ 0.30 |
| Regie: main thread busy, dragging | 0.592 – 0.802 | 0.476 – 0.520 | ≤ 0.65 |
| Regie: animation frames per second, dragging | 15.3 – 32.7 | 31.3 – 36.8 | not budgeted |
| Senders: CPU, all six (cores) | 1.38 – 1.70 | 1.21 – 1.25 | ≤ 2.3 |
| Senders: encode load of the 2 screens (cores) | 0.88 – 1.03 | 1.21 – 1.35 | – |
| Senders: encode load of the 4 phones (cores) | 1.53 – 1.84 | 1.53 – 1.58 | – |
| Switch to the preview scene (ms, request → every video shows a picture) | 220 – 919 | 236 – 864 | ≤ 1500 |
| Switch to a scene nobody prepared (ms) | 341 – 653 | 424 – 443 | ≤ 2000 |
| Regie: share of the main thread in `drawImage` (sampled profile) | 29 – 30 % | 4 – 5 % | – |

What the numbers say. *Output*: it decodes three streams instead of six (the program scene and the preview scene, nothing else) and needs about 40 % less CPU; its main thread is idle nine tenths of the time. *Regie*: 16 videos instead of 26 and 4 canvases instead of 20 (the scene thumbnails are stills, shown as images), the main thread is busy about a tenth of the time instead of half (the copies of video frames were 29 % of its time, mostly the software conversion of the 2560 × 1440 screens, and are 4 to 5 % now: they share a time budget), CPU 0.43 to 0.48 cores instead of 0.70 to 0.76. It still decodes six streams: the station thumbnails are live, at the smallest layer. The animation frame rate while an item is dragged is 31 to 37 (15 to 33 before). A first version of the stills drew a canvas per thumbnail; the sixteen canvases on screen doubled the GPU process of the Regie and the frame rate fell to 3, which is why the budget counts canvases and the GPU process. *Senders*: all six together need less CPU (1.2 instead of 1.4 to 1.7 cores). The two screens, however, cost more as software H.264 than they did as software VP9 (1.2 to 1.35 cores against 0.9 to 1.0), because this container has no hardware encoder; the decision (VP9 only with a power-efficient encoder, H.264 otherwise) is made for real laptops, where H.264 is encoded and decoded in hardware and VP9 often is not, and MAN-16 has to confirm it there. *Switching*: the times are between 0.2 and 0.9 s for the preview scene and about 0.4 s for a scene nobody prepared (before, such a scene came up from the preloaded low layer); they include the API call and a fully busy machine, so the budget leaves room. A run in which a sender reports `qualityLimitationReason = cpu` is not a valid measurement: its loads are recorded and the test is skipped as `not-comparable` (the counts are still checked); repeat it when the machine is quiet (6.8).

---

## 6. Execution, tags and reporting

### 6.1 Pipeline

The pipeline runs on GitHub Actions (`.github/workflows/`). `ci.yml` is the safety net of every change; `e2e-full.yml` is the full run, started on demand. Every job runs commands that also run locally (the npm scripts of the root `package.json`), so a red job is reproduced with the command in the table.

**`ci.yml`** runs on every pull request and every push to `main`, on `ubuntu-24.04` (pinned in every workflow: `ubuntu-latest` moves to a newer image, and a run must not change with it; the pin is moved on purpose). All jobs run in parallel, except that `e2e-smoke` waits for the three `build-images` jobs. Target: a clean run in under 15 minutes (anything longer belongs in the full run); the budget is in the table below. A new push to a pull request cancels the run it supersedes; runs on `main` always finish. The `push` trigger is limited to `main` because the `pull_request` trigger already builds every push to a pull request branch.

**Which jobs run (issue 57).** The first job, `changes`, compares the changed paths (on a push to `main` with the commit of the last green CI run, so a run that GitHub cancelled while it was pending is covered by the next one; on a pull request with the merge base) with four filters (`dorny/paths-filter`, pinned by SHA, `predicate-quantifier: every`). *code* is every path except `docs/**`, `**/*.md`, `LICENSE`, `NOTICE`, `prototype/**` and the Renovate and issue-template files; *api* is `apps/api/**` (and `global.json`); *web* is code outside `apps/api` and `.github`; a change under `.github/workflows/` counts for all of them.

| Changed | Jobs that run | Billed time (warm caches) |
|---|---|---|
| Only docs and Markdown | `changes`, `lint-typecheck` (Prettier, i18n check, release files check; no type check, no .NET), `ci-ok`; in `release.yml` only `plan` and `release-please` | about 3 minutes of runner time, 5 jobs (GitHub rounds every job up to a whole minute) |
| `apps/api/**` only | `api`, `contracts`, `lint-typecheck` with `dotnet format`, the four `build-images` and `e2e-smoke` | about 25 minutes |
| Frontends, packages, tools, the E2E harness | `unit-web`, `contracts`, `lint-typecheck` with the type check, `build-images` and `e2e-smoke` | about 25 minutes |
| `.github/workflows/**` | everything | about 28 minutes |

`e2e-smoke` needs all four images, so whenever it runs the four `build-images` jobs run (about 25 s each with the layer cache). On a pull request the label `e2e` runs `e2e-smoke` (and the image builds) even when the paths would not. The release commit on `main` (a push that changes `.release-please-manifest.json`) skips both: the release pull request ran them, and the job `smoke` of `release.yml` runs the smoke set against the pushed images before the release gets its tag (`docs/releasing.md` section 4). The last job, `ci-ok`, runs after all others with `if: always()` and fails when one of them ended `failure` or `cancelled`; a skipped job passes. Branch protection requires `ci-ok` and the title check only, so that a skipped job never blocks a merge and a red one always does.

| Job | Runs | Red when |
|---|---|---|
| `changes` | the path filters above | never on its own (an API error of GitHub) |
| `lint-typecheck` | always; `npm run typecheck` only for web changes, `dotnet format` only for API changes. `npm run typecheck` (packages, output page and the E2E harness), `npm run format:check` (Prettier; `.prettierignore` lists what is not formatted: generated files, prose, prototypes), `dotnet format apps/api/StudioFlow.slnx --verify-no-changes`, `node infra/release/check.mjs` (one version in every file that carries it, `docker-compose.release.yml` agrees with `docker-compose.yml`) | a type error, a file that Prettier or `dotnet format` would change, a version or Compose file that does not match its twin |
| `unit-web` | `npm run test:unit` (also the repository tools in `tools/lib`: the i18n checks, the notices list `third-party-notices.spec.ts`, the standalone prototype `prototype.spec.ts` that builds the real file), `npm run test:studio`, `npm run test:sender` (Vitest in Node, happy-dom and jsdom: no browser is needed) | a red `UNIT-*` test |
| `api` | `dotnet build apps/api/StudioFlow.slnx` (`TreatWarningsAsErrors` is set in `Directory.Build.props`), `npm run test:api` (the `INT-*` tests start PostgreSQL with Testcontainers; Docker is available on the runner) | a C# warning, a red test |
| `contracts` | `npm run gen:contracts`, then `git diff --exit-code` on `apps/api/openapi/` and `packages/scene-model/src/generated/api.ts` | the committed OpenAPI document or TypeScript types differ from what the code generates (run `npm run gen:contracts` and commit) |
| `build-images (api)`, `build-images (caddy)`, `build-images (backup)` | one job per image, in parallel: the API image, the Caddy image (three frontends; `caddy validate` for every TLS mode runs inside the Dockerfile) and the backup image (on the PostgreSQL pin of `docker-compose.yml`), each with Docker layers from the GitHub Actions cache (scope per image, also read by `release.yml`). The images carry the commit of the run in the label `org.opencontainers.image.revision`; api and caddy go to `e2e-smoke` as the artifacts `image-api` and `image-caddy` | a broken Caddyfile, frontend, API or backup build |
| `e2e-smoke` | downloads the two image artifacts (the action compares the SHA-256 of the download with the one recorded at the upload), loads them and fails if an image does not carry the commit of the run in its revision label, loads the netem kernel modules (`tests/e2e/load-netem-modules.sh`), starts the stack as numbered stack 1 (`tests/e2e/stack.sh up 1`; the harness writes the env file with TLS mode `internal` and preflights ports and subnet), runs `tests/e2e/stack.sh test 1 --project=smoke` (6.2) | a red smoke test; a test of an open entry of `known-bugs.json` that passes (set the entry to `fixed`, see `tests/e2e/README.md`) |

**Timing budget** (measured on the runs 40022862070 and 40024767576 of 2026-10-23, warm caches; minutes:seconds). The images used to be built one after the other in one job and handed over in one artifact; the three builds now run in parallel, so the slowest one counts:

| Stage | Before | Now (expected) | Notes |
|---|---|---|---|
| `lint-typecheck`, `unit-web`, `api`, `contracts` | 1:30, 2:05, 2:15, 0:55 | the same (the dependency audit moved to the weekly `audit.yml`) | run beside the image builds and are shorter than the critical path |
| Image builds | 3:15 in one job (API 1:03, Caddy 1:09, backup 0:21 and the upload, one after the other) | about 1:30 (Caddy decides; set-up and upload on top) | the first run with a cold cache needs about 7 minutes for the Caddy and API build; that run fills the cache |
| `e2e-smoke` set-up | about 1:00 (checkout, Node, `npm ci`, Chromium 0:20, artifact 0:08, load 0:05) | about 0:40 | the Chromium cache is saved right after the install (it was only saved by a green job, and the job was never green) |
| Stack start | 0:28 | 0:28 | `stack.sh up 1` |
| Smoke tests | about 6:00 when green | about 6:00 | one worker, one stack: see below |
| **Whole run** | about 11:30 | about 9:30 | the red run of 2026-10-23 took 12:55 for the tests, because 16 failing tests were run twice (`retries: 1`) |

The smoke tests share one stack and one worker on purpose (state of the stack, the order of the specs). Sharding them over two runners (`--shard`, two stacks) would save about 2.5 minutes for the price of a second set-up and double the runner minutes of a private repository; it is not done as long as the run stays below the target. All 63 tests of the set carry `@p0` (`t.smoke` is `@p0 @smoke`); the long ones are the media and outage tests (E2E-OUT-06 up to 90 s with retry, E2E-SRC-03 52 s, E2E-SWITCH-11 34 s, E2E-NET-00 up to 27 s).

**What `digest-mismatch: error` in the log means.** The step log of `actions/download-artifact` lists its inputs, and `digest-mismatch` is one of them: the default is `error`, which makes the step fail if the SHA-256 of the downloaded artifact differs from the one the upload recorded. It is not an error message. In the run 40022862070 the expected and the downloaded digest are the same (`928e5a91...`). The workflow spells the input out, so that the check stays on whatever the default becomes, and `e2e-smoke` additionally checks the revision label of every loaded image against `GITHUB_SHA`.

Failure artifacts: when `e2e-smoke` fails it uploads `tests/e2e/.output` (14 days): the HTML report, `junit.xml`, `results.json`, traces, videos and screenshots (`retain-on-failure`), and `logs/<service>.log`, the `docker compose logs` of the four services (the harness writes them at the end of every run, also when the stack did not come up), `logs/containers.json` (restart count, state, limits and restart policy of the four containers at the end) and `logs/docker-events.jsonl`, the `start`, `kill`, `die` (with the exit code), `oom`, `restart` and `stop` events of the containers during the run. Only the event log tells why a container with a restart policy stopped: `docker inspect` resets the exit code when it runs again, and the log of a container that got a SIGKILL has no last words. `retries: 1` applies on CI (6.4).

**`e2e-full.yml`** runs every Playwright project except `soak` (weekly, 60 minutes): `smoke`, `desktop-chromium`, `i18n`, `short-ttl`, `disruptive` (restarts, lockout, network impairment with the netem sidecar, which needs `NET_ADMIN`, granted by the compose file, and the kernel modules `sch_netem`, `ifb` and `act_mirred` on the runner; `tests/e2e/load-netem-modules.sh` loads them, installs `linux-modules-extra-$(uname -r)` if needed, and if the kernel still lacks them it writes a warning annotation and sets `E2E_NETEM=unavailable`: `E2E-NET-00` then records the netem tool as skipped and the tests that need it are skipped, not failed; `E2E-NET-00` reports whether the tools work), the `pixel-7`, `iphone-15` and `ipad` descriptors, `desktop-firefox` and `webkit`. The harness builds the images with `docker compose`. It runs on demand (`workflow_dispatch`; the owner removed the nightly schedule on 2026-10-27) and when a pull request gets the label `needs-full-e2e`: the release pull request gets it before it is merged (`docs/releasing.md`), Renovate sets it on LiveKit updates. Run it after larger changes as well. A failed run creates an issue labelled `ci-failure` (“Full E2E run failed”) or adds a comment to the one that is still open; the job `report-failure` is the only job with `issues: write`.

**Toolchain and supply chain.**
- Node comes from `.nvmrc` (22.22.3), the .NET SDK from `global.json` (`10.0.301` with `rollForward: latestFeature`: a local SDK from 10.0.301 up to the newest 10.0 feature band is accepted, and CI installs the newest 10.0 SDK, the band the API Docker image is built with).
- The default is `permissions: contents: read`. Every action is pinned by its full commit SHA with the release in a comment; to update one, look up the SHA of the new release tag (`gh api repos/<owner>/<action>/git/ref/tags/<tag>`, and dereference annotated tags with `git/tags/<sha>`) instead of using the tag.
- Caches: npm (`actions/setup-node`), NuGet (`actions/setup-dotnet`, key from `Directory.Packages.props` and the `*.csproj` files), the Playwright browsers (`actions/cache/restore` and `actions/cache/save` as two steps, so that a red job still saves what it installed), Docker layers (`docker/build-push-action` with `type=gha`, one scope per image: `api`, `caddy`, `backup`).

**Branch protection** for `main` is a repository setting, not part of the repository (`tools/github-repo-settings.sh` sets it): the required checks are `ci-ok` (the aggregate of all CI jobs, see above) and “Conventional Commits title” (`pr-title.yml`). **`audit.yml`** (`npm audit`, `dotnet list package --vulnerable`) runs on Mondays and on demand; it is a report and never red. The other repository settings of the releases are listed in `docs/releasing.md`, section 8.

**`pr-title.yml`** checks that the title of every pull request follows Conventional Commits (`feat: ...`, `fix(api): ...`; the job is named “Conventional Commits title”). **`release.yml`** runs after `ci.yml` succeeded on a push to `main`. When CI ran `e2e-smoke` for the commit (something that reaches the stack changed) it builds the four images once from the same layer cache, pushes them as `sha-<7>`, scans them with Trivy and moves `:main`; after a docs-only commit it builds nothing. For a release commit (it changes `.release-please-manifest.json`) it always builds, runs the smoke set again against the pushed images, and only then tags the same images with the version. release-please runs on every commit. Details: `docs/releasing.md`. Its smoke run uses the same harness as `e2e-smoke` (`E2E_NO_BUILD=1` with the pulled images tagged `sf-e2e-1-api` and `sf-e2e-1-caddy`).

**Not automated yet** (they need runners or tools that do not exist yet): the weekly stage (P2, `soak` 60 minutes, `@netns`, `@linux-netem` in full, OPS on a Windows runner, a11y sweep), the release stage (all of the above green and the manual checklist MAN-01…MAN-13 signed), the catalogue check (6.5), and the tests that need real devices (real phones), which stay manual (section 4). The `@perf` tests (latency, many sources, switching times, the performance budget) are not in the nightly run either: they run on demand with the workflow `perf.yml` (input `runner`: a larger runner or a perf runner with at least 4 cores) or with `tests/e2e/stack.sh test <N> --project=perf` (6.8; decision 15.3 stays, there is no self-hosted runner).

### 6.2 Smoke set (`@smoke`, P0)

`E2E-NET-00`, `E2E-AUTH-01`, `E2E-AUTH-06`, `E2E-AUTH-07`, `E2E-AUTH-09`, `E2E-PAIR-01`, `E2E-PAIR-02`, `E2E-PAIR-03`, `E2E-PAIR-10`, `E2E-PAIR-13`, `E2E-SCENE-04`, `E2E-SCENE-05` (templates `full`, `two`, `pip` only), `E2E-SCENE-07`, `E2E-SCENE-12`,
`E2E-SWITCH-01`, `E2E-SWITCH-02`, `E2E-SWITCH-04`, `E2E-SWITCH-06`, `E2E-SWITCH-11`, `E2E-SWITCH-12`, `E2E-SRC-01`, `E2E-SRC-02`, `E2E-SRC-03`, `E2E-SRC-06`, `E2E-SRC-07`, `E2E-SRC-10`, `E2E-OUT-01`, `E2E-OUT-02`, `E2E-OUT-06`, `E2E-OUT-08`,
`E2E-DEV-01`, `E2E-DOCK-02`, `E2E-MEDIA-03`, `E2E-XFER-01`, `E2E-XFER-03`, `E2E-XFER-10`, `E2E-AUD-01`.

### 6.3 Tags and selection

`@smoke`, `@disruptive` (restarts, kills, lockout, rate limits; run last, followed by `stack.ensureHealthy()`), `@short-ttl`, `@netns`, `@linux-netem`, `@soak`, `@perf` (absolute timing, frame-rate and CPU thresholds: E2E-OUT-13, E2E-OUT-14, E2E-NET-19, E2E-NET-20, E2E-SWITCH-08 and -15 [regie], E2E-PERF-01; they need at least 4 cores and nothing else running, so the nightly run leaves them out; project `perf`, workflow `perf.yml`, never retried, see 6.8),
`@webkit-ui` (UI-only subset), `@p0 @p1 @p2` (priority, derived from this file). Example: `npx playwright test -c tests/e2e/playwright.config.ts --grep "@smoke" --project=smoke`; the `@perf` tests: `tests/e2e/stack.sh test <N> --project=perf`.

### 6.4 Retries and flakiness

Unit and integration: no retries. E2E: `retries: 1` on CI; a test that passes only on retry is reported as flaky; more than 2 flaky runs in 20 → tagged `@quarantine` with an issue and excluded from blocking (P0 tests are never quarantined: they are fixed within the sprint). `@perf`, `@soak` and all `T-…` measurements are never retried and run on dedicated runners.
Failure artefacts: Playwright trace, video and screenshot (`retain-on-failure`), browser console log, `docker compose logs --since` of the test window, HAR for NET tests, and the sampled JSON/CSV files.

### 6.5 Keeping this plan and the tests in sync

- Every Playwright/xUnit/Vitest/Angular test carries its catalogue ID: Playwright `test('E2E-AUTH-01 login via UI …')`, Vitest/ng `describe('UNIT-SCENE-12 …')`, xUnit `[Trait("Id", "UNIT-AUTH-04")]` on the method or class (method names still follow `MethodName_Condition_ExpectedResult`, spec 3); parametrised cases append a suffix in brackets (`E2E-SCENE-05 [grid3]`). `tests/e2e/tools/check-catalogue.mjs` (planned, not written yet, so not part of CI, see 6.1) is to fail the `lint-typecheck` job when a test ID is missing from this file, a P0/P1 ID has no implementation (after the agreed grace period), an ID is duplicated, or a `[GAP-nn]` reference has no entry in section 7.
- IDs are never reused; a new regression test gets the next free number of its area and level; priorities may be raised, not silently lowered.
- Pinned decisions in section 7 are removed (and the affected tests updated) when the spec or the code resolves them.

### 6.6 Prerequisites on a test machine

Docker with Compose v2 (`--wait`), Node ≥ 22.12, .NET 10 SDK, Playwright browsers (`npx playwright install --with-deps chromium firefox webkit`, Microsoft Edge for `edge-desktop`), `ffmpeg` with the encoders libx264, libvpx and libwebp (global setup checks it and stops with the install hint; the sample media are never replaced by stubs, `H-MEDIA-01/02`; the media already on disk are kept and need no ffmpeg; `ci.yml` and `release.yml` restore them from the Actions cache keyed by the hash of `support/media-samples.ts` and install ffmpeg only on a miss; `ci.yml` saves the cache only after a green smoke run, so it holds only samples that `H-MEDIA-01` probed with ffprobe, and on a cache hit `H-MEDIA-01` is skipped with that reason while `H-MEDIA-02` checks the refusal without ffmpeg; `e2e-full.yml` always installs it), `nicolaka/netshoot` (pull in global setup, pin by digest), the kernel modules `sch_netem`, `ifb`, `act_mirred` for `@linux-netem` tests, ports 80/443 (or the port override of 1.2.2), 7881/tcp and 7882/udp free.

### 6.7 Suggested implementation order for test agents

1. Harness: stack start/stop, fixtures, init script, `E2E-NET-00` canary, `check-catalogue.mjs`. 2. All `UNIT-*` of a component together with the component (xunit Core, vitest packages, ng). 3. `INT-AUTH`, `INT-SYNC`, `INT-PAIR`, `INT-SWITCH`, `INT-SCENE`, `INT-SRC`, `INT-MEDIA`, `INT-LK`, `INT-NET`. 4. The smoke set (6.2). 5. Remaining P0 E2E, then P1, then P2. 6. `@perf`, `@soak`, `@linux-netem`, `@netns` last, on the dedicated runners. `check-catalogue.mjs` prints the list of catalogue IDs that are not implemented yet.

### 6.8 Timing tests on a machine without headroom (issue #39)

A latency, frame-rate or switching-time figure means something only if the machine had CPU to spare while it was taken. The standard GitHub runner (`ubuntu-24.04`) has 2 vCPU and 7 GB for the whole stack (API, PostgreSQL, LiveKit, Caddy), the senders (software H.264 simulcast encoders, `--disable-gpu`) and the output browser. In the first full run (40408028177) the machine was at 93 to 100 % CPU the whole time: the output page decoded everything it was sent but drew 1.1 frames per second (a starved compositor, its main thread was busy 14 to 18 %), the senders adapted to their CPU (the lowest simulcast layer 240 px wide instead of 320), and the latency tests waited for a quiet machine that never came and ran into their timeouts (3 × (246 + 66) s in a test of 900 s). The latency itself was fine at 93 % load (E2E-OUT-14: p50 89 ms, p95 112 ms). The rules since then:

1. **`@perf` tests are not in the nightly run.** They hold measurements against absolute thresholds and need at least 4 cores with nothing else running (E2E-OUT-13 says so). `desktop-chromium` leaves them out (`grepInvert`), the project `perf` selects them by tag (`tests/e2e/stack.sh test <N> --project=perf`), and the workflow `perf.yml` runs them on demand (`workflow_dispatch`, input `runner` for a larger runner or a perf runner; the output folder with the measurements is always uploaded). They are never retried: a second run measures a different machine. Nothing runs them by itself, in line with decision 15.3 (latency tests stay manual). The nightly run keeps a short camera latency run (E2E-OUT-13 [latency, camera, short]) and everything that is not a threshold on time.
2. **Waiting for a quiet machine has a budget.** `measureWhenQuiet` (`tests/e2e/support/output/quiet.ts`) starts no attempt that would not fit before the test timeout less a reserve of 60 s, waits for a quiet machine at most 30 s in all on CI (`CI` set) and 240 s on a shared machine (not per attempt), and never lets the wait eat into the time of the run. The first attempt always runs. A machine that never gets quiet costs the wait plus the runs and ends in a measurement with `quiet: false`, not in a timeout. The set-up of the test counts: the spec calls `markTestStart` in `test.beforeEach`.
3. **Thresholds are enforced when the machine had headroom.** Quiet means: the whole machine (all cores) was at 60 % CPU or less while the figures were taken (`QUIET_BUSY_PCT`, from `os.cpus()` around the measurement). `judgeTiming` runs the assertions that hold the figures against absolute thresholds (latency, frame rate, main-thread share, picture and switching times, decoded frames per second): on a quiet machine a failure fails the test; on a busier one a failure ends in a skip with the annotation `not-comparable` (CPU use and the first failed threshold), and the report says "skipped". A pass on a busy machine is a pass. What does not depend on the load stays enforced everywhere: the stamps are decoded and increase, the output decodes what the senders send, the received bytes, the heap, the drops, no incident, no page error. The JSON of every such measurement (`.output/<stack>/results/out-*.json`) carries `machineCpuBusyPct`, `comparable`, `stoppedBecause` and `waitedForQuietMs`. The tests that use the gate: E2E-OUT-13 (camera, screen, short), E2E-OUT-14, E2E-NET-19 (frame rate and main-thread share), E2E-NET-20, E2E-SWITCH-08 and -15 [regie], E2E-SWITCH-09 (picture within N ms, cold scene), E2E-SWITCH-10 (time to the highest layer of the preview), E2E-OUT-20 (frame rate and latency in the report); E2E-PERF-01 judges its loads (not its counts) when no sender was at its CPU limit and the machine was at 90 % CPU or less (the scenario itself takes about two thirds of four cores). The other timing tests (E2E-SWITCH-02, -04, -08 [output], -09 fade) are not gated yet: they hold on a machine with headroom and the 2-vCPU runner passed them, but they fail on a computer that is busy with other work.
4. **A sender that adapts to its CPU has smaller layers.** libwebrtc lowers the resolution of an overloaded sender (`degradationPreference: 'maintain-framerate'`), so its LOW layer is 240 px, not 320. E2E-SWITCH-09 reads the lowest layer the sender sends before each cut: a sender at `qualityLimitationReason = cpu` sets the floor of that cut to that layer (annotation `sender-cpu-limited`), any other sender keeps the floor at 320 px. A picture narrower than the layer that is sent still fails. The known product bug OUT-03 (the preview scene prepared at 320 px) is a different matter.
5. **To get a verdict from a skipped test**, repeat it on a machine with headroom: `perf.yml` on a larger runner, or a computer with 4 cores or more that is not doing anything else (`machineCpuBusyPct` in the JSON says whether it was).

---

## 7. Spec gaps, contradictions and pinned decisions

Each entry: where the sources are silent or disagree, what this plan pins (and tests assert), and what the implementation must provide or decide. When a gap is resolved, update the pin here and the tests that cite it.
"Spec" = `docs/architecture/implementation-spec.md`; "Plan" = `docs/history/FlowStudio Architekturplan.html`; "ApiSurface" = `apps/api/src/Opten.StudioFlow.Web/Endpoints/ApiSurface.cs`.

**GAP-01 · Time-based rules can be faked but not configured.** Spec 4.6 (invite 30 min, request 10 min, credentials window 5 min, redeem idempotency 5 min), 5 (lockout 15 min, sliding cookie 12 h), 7 (token TTL 10 min, `empty_timeout` 300 s), 4.2 (fade guard). The working tree injects `TimeProvider` into the services (so expiry tests can use `FakeTimeProvider`), but the durations are `static readonly` constants (`Invite.Lifetime`, `Invite.ReplayWindow`, `PairingRequest.PendingLifetime`/`DecisionLifetime`, `LoginThrottle.Window`/`Lockout`, `PairingRequestStore.MaxPending`), so no short-TTL stack can be built.
Pin: every duration and limit becomes an option with the spec default; configuration keys: `Pairing:InviteTtl`, `Pairing:RequestTtl`, `Pairing:CredentialsWindow`, `Pairing:RedeemIdempotencyWindow`, `Pairing:Limits:RequestsPerIpPer10Min` (10), `Pairing:Limits:PendingTotal` (20), `Pairing:Limits:RedeemPerIpPer10Min` (20), `Admin:Lockout:*`, `LiveKit:TokenTtl` (LiveKit's own `room.empty_timeout` is set in the `LIVEKIT_CONFIG` block of the compose file). Without them `E2E-PAIR-05/06/07`, `E2E-LK-03`, `E2E-NET-26` and all expiry integration tests cannot run.

**GAP-02 · Production lifecycle beyond the first start.** Spec 4.2 describes only the default production “Webinar”; `createProduction` (ApiSurface) says nothing about content, activation or slug rules; there is no delete route.
Pin (as implemented in `ProductionService.CreateAsync`): a created production gets the same three default scenes (“Welcome”, “Presentation”, “Break”; program = first) and is active only when no other production is active; `AddScene` on a production without program makes the new scene the program; `activate` makes the production the only active one (emits `resync` to Regie sessions); slug = lower-case ASCII `[a-z0-9-]`, 1–48 chars (German umlauts → ae, oe, ue; accented letters lose the accent; the sharp s → ss; other characters → `-`, runs collapsed, ends trimmed), a collision appends `-2`, `-3`, …; empty after normalisation → `production` (all as in `Slugs.cs`). Productions accumulate in E2E (removed by `down -v`).

**GAP-03 · Login lockout semantics.** Spec 5: "5 failed attempts per client IP within 15 minutes → 15 minutes 429 `rate_limited` with `Retry-After`; additionally 20 failures per username in 15 minutes lock the username"; Plan §7 (a 15 minute lock after five failed attempts).
Pin (equals `LoginThrottle` in the working tree): failures 1–4 return 401, the 5th failure itself returns 429 and starts the lock, every later attempt (even with the correct password) gets 429 until the lock ends; success clears the IP counter; the window is sliding; `Retry-After` in seconds (≤ 900); counters live in memory (a restart clears them, the E2E lockout tests rely on it); the client IP is the proxy-forwarded address (all E2E traffic shares one IP).

**GAP-04 · Authorisation details missing from the spec.** (a) No route → policy table (spec 5 lists the policies only); this plan pins the table in 2.1 (notably `GET /api/system/info` = Admin, health = anonymous). (b) Logout: a stateless Data Protection ticket stays valid until expiry; pin: logout invalidates the session server-side (revocation list/session id) and closes the hub connections of that session. (c) `Program.cs` calls `app.MapOpenApi()` unconditionally; pin: only in Development/OpenAPI generation, never in Production.

**GAP-05 · Which error code for which limit.** `ErrorCodes.LimitReached` (Core/Contracts/AccessContracts.cs) says "scenes, items, slots, pending requests"; Spec 4.6 says pending requests → 429 `rate_limited`; Spec 4.3 lists "max 32 items" under *validation*; ApiSurface declares no 409 on `addSceneItem`/`replaceSceneItems`/`allocateSlot` beyond what is shown, and no status for the item limit.
Pin: 33rd item (add or replace), 100th scene, 10th screen, second laptop camera → **409 `limit_reached`**; 11th request per IP, 21st pending request, 21st redeem attempt → **429 `rate_limited`**; invalid values → 400 `validation_failed`. ApiSurface must declare these statuses and update `ErrorCodes.LimitReached` documentation.

**GAP-06 · Output slug oracle and access changes.** Spec 4.8: wrong key → 403 "no hint whether the slug exists"; ApiSurface `getOutputSnapshot` declares `.ProducesProblem(404)`.
Pin: unknown slug returns the same 403 as a wrong key (byte-identical body); remove the 404 from the output routes' contract. Also pinned: shrinking `allowedIps` disconnects output pages whose address is no longer allowed within 2 s.

**GAP-07 · What the output stream shows of source health.** Spec 6: events "devices, pairing, invites, incidents, log, output status" are `revisionOnly`; `OutputSnapshot.Sources` are "without health" but `SourceDto.Status` is non-nullable and `sourceUpserted` is not classified.
Pin: output snapshot sources carry `status: ok`, `statusSince: null`; health-only changes of a source are `revisionOnly` for the output; label/code changes are delivered. The output derives hold/lost purely from LiveKit track presence.

**GAP-08 · Source status and incident transitions beyond "ok → x".** Spec 4.5 defines only `ok → reconnecting|ended|lost` and recovery. Missing: media loss that only the device report shows (`rtc: reconnecting|disconnected` while the hub is up; a frozen LiveKit sends no webhook), `reconnecting → ended|lost`, `ended`/`lost` + hub disconnect, slot states `starting` and `paused`, unblock recovery, ack of an open incident, and the API restart (the in-memory health and incident history are lost; a device that does not come back is never flagged).
Resolved by implementation-spec 4.5 and 12 (decided 2026-10-22, DOC-06), pinned in `UNIT-SRC-01/02/03`: ended/lost are sticky (across hub disconnects of the same session, not across a new session); `reconnecting → ended|lost` updates the open incident in place; `starting` has no rule of its own; `paused` (the OS suspended the capture) is not live and expected back → `reconnecting` if the slot was live, never `ended`; only a deliberate stop is `ended` (“camera stopped” / “sharing stopped”); every report replaces all slot states and a new `Hello` session starts without them; a device report `rtc: reconnecting|disconnected` while the hub is up marks the live slots `reconnecting` at once (GAP-08 a); the prototype's log entries “K2 acknowledged” and “S1 asked to share again” do not exist in spec 4.9 or `LogTexts` and are not expected; unblock → `offline` without incident; ack of an open incident → 409; second ack → 404; a graceful API shutdown is no outage (no evaluation, no log entry, no incident, BUG-20); after an API start the sources go `offline` → `ok` as the devices reconnect, without any incident, and a source that was live within 12 h, is used in the program or preview scene and whose device does not reconnect within 15 s becomes `reconnecting` with an incident (GAP-08 b) – no outage goes unnoticed across a restart.

**GAP-09 · Switching and broadcast edge rules.** Spec 4.2 is silent on: program switch/take/preview in standby or ended; `start` while live, `end` when not live, a direct switch to the preview scene; `setPreview` during a fade; double approval of a pairing request (Spec 4.6, ApiSurface approve 404/410).
Pin: switching is allowed in every broadcast state (the output shows the slate; tally stays `off`); `start` while live, `end` while ended and `reset` while in standby are idempotent no-ops, `end` while standby → 409 `conflict` (as implemented in `Production.cs`); a direct switch to the scene that is currently the preview swaps program and preview like a take; `setPreview` is not guarded by the fade guard; the second of two concurrent approvals → 404 `not_found` with exactly one device created.

**GAP-10 · Transition validation.** Spec 4.2 ("cut → durationMs 0; fade → one of …") vs `TransitionDto` doc ("Ignored (0) for a cut").
Pin: `cut` with any duration is normalised to 0; `fade` with a duration outside the seven values → 400 `validation_failed` (`errors.transition.durationMs`).

**GAP-11 · UI and server bounds, names and Auto grid overflow.** Prototype `regie.html` limits corner radius to 0…80 (input `max=80`, `clamp(v,0,80)`) while Spec 4.3 / `ITEM_BOUNDS.maxRadius` is 200; the prototype's drag minimum is 96×54 while the server minimum is 16×16; the template is “Screen + camera column” in Spec 4.3 and Plan §3 (and in the catalogue, `model.scene.templateName.col`) but “Screen + column” in the prototype `PRESETS`; Auto grid has slots for at most 9 items but a scene may hold 32.
Pin: the Studio clamps exactly like the server (radius 200, min 16 for typed values; a larger UI minimum for dragging is allowed but must be documented); display name “Screen + camera column” (id `col`); in Auto grid only the first 9 available items are rendered, the rest are not rendered.

**GAP-12 · Failure detection time.** Plan §6 ("heartbeats … detect a drop after 2–5 s") vs Spec 6 (keep-alive 2 s, server timeout 6 s).
Resolved (spec 6/12): server `ClientTimeoutInterval` 5 s, keep-alive 2 s, clients `serverTimeoutInMilliseconds` 5000. Pin: `T-DETECT-SILENT` target 5 s, hard limit 6.5 s (timeout + propagation).

**GAP-13 · Asset validation details.** Spec 4.7 does not define: allowed MP4 `ftyp` brands (HEIC/AVIF use `ftyp`), WebM vs Matroska (both EBML), image dimension limits, how names are sanitised, the fallback name, rename validation, and the HTTP status for a content request without credentials or with another production's key.
Pin: MP4 brands `isom iso2 mp41 mp42 avc1 M4V`; WebM requires DocType `webm`; image width/height must be 1…16384; names: single path-free segment, 1–80 chars, no control/bidi characters, fallback `Medium`, rename uses the same rules; content: no credential → 401, wrong or foreign key → 403; response carries the verified type, `nosniff`, `Content-Disposition: inline`, and (recommended) `Content-Security-Policy: default-src 'none'; sandbox`.

**GAP-14 · Content-Security-Policy is not specified.** Spec 10 says "strict CSP (see security review)", but no security-review document exists (`docs/` has only `architecture/`).
Pin: invariants **I-CSP** (see `E2E-AUTH-09`); the exact policy is to be written in the security review; Angular's inline styles may require `style-src 'unsafe-inline'` (allowed, flagged P2); Safari needs the explicit `wss://<host>` in `connect-src`.

**GAP-15 · No test hooks defined.** The spec defines no `data-testid`, no read-only state objects, no storage key for the sender credentials. Pinned names are in 1.7 (`regie-ready`, `connection-state`, `data-tally`, `data-state`, `data-slate`, `window.__sfStudio|__sfSender`); spec 12 adds: tests prefer roles, labels and visible (English) text; the two global state views exist only with the opt-in flag `localStorage['studioflow.testHooks'] = '1'`; there is no `window.__sfOutput` (only the output page's `?latency=1` aid). Storage keys as implemented: sender localStorage `studioflow.sender.v1` (credentials, before pairing the redeem client id), `studioflow.sender.settings`, sessionStorage `studioflow.pairing`; Regie localStorage `studioflow.studio`, `studioflow.layout`, `studioflow.transition`; the opt-in flag `studioflow.testHooks`.

**GAP-16 · Compose, `.env.example` and scripts differ from spec 10.** Spec 10 names the TLS modes `dns | internal | public`; `.env.example`, `setup.sh` and `docker-compose.yml` implement `internal | acme | custom | dns-cloudflare | dns-infomaniak | dns-hetzner | dns-desec | dns-route53 | dns-gandi | dns-ovh`. Spec 10 lists ports 80/443; the compose file also publishes 443/udp (HTTP/3) and has no port variables. The compose file adds `STUDIOFLOW_PUBLIC_BASE_URL`, `STUDIOFLOW_SUBNET`, `STUDIOFLOW_TRUSTED_PROXIES`, `STUDIOFLOW_MAX_UPLOAD`, `STUDIOFLOW_MAX_BODY`, `STUDIOFLOW_HSTS_MAX_AGE` and the profiles `chaos` (netem) and `tools`.
Pin: the implemented names are authoritative for the tests (`.env.example` is the contract, as its header says) and spec 10 is to be updated; services `caddy`, `api`, `livekit`, `postgres`; healthchecks as implemented (`pg_isready`, API `/health/live`, LiveKit `GET /` on 7880, Caddy loopback `:2020/healthz`); `setup.sh --non-interactive` with the documented flags. *Superseded by issue #27: the stack is zero-config, the TLS modes are `internal`, `custom` and `dns-<provider>` chosen in the wizard, and there is no script (section 2.11).*

**GAP-17 · Client-supplied ids and source references.** Spec 4.1 defines id shapes, 4.3 lets `ReplaceSceneItems` carry client item ids and "may keep a source that was deleted later" – without saying how the server distinguishes "kept" from "newly introduced".
Pin: client-supplied item ids must match `^itm_[a-z0-9]{4,40}$` (clients generate them; server-generated ids use 16 base32 characters); a source reference must parse as `parseSourceRef`; an unknown source is allowed only if that exact item (same id and source) already exists in the scene.

**GAP-18 · Studio Mode and preview rules.** Spec 4.2: "turning it on sets the preview to the scene after the program if none is set; turning it off clears the preview only if no other Regie session is connected (the client decides)". Not stated: wrap-around after the last scene; the race between two operators.
Pin: wrap to the first scene; presence is read from the latest `presence` value; a stale count can clear another operator's preview – acceptable, test `E2E-SWITCH-14` documents it.

**GAP-19 · Device and pairing API edge cases.** Not defined: device kind when `RedeemInviteRequest.Kind` contradicts the invite kind; `createInvite` with `phoneQr`; `allocateSlot`/`releaseSlot` error statuses (ApiSurface declares 409 and only 204); releasing a phone's camera; whether the sender's “Stop sharing” is `ended` or `paused`.
Pin: invite kind decides; `createInvite {phoneQr}` = renew; phone cannot allocate a screen (400); second laptop camera or 10th screen → 409 `limit_reached`; releasing an unknown slot → 404; releasing a phone's only camera slot → 409 `conflict`; “Stop sharing” → `ended`.

**GAP-20 · Revision semantics.** Spec 5/6: counter per production? `GET …/changes?since=` for `since` > current, negative, 0.
Pin: per production; since ≥ buffer start and ≤ current → delta; everything else valid → snapshot; negative/missing → 400.

**GAP-21 · Device hub session semantics.** Spec 4.6 does not say what the server does when a *replaced* tab reconnects and sends `Hello` again, nor when a tab reconnects with its own sessionId.
Pin: a `Hello` whose sessionId is not the current one and was replaced earlier is answered with `sessionReplaced` and aborted without replacing the current session; a new connection with the *current* sessionId replaces its old connection silently.

**GAP-22 · LiveKit webhook semantics.** Not defined: idempotency, out-of-order events, unknown identities/rooms, malformed bodies.
Pin: state-based processing (duplicates and reordering converge), unknown identities/events/rooms → 200 and ignored, malformed JSON → 400, > 1 MB → 413.

**GAP-23 · Admin credential precedence (closed by issue 4).** Spec 5 used to allow `Admin:PasswordHash` or `Admin:Password`.
Pin: there is no account setting any more. The account lives in the database and is created in the first-run setup with a one-time code from the server log (spec 5). `Admin:Username`, `Admin:Password` and `Admin:PasswordHash` are ignored; the API warns at startup and names the keys, never the values. Tests: `INT-AUTH-27` (ignored settings), `UNIT-AUTH-02`, `E2E-OPS-02`.

**GAP-24 · Output page details.** Not defined: what `bg=transparent` covers, the content of `debug=1`, and what a reloading output shows while the broadcast is live.
Pin: transparent makes the page, the stage and the scene background colour transparent (contain bars and missing-source placeholders stay opaque); `debug=1` shows `scene`, `revision`, `hub`, `livekit`, per source `<code> <w>x<h> <fps> fps <kbps> kbps` and `latency <n> ms`; a live production never flashes the standby slate on load.

**GAP-25 · Backoff formula vs sequence.** Spec 8.2: `min(5000, 300 * 2^retryCount) + random(0..250)` and "0 for the first retry" gives 600 ms for `retryCount = 1`, while Spec 6 and Plan §6 list 0, 300, 600, 1200 …; `packages/realtime-client/src/backoff.ts` uses `300 * 2^(n−1)`.
Pin: the sequence 0, 300, 600, 1200, 2400, 4800, 5000 (+ jitter 0–250 from the second retry on); fix the formula text in Spec 8.2.

**GAP-26 · Output may subscribe to every track.** Plan §7 accepts that the output token can subscribe to all sources (it composes scenes itself), Spec 7 grants `canSubscribe` without per-track limits.
Pin: the output client subscribes only to sources of scenes (`E2E-OUT-22`); a server-side per-track restriction is not required but should be considered because the output link is a bearer secret that can be extracted from the page.

**GAP-27 · UI strings the spec does not define.** Login title, labels, error and lockout message; logout action; confirmation text of “End broadcast”; reset-broadcast action; connection-lost banner in the Regie; generic request-failure toast; messages for expired/denied/limited pairing and expired invite; “Add scene”, “Duplicate”, upload and asset-delete controls and errors; slate editor; message composer and offline toast; sender banners for removed device and camera restart; technical-check re-run button; session-expired notice; the shape of `studioflow.transition`.
Pin: tests locate these by role/regex or `data-testid` as written in each entry; the final texts are the ones of the catalogue (English in `packages/i18n/src/messages/en/`, German in `.../de-CH/`; the API `detail` texts are English and clients show their own texts chosen by `code`, decision D7). Reported so far (assert exactly): state word “camera stopped” for a camera stopped on purpose (screens “sharing stopped”); Regie element view button “Back to scene” (accessible name “Clear selection, back to scene”, tooltip “Clear selection (Esc)”), upload toast action “Add to scene”; logout failure toast “Signing out failed. {reason}”; Regie strip without an active production “No active production found.”, when the server cannot be reached “The server is not reachable. The control room is reconnecting…”; toasts “K1 blocked and disconnected” / “K1 unblocked” (codes only); sender slot errors “A phone cannot share a screen. Please pair a laptop for that.”, “At most 9 screens are possible per device.”, “This device already has a camera.”, “The camera of a phone cannot be removed. The control room can remove the whole device.”; database outage “The database is currently not reachable. Please try again in a moment.” (ProblemDetails `detail`, title “Temporarily unavailable”); binding errors “Invalid value.” per field.

**GAP-28 · Reduced motion scope.** Spec 8.3 gives the renderer a `reducedMotion` option; the Regie must honour `prefers-reduced-motion`; whether the *output page* does is open.
Pin: Regie monitors/thumbnails and the sender honour the OS setting; the output page does not (the programme must look the same for the audience whatever the proxy machine's accessibility setting is).

**GAP-29 · Telemetry bounds and staleness.** Not defined: valid ranges, slot count, when telemetry is considered stale.
Pin: battery 0–100, loss 0–100, bitrate/fps/size ≥ 0 else `null`; ≤ 10 slots; a device silent for 6 s is `Rtc = Disconnected` and no telemetry is pushed.

**GAP-30 · Regie message semantics.** Not defined: text trimming, behaviour for blocked/offline devices, queueing.
Pin: trimmed 1–140 chars; always 202; delivered only to a connected device, never queued; the Regie shows a toast when the device is offline.

**GAP-31 · Operations scripts rely on API commands the spec does not define.** Spec 5 names only `reset-admin` (before issue 4: `hash-password`); `update.sh`, `restore.sh` (and `infra/scripts/common.sh`) call `dotnet Opten.StudioFlow.Web.dll broadcast-status` and interpret exit 0 as "none live", 3 as "live", anything else as "unknown".
Pin: the API image provides `broadcast-status` (exit codes 0/3, other = unknown) and spec 5 is extended; the scripts refuse while live or unknown unless `--force`; backup folders contain `database.dump`, `media.tar.gz`, `keys.tar.gz`, `caddy_data.tar.gz`, `backup-info.txt`, `SHA256SUMS` (suffix `-2` on a name clash); `restore.sh <dir>` verifies the checksums, writes a `…_vor-restore` safety backup, restores the database into a new database before swapping, and asks for confirmation unless `--yes`. *Superseded by issue #27: the same behaviour is `docker compose run --rm backup restore <folder>`, which refuses while the API holds database connections (E2E-OPS-08); the update has no script and does not check the broadcast (E2E-OPS-09).*

**GAP-32 · Database outage behaviour.** Spec 5 defines `/health/live` and `/health/ready` but not behaviour of writes and hubs while PostgreSQL is down.
Pin: writes/reads needing the DB → 503 ProblemDetails within 5 s (`T-DB-OUTAGE`: connect timeout 3 s, command timeout 5 s; once an outage is known every request fails at once instead of waiting for its own timeout and queueing behind device reports; options `Database:ConnectTimeout`, `Database:CommandTimeout`, `Database:ProbeInterval`, `Database:StartupWait`; BUG-21); in-memory hubs stay up; readiness recovers by itself (probe connection every second) without restarting the API.

**GAP-33 · `LiveSince` across restarts.** Pin: persisted with the production; the LIVE runtime continues after a restart.

**GAP-34 · Local storage schemas.** Spec 9.1 names `studioflow.studio`, `studioflow.layout` (v1) and `studioflow.transition` but only the layout shape exists (prototype). Pin: `studioflow.transition` = `{"kind":"cut"|"fade","durationMs":<allowed value>}`; layout numeric fields are validated and clamped on load (the prototype does not validate them).

**GAP-35 · Device removal while connected.** `deleteDevice` is in ApiSurface; the sender's reaction is undefined. Pin: LiveKit removal + hub close; the sender shows a terminal “removed”-type state (“No longer paired”) with a way to pair again and does not reconnect in a loop.

**GAP-36 · Pending knock requests when another production is activated.** Pin: they are dropped with outcome `expired` (pending requests belong to the active production).

**GAP-37 · Regie controls that exist in the spec but not in the prototype.** Create/clone/reorder scene, scene background, media upload and delete, slate editor, broadcast reset, message composer, tech-check re-run. Pinned working names: “Add scene” (“+ Scene”), “Duplicate”, “Upload image or video…”; reorder by dragging the scene row or `Alt+ArrowUp/Down`. Implementers choose the final controls; tests are adjusted via the page object.

**GAP-38 · Touch target sizes in the Regie.** DESIGN.md fixes 26–30 px controls; the plan asks for large touch targets only for the sender (Spec 9.2). Pin: sender ≥ 44 px (hard), Regie at ≤ 900 px best effort (Take ≥ 48 px, scene cards ≥ 44 px), other controls recorded.

### 7.1 Contradictions between documents (summary)

| # | Documents | Conflict | Pin |
|---|---|---|---|
| 1 | Plan §8 ("SignalR with MessagePack") vs Spec 6 | Wire protocol | Spec wins: JSON protocol, camelCase, string enums (`INT-SYNC-03`) |
| 2 | Plan §6 (2–5 s) vs Spec 6 (6 s) | Failure detection | GAP-12 – resolved: 5 s |
| 3 | Spec 4.8 vs ApiSurface (`getOutputSnapshot` 404) | Slug oracle | GAP-06 |
| 4 | `ErrorCodes.LimitReached` doc vs Spec 4.6/4.3 | Which code for limits | GAP-05 |
| 5 | Spec 4.3 / `ITEM_BOUNDS` vs prototype | Radius 200 vs 80; min size 16 vs 96×54; template name | GAP-11 |
| 6 | `TransitionDto` doc vs Spec 4.2 | Cut with duration | GAP-10 |
| 7 | Spec 8.2 formula vs Spec 6 sequence | Backoff | GAP-25 |
| 8 | `Program.cs` (`MapOpenApi()` unconditional, `appsettings.json` `AllowedHosts: *`) vs Spec 10 (strict exposure) | Hardening | GAP-04c, `E2E-OPS-18` |
| 9 | Spec 4.5 vs `SlotState.Paused`/`Starting` (Contracts/Enums.cs) | Unmapped states | GAP-08 |
| 10 | Spec 10 (TLS modes `dns \| internal \| public`, ports 80/443) vs `.env.example`/`setup.sh`/`docker-compose.yml` (`internal \| acme \| custom \| dns-<provider>`, 443/udp too) | TLS mode names, ports | GAP-16 |
| 11 | Spec 5 (only `reset-admin`, before issue 4 `hash-password`) vs `update.sh`/`restore.sh` (`broadcast-status`) | API CLI commands | GAP-31 |

### 7.2 Findings of the E2E run (`tests/e2e/known-bugs.json`)

The registry lists confirmed product bugs and documentation differences; an `open` entry makes its test an expected failure, a `fixed` entry turns it into a regression guard.
Resolved on 2026-10-22 (product engineer; each with unit or integration tests in `apps/**`):

| Entry | Resolution | Pinned in |
|---|---|---|
| BUG-05 | The webhook accepts `application/json` next to `application/webhook+json`; other types 415 | INT-AUTH-25 |
| BUG-08 | A body that cannot be bound is 400 `validation_failed` with `errors` naming the camelCase field path, no serializer text | INT-PAIR-08 |
| BUG-10 | Intended deviation: log texts keep the device name (“K1 Phone 1 blocked / unblocked / removed”), more informative for multi-slot devices (“S1 S2 Laptop Mia blocked”) | INT-PAIR-12, 2.5 strings |
| BUG-16 | `HEAD` on the asset content: headers of GET without body, range-aware | INT-MEDIA-06, E2E-AUTH-17 |
| BUG-18 | `X-Content-Type-Options` exactly once through Caddy (Caddy drops the upstream copy, `header_down`) | INT-AUTH-21 |
| BUG-19 | Telemetry to the Regie at most once per device and 2 s, latest value wins | INT-SRC-03, INT-SYNC-05 |
| BUG-20 | A graceful API shutdown is no outage: no “reconnecting”, no incident | UNIT-SRC-03, INT-NET-05, E2E-NET-12 |
| BUG-21 | PostgreSQL down: 503 within 5 s (timeouts, fail-fast circuit, probe), no 504 from Caddy | INT-NET-04, E2E-NET-11, `T-DB-OUTAGE` |
| BUG-22 | postgres runs with `cap_drop: ALL` plus the five capabilities of its entrypoint | E2E-OPS-01, E2E-OPS-13 |
| OBS-01 | Hub connections aborted on `ApplicationStopping`, `HostOptions.ShutdownTimeout` 5 s, maintenance loops stop at once | INT-NET-05, `T-SHUTDOWN` |
| DOC-01 … DOC-07 | This plan now follows the implementation (microphone policy, redeem event order, token TTL, crash method, empty domain, paused semantics, healthcheck method) | see the entries cited above |

