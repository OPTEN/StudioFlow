# StudioFlow – Implementation specification

Binding technical specification for the implementation of the plan
(`docs/history/FlowStudio Architekturplan.html`, draft 2, historical and in German) and the Regie (control room)
prototype (`prototype/regie.html`, `DESIGN.md`).
Everything here is a decision; if code and this document disagree, fix one of them deliberately.

Language: code, comments and this document are English. **The UI is English by default, with German (Switzerland) as
the first translation** (`en` is the source locale, `de-CH` the translation; the locale follows the user setting and
the browser language by default, see `docs/architecture/i18n-design.md`). German uses Swiss conventions: «ss» instead
of «ß», guillemets « », decimal comma (0,3 s); the English UI uses “…” and a decimal point (0.3 s). Both use a 24 h
clock. Terms from OBS: scene, source, item, preview, program, take, Studio Mode, dock, transition, cut, fade, tally,
slate, station. UI texts quoted in this document are the English UI texts; where the exact wording matters, the German
text follows in parentheses. All German texts are in `packages/i18n/src/messages/de-CH/`.

## 1. Scope

Implemented now (plan phases 0–2, everything that is software):

- Phase 0: compose stack (Caddy, API, LiveKit, PostgreSQL), HTTPS in the LAN (DNS challenge or internal CA),
  automated latency measurement, reconnect behaviour, laptop pairing by short URL and check code.
- Phase 1 (MVP): admin login, productions, pairing (QR, code + approval, invite link), LiveKit tokens, SignalR hubs;
  sender PWA (camera, several screens, tally, auto-reconnect, wake lock, technical check); Regie after the prototype
  (scenes, layout templates incl. Auto grid, free editing with snapping, crop, Studio Mode with preview and take,
  cut and fade, stations with state, freely arrangeable docks); images and videos as sources; output page 16:9 with
  secret link.
- Phase 2: backup/restore/update scripts, slates and per-item fallbacks, monitoring view (bitrate, packet loss,
  battery), security review and runbook, Regie chat (short messages to devices).

Prepared but not built (plan phases 3–4, confirmed as “later”): audio in StudioFlow (contracts and output page are
audio-ready, no audio track is published), restream/recording (egress), Air mode (renderer + air room), overlays and
lower thirds, multiview, Stream Deck, multi-tenancy UI (tenantId exists in the data model), auto-director,
greenscreen. Do not build them.

## 2. Repository layout and ownership

```
apps/api/            ASP.NET Core (.NET 10): StudioFlow.slnx, src/Opten.StudioFlow.{Core,Infrastructure,Web}, tests/
apps/studio/         Angular app: Regie (served at /)
apps/sender/         Angular PWA: sender (served at /join/)
apps/output/         Vanilla TypeScript + Vite: output page (served at /o/)
packages/scene-model/      generated contracts + pure state/model helpers (no DOM)
packages/realtime-client/  SignalR wrapper with endless reconnect + revisioned state sync
packages/scene-renderer/   framework-free DOM renderer for monitors, thumbnails and output
packages/media-client/     livekit-client wrapper: sessions with endless reconnect, source provider, publisher, stats
infra/caddy/         Dockerfile (xcaddy + DNS module + built frontends), Caddyfile, TLS snippets
(LiveKit is configured inline in docker-compose.yml via LIVEKIT_CONFIG)
tests/e2e/           Playwright end-to-end tests against the compose stack
docs/                architecture, runbook, security review, testing report
docker-compose.yml, .env.example, setup.sh, setup.ps1, backup.sh, restore.sh, update.sh
```

Tooling: one root `package.json` (npm, Node ≥ 22.12), one root `angular.json` (projects `studio`, `sender`),
TypeScript 6 strict, Vitest 5 for packages and output (`vitest.config.ts` at the root), Angular unit tests via
`ng test <app> --watch=false` (Vitest builder), Playwright for E2E. Packages are consumed as TypeScript source via
`tsconfig.json` `paths` (`@studioflow/<name>` → `packages/<name>/src/index.ts`); they have no build step and no
`package.json` of their own. **Do not change root `package.json`, `package-lock.json`, `angular.json` or
`tsconfig.json` without the orchestrator**; if you need a dependency, report it.

Commands: `npm run gen:contracts` (build API → OpenAPI → `packages/scene-model/src/generated/api.ts`),
`npm run build:web`, `npm run test:unit`, `npm run test:studio`, `npm run test:sender`, `npm run test:api`,
`npm run test:e2e`, `npm run typecheck`.

## 3. Conventions

- OPTEN standards apply (read the instruction files listed in your CLAUDE.md for the languages you touch).
  C#: namespaces `Opten.StudioFlow.*`, primary constructors, file-scoped namespaces, newline before braces,
  `is null`, `ArgumentNullException.ThrowIfNull`, `Async` suffix, structured logging with templates, XML docs for
  public APIs, xUnit tests named `MethodName_Condition_ExpectedResult`, no Arrange/Act/Assert comments.
  Angular: standalone, signals (`signal`, `computed`, `effect`, `input()`, `output()`, `viewChild()`), OnPush,
  `inject()`, built-in control flow, typed reactive forms, SCSS with BEMIT (`c-`, `o-`, `u-`, `is-`/`has-`),
  component styles next to components, shared tokens in `src/styles/`.
- `TreatWarningsAsErrors` is on for .NET. Keep it green.
- No external CDNs, fonts or services at runtime. Fonts are self-hosted: copy `prototype/fonts/*.woff2` (+ OFL
  license texts) to `apps/<app>/src/fonts/` and reference them relatively from the global stylesheet
  (`url('./fonts/sofia-sans-semi-condensed-latin.woff2')`, `font-weight: 1 1000`; JetBrains Mono `100 800`,
  `font-display: swap`) so esbuild hashes them and the URLs work under `/join/`.
- QR codes: `uqr` (`encode(url, { ecc: 'M', border: 0 })`), rendered as one SVG `<path>` (dark on white, 4-module
  quiet zone) – never via `[innerHTML]` (Angular strips SVG).
- `getBattery` and `navigator.connection` are missing from TS 6 `lib.dom`; declare them in an ambient `.d.ts` and
  feature-detect.
- Security: never log secrets (device secrets, output keys, tokens, passwords). Compare secrets in constant time.
- Every user-visible string comes from the message catalogues of `packages/i18n` (English source, German `de-CH`),
  never from a literal in a component (rules in `docs/i18n.md`). The API sends English texts only; clients localise by
  `code`. IDs, enums and API fields are English.

## 4. Domain

### 4.1 Identifiers

Random, URL-safe ids with a type prefix and 16 lowercase base32 characters (80 bits):
`prd_`, `scn_`, `itm_`, `dev_`, `ast_`, `inv_`, `prq_` (pairing request), `inc_`, `cmd_`.
Secrets (device secret, output key, invite token, poll token) are 32 random bytes, base64url without padding.

### 4.2 Production (aggregate root)

Fields: id, tenantId (`opten`), name (1–80), slug (lowercase `[a-z0-9-]{1,48}`, unique per tenant, derived from the
name on creation), isActive (exactly one active production per tenant), broadcast (standby | live | ended),
liveSince, endedAt, programSceneId, previewSceneId, lastTransition, lastSwitchAt, standbySlate (default “Starting soon”,
subtitle = production name), endSlate (default “Thanks for watching”), output key (+ createdAt), allowedIps, createdAt.

On first start the API creates the default production “Webinar” (slug `webinar`, active) with three scenes:
“Welcome” (empty, layout free), “Presentation” (empty), “Break” (empty) – program = first scene, broadcast standby.
Server-created texts like these are English in every UI language (a documented limitation of issue #6).

Rules:
- Broadcast: `start` (standby|ended → live, liveSince = now), `end` (live → ended, endedAt = now),
  `reset` (any → standby). The output shows the standby slate, the program scene, or the end slate.
- Program switch (`program`): scene must exist; if `now < lastSwitchAt + lastTransition.durationMs` (a fade is
  running) → 409 `transition_running`. Switching to the current program is a no-op (200, no event).
- Take: requires previewSceneId ≠ null and ≠ programSceneId (else 409 `conflict`); swaps program and preview.
- Preview: any existing scene or null. Studio Mode itself is a per-browser setting; turning it on in a browser sets
  the preview to the scene after the program if none is set; turning it off clears the preview only if no other Regie
  session is connected (the client decides; the server just stores the value).
- Transition durations: cut → durationMs 0; fade → one of 200, 300, 500, 800, 1000, 1500, 2000 (default 300).
- Deleting the program scene → 409 `scene_is_live`. Deleting the preview scene clears the preview.
- Max 99 scenes per production (`limit_reached`).

### 4.3 Scene and items

As in `SceneContracts.cs`. Validation (server authoritative, client clamps the same way):
- name 1–80 chars (trimmed); background colour `^#[0-9a-fA-F]{6}$`; background asset must be an image asset.
- max 32 items; item ids unique; source must exist in the production when added (`AddSceneItem`, `ReplaceItems`
  and `UpdateItem` may keep a source that was deleted later – it renders as “Source missing”).
- x ∈ [-3840, 3840], y ∈ [-2160, 2160], w ∈ [16, 3840], h ∈ [16, 2160]; crop sides ∈ [0, 0.45],
  top+bottom < 0.9, left+right < 0.9; radius ∈ [0, 200]; rotation ∈ {0, 90, 180, 270}; border width ∈ [1, 40],
  colour hex; onLost.holdMs null or ∈ [0, 600000]; fallbackSource null or an existing source ≠ the item's source.
- Every change increments `Version` and emits `sceneUpserted` with the full scene.
- Defaults for a new item (`AddSceneItem` without geometry): x 1240, y 680, w 600, h 338, radius 12,
  fit contain for screens else cover, crop 0, rotation 0, onLost {holdMs 3000, fallback null}.
- `UpdateSceneItem` replaces the whole item (last writer wins per item). Clients coalesce rapid edits (drag) and send
  sequentially (never more than one request in flight per item; send the newest state when the previous returns).

Layout templates (client-side, `packages/scene-model`): Full screen, Side by side, Picture in picture,
Screen + camera column, One plus two, 2 × 2, 3 × 3, Auto grid – slot rectangles exactly as `PRESETS` in the
prototype. Applying a template orders the visible items by kind (screen, then image/video, then camera), assigns slots
in order, sets fit contain for a screen in slot 0 (except Side by side and the grids), radius 0 for full-canvas slots
else 12, and sends `ReplaceSceneItems`. Items beyond the slot count keep their geometry. The item order is the
z-order (first = back), and slots may overlap (Picture in picture), so applying a template also re-orders the items: the
placed items first in slot order (slot 0 at the back, later slots in front), then every item without a slot (hidden
items and items beyond the slot count) in front of them in their previous relative order – nothing that is or later
becomes visible disappears behind a template slot. Undo restores the previous order. Auto grid sets
`layoutMode = autoGrid` and keeps the item order (its slots never overlap): the renderer arranges all visible items
whose source is available (live, or lost but still inside its hold time; media always) with `autoGridSlots(n)`
(prototype `autoSlots`), in item order; editing an item's geometry in the editor switches the scene back to `free`
with the current computed rectangles.

### 4.4 Sources and slot codes

A source is a device slot (`{deviceId}/{slot}`) or an asset (`{assetId}`). Slots: `camera`, `screen-1` … `screen-9`.
The slot name is also the LiveKit track name; the device id is the LiveKit identity.

Slot codes: K = camera, S = screen, M = media; the lowest free number per letter in the production at creation time
(K1, K2 …). Codes never change while the source exists. Labels: phones “{device name}”, laptop screens
“{device name} · Screen {n}”, laptop camera “{device name} · Camera”, media = asset name.

Creation: pairing a phone creates its `camera` slot; pairing a laptop creates `screen-1`. A laptop allocates more
screens or its camera with `POST /api/device/slots` (max 9 screens + 1 camera per device, `limit_reached`).
`DELETE /api/device/slots/{slot}` removes the source (the sender's “Remove”); a screen share that merely ended
keeps its slot (state ended) so the Regie can ask for a reshare and the picture returns to the same place.

### 4.5 Source status (server, in memory, see `SourceStatus`)

Inputs: device hub connection (keep-alive 2 s, client timeout 5 s, section 12 GAP-12; a connected session without a
report for 6 s counts as `rtc: disconnected`, GAP-29), LiveKit webhooks (participant_joined/left,
track_published/unpublished; track name = slot), device reports (slot states, rtc state), block state.
At startup the API seeds published tracks with `ListParticipants`.

Reported slot states (decided 2026-10-22, sender open questions 1 and 2; this overrides the GAP-08 pin «`paused` →
`ended`» in `docs/testing.md`):
- Every report carries the state of each slot the session captures and **replaces** all earlier states: a slot that
  is missing from a report has no state (not live). Only the slots of the device count.
- A **new session** (`Hello` with another session id: another tab, or the same tab after a reload – every page load
  has its own id) starts without slot states and without rtc state; until it reports, only a published track makes a
  slot live. A reconnect of the same session keeps the states until its next report; `ended` and `failed` therefore
  survive a hub disconnect of the same session, but not a reload.
- `ended` = stopped on purpose (screen: “Stop sharing” («Teilen beenden») or the browser's stop button; camera: stopped by the user).
- `paused` = the operating system suspended the capture and it is expected back (e.g. the phone app went to the
  background). It is not live, never `ended`.
- `starting` has no rule of its own.

Per device slot:
- `blocked` if the device is blocked.
- `ended` if the device reports the slot `ended` – wins over a published track and over the connection.
- `lost` if the device reports the slot `failed` – likewise.
- `ok` if the slot is live and the device hub is connected. Live = the track is published (webhook or
  `ListParticipants`) or the current session reports the slot `live` with `rtc: connected`; never while the session
  reports the slot `paused` or its rtc state `reconnecting`/`disconnected` (section 12, GAP-08 a).
- `reconnecting` if the slot was `ok` and is no longer live without `ended`/`failed`: hub disconnected, participant
  left unintentionally, track unpublished while the device reports rtc reconnecting, rtc reconnecting/disconnected
  reported, slot `paused`, slot missing from the report while no track is published, a new session that has not
  published yet. Stays amber until it is back or the device is blocked or the slot removed – there is no automatic
  escalation.
- `connecting` if the device is online but the slot never went live since the device connected (also a slot that is
  `paused` before it was ever live).
- `offline` if the device is not connected and the slot was not live before (no incident).
Media sources are always `ok`.

Incidents: a transition from `ok` to `reconnecting`, `ended` or `lost` opens an incident (replacing any earlier
incident of the same source). An open `reconnecting` incident that turns `ended` or `lost` keeps its id and start and
only changes its kind (a paused camera that is then stopped: “K1 reconnecting”, then “K1 camera stopped”); the way
back from `ended`/`lost` to `reconnecting` keeps the kind. Back to `ok` sets `endedAt` (“recovered · gone for 9 s”)
until someone acknowledges it (“Seen”, `POST …/incidents/{id}/ack`, shared by both Regie sessions). Blocking a
device or removing a source removes its incidents. Each change emits `sourceUpserted` / `incidentUpserted` /
`incidentRemovedEvent` and a log entry: “K2 reconnecting” (also a paused camera), “K2 recovered, gone for 9 s”,
“S1 sharing stopped” (screen `ended`), “K1 camera stopped” (camera `ended`), “K1 no picture” (`failed`). The entry
carries a stable `code`, its `params` and an English `text`; clients localise by `code` (German: «K2 verbindet neu»,
«K2 wieder da, war 9 s weg», «S1 Teilen beendet», «K1 Kamera beendet», «K1 kein Bild»).
A graceful shutdown of the API is no outage: hub connections that end because the host stops
(`ApplicationStopping`) are not evaluated and nothing is written (no log entry, no incident); after the restart the
restart watch of section 12 (GAP-08 b) flags a source on air whose device does not return.

### 4.6 Devices and pairing

Device: id, productionId, name (1–60), kind, platform (≤ 80), state (active | blocked), pairingMethod, pairedAt,
lastSeenAt, secretHash (SHA-256 of the secret), slots. Live data (connection, telemetry, tech check) is in memory.

Authentication: `Authorization: Bearer {deviceId}.{secret}` for REST; `access_token={deviceId}.{secret}` for the
device hub. Blocked devices get 403 `device_blocked` (the sender stops reconnecting and shows “Blocked”).
Blocking also calls LiveKit `RemoveParticipant` and sends the device a final `self` message, then aborts the hub
connection. Unblocking lets the device reconnect (the sender retries every 15 s while blocked).

Pairing ways (all end with `DeviceCredentialsDto`; the secret is shown once to the device and stored hashed):
1. **QR (phones)**: the Regie shows the current phone invite (`GET …/pairing/phone-invite` returns the valid one or
   creates one). URL: `{PublicBaseUrl}/join/i/{token}`. Valid once, 30 minutes. When it is redeemed or renewed, the
   server immediately creates the next phone invite and emits `inviteRemoved` + `inviteUpserted`, so the Regie always
   shows a fresh code. Redeeming creates a phone device named “Phone {n}” unless a name is given.
2. **Short URL + check code (laptops on site)**: `/join` → name → `POST /api/pairing/requests` → returns requestId,
   pollToken, 4-digit check code (unique among pending requests, shown «47 12»), expires in 10 minutes. The laptop polls
   `GET /api/pairing/requests/{id}` (header `X-Pairing-Token`) every 1.5 s. The Regie sees a knock card and approves or
   denies. After approval the poll returns the credentials for 5 minutes (repeated polls return the same
   credentials). Pending requests live in memory. Limits: 10 requests per IP per 10 minutes, 20 pending requests in
   total (429 `rate_limited`).
3. **Invite link (laptops in advance)**: `POST …/pairing/invites {kind: laptopLink}` → `{PublicBaseUrl}/j/{token}`
   (Caddy redirects `/j/*` to `/join/i/*`). Valid once, 30 minutes, revocable.

Redeem (`POST /api/pairing/invites/{token}/redeem`) is idempotent per `clientId` for 5 minutes (a lost response
must not burn the invite): the same clientId receives the same device with a rotated secret. Unknown, expired, used
or revoked tokens → 410 `pairing_expired`. Rate limit: 20 redeem attempts per IP per 10 minutes.

Re-recognition: the sender stores the credentials in localStorage; on load it calls `GET /api/device/me`.

Session replacement: a device has at most one active session. A new hub `Hello` with a different sessionId sends
`sessionReplaced` to the old connection and aborts it; LiveKit's DUPLICATE_IDENTITY disconnect ends the old media
session. The old tab shows “Opened in another tab” with “Continue here” (which takes over again). No
ping-pong: a replaced tab never reconnects by itself.

Tally (server → device `tally`): per slot `program` if a non-hidden item with that source is in the program scene,
else `preview` if in the preview scene, else `off`; overall = max. Pushed on every change that affects it and on
Hello. During standby/ended the tally is `off` (nothing is on air).

Commands: reshare (slot), switchCamera, message (1–140 chars; Regie chat). Delivered over the device hub; 202 even if
the device is offline (dropped then; the Regie shows a toast if the device is offline).

### 4.7 Assets

Upload `multipart/form-data` field `file`. Allowed (verified by magic bytes, not by the client's content type):
PNG, JPEG, WebP images ≤ 25 MB; MP4 (ftyp) and WebM (EBML) videos ≤ 1 GB (configurable `Media:MaxImageBytes`,
`Media:MaxVideoBytes`). SVG, GIF and everything else → 415 `unsupported_media`; too big → 413. Image width/height are
read from the header. Stored at `/data/media/{productionId}/{assetId}{ext}`; name from the file name (sanitized,
≤ 80 chars). Content endpoint supports HTTP range requests, `HEAD` (the headers of `GET` without the body; not part
of the OpenAPI contract) and `Cache-Control: private, max-age=3600`; access with
the admin cookie or `?k={outputKey}` of the asset's production. Deleting an asset used by a scene item, a scene
background, a slate or a fallback → 409 `asset_in_use`.

### 4.8 Output access

The output URL is `{PublicBaseUrl}/o/{slug}?k={outputKey}`. The key is sent by the page as `X-Output-Key` (REST) and
as `access_token` (output hub). Wrong key → 403 (no hint whether the slug exists). If `allowedIps` is not empty, the
client IP (from `X-Forwarded-For`, trusted only from the Caddy network) must match one entry (IP or CIDR), else 403.
`regenerate-key` invalidates the old key immediately: connected output pages are disconnected (hub abort + LiveKit
`RemoveParticipant` for identity `output_{slug}_*`). Embedding is limited by `frame-ancestors` from
`STUDIOFLOW_FRAME_ANCESTORS` (Caddy; shown read-only in the Regie).

Output status: the API tracks output hub connections (count, remote IPs) and reports (`OutputReport` every 2 s).
State `connected` if ≥ 1 page connected and reported `rendering` within 6 s, `stale` if connected but no fresh
rendering report, `none` otherwise. Changes emit `outputStatusChanged` (latency/fps updates at most every 5 s or when
the value changes by > 20 %).

### 4.9 Audit log

Table `audit_entries` (id, productionId nullable, at, actor `admin` | `device:{id}` | `system`, action, details jsonb).
Actions: login.succeeded, login.failed, login.locked, scene.live, broadcast.started, broadcast.ended, device.paired,
device.blocked, device.unblocked, device.removed, pairing.denied, invite.created, invite.revoked, output.key.regenerated,
output.access.changed, asset.uploaded, asset.deleted, scene.created, scene.deleted. The API derives the log entry
(`LogEntryDto`: a stable `code`, its `params` and an English `text` fallback) for the Regie, which renders it in the
user's language from `code` and `params`; `RecentLog` in the snapshot holds the latest 20 entries of the production.

## 5. API

The REST surface is fixed in `apps/api/src/Opten.StudioFlow.Web/Endpoints/ApiSurface.cs` (routes, verbs, operation
names, request/response types). Implement every route; keep the contract. Successful responses use the documented
types; errors are RFC 7807 `ProblemDetails` with extension `code` (see `ErrorCodes`) and, for validation, `errors`.

Authentication and authorization:
- Admin: `POST /api/auth/login` checks `Admin:Username` and `Admin:PasswordHash` (ASP.NET Identity v3 hash; created by
  `dotnet Opten.StudioFlow.Web.dll hash-password`, which reads the password from stdin) or, for local setups only,
  `Admin:Password` (plain). Startup fails without one of them. Cookie `sf_session`: HttpOnly, Secure
  (`SameAsRequest` only in Development/Testing), SameSite=Strict, sliding 12 h. Data Protection keys persisted to
  `/data/keys` (`DataProtection:KeysPath`). Lockout: 5 failed attempts per client IP within 15 minutes → 15 minutes
  429 `rate_limited` with `Retry-After`; additionally 20 failures per username in 15 minutes lock the username.
- CSRF: cookie-authenticated unsafe requests (POST/PUT/PATCH/DELETE) must carry `X-StudioFlow: 1` (the Angular
  interceptor sets it); otherwise 403. No CORS is enabled.
- Hubs reject WebSocket/negotiate requests whose `Origin` host differs from the request host (403).
- Policies: `Admin` (cookie), `Device` (device bearer), `Output` (key + IP check, per slug).
- Production-scoped routes return 404 for unknown production ids.

Validation: built-in .NET 10 minimal API validation where it fits, plus domain validation in Core returning
`validation_failed` with field errors. A body that cannot be bound (unknown enum text, wrong JSON type, broken JSON)
is the same 400 `validation_failed` with `errors` naming the camelCase field path (`kind`, `items[0].fit`; `body` for
the body as a whole) and “Invalid value.” – never the serializer message (it names .NET types). Input sizes are bounded (JSON body ≤ 256 KB except uploads and the bandwidth
test ≤ 4 MB).

Concurrency: one API instance. All mutations of a production run through `ProductionCoordinator`, which serializes
them per production (SemaphoreSlim), loads/saves through EF Core and assigns revisions and ring-buffer entries inside the
lock; delivery happens outside it through one ordered dispatcher per production with a per-connection outbox, so a
slow or dead client never delays a mutation (`Realtime:DeliveryWait`, `Realtime:ConnectionQueueLimit`). The revision counter starts at `unixTimeMs * 1000` on process start, so
it is monotonic across restarts; clients resubscribe after any reconnect anyway.

Persistence: PostgreSQL 17, EF Core 10 + Npgsql, snake_case tables, migrations applied on startup
(`Database.MigrateAsync`, guarded against design-time/OpenAPI generation). Scene items are stored as `jsonb`.
Health: `/health/live` (process), `/health/ready` (database reachable).
Database outage (GAP-32): connect timeout 3 s, command timeout 5 s (`Database:ConnectTimeout`,
`Database:CommandTimeout`; they replace timeouts in the connection string; migrations get 10 min). A connection that
cannot be established or a statement without answer opens a circuit: every database operation then fails at once
(503 `service_unavailable`, `Retry-After: 5`; hub methods `service_unavailable`) instead of waiting for its own timeout
and queueing behind the device reports of the same production, and a probe connection every `Database:ProbeInterval`
(1 s) closes the circuit again – readiness and writes recover without a restart. Transient errors are retried (3×, at
most 2 s apart) only while the circuit is closed. The startup waits up to `Database:StartupWait` (60 s) for PostgreSQL.
Graceful shutdown: every hub connection is aborted when the host begins to stop, the maintenance loops end,
`HostOptions.ShutdownTimeout` is 5 s (below Docker's 10 s stop grace).

## 6. Realtime protocol (SignalR, JSON protocol, camelCase, enums as camelCase strings)

Hubs: `/hubs/studio` (Admin), `/hubs/device` (Device), `/hubs/output` (Output). Server keep-alive 2 s, client timeout
5 s (section 12); clients set `serverTimeoutInMilliseconds = 5000`, `keepAliveIntervalInMilliseconds = 2000` and reconnect
forever (0, 300, 600, 1200 … max 5000 ms + jitter); `online` and `visibilitychange` trigger an immediate attempt.

Verified details (research 2026-10-22):
- JSON hub protocol, not MessagePack: MessagePack would send PascalCase keys and break the generated contracts. The
  server must configure `AddJsonProtocol(o => { o.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
  o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)); })` – by default
  the hub protocol writes enums as numbers. Use the same options object as for HTTP JSON.
- The default `withAutomaticReconnect()` gives up after ~42 s; use a custom `IRetryPolicy` that never returns null,
  except for authorization failures: the policy returns null when `retryContext.retryReason.message` matches
  `/Status code '(401|403)'/` (blocked device, rotated output key, expired session). `start()` never retries by
  itself, so the first connect is wrapped in a loop.
- Do not use `skipNegotiation`: only the negotiate request surfaces 401/403 distinctly.
- Browsers send the hub token as `?access_token=` on the WebSocket URL: the API reads it for `/hubs/*` only, and Caddy
  redacts `access_token` (and `k`) from access logs.
- Write to Angular signals inside hub callbacks (zoneless change detection).

Studio: `Subscribe(productionId, sinceRevision?) → ProductionChangesDto`. The server keeps the last 500 events per
production in a ring buffer: if `sinceRevision` is known and all later events are buffered, it returns them
(`events`), else a `snapshot`. After subscribing, the connection receives `event` (one `ProductionEvent`),
`telemetry` (`DeviceTelemetryMessage`, at most once per device and 2 s – the first report at once, the newest held-back
report when the interval has passed, `Sources:TelemetryInterval` –, not revisioned) and `presence` (number of connected Regie
sessions). Client rule: apply an event if `revision == local + 1`; ignore if `≤ local`; on a gap call `Subscribe`
again with the local revision. `resync` (payload: productionId) tells the client to resubscribe (active production
changed).

Output: `SubscribeOutput(sinceRevision?) → OutputChangesDto` (production derived from the key), then `event`.
Events the output must not see (devices, pairing, invites, incidents, log, output status) are delivered as
`revisionOnly` with the same revision. `Report(OutputReport)` every 2 s.

Device: `Hello(DeviceHelloDto) → DeviceSessionDto`, then `tally`, `command`, `self`, `sessionReplaced`.
`Report(DeviceReportDto)` every 2 s (the server relays it as telemetry to the Regie and updates source status).

## 7. LiveKit

- One room per production: `prd_{id}` («backstage»). `auto_create` on, `empty_timeout` 300 s.
- Identities: device id for senders; `studio_{random}` for Regie sessions; `output_{slug}_{random}` for output pages.
- Grants: sender – roomJoin, canPublish, canPublishSources [camera, screen_share], canSubscribe false,
  canPublishData false; studio and output – roomJoin, canSubscribe, canPublish false, canPublishData false,
  hidden true. TTL 10 min: the server refreshes tokens of connected participants every 5 min (validity
  max(10 min, remaining)), and clients fetch a fresh token from the API for every rejoin. Tokens: HS256 JWT,
  `iss` = API key, `sub` = identity, `nbf`, `exp`, `name`, `metadata` (JSON), nested `video` grant object
  (`roomJoin`, `room`, `canPublish`, `canSubscribe`, `canPublishData`, `canPublishSources` lowercase, `hidden`);
  admin token for Twirp: `video = { roomAdmin: true, room }`. Created with `Microsoft.IdentityModel.JsonWebTokens`
  (`JsonWebTokenHandler`, `SetDefaultTimesOnTokenCreation = false`).
- `RemoveParticipant` is a kick, not a ban: blocked devices are refused by the token endpoint, and a
  `participant_joined` webhook for a blocked device triggers `RemoveParticipant` again.
- Webhooks: LiveKit posts to `http://api:8080/api/livekit/webhook` (`application/webhook+json`; `application/json` is
  accepted as well). `Authorization`
  carries the raw JWT (no `Bearer`), HS256 with the API secret, `iss` = API key, claim `sha256` = standard base64 of
  SHA-256 over the raw body bytes (compare in constant time); invalid → 401. Body: camelCase, enums as strings,
  int64 as strings (`createdAt`), defaults omitted → deserialize with web defaults + `AllowReadingFromString`.
  Webhooks are lossy (queue max age 30 s) and may interleave across rooms: key state by `participant.sid`, tolerate
  `participant_left` for unknown participants, and reconcile with `ListParticipants` on startup and every 15 s.
  An abruptly killed client is only reported after ~21 s (`CONNECTION_TIMEOUT`); the device hub timeout (6 s) is the
  fast signal. Never log webhook bodies (they contain `turnPassword`).
- Room service (Twirp, `POST http://livekit:7880/twirp/livekit.RoomService/{Method}`, `Authorization: Bearer
  {admin JWT}`, JSON; requests camelCase or snake_case, **responses snake_case**, int64 as strings):
  RemoveParticipant (block, output key rotation; 404 if absent is fine), ListParticipants (seed + reconcile).
- Server: `livekit/livekit-server:v1.13.10`, config passed as `LIVEKIT_CONFIG` (YAML body; compose interpolates the
  key) – `port 7880`, `rtc.tcp_port 7881`, `rtc.udp_port 7882`, `rtc.use_external_ip false`, node IP via `NODE_IP`
  env, `room.empty_timeout 300`, `room.departure_timeout 20`, `webhook.api_key` (must equal the key) +
  `webhook.urls`. `LIVEKIT_KEYS: "{key}: {secret}"` – the secret must start with a letter and be ≥ 32 chars (YAML
  parses an all-digit secret as a number and drops it): `sk` + 40 hex chars. Healthcheck
  `wget -q -O /dev/null http://127.0.0.1:7880/`. Caddy forwards the whole `/rtc` prefix (`/rtc`, `/rtc/v1`,
  `…/validate`); never expose `/twirp`. `NODE_IP` = the host's LAN IPv4 (works for LAN and same-host clients);
  `127.0.0.1` only for single-machine tests.
- Publishing (sender): camera H.264, simulcast layers 1080p/540p/270p (or 720p/360p/180p), `contentHint = 'motion'`;
  screens VP9 with H.264 backup codec, `contentHint = 'detail'`, simulcast off, max 1440p/15–30 fps;
  dynacast on; no audio.
- Subscribing: Regie with `adaptiveStream: true` (monitors are small) and minimal jitter buffer
  (`playoutDelayHint`/`jitterBufferTarget` ≈ 0 where supported); output with `adaptiveStream: false`, explicit
  quality per source from the scene model: program items → dimensions of the item on the canvas (HIGH for large
  items), preview scene items → HIGH (preload before a take), all other scenes' sources → LOW; jitter buffer ≈ 50 ms.
- The LiveKit URL for clients is the same origin (`wss://{host}`); Caddy proxies `/rtc` to LiveKit 7880. Media goes
  directly to 7881/tcp and 7882/udp on `STUDIOFLOW_NODE_IP`.

Verified livekit-client 2.23.0 behaviour (research 2026-10-22, server v1.13.10) that the implementation must respect:
- `DefaultReconnectPolicy` gives up after ~40 s. Use a policy that never returns null (cap 5 s). The SDK still gives
  up on unrecoverable errors and then emits `Disconnected` with `reason === undefined`: treat that as «gave up» and
  rejoin with a fresh token and a **new `Room`**.
- `ReconnectContext` only carries `retryCount` and `elapsedMs`.
- `CLIENT_INITIATED` is not proof of an intentional stop: the SDK disconnects on `pagehide`/`beforeunload` and on
  Chromium's `freeze` event. Track «stop requested by us» yourself; reconnect on `visibilitychange`/`pageshow`/`resume`.
- `signalReconnecting` can last ~14 s while the server is completely down: treat `signalReconnecting` and
  `reconnecting` as degraded.
- A full reconnect synthesizes `ParticipantDisconnected(undefined)`, `TrackUnpublished`, `TrackUnsubscribed` and
  re-publishes local tracks with the same names and new SIDs; quality settings and attachments are lost. Re-apply
  everything in `TrackSubscribed`.
- `TrackUnsubscribed` makes the SDK call `detach()` on elements attached with `track.attach()` (srcObject → null,
  black). Therefore `LiveKitSourceProvider` sets `video.srcObject = new MediaStream([track.mediaStreamTrack])` itself
  (never `track.attach`) and keeps it on loss; the renderer additionally snapshots the current frame into a canvas
  overlay at the moment a source becomes `lost` (one copy, not per frame) so the hold frame survives in every browser.
- `setVideoQuality(LOW|MEDIUM|HIGH)` and `setVideoDimensions` work with `adaptiveStream: false`; dynacast pauses
  unused layers with ≥ 5 s lag. `publication.videoQuality` is unreliable after `setVideoDimensions`.
- Playout: `track.setPlayoutDelay(seconds)` (Chromium) and `receiver.jitterBufferTarget` (ms, 0–4000, Chrome 124+,
  Firefox 115+); set both, guarded.
- Publishing: camera `{ name: 'camera', source: Track.Source.Camera, simulcast: true, videoCodec: 'h264',
  backupCodec: false, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] }` (720p source → 3 layers);
  the SDK restarts an ended camera itself (`TrackEvent.Restarted`) and re-acquires it when a phone returns to the
  foreground. Screens via `room.localParticipant.createScreenTracks({ audio: false, contentHint: 'detail',
  selfBrowserSurface: 'exclude', surfaceSwitching: 'include' })` (the standalone `createLocalScreenTracks` ignores
  `contentHint`), published with `{ name: 'screen-n', source: Track.Source.ScreenShare, videoCodec: 'vp9',
  backupCodec: { codec: 'vp8' }, simulcast: false, degradationPreference: 'maintain-resolution',
  screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 } }`. Several screens per participant work
  (find them with `getTrackPublicationByName`). VP9 falls back to VP8 automatically where unsupported.
- `livekit-client` is not tree-shakable (~150 KB gzip). The Regie loads it lazily (`await import('livekit-client')`)
  so the login page stays small.
- Chromium fake media on this machine needs `--disable-gpu` in addition to `--use-fake-device-for-media-stream
  --use-fake-ui-for-media-stream` (otherwise the fake camera track ends after 0.4 s); headless screen capture works
  with `--auto-select-desktop-capture-source="Entire screen"`.

## 8. Shared packages (public APIs)

### 8.1 `@studioflow/scene-model` (pure TypeScript, no DOM)

- `contracts.ts` (exists): generated wire types under friendly names, `HUB`, `ERROR_CODES`.
- `constants.ts`: `CANVAS_WIDTH = 1920`, `CANVAS_HEIGHT = 1080`, `SAFE_MARGIN = 40`, `FADE_DURATIONS_MS`,
  `DEFAULT_FADE_MS = 300`, `HOLD_OPTIONS` ([{label:'Freeze frame 3 s, then dimmed', holdMs:3000},
  {…10 s…, 10000}, {label:'Hold freeze frame', holdMs:null}]; `label` resolves through `@studioflow/i18n`),
  limits (`MAX_ITEMS_PER_SCENE = 32`, …), item bounds.
- `source-ref.ts`: `parseSourceRef(ref)` → `{kind:'device', deviceId, slot} | {kind:'asset', assetId} | null`,
  `deviceSourceRef(deviceId, slot)`, `isDeviceSourceRef`, `slotKind(slot)`.
- `layout-templates.ts`: `LAYOUT_TEMPLATES` (id, name, slots), `autoGridSlots(count)`,
  `applyLayoutTemplate(items, templateId, kindOf: (sourceId) => SourceKind | undefined)` →
  `{ items, layoutMode }`.
- `geometry.ts`: `clampItem(item)`, `validateItem(item)` → list of messages (resolved through `@studioflow/i18n`), `itemDefaults(source, kind)`,
  `rectsIntersect`, `CanvasRect` helpers.
- `production-state.ts`: immutable `ProductionState` (revision, serverOffsetMs, production, scenes ordered,
  `sourcesById`, devices, assets, pairingRequests, invites, incidents, outputStatus, log, operatorsOnline, telemetry by
  device) with `stateFromSnapshot(snapshot, receivedAtMs)`, `stateFromOutputSnapshot(…)`,
  `applyEvent(state, event)` → `{ state, result: 'applied' | 'ignored' | 'gap' }`, `applyTelemetry`.
- `selectors.ts`: `programScene`, `previewScene`, `sceneById`, `sourcesInScene(scene)`,
  `isSourceVisibleIn(scene, sourceId)`, `sceneHealth(scene, sources)` (worst down source like the prototype),
  `tallyOf(state, sourceId)`, `incidentPlace(state, sourceId)` (`'program' | 'preview' | 'off'`, worded “in Program” | “in Preview” | “not live” by
  `incidentPlaceWord(place)`),
  `stationOrder` (prototype ordering), `isDown(status)`.
- `format.ts` (locale-aware through `@studioflow/i18n`): `formatDuration(ms)` mm:ss, `formatRuntime(ms)` hh:mm:ss, `formatClock(date)`,
  `formatHm(date)`, `formatSeconds(ms)` (“0.3 s”, German “0,3 s”), `formatRate(mbit)` (“2.8”, German “2,8”),
  `formatCheckCode('4712')` (“47 12”),
  `statusWord(status, kind)` (“reconnecting”, “sharing stopped” / “camera stopped” for a camera, “blocked”,
  “connecting…”, “no picture”, “not connected”; German: «verbindet neu», «Teilen beendet» / «Kamera beendet»,
  «gesperrt», «verbindet …», «kein Bild», «nicht verbunden»).

### 8.2 `@studioflow/realtime-client`

- `createHubConnection({ url, accessTokenFactory?, logger? })` → configured `HubConnection` (JSON protocol, WebSockets
  with fallback, timeouts as in section 6, endless `withAutomaticReconnect` policy).
- `ResilientHub`: wraps a connection; `start()` retries forever (also the first connect), `stop()`, `on(method, fn)`,
  `invoke<T>(method, …args)`, `state` (`connecting | connected | reconnecting | disconnected | stopped`),
  `onStateChange(fn)`, `onReconnected(fn)`; listens to `online`/`visibilitychange`; never reconnects after `stop()`
  or a terminal close reason supplied by the caller (`markTerminal()` – used for session replacement / blocked).
- `ProductionSync<TState>`: given a `ResilientHub`, a `subscribe(sinceRevision?) => Promise<Changes>` function and the
  reducer, keeps `state`, applies `event`s with gap detection, resubscribes after reconnect (delta when possible),
  handles `resync`, exposes `onChange(fn)`, `onGap`, `lastSyncAt`. Used by the Regie (ProductionChangesDto) and the
  output (OutputChangesDto).
- `backoffDelay(retryCount)` shared policy: `min(5000, 300 * 2^retryCount) + random(0..250)`; 0 for the first retry.

### 8.3 `@studioflow/scene-renderer` (DOM, no framework, no livekit)

Interfaces in `types.ts` (exists). Main API:

```ts
createSceneRenderer(container: HTMLElement, options: {
  mode: 'output' | 'monitor' | 'thumbnail';
  provider: SourceMediaProvider;
  background?: 'black' | 'transparent';          // output ?bg=transparent
  statusOf?: (sourceId: string) => MonitorSourceStatus | undefined;  // monitor alerts (Regie)
  codeOf?: (sourceId: string) => string | undefined;                 // label “K2 · freeze frame 00:12”
  reducedMotion?: boolean;
}): SceneRenderer

interface SceneRenderer {
  readonly element: HTMLElement;               // 1920×1080 stage, scaled with CSS transform into the container (letterbox)
  show(scene: SceneDto | null): void;          // immediate
  update(scene: SceneDto): void;               // same scene changed: diff items in place (no flicker)
  transitionTo(scene: SceneDto | null, transition: TransitionDto): Promise<void>; // cut or fade; fade always completes;
                                              // a new transition finishes a running fade instantly first
  showSlate(slate: SlateDto | null, assetUrl?: string | null): void;   // standby/end slate above everything (fade 300 ms)
  setPreloadScenes(scenes: readonly SceneDto[]): void;  // output: request LOW quality for their sources
  setSourceStatuses(): void;                   // re-read statusOf for alerts
  effectiveRects(): ReadonlyMap<string, CanvasRect>;    // per item id, after Auto grid (for the edit overlay)
  stats(): { fps: number; items: number; videos: number };
  destroy(): void;
}
```

Rendering rules: one absolutely positioned element per visible item in z-order, `<video muted playsinline autoplay>`
for device sources and video assets (loop), `<img>` for images, GPU-friendly transforms only (no canvas copies).
Fit cover/contain via `object-fit`; crop by an inner wrapper scaled so the cropped part fills the item; radius with
`overflow:hidden` + `border-radius`; border as inset box-shadow; mirror `scaleX(-1)`; rotation 90/270 swaps the
inner box. Contain bars use `#0a0d12`. Missing source → dark placeholder `#121821` (monitor shows “Source missing”).
Hold frame: when a device source is `lost`, the element keeps its last frame; after `onLost.holdMs` it gets the
held state (blur ≈ 2.5 % of item width, dark overlay rgba(13,17,23,.72), centred “Picture returns shortly” («Bild kommt gleich zurück») if the
item is ≥ 320 px wide) – or shows `onLost.fallbackSource` instead. `holdMs = null` never escalates. In `monitor`
mode, a down source additionally gets a dashed outline (amber `#e3b341` reconnecting, red `#f85149` otherwise) and a
filled label tab like the prototype. Desired sizes: each renderer reports the on-screen pixel size of every device
source it shows (×devicePixelRatio, rounded to 16 px) via `provider.setDesiredSize`. Auto grid as in 4.3.
Fades use the Web Animations API on opacity (new scene layer over old), `reducedMotion` turns fades into cuts.

### 8.4 `@studioflow/media-client` (livekit-client)

- `MediaSession`: owns a `Room`; `start()` connects with a token from `tokenProvider()` and keeps the room connected
  forever: SDK resume/reconnect first, then rejoin with a fresh token, then wait with `backoffDelay` and retry without
  limit; `online`/`visibilitychange` cut the wait short. Intentional reasons (CLIENT_INITIATED, PARTICIPANT_REMOVED,
  DUPLICATE_IDENTITY, ROOM_DELETED and a 403 from the token provider) stop it: state `stopped | replaced | removed`.
  State signal-like API: `state`, `onStateChange(fn)`; `stop()`.
- `LiveKitSourceProvider implements SourceMediaProvider`: maps `{identity}/{trackName}` to remote video tracks,
  keeps video elements attached across track loss (hold frame), aggregates desired sizes → `setVideoDimensions` /
  `setVideoQuality` per publication (output: `adaptiveStream` off), sets the playout delay hint per role.
  `getStats(sourceId)` (bitrate, fps, resolution, packet loss, jitter-buffer delay) and
  `estimateLatencyMs()` (RTT/2 + jitter buffer delay, averaged) for the output debug overlay and report.
- `Publisher` (sender): `publishCamera(slot, { facingMode, resolution: 720 | 1080 })`, `switchCamera()`,
  `publishScreen(slot)` (must be called from a user gesture), `unpublish(slot)`, `stopAll()`, per-slot state
  (`starting | live | paused | ended | failed`) via `onSlotState(fn)`; camera `ended`/device loss → re-acquire with
  `restartTrack` (3 attempts with backoff, then `failed`), screen `ended` → `ended` (never restarts by itself);
  republishes all live slots after a rejoin; `getSlotTelemetry()` for reports.
- `runTechCheck(…)`: camera (resolution/fps achieved), network (RTT to the API over 5 pings), bandwidth (upload of
  1 MB to `/api/device/bandwidth-test`, ≥ 6 Mbit/s ok, ≥ 3 warn, else bad) → `TechCheckDto`.

## 9. Applications

### 9.1 Regie (`apps/studio`, Angular)

Implements `prototype/regie.html` faithfully with real data. `DESIGN.md` + `.impeccable/design.json` are the design
system (tokens, typography, components, responsive rules). Routes: `/login`, `/` (Regie), `/monitoring`
(full-page station metrics: bitrate, fps, resolution, packet loss, RTT, battery, network, tech check; live).
Header: brand, production name (menu: rename, switch/create production, slates), “Start broadcast” / “End broadcast”
(start/end/reset broadcast, confirmation for ending), LIVE runtime (while live; else “READY” / “ENDED”),
output chip with popover (state, consumers, IPs, format, latency, link copy, IP restriction editor, regenerate key
with dashed red confirmation), station health chip, “Docks and layout” popover, a settings (gear) popover with the
language setting, presence, clock, logout.
Everything in the prototype menu “Prototype” is replaced by real events (no demo data).
State: one `ProductionStore` service wrapping `ProductionSync` in signals; commands go through `StudioApi` (typed
HttpClient). Undo/redo (Ctrl+Z / Ctrl+Shift+Z, 60 steps) per scene via `ReplaceSceneItems`. Keyboard as prototype
(1–9, Space, arrows 1 px / Shift 10 px, Escape). Editing: drag, corner resize (aspect ratio locked, Shift frees),
Alt+drag on an edge/corner crops (like OBS), snapping to canvas edges, safe margin, centre and other items with blue
guides (Alt disables snapping during move), dot raster while dragging, live edits throttled to the API as specified.
Studio Mode and layout persist per browser (`localStorage` keys `studioflow.studio`, `studioflow.layout` v1,
`studioflow.transition`; the language setting is `studioflow.locale`, shared with the sender). Fonts self-hosted. Responsive rules from DESIGN.md (1280×720 … 1920×1080; ≤ 1180 px
stacked docks; ≤ 900 px priority stack).

### 9.2 Sender (`apps/sender`, Angular PWA, base `/join/`)

Routes: `/join/` (resume with stored credentials, else pairing form: name, kind auto-detected – phone if no
`getDisplayMedia` or mobile UA; switchable), `/join/i/:token` (redeem), `/join/waiting` (check code “47 12”, waiting),
`/join/station` (paired). Station UI: big tally border/background (red “LIVE”, green “Up next” («Als Nächstes»), none),
device
name + slot codes, connection state (“Connected”, “Reconnecting…”, “Blocked”, “Opened in another tab”; German:
«Verbunden», «Verbindet neu …», «Gesperrt», «In einem anderen Tab geöffnet»).
Phone: camera preview, front/back, 720p/1080p, start/stop, dark mode (black screen with a thin tally frame),
wake lock (re-acquire on visibility), auto-start after reload with the last settings. Laptop: list of screen slots with
“Share screen”, “+ Add another screen”, “Stop sharing”, “Remove”, a large “Share again” button when a
share ended or the Regie asks (“The control room asks you to share your screen again”), optional camera. German:
«Bildschirm teilen», «+ weiteren Bildschirm», «Teilen beenden», «Entfernen», «Erneut teilen», «Die Regie bittet dich,
den Bildschirm erneut zu teilen».
Messages from the Regie appear as a prominent banner. Technical check runs on first start and on demand; result is
reported. Reports every 2 s. PWA: manifest (name “StudioFlow Sender”, `lang` `en`, scope/start_url `/join/`, display standalone,
theme `#0d1117`), Angular service worker for the app shell only (never cache `/api`, `/hubs`, `/rtc`).
Design: same tokens as the Regie, large touch targets (≥ 44 px), works from 320 px wide, portrait and landscape.

### 9.3 Output (`apps/output`, Vanilla TS + Vite, base `/o/`)

`/o/{slug}?k=…[&bg=transparent][&debug=1][&lang=de-CH]`. No controls, no text except slates and hold messages (English
by default; `lang` selects `en` or `de-CH`, otherwise the browser language decides; the output ignores the stored
setting). Boot: read slug
and key, subscribe via output hub (`ProductionSync`), get a LiveKit token, start `MediaSession` (output role) and
`LiveKitSourceProvider`, render with `createSceneRenderer(mode 'output')`: standby slate → program scene → end slate;
program switches play the event's transition; preview scene and all other scenes are preloaded at LOW/HIGH as in 7.
Loss of API or LiveKit keeps the last picture; reconnect forever. 403 → slate “No access” («Kein Zugang») (no retry loop faster
than 30 s). `debug=1` shows a mono overlay (scene, revision, connection states, per source resolution/fps/bitrate,
estimated latency). Reports `OutputReport` every 2 s. Bundle target: < 350 KB gzip incl. livekit-client.

## 10. Infrastructure

Operations (English): `docs/runbook.md`. Every variable is documented in `.env.example`.

`docker-compose.yml` (project `studioflow`, network `studioflow` with subnet `${STUDIOFLOW_SUBNET:-172.30.0.0/24}`).
All services: `restart: unless-stopped`, `no-new-privileges`, json-file logs 5 × 10 MB, a healthcheck, `depends_on`
with `condition: service_healthy` (caddy waits for api and livekit, api waits for postgres). Required variables fail
fast (`${VAR:?…}`); optional variables have their default in `docker-compose.yml` and nowhere else.

- `caddy`: build context = repository root, `infra/caddy/Dockerfile`: stage 1 `node:22.22.3-alpine` (`npm ci`,
  `npm run build:web`), stage 2 `caddy:2.11.7-builder-alpine` + xcaddy with the DNS modules cloudflare v0.2.4,
  infomaniak v1.0.2, hetzner/v2 v2.0.1, desec v1.1.0, route53 v1.6.2, gandi v1.2.1, ovh v1.1.0, stage 3
  `caddy:2.11.7-alpine` with `dist/studio/browser` → `/srv/studio`, `dist/sender/browser` → `/srv/join`,
  `dist/output` → `/srv/o`. The build runs `caddy validate` for every TLS mode (except `custom`, which needs mounted
  files) with a throwaway data directory, so no CA is baked into the image. Runs as uid 10001 without capabilities
  (`cap_drop: ALL`, sysctl `net.ipv4.ip_unprivileged_port_start=0`). Ports 80/tcp, 443/tcp, 443/udp. Volumes
  `caddy_data:/data` (certificates, local CA – must survive), `caddy_config:/config`. Healthcheck in the image:
  `wget --spider http://127.0.0.1:2020/healthz` (loopback-only listener).
- `api`: build `apps/api` (own Dockerfile and `.dockerignore`), non-root, `cap_drop: ALL`, port 8080 inside the
  network only. Volumes `media:/data/media`, `keys:/data/keys`. Healthcheck
  `wget -q -O /dev/null http://127.0.0.1:8080/health/live`.
- `livekit`: `livekit/livekit-server:v1.13.10`, `cap_drop: ALL`, config as `LIVEKIT_CONFIG` YAML inside
  `docker-compose.yml` (interpolated from `.env`; `infra/livekit/` is not used): `port 7880`, `rtc.tcp_port 7881`,
  `rtc.udp_port 7882`, `rtc.use_external_ip false`, `room.auto_create true`, `room.empty_timeout 300`,
  `room.departure_timeout 20`, `webhook.api_key` = the key, `webhook.urls [http://api:8080/api/livekit/webhook]`.
  `LIVEKIT_KEYS: "{key}: {secret}"`, `NODE_IP` = `STUDIOFLOW_NODE_IP`. Ports 7881/tcp and 7882/udp only. Healthcheck
  `wget -q -O /dev/null http://127.0.0.1:7880/`.
- `postgres`: `postgres:17.11-alpine`, database and user `studioflow`, volume `pgdata`, healthcheck
  `pg_isready -h 127.0.0.1 -U studioflow -d studioflow` (TCP: during the first initialisation only the socket
  listens), `stop_grace_period: 30s`, `cap_drop: ALL` with `cap_add` `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`,
  `SETUID` (the official entrypoint fixes ownership and mode of the data and socket directories as root and then drops
  to the user `postgres`; without `DAC_OVERRIDE` a restart on a non-empty volume fails).
- Profile `chaos`: `netem` (built from `infra/netem`, `network_mode: service:livekit`, `cap_add: NET_ADMIN`):
  `docker compose --profile chaos run --rm netem apply <delay_ms> <jitter_ms> <loss_pct> [rate] | clear | show`
  (egress and ingress via ifb; affects media, signalling and API ↔ LiveKit).
- Profile `tools`: `toolbox` (the postgres image, no network, volumes media/keys/caddy_data at `/volumes/<name>`),
  started on demand by the backup and restore scripts.
- `docker-compose.override.example.yml`: local development (API on 127.0.0.1:5298, LiveKit signalling 127.0.0.1:7880,
  PostgreSQL 127.0.0.1:5432, `ASPNETCORE_ENVIRONMENT=Development`) and the certificate mount for TLS mode `custom`.

Caddy (`infra/caddy/Caddyfile`, shared parts in `infra/caddy/snippets/`, TLS modes in `infra/caddy/tls/`):

- Site `{$STUDIOFLOW_DOMAIN} {$STUDIOFLOW_EXTRA_HOSTS}`, `default_sni {$STUDIOFLOW_DEFAULT_SNI}` (clients without
  SNI, i.e. access by IP), `trusted_proxies static {$STUDIOFLOW_TRUSTED_PROXIES}` (default `127.0.0.1/32` = nobody,
  so LAN clients cannot spoof `X-Forwarded-For`), server timeouts `read_body_idle 5m`, `write_idle 2m`.
- TLS: `import /etc/caddy/tls/{$STUDIOFLOW_TLS_MODE}.caddy` (an unknown mode fails at startup).
  `internal` = Caddy's local CA (`skip_install_trust`; the root is served at `/ca.crt` as
  `application/x-x509-ca-cert`, only in this mode); `acme` = Let's Encrypt HTTP-01/TLS-ALPN (public reachability);
  `custom` = `/certs/fullchain.pem` + `/certs/privkey.pem`; `dns-cloudflare | dns-infomaniak | dns-hetzner |
  dns-desec | dns-route53 | dns-gandi | dns-ovh` = Let's Encrypt DNS-01 with `resolvers {$STUDIOFLOW_DNS_RESOLVERS}`
  and `dns_challenge_override_domain {$STUDIOFLOW_DNS_CHALLENGE_DOMAIN}`. The override defaults to
  `_acme-challenge.{domain}`, which is exactly Caddy's own record name; set it to the CNAME target when
  `_acme-challenge` is delegated (providers without a module, e.g. Hostpoint or cyon → deSEC or Cloudflare).
  Provider secrets are read at runtime (`{env.…}`); certificates renew automatically.
- Routes: `POST /api/productions/{id}/assets[/]` → api with body ≤ `STUDIOFLOW_MAX_UPLOAD` and response header timeout
  15 min; all other `/api/*` → api with body ≤ `STUDIOFLOW_MAX_BODY` and 60 s; `/hubs/*` → api (no response header
  timeout: long polling); `/rtc`, `/rtc/*` → livekit:7880; `/twirp`, `/twirp/*` and `/api/livekit/*` (webhooks arrive
  inside the network) → 404;
  `/j/{token}` → 302 `/join/i/{token}`; `/join` → 308 `/join/`, `/o` → 308 `/o/` (query kept); `/join/*` sender SPA
  (`/srv/join`), `/o/*` output SPA (`/srv/o`), everything else studio SPA (`/srv/studio`). SPA fallback: paths without
  a file extension get `index.html`, missing files stay 404. Proxies use `dial_timeout 5s` and `stream_close_delay 5m`
  (WebSockets survive a config reload). The API's `/health/*` is not reachable through Caddy.
- Headers on every response: `Strict-Transport-Security: max-age={STUDIOFLOW_HSTS_MAX_AGE}; includeSubDomains`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, no `Server`;
  every header exactly once: the proxies to the API, the hubs and LiveKit drop the upstream's `X-Content-Type-Options`
  (`header_down`), the API keeps sending its own for direct access.
  HTML areas: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://{host}
  wss://{host}; worker-src 'self'; manifest-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self';
  form-action 'self'; frame-ancestors …; upgrade-insecure-requests` with `frame-ancestors 'none'` for `/` and `/join/`
  and `'self' {STUDIOFLOW_FRAME_ANCESTORS}` for `/o/`. `'unsafe-inline'` for styles only, because Angular injects
  component styles at runtime. `Permissions-Policy`: studio `camera=(), microphone=(), display-capture=(),
  clipboard-write=(self), screen-wake-lock=(self), fullscreen=(self), autoplay=(self)`; sender `camera=(self),
  microphone=(self), display-capture=(self), screen-wake-lock=(self), fullscreen=(self), clipboard-write=(self)`; output
  `camera=(), microphone=(), display-capture=(), autoplay=(self), fullscreen=(self)` (all deny geolocation, payment,
  usb). API responses get `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox` unless the
  API sets its own.
- Cache: Angular files with `-[A-Z0-9]{8}.ext` and Vite `/o/assets/*` → `public, max-age=31536000, immutable`; all
  other files (`index.html`, `ngsw.json`, `ngsw-worker.js`, manifest) → `no-cache`; error responses → `no-store`;
  zstd/gzip for the SPAs.
- Logs (JSON; access log on stdout, runtime/error log on stderr, both filtered): the query values `access_token`,
  `token` and `k` and the path tokens of `/j/…`, `/join/i/…` and `/api/pairing/invites/…` become `REDACTED`;
  `X-Output-Key`, `X-Pairing-Token` and the response `Location` are dropped; Caddy redacts `Cookie` and
  `Authorization` itself.
- The studio has no service worker (only the sender, scope `/join/`). Adding one to the studio requires
  `navigationUrls` exclusions for `/join`, `/o`, `/api`, `/hubs` and `/rtc`.

Configuration contract (`.env` → compose → containers). Compose passes only the variables a service needs; the API
reads ASP.NET Core configuration (double underscore = section separator, names case-insensitive):

| Variable (`.env`) | Used by | Meaning / default |
|---|---|---|
| `STUDIOFLOW_DOMAIN` | caddy, api | **Required.** Host name of the site, e.g. `studioflow.opten.ch` (tests: `localhost`; in mode `internal` also an IP) |
| `STUDIOFLOW_NODE_IP` | livekit | **Required.** IPv4 that LiveKit announces for media (`NODE_IP`): the server's LAN IP (VPS: public IP); `127.0.0.1` only for single-machine tests |
| `STUDIOFLOW_TLS_MODE` | caddy | **Required.** `internal` \| `acme` \| `custom` \| `dns-cloudflare` \| `dns-infomaniak` \| `dns-hetzner` \| `dns-desec` \| `dns-route53` \| `dns-gandi` \| `dns-ovh` |
| `STUDIOFLOW_EXTRA_HOSTS` | caddy | Further site addresses, space-separated (mode `internal`, e.g. the IP); default empty |
| `STUDIOFLOW_DEFAULT_SNI` | caddy | Certificate for clients without SNI; default `STUDIOFLOW_DOMAIN` (setup sets the first IP of the extra hosts) |
| `STUDIOFLOW_PUBLIC_BASE_URL` | api → `STUDIOFLOW__PUBLICBASEURL` | Base of invite, QR and output URLs; default `https://${STUDIOFLOW_DOMAIN}` (override only for a non-443 port) |
| `STUDIOFLOW_ACME_EMAIL` | caddy | Let's Encrypt account e-mail (`acme`, `dns-*`); default empty |
| `CF_API_TOKEN` | caddy | `dns-cloudflare` (Zone:Read, DNS:Edit) |
| `INFOMANIAK_API_TOKEN` | caddy | `dns-infomaniak` (scopes `domain:read dns:read dns:write`) |
| `HETZNER_API_TOKEN` | caddy | `dns-hetzner` (Hetzner Cloud DNS API) |
| `DESEC_TOKEN` | caddy | `dns-desec` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | caddy | `dns-route53` |
| `GANDI_BEARER_TOKEN` | caddy | `dns-gandi` (personal access token) |
| `OVH_ENDPOINT`, `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY` | caddy | `dns-ovh` |
| `STUDIOFLOW_DNS_CHALLENGE_DOMAIN` | caddy | `dns-*`: where the TXT record is written; default `_acme-challenge.${STUDIOFLOW_DOMAIN}`; the CNAME target when delegated |
| `STUDIOFLOW_DNS_RESOLVERS` | caddy | `dns-*`: resolvers for the propagation check; default `1.1.1.1 9.9.9.9` |
| `STUDIOFLOW_HSTS_MAX_AGE` | caddy | Seconds; default `31536000` (setup writes `3600` for `internal`) |
| `STUDIOFLOW_FRAME_ANCESTORS` | caddy, api → `STUDIOFLOW__FRAMEANCESTORS` | Additional origins allowed to embed `/o/*`, space-separated (`'self'` is always allowed and not part of the value); default empty. The API gets the effective list (`'self' …`) and shows it read-only |
| `STUDIOFLOW_TRUSTED_PROXIES` | caddy | CIDRs of proxies in front of Caddy whose `X-Forwarded-For` is trusted; default `127.0.0.1/32` (nobody) |
| `STUDIOFLOW_MAX_UPLOAD` | caddy | Body limit of the asset upload route; default `1100MiB` (1 GiB video + multipart overhead; `MB` = 10^6, `MiB` = 2^20) |
| `STUDIOFLOW_MAX_BODY` | caddy | Body limit of all other `/api/*` requests; default `10MB` |
| `STUDIOFLOW_SUBNET` | compose, api → `FORWARDEDHEADERS__KNOWNNETWORKS__0` | Subnet of the network `studioflow`; default `172.30.0.0/24` (only Caddy can reach the API) |
| `ADMIN__USERNAME` | api | **Required.** Admin user name |
| `ADMIN__PASSWORDHASH` / `ADMIN__PASSWORD` | api | One of them is required by the API: ASP.NET Identity v3 hash (setup writes it) or plain password (local development, `--plain-password`, or setup's fallback). Compose passes the unset one as an empty string |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | livekit, api → `LIVEKIT__APIKEY`, `LIVEKIT__APISECRET` | **Required.** Key `studioflow`, secret `sk` + 40 hex (starts with a letter, ≥ 32 chars). Also `LIVEKIT__INTERNALURL=http://livekit:7880` (fixed) |
| `POSTGRES_PASSWORD` | postgres, api → `CONNECTIONSTRINGS__STUDIOFLOW` | **Required.** 32 alphanumeric characters; only applied when `pgdata` is initialised. The API gets `Host=postgres;Database=studioflow;Username=studioflow;Password=…` |
| `MEDIA__MAXIMAGEBYTES`, `MEDIA__MAXVIDEOBYTES` | api | Default `26214400`, `1073741824` |
| – | api | Fixed: `MEDIA__PATH=/data/media`, `DATAPROTECTION__KEYSPATH=/data/keys` |

Nothing but Caddy (80/tcp, 443/tcp+udp) and LiveKit media (7881/tcp, 7882/udp) is published.

Scripts (repository root; bash and PowerShell 7.4+ with the same options and behaviour; shared code in
`infra/scripts/common.sh` and `infra/scripts/StudioFlow.psm1`; messages in English, ASCII only (no i18n layer); `--help` / `Get-Help -Full`):

- `setup.sh` / `setup.ps1`: interactive or `--non-interactive` (`--domain`, `--node-ip` (default: source address of the
  default route, confirmed interactively), `--tls-mode`, `--acme-email`, `--dns-challenge-domain`, `--extra-hosts`,
  `--frame-ancestors`, `--admin-user`, `--admin-password-stdin`, `--generate-password`, `--plain-password`,
  `--env-file`, `--force`; PowerShell: `-Domain`, `-NodeIp`, …). Provider credentials come from the environment, the
  existing `.env` or a hidden prompt. Generates the LiveKit secret and the PostgreSQL password, builds the API image
  and stores `ADMIN__PASSWORDHASH` from
  `docker compose run --rm --no-deps -T --entrypoint dotnet api Opten.StudioFlow.Web.dll hash-password` (falls back to
  `ADMIN__PASSWORD` with a warning). Writes `.env` atomically with mode 600; refuses to overwrite it without
  `--force`, then keeps `.env.backup-<time>` and reuses the PostgreSQL password, the LiveKit key pair and (if wanted)
  the admin credentials.
- `backup.sh` / `backup.ps1` (`--dir`, `--keep N`, `--label`): `pg_dump -Fc` via `docker compose exec`, the volumes
  media, keys and caddy_data as `.tar.gz` (via `toolbox`), `backup-info.txt` and `SHA256SUMS` into
  `backups/YYYY-MM-DD_HHMM[_label]/`; retention keeps the newest N by completion time.
- `restore.sh` / `restore.ps1` (`<dir>`, `--yes`, `--no-safety-backup`, `--force`): verifies the checksums, asks for
  confirmation, refuses while live, takes a safety backup (`…_pre-restore`), stops api and caddy, restores the dump into
  a new database with `pg_restore --no-owner --no-privileges --exit-on-error` and swaps it in by renaming (the old
  database stays intact if the restore fails, and no objects of a newer schema survive), replaces the volumes, starts
  the stack and waits until it is healthy.
- `update.sh` / `update.ps1` (`--backup`, `--no-pull`, `--force`): refuses while a broadcast is live or its state is
  unknown, `git pull --ff-only`, `docker compose up -d --build --remove-orphans --wait`, prints the status.

What the scripts and Caddy require from the API image:
- `ENTRYPOINT`/`WORKDIR` such that `dotnet Opten.StudioFlow.Web.dll` works in the working directory, BusyBox `wget`
  for the healthcheck, `/health/live` on port 8080.
- `hash-password`: reads the password from stdin (sent **without** a trailing newline; tolerate one), prints the
  Identity v3 hash as the last stdout line, exit 0.
- `broadcast-status`: exit code 3 if any production is live, 0 if none, any other code on error (`update` and
  `restore` then refuse unless forced).
- Treat empty `ADMIN__PASSWORDHASH` / `ADMIN__PASSWORD` as unset; trust `X-Forwarded-*` only from
  `FORWARDEDHEADERS__KNOWNNETWORKS__0` (ForwardLimit 1: Caddy replaces any client-sent `X-Forwarded-For`).

## 11. Testing (minimum)

- .NET unit tests (Core): scene validation and limits, templates of ids, pairing state machine (expiry, single use,
  idempotent redeem, check-code uniqueness), source status/incident state machine (all transitions), tally
  computation, transition guard, slot code allocation, output IP matching (IPv4/IPv6/CIDR), webhook signature
  verification, LiveKit token claims, login lockout.
- .NET integration tests (WebApplicationFactory + Testcontainers PostgreSQL): every REST route (happy path + main
  errors + auth), CSRF header, hub subscribe/delta/snapshot, device hub hello/tally/session replacement, output hub
  filtering (revisionOnly), webhook flow → incidents, uploads with spoofed types.
- Vitest: scene-model reducer (apply/ignore/gap for every event type), selectors, templates, formatting;
  realtime-client retry/gap/resubscribe with a fake hub; scene-renderer DOM output (fit, crop, z-order, hold frame
  timing with fake timers, fallback, fades complete, auto-grid, letterboxing); media-client logic with fake rooms
  (reconnect policy, intentional reasons, provider attach/hold, desired-size aggregation, publisher re-acquire).
- Angular: store, dock layout (persist/validate/move/reset), editor math (snap, resize with ratio, crop), keyboard,
  key components.
- E2E (Playwright, real stack, fake media): see `docs/testing.md`.

## 12. Decisions on open points (test planning, 2026-10-22)

The pins in `docs/testing.md` section 7 (GAP-01 … GAP-38) are binding decisions unless overridden here:

- GAP-08: additionally, (a) a device report with `rtc: reconnecting|disconnected` while the hub is up marks its live
  slots `reconnecting` immediately (do not wait for LiveKit's ~21 s timeout); (b) sources persist `lastLiveAt`; after
  an API start, a source that was live within the last 12 h and is used in the program or preview scene and whose
  device does not reconnect within 15 s becomes `reconnecting` with an incident – no outage goes unnoticed, even
  across a restart.
- GAP-11: the template is named “Screen + camera column” (plan wording «Screen + Kamera-Spalte», id `col`). The Regie clamps typed values to the
  server bounds; dragging keeps the prototype minimum of 96 × 54.
- GAP-12: detection target 2–5 s as in the plan: server `ClientTimeoutInterval` 5 s, keep-alive 2 s; clients
  `serverTimeoutInMilliseconds` 5000.
- GAP-15: tests prefer roles, labels and visible English text (German text only in the German-locale tests); `data-testid` attributes may be added where roles are
  ambiguous. No global debug objects in production builds except the output page's opt-in `?latency=1` test aid.
- GAP-25: the backoff sequence is 0, 300, 600, 1200, 2400, 4800, 5000 ms (+ 0–250 ms jitter from the second retry).
- GAP-08 (camera pause): a slot reported `paused` (the OS suspended the camera) means «not live, expected back» →
  `reconnecting` if it was live; only a deliberate stop is `ended` (“K1 camera stopped”, “S1 sharing stopped”). Every
  device report lists every slot; a new Hello session clears the reported slot states (section 4.5).
- Test hooks (`window.__sfStudio`, `window.__sfSender`) are read-only state views that exist only when the opt-in
  flag `localStorage['studioflow.testHooks'] = '1'` is set (E2E sets it with an init script). The flag is read once
  when the Regie's production store / the sender's station starts and must be exactly `'1'`; the objects are frozen,
  non-enumerable and non-writable (getters read the live state) and live as long as the page (removed when the service is
  destroyed; after a sign-out `__sfStudio` reports `revision: null`, `hub: 'idle'`).
  `__sfStudio = { revision: number | null, lastSync: 'delta' | 'snapshot' | null, hub: HubState }`;
  `__sfSender = { slots(): Record<slot, SlotState>, rtc(): RtcState, sessionId: string }`.
- Log texts of block, unblock and removal name the codes and the device (“K1 Phone 1 blocked”, “S1 S2 Laptop Mia
  removed”; known-bugs BUG-10: intended, more informative for devices with several slots); the Regie toasts name the
  codes only (“K1 blocked and disconnected”).
- Hub reports are cheap and frequent: the telemetry relayed to the Regie is throttled (section 6), and a report that
  arrives while the database is down still counts as a sign of life of the session (GAP-29), so the database outage does
  not turn into source outages once it is over.
