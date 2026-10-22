# FlowStudio – Implementation specification

Binding technical specification for the implementation of the plan
(`plan/FlowStudio Architekturplan.html`, Entwurf 2) and the Regie prototype (`prototype/regie.html`, `DESIGN.md`).
Everything here is a decision; if code and this document disagree, fix one of them deliberately.

Language: code, comments and this document are English. **All UI text is German (Switzerland)**: «ss» instead of «ß»,
guillemets « », decimal comma (0,3 s), 24h clock. Terms from OBS: Szene, Quelle, Element, Preview, Program, Take,
Studio-Modus, Dock, Übergang, Schnitt, Blende, Tally, Slate, Station.

## 1. Scope

Implemented now (plan phases 0–2, everything that is software):

- Phase 0: compose stack (Caddy, API, LiveKit, PostgreSQL), HTTPS in the LAN (DNS challenge or internal CA),
  automated latency measurement, reconnect behaviour, laptop pairing by short URL and check code.
- Phase 1 (MVP): admin login, productions, pairing (QR, code + approval, invite link), LiveKit tokens, SignalR hubs;
  sender PWA (camera, several screens, tally, auto-reconnect, wake lock, technical check); Regie after the prototype
  (scenes, layout templates incl. Auto-Grid, free editing with snapping, crop, Studio-Modus with preview and take,
  cut and fade, stations with state, freely arrangeable docks); images and videos as sources; output page 16:9 with
  secret link.
- Phase 2: backup/restore/update scripts, slates and per-item fallbacks, monitoring view (bitrate, packet loss,
  battery), security review and runbook, Regie-Chat (short messages to devices).

Prepared but not built (plan phases 3–4, confirmed as «später»): audio in FlowStudio (contracts and output page are
audio-ready, no audio track is published), restream/recording (egress), Air mode (renderer + air room), overlays and
lower thirds, multiview, Stream Deck, multi-tenancy UI (tenantId exists in the data model), auto-director,
greenscreen. Do not build them.

## 2. Repository layout and ownership

```
apps/api/            ASP.NET Core (.NET 10): FlowStudio.slnx, src/Opten.FlowStudio.{Core,Infrastructure,Web}, tests/
apps/studio/         Angular app: Regie (served at /)
apps/sender/         Angular PWA: sender (served at /join/)
apps/output/         Vanilla TypeScript + Vite: output page (served at /o/)
packages/scene-model/      generated contracts + pure state/model helpers (no DOM)
packages/realtime-client/  SignalR wrapper with endless reconnect + revisioned state sync
packages/scene-renderer/   framework-free DOM renderer for monitors, thumbnails and output
packages/media-client/     livekit-client wrapper: sessions with endless reconnect, source provider, publisher, stats
infra/caddy/         Dockerfile (xcaddy + DNS module + built frontends), Caddyfile, TLS snippets
infra/livekit/       livekit.yaml template (rendered via env by compose)
tests/e2e/           Playwright end-to-end tests against the compose stack
docs/                architecture, runbook, security review, testing report
docker-compose.yml, .env.example, setup.sh, setup.ps1, backup.sh, restore.sh, update.sh
```

Tooling: one root `package.json` (npm, Node ≥ 22.12), one root `angular.json` (projects `studio`, `sender`),
TypeScript 6 strict, Vitest 5 for packages and output (`vitest.config.ts` at the root), Angular unit tests via
`ng test <app> --watch=false` (Vitest builder), Playwright for E2E. Packages are consumed as TypeScript source via
`tsconfig.json` `paths` (`@flowstudio/<name>` → `packages/<name>/src/index.ts`); they have no build step and no
`package.json` of their own. **Do not change root `package.json`, `package-lock.json`, `angular.json` or
`tsconfig.json` without the orchestrator**; if you need a dependency, report it.

Commands: `npm run gen:contracts` (build API → OpenAPI → `packages/scene-model/src/generated/api.ts`),
`npm run build:web`, `npm run test:unit`, `npm run test:studio`, `npm run test:sender`, `npm run test:api`,
`npm run test:e2e`, `npm run typecheck`.

## 3. Conventions

- OPTEN standards apply (read the instruction files listed in your CLAUDE.md for the languages you touch).
  C#: namespaces `Opten.FlowStudio.*`, primary constructors, file-scoped namespaces, newline before braces,
  `is null`, `ArgumentNullException.ThrowIfNull`, `Async` suffix, structured logging with templates, XML docs for
  public APIs, xUnit tests named `MethodName_Condition_ExpectedResult`, no Arrange/Act/Assert comments.
  Angular: standalone, signals (`signal`, `computed`, `effect`, `input()`, `output()`, `viewChild()`), OnPush,
  `inject()`, built-in control flow, typed reactive forms, SCSS with BEMIT (`c-`, `o-`, `u-`, `is-`/`has-`),
  component styles next to components, shared tokens in `src/styles/`.
- `TreatWarningsAsErrors` is on for .NET. Keep it green.
- No external CDNs, fonts or services at runtime. Fonts are self-hosted (copy from `prototype/fonts/`).
- Security: never log secrets (device secrets, output keys, tokens, passwords). Compare secrets in constant time.
- Every user-visible string is German (CH). IDs, enums and API fields are English.

## 4. Domain

### 4.1 Identifiers

Random, URL-safe ids with a type prefix and 16 lowercase base32 characters (80 bits):
`prd_`, `scn_`, `itm_`, `dev_`, `ast_`, `inv_`, `prq_` (pairing request), `inc_`, `cmd_`.
Secrets (device secret, output key, invite token, poll token) are 32 random bytes, base64url without padding.

### 4.2 Production (aggregate root)

Fields: id, tenantId (`opten`), name (1–80), slug (lowercase `[a-z0-9-]{1,48}`, unique per tenant, derived from the
name on creation), isActive (exactly one active production per tenant), broadcast (standby | live | ended),
liveSince, endedAt, programSceneId, previewSceneId, lastTransition, lastSwitchAt, standbySlate («Gleich geht's los»,
subtitle = production name), endSlate («Danke fürs Zuschauen»), output key (+ createdAt), allowedIps, createdAt.

On first start the API creates the default production «Webinar» (slug `webinar`, active) with three scenes:
«Begrüssung» (empty, layout free), «Präsentation» (empty), «Pause» (empty) – program = first scene, broadcast standby.

Rules:
- Broadcast: `start` (standby|ended → live, liveSince = now), `end` (live → ended, endedAt = now),
  `reset` (any → standby). The output shows the standby slate, the program scene, or the end slate.
- Program switch (`program`): scene must exist; if `now < lastSwitchAt + lastTransition.durationMs` (a fade is
  running) → 409 `transition_running`. Switching to the current program is a no-op (200, no event).
- Take: requires previewSceneId ≠ null and ≠ programSceneId (else 409 `conflict`); swaps program and preview.
- Preview: any existing scene or null. Studio-Modus itself is a per-browser setting; turning it on in a browser sets
  the preview to the scene after the program if none is set; turning it off clears the preview only if no other Regie
  session is connected (the client decides; the server just stores the value).
- Transition durations: cut → durationMs 0; fade → one of 200, 300, 500, 800, 1000, 1500, 2000 (default 300).
- Deleting the program scene → 409 `scene_is_live`. Deleting the preview scene clears the preview.
- Max 99 scenes per production (`limit_reached`).

### 4.3 Scene and items

As in `SceneContracts.cs`. Validation (server authoritative, client clamps the same way):
- name 1–80 chars (trimmed); background colour `^#[0-9a-fA-F]{6}$`; background asset must be an image asset.
- max 32 items; item ids unique; source must exist in the production when added (`AddSceneItem`, `ReplaceItems`
  and `UpdateItem` may keep a source that was deleted later – it renders as «Quelle fehlt»).
- x ∈ [-3840, 3840], y ∈ [-2160, 2160], w ∈ [16, 3840], h ∈ [16, 2160]; crop sides ∈ [0, 0.45],
  top+bottom < 0.9, left+right < 0.9; radius ∈ [0, 200]; rotation ∈ {0, 90, 180, 270}; border width ∈ [1, 40],
  colour hex; onLost.holdMs null or ∈ [0, 600000]; fallbackSource null or an existing source ≠ the item's source.
- Every change increments `Version` and emits `sceneUpserted` with the full scene.
- Defaults for a new item (`AddSceneItem` without geometry): x 1240, y 680, w 600, h 338, radius 12,
  fit contain for screens else cover, crop 0, rotation 0, onLost {holdMs 3000, fallback null}.
- `UpdateSceneItem` replaces the whole item (last writer wins per item). Clients coalesce rapid edits (drag) and send
  sequentially (never more than one request in flight per item; send the newest state when the previous returns).

Layout templates (client-side, `packages/scene-model`): Vollbild, Nebeneinander, Bild-in-Bild,
Screen + Kamera-Spalte, Eins plus zwei, 2 × 2, 3 × 3, Auto-Grid – slot rectangles exactly as `PRESETS` in the
prototype. Applying a template orders the visible items by kind (screen, then image/video, then camera), assigns slots
in order, sets fit contain for a screen in slot 0 (except Nebeneinander and the grids), radius 0 for full-canvas slots
else 12, and sends `ReplaceSceneItems`. Items beyond the slot count keep their geometry. Auto-Grid sets
`layoutMode = autoGrid`: the renderer arranges all visible items whose source is available (live, or lost but still
inside its hold time; media always) with `autoGridSlots(n)` (prototype `autoSlots`), in item order; editing an item's
geometry in the editor switches the scene back to `free` with the current computed rectangles.

### 4.4 Sources and slot codes

A source is a device slot (`{deviceId}/{slot}`) or an asset (`{assetId}`). Slots: `camera`, `screen-1` … `screen-9`.
The slot name is also the LiveKit track name; the device id is the LiveKit identity.

Slot codes: K = camera, S = screen, M = media; the lowest free number per letter in the production at creation time
(K1, K2 …). Codes never change while the source exists. Labels: phones «{device name}», laptop screens
«{device name} · Screen {n}», laptop camera «{device name} · Kamera», media = asset name.

Creation: pairing a phone creates its `camera` slot; pairing a laptop creates `screen-1`. A laptop allocates more
screens or its camera with `POST /api/device/slots` (max 9 screens + 1 camera per device, `limit_reached`).
`DELETE /api/device/slots/{slot}` removes the source (the sender's «Entfernen»); a screen share that merely ended
keeps its slot (state ended) so the Regie can ask for a reshare and the picture returns to the same place.

### 4.5 Source status (server, in memory, see `SourceStatus`)

Inputs: device hub connection (keep-alive 2 s, server timeout 6 s), LiveKit webhooks (participant_joined/left,
track_published/unpublished; track name = slot), device reports (slot states, rtc state), block state.
At startup the API seeds published tracks with `ListParticipants`.

Per device slot:
- `blocked` if the device is blocked.
- `ok` if the track for the slot is published (webhook or report says live) and the device is not disconnected.
- `ended` if the device reports the slot `ended` (user stopped sharing).
- `lost` if the device reports the slot `failed`.
- `reconnecting` if the slot was `ok` and the track/connection went away without `ended`/`failed` (hub disconnected,
  participant left unintentionally, track unpublished while the device reports rtc reconnecting). Stays amber until it
  is back or the device is blocked or the slot removed – there is no automatic escalation.
- `connecting` if the device is online but the slot never went live since the device connected.
- `offline` if the device is not connected and the slot was not live before (no incident).
Media sources are always `ok`.

Incidents: a transition from `ok` to `reconnecting`, `ended` or `lost` opens an incident (replacing any earlier
incident of the same source). Back to `ok` sets `endedAt` («wieder da · war 9 s weg») until someone acknowledges
it («Gesehen», `POST …/incidents/{id}/ack`, shared by both Regie sessions). Blocking a device or removing a source
removes its incidents. Each change emits `sourceUpserted` / `incidentUpserted` / `incidentRemovedEvent` and a log
entry («K2 verbindet neu», «K2 wieder da, war 9 s weg», «S1 Teilen beendet»).

### 4.6 Devices and pairing

Device: id, productionId, name (1–60), kind, platform (≤ 80), state (active | blocked), pairingMethod, pairedAt,
lastSeenAt, secretHash (SHA-256 of the secret), slots. Live data (connection, telemetry, tech check) is in memory.

Authentication: `Authorization: Bearer {deviceId}.{secret}` for REST; `access_token={deviceId}.{secret}` for the
device hub. Blocked devices get 403 `device_blocked` (the sender stops reconnecting and shows «Gesperrt»).
Blocking also calls LiveKit `RemoveParticipant` and sends the device a final `self` message, then aborts the hub
connection. Unblocking lets the device reconnect (the sender retries every 15 s while blocked).

Pairing ways (all end with `DeviceCredentialsDto`; the secret is shown once to the device and stored hashed):
1. **QR (phones)**: the Regie shows the current phone invite (`GET …/pairing/phone-invite` returns the valid one or
   creates one). URL: `{PublicBaseUrl}/join/i/{token}`. Valid once, 30 minutes. When it is redeemed or renewed, the
   server immediately creates the next phone invite and emits `inviteRemoved` + `inviteUpserted`, so the Regie always
   shows a fresh code. Redeeming creates a phone device named «Handy {n}» unless a name is given.
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
session. The old tab shows «In einem anderen Tab geöffnet» with «Hier weitermachen» (which takes over again). No
ping-pong: a replaced tab never reconnects by itself.

Tally (server → device `tally`): per slot `program` if a non-hidden item with that source is in the program scene,
else `preview` if in the preview scene, else `off`; overall = max. Pushed on every change that affects it and on
Hello. During standby/ended the tally is `off` (nothing is on air).

Commands: reshare (slot), switchCamera, message (1–140 chars; Regie-Chat). Delivered over the device hub; 202 even if
the device is offline (dropped then; the Regie shows a toast if the device is offline).

### 4.7 Assets

Upload `multipart/form-data` field `file`. Allowed (verified by magic bytes, not by the client's content type):
PNG, JPEG, WebP images ≤ 25 MB; MP4 (ftyp) and WebM (EBML) videos ≤ 1 GB (configurable `Media:MaxImageBytes`,
`Media:MaxVideoBytes`). SVG, GIF and everything else → 415 `unsupported_media`; too big → 413. Image width/height are
read from the header. Stored at `/data/media/{productionId}/{assetId}{ext}`; name from the file name (sanitized,
≤ 80 chars). Content endpoint supports HTTP range requests and `Cache-Control: private, max-age=3600`; access with
the admin cookie or `?k={outputKey}` of the asset's production. Deleting an asset used by a scene item, a scene
background, a slate or a fallback → 409 `asset_in_use`.

### 4.8 Output access

The output URL is `{PublicBaseUrl}/o/{slug}?k={outputKey}`. The key is sent by the page as `X-Output-Key` (REST) and
as `access_token` (output hub). Wrong key → 403 (no hint whether the slug exists). If `allowedIps` is not empty, the
client IP (from `X-Forwarded-For`, trusted only from the Caddy network) must match one entry (IP or CIDR), else 403.
`regenerate-key` invalidates the old key immediately: connected output pages are disconnected (hub abort + LiveKit
`RemoveParticipant` for identity `output_{slug}_*`). Embedding is limited by `frame-ancestors` from
`FLOWSTUDIO_FRAME_ANCESTORS` (Caddy; shown read-only in the Regie).

Output status: the API tracks output hub connections (count, remote IPs) and reports (`OutputReport` every 2 s).
State `connected` if ≥ 1 page connected and reported `rendering` within 6 s, `stale` if connected but no fresh
rendering report, `none` otherwise. Changes emit `outputStatusChanged` (latency/fps updates at most every 5 s or when
the value changes by > 20 %).

### 4.9 Audit log

Table `audit_entries` (id, productionId nullable, at, actor `admin` | `device:{id}` | `system`, action, details jsonb).
Actions: login.succeeded, login.failed, login.locked, scene.live, broadcast.started, broadcast.ended, device.paired,
device.blocked, device.unblocked, device.removed, pairing.denied, invite.created, invite.revoked, output.key.regenerated,
output.access.changed, asset.uploaded, asset.deleted, scene.created, scene.deleted. The API derives the German log
text (`LogEntryDto`) for the Regie; `RecentLog` in the snapshot holds the latest 20 entries of the production.

## 5. API

The REST surface is fixed in `apps/api/src/Opten.FlowStudio.Web/Endpoints/ApiSurface.cs` (routes, verbs, operation
names, request/response types). Implement every route; keep the contract. Successful responses use the documented
types; errors are RFC 7807 `ProblemDetails` with extension `code` (see `ErrorCodes`) and, for validation, `errors`.

Authentication and authorization:
- Admin: `POST /api/auth/login` checks `Admin:Username` and `Admin:PasswordHash` (ASP.NET Identity v3 hash; created by
  `dotnet Opten.FlowStudio.Web.dll hash-password`, which reads the password from stdin) or, for local setups only,
  `Admin:Password` (plain). Startup fails without one of them. Cookie `fs_session`: HttpOnly, Secure
  (`SameAsRequest` only in Development/Testing), SameSite=Strict, sliding 12 h. Data Protection keys persisted to
  `/data/keys` (`DataProtection:KeysPath`). Lockout: 5 failed attempts per client IP within 15 minutes → 15 minutes
  429 `rate_limited` with `Retry-After`; additionally 20 failures per username in 15 minutes lock the username.
- CSRF: cookie-authenticated unsafe requests (POST/PUT/PATCH/DELETE) must carry `X-FlowStudio: 1` (the Angular
  interceptor sets it); otherwise 403. No CORS is enabled.
- Hubs reject WebSocket/negotiate requests whose `Origin` host differs from the request host (403).
- Policies: `Admin` (cookie), `Device` (device bearer), `Output` (key + IP check, per slug).
- Production-scoped routes return 404 for unknown production ids.

Validation: built-in .NET 10 minimal API validation where it fits, plus domain validation in Core returning
`validation_failed` with field errors. Input sizes are bounded (JSON body ≤ 256 KB except uploads and the bandwidth
test ≤ 4 MB).

Concurrency: one API instance. All mutations of a production run through `ProductionCoordinator`, which serializes
them per production (SemaphoreSlim), loads/saves through EF Core, increments the in-memory revision and publishes
events **inside the lock** (ordered delivery). The revision counter starts at `unixTimeMs * 1000` on process start, so
it is monotonic across restarts; clients resubscribe after any reconnect anyway.

Persistence: PostgreSQL 17, EF Core 10 + Npgsql, snake_case tables, migrations applied on startup
(`Database.MigrateAsync`, guarded against design-time/OpenAPI generation). Scene items are stored as `jsonb`.
Health: `/health/live` (process), `/health/ready` (database reachable).

## 6. Realtime protocol (SignalR, JSON protocol, camelCase, enums as camelCase strings)

Hubs: `/hubs/studio` (Admin), `/hubs/device` (Device), `/hubs/output` (Output). Server keep-alive 2 s, client timeout
6 s; clients set `serverTimeoutInMilliseconds = 6000`, `keepAliveIntervalInMilliseconds = 2000` and reconnect
forever (0, 300, 600, 1200 … max 5000 ms + jitter); `online` and `visibilitychange` trigger an immediate attempt.

Studio: `Subscribe(productionId, sinceRevision?) → ProductionChangesDto`. The server keeps the last 500 events per
production in a ring buffer: if `sinceRevision` is known and all later events are buffered, it returns them
(`events`), else a `snapshot`. After subscribing, the connection receives `event` (one `ProductionEvent`),
`telemetry` (`DeviceTelemetryMessage`, every 2 s per device, not revisioned) and `presence` (number of connected Regie
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
  hidden true. TTL 2 h (LiveKit refreshes tokens of running connections); clients fetch a fresh token for every
  rejoin.
- Webhooks: LiveKit posts to `http://api:8080/api/livekit/webhook`; the API verifies the JWT in `Authorization`
  (HS256 with the API secret, `iss` = API key) and the `sha256` claim against the body; invalid → 401.
- Room service (Twirp over HTTP, `http://livekit:7880/twirp/livekit.RoomService/…`): RemoveParticipant (block,
  output key rotation), ListParticipants (startup seed).
- Publishing (sender): camera H.264, simulcast layers 1080p/540p/270p (or 720p/360p/180p), `contentHint = 'motion'`;
  screens VP9 with H.264 backup codec, `contentHint = 'detail'`, simulcast off, max 1440p/15–30 fps;
  dynacast on; no audio.
- Subscribing: Regie with `adaptiveStream: true` (monitors are small) and minimal jitter buffer
  (`playoutDelayHint`/`jitterBufferTarget` ≈ 0 where supported); output with `adaptiveStream: false`, explicit
  quality per source from the scene model: program items → dimensions of the item on the canvas (HIGH for large
  items), preview scene items → HIGH (preload before a take), all other scenes' sources → LOW; jitter buffer ≈ 50 ms.
- The LiveKit URL for clients is the same origin (`wss://{host}`); Caddy proxies `/rtc` to LiveKit 7880. Media goes
  directly to 7881/tcp and 7882/udp on `FLOWSTUDIO_NODE_IP`.

## 8. Shared packages (public APIs)

### 8.1 `@flowstudio/scene-model` (pure TypeScript, no DOM)

- `contracts.ts` (exists): generated wire types under friendly names, `HUB`, `ERROR_CODES`.
- `constants.ts`: `CANVAS_WIDTH = 1920`, `CANVAS_HEIGHT = 1080`, `SAFE_MARGIN = 40`, `FADE_DURATIONS_MS`,
  `DEFAULT_FADE_MS = 300`, `HOLD_OPTIONS` ([{label:'Standbild 3 s, dann abgedunkelt', holdMs:3000},
  {…10 s…, 10000}, {label:'Standbild halten', holdMs:null}]), limits (`MAX_ITEMS_PER_SCENE = 32`, …), item bounds.
- `source-ref.ts`: `parseSourceRef(ref)` → `{kind:'device', deviceId, slot} | {kind:'asset', assetId} | null`,
  `deviceSourceRef(deviceId, slot)`, `isDeviceSourceRef`, `slotKind(slot)`.
- `layout-templates.ts`: `LAYOUT_TEMPLATES` (id, name, slots), `autoGridSlots(count)`,
  `applyLayoutTemplate(items, templateId, kindOf: (sourceId) => SourceKind | undefined)` →
  `{ items, layoutMode }`.
- `geometry.ts`: `clampItem(item)`, `validateItem(item)` → list of German messages, `itemDefaults(source, kind)`,
  `rectsIntersect`, `CanvasRect` helpers.
- `production-state.ts`: immutable `ProductionState` (revision, serverOffsetMs, production, scenes ordered,
  `sourcesById`, devices, assets, pairingRequests, invites, incidents, outputStatus, log, operatorsOnline, telemetry by
  device) with `stateFromSnapshot(snapshot, receivedAtMs)`, `stateFromOutputSnapshot(…)`,
  `applyEvent(state, event)` → `{ state, result: 'applied' | 'ignored' | 'gap' }`, `applyTelemetry`.
- `selectors.ts`: `programScene`, `previewScene`, `sceneById`, `sourcesInScene(scene)`,
  `isSourceVisibleIn(scene, sourceId)`, `sceneHealth(scene, sources)` (worst down source like the prototype),
  `tallyOf(state, sourceId)`, `incidentPlace(state, sourceId)` («im Program» | «in der Preview» | «nicht live»),
  `stationOrder` (prototype ordering), `isDown(status)`.
- `format.ts` (de-CH): `formatDuration(ms)` mm:ss, `formatRuntime(ms)` hh:mm:ss, `formatClock(date)`,
  `formatHm(date)`, `formatSeconds(ms)` («0,3 s»), `formatRate(mbit)` («2,8»), `formatCheckCode('4712')` («47 12»),
  `statusWord(status)` («verbindet neu», «Teilen beendet», «gesperrt», «verbindet …», «kein Bild», «nicht verbunden»).

### 8.2 `@flowstudio/realtime-client`

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

### 8.3 `@flowstudio/scene-renderer` (DOM, no framework, no livekit)

Interfaces in `types.ts` (exists). Main API:

```ts
createSceneRenderer(container: HTMLElement, options: {
  mode: 'output' | 'monitor' | 'thumbnail';
  provider: SourceMediaProvider;
  background?: 'black' | 'transparent';          // output ?bg=transparent
  statusOf?: (sourceId: string) => MonitorSourceStatus | undefined;  // monitor alerts (Regie)
  codeOf?: (sourceId: string) => string | undefined;                 // label «K2 · Standbild 00:12»
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
  effectiveRects(): ReadonlyMap<string, CanvasRect>;    // per item id, after Auto-Grid (for the edit overlay)
  stats(): { fps: number; items: number; videos: number };
  destroy(): void;
}
```

Rendering rules: one absolutely positioned element per visible item in z-order, `<video muted playsinline autoplay>`
for device sources and video assets (loop), `<img>` for images, GPU-friendly transforms only (no canvas copies).
Fit cover/contain via `object-fit`; crop by an inner wrapper scaled so the cropped part fills the item; radius with
`overflow:hidden` + `border-radius`; border as inset box-shadow; mirror `scaleX(-1)`; rotation 90/270 swaps the
inner box. Contain bars use `#0a0d12`. Missing source → dark placeholder `#121821` (monitor shows «Quelle fehlt»).
Hold frame: when a device source is `lost`, the element keeps its last frame; after `onLost.holdMs` it gets the
held state (blur ≈ 2.5 % of item width, dark overlay rgba(13,17,23,.72), centred «Bild kommt gleich zurück» if the
item is ≥ 320 px wide) – or shows `onLost.fallbackSource` instead. `holdMs = null` never escalates. In `monitor`
mode, a down source additionally gets a dashed outline (amber `#e3b341` reconnecting, red `#f85149` otherwise) and a
filled label tab like the prototype. Desired sizes: each renderer reports the on-screen pixel size of every device
source it shows (×devicePixelRatio, rounded to 16 px) via `provider.setDesiredSize`. Auto-Grid as in 4.3.
Fades use the Web Animations API on opacity (new scene layer over old), `reducedMotion` turns fades into cuts.

### 8.4 `@flowstudio/media-client` (livekit-client)

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
Header: brand, production name (menu: rename, switch/create production, slates), «Sendung starten/beenden»
(start/end/reset broadcast, confirmation for «beenden»), LIVE runtime (while live; else «BEREIT» / «BEENDET»),
output chip with popover (state, consumers, IPs, format, latency, link copy, IP restriction editor, regenerate key
with dashed red confirmation), station health chip, Docks und Layout popover, presence, clock, logout.
Everything in the prototype menu «Prototyp» is replaced by real events (no demo data).
State: one `ProductionStore` service wrapping `ProductionSync` in signals; commands go through `StudioApi` (typed
HttpClient). Undo/redo (Ctrl+Z / Ctrl+Shift+Z, 60 steps) per scene via `ReplaceSceneItems`. Keyboard as prototype
(1–9, Space, arrows 1 px / Shift 10 px, Escape). Editing: drag, corner resize (aspect ratio locked, Shift frees),
Alt+drag on an edge/corner crops (like OBS), snapping to canvas edges, safe margin, centre and other items with blue
guides (Alt disables snapping during move), dot raster while dragging, live edits throttled to the API as specified.
Studio-Modus and layout persist per browser (`localStorage` keys `flowstudio.studio`, `flowstudio.layout` v1,
`flowstudio.transition`). Fonts self-hosted. Responsive rules from DESIGN.md (1280×720 … 1920×1080; ≤ 1180 px
stacked docks; ≤ 900 px priority stack).

### 9.2 Sender (`apps/sender`, Angular PWA, base `/join/`)

Routes: `/join/` (resume with stored credentials, else pairing form: name, kind auto-detected – phone if no
`getDisplayMedia` or mobile UA; switchable), `/join/i/:token` (redeem), `/join/warten` (check code «47 12», waiting),
`/join/station` (paired). Station UI: big tally border/background (red «LIVE», green «Als Nächstes», none), device
name + slot codes, connection state («Verbunden», «Verbindet neu …», «Gesperrt», «In einem anderen Tab geöffnet»).
Phone: camera preview, front/back, 720p/1080p, start/stop, dark mode (black screen with a thin tally frame),
wake lock (re-acquire on visibility), auto-start after reload with the last settings. Laptop: list of screen slots with
«Bildschirm teilen», «+ weiteren Bildschirm», «Teilen beenden», «Entfernen», a large «Erneut teilen» button when a
share ended or the Regie asks («Die Regie bittet dich, den Bildschirm erneut zu teilen»), optional camera.
Messages from the Regie appear as a prominent banner. Technical check runs on first start and on demand; result is
reported. Reports every 2 s. PWA: manifest (name «FlowStudio Sender», scope/start_url `/join/`, display standalone,
theme `#0d1117`), Angular service worker for the app shell only (never cache `/api`, `/hubs`, `/rtc`).
Design: same tokens as the Regie, large touch targets (≥ 44 px), works from 320 px wide, portrait and landscape.

### 9.3 Output (`apps/output`, Vanilla TS + Vite, base `/o/`)

`/o/{slug}?k=…[&bg=transparent][&debug=1]`. No controls, no text except slates and hold messages. Boot: read slug
and key, subscribe via output hub (`ProductionSync`), get a LiveKit token, start `MediaSession` (output role) and
`LiveKitSourceProvider`, render with `createSceneRenderer(mode 'output')`: standby slate → program scene → end slate;
program switches play the event's transition; preview scene and all other scenes are preloaded at LOW/HIGH as in 7.
Loss of API or LiveKit keeps the last picture; reconnect forever. 403 → slate «Kein Zugang» (no retry loop faster
than 30 s). `debug=1` shows a mono overlay (scene, revision, connection states, per source resolution/fps/bitrate,
estimated latency). Reports `OutputReport` every 2 s. Bundle target: < 350 KB gzip incl. livekit-client.

## 10. Infrastructure

`docker-compose.yml` services: `caddy` (build `infra/caddy`, ports 80/443, volumes caddy_data, caddy_config),
`api` (build `apps/api`, volumes media → /data/media, keys → /data/keys), `livekit` (image pinned, config via
`LIVEKIT_CONFIG` env rendered from `.env`, ports 7881/tcp and 7882/udp, `--node-ip ${FLOWSTUDIO_NODE_IP}`),
`postgres` (postgres:17-alpine pinned, pgdata). All `restart: unless-stopped`, healthchecks on every service,
`depends_on` with `condition: service_healthy`. The API image is non-root.

Caddy: site `{$FLOWSTUDIO_DOMAIN}`; TLS mode from `FLOWSTUDIO_TLS_MODE` = `dns` (Let's Encrypt DNS challenge with
the provider module selected at build time, default cloudflare; token from env) | `internal` (Caddy local CA; root
certificate exported for devices) | `public` (HTTP-01, only with public reachability). Routes: `/api/*`, `/hubs/*`
→ api:8080; `/rtc*` → livekit:7880; `/join*` → sender SPA; `/j/*` → redirect `/join/i/*`; `/o/*` → output; `/` →
studio SPA. Headers: HSTS, strict CSP (see security review), `X-Content-Type-Options`, `Referrer-Policy
no-referrer`, `Permissions-Policy` (camera/display-capture only on `/join`), `frame-ancestors 'none'` except `/o/*`
(`FLOWSTUDIO_FRAME_ANCESTORS`). Hashed assets `immutable`, `index.html`/`ngsw*.json` `no-cache`. Upload body limit
1 GB on the asset route only.

Scripts (bash for Linux, PowerShell equivalents where marked): `setup.sh`/`setup.ps1` (asks domain, node IP
(auto-detected), TLS mode + DNS token, admin user and password; writes `.env` with random secrets; hashes the password
via the API image), `backup.sh` (pg_dump + media volume to `backups/YYYY-MM-DD_HHMM/`), `restore.sh`, `update.sh`
(refuses while a broadcast is live; `git pull`, `docker compose up -d --build`, health wait).

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
