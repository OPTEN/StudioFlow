# Security audit — StudioFlow

**Phase: repo only** · Audited on 22 October 2026 21:20 by an automated security audit agent

**Findings: 🔴 0 Critical · 🟠 0 High · 🟡 2 Medium · 🔵 2 Low** — 🔎 0 to check · ✅ 32 ok · ℹ️ 2 Info · ⚪ 0 not checked · ⏭ 14 not applicable

Live site not checked · Repo: StudioFlow @ dd13fd0 (main) · Code review: 27 items assessed by the agent

> Passive review: no attacks, no logins, no form submissions, no payloads. Every finding names its evidence and a recommendation; nothing was changed.

## Findings

### 🟡 Medium (2)

- **auth-05 Login and forms are throttled against brute force/spam** — Throttling exists (login lockout, pairing limits), but the lockouts can be abused to lock people out: 20 failed attempts lock the admin name for everyone, 20 open pairing requests block /join; on Docker Desktop all clients share one IP
  - [code] apps/api/src/Opten.StudioFlow.Core/Application/Services/LoginThrottle.cs:3-6 + apps/api/src/Opten.StudioFlow.Web/appsettings.json:17-22: 20 failed attempts per user name within 15 min lock the name for every IP; AdminLoginService.cs:32 checks the lockout before the password – anyone who can reach the login page can block the admin login again and again for 15 min (existing sessions keep working)
  - [code] docs/runbook.md:36-38 Docker Desktop: all devices with the same internal IP → 5 failed attempts lock the login for everyone, pairing limits apply to all together, output IP restriction unusable
  - [code] Core/Application/Runtime/PairingRequestStore.cs:34 at most 20 open pairing requests in total (appsettings.json:30-34, 10 per IP): two anonymous clients keep /join full for 10 min
  - [code] LoginThrottle.cs:83-89 at 10 000 entries the oldest counter is evicted, even one with an active lockout
  - [code] Web/Hosting/StudioFlowHost.cs:290-297 and Web/Security/RequestSecurity.cs:102-112 partition per single address (IPv6: per /128, not per /64)
  - [code] Positive: PBKDF2 hash (Infrastructure/Security/AdminCredentials.cs:45-61), 256-bit secrets (Core/Domain/Secrets.cs:16) – guessing keys and tokens is not practical even without a limit
  - [repo] apps/api/src/Opten.StudioFlow.Web/Endpoints/ApiSurface.cs:168: .RequireRateLimiting(PairingRequestsLimit);
  - [repo] apps/api/src/Opten.StudioFlow.Web/Endpoints/ApiSurface.cs:175: .RequireRateLimiting(RedeemLimit);
  - … 23 more (results-*.json, key `rate_limiting`)
  - **Recommendation:** Replace the hard user lockout with a progressive delay, or lock only IPs without an earlier success (LoginThrottle.cs:99-104); never evict active lockouts (LoginThrottle.cs:83-89); count IPv6 per /64 (RequestSecurity.cs:102-112); limit open pairing requests per IP instead of only globally (PairingRequestStore.cs:34); in production use Linux instead of Docker Desktop (runbook.md:36)
- **tr-02 Valid TLS certificate, modern protocol** — Mode internal: every device trusts a local root CA whose private key sits in caddy_data and in every backup; according to the configuration the root is not restricted to the StudioFlow domain (manual confirmation)
  - infra/caddy/tls/internal.caddy:1-4 tls internal; devices install the root through /ca.crt (internal.caddy:6-14, docs/runbook.md:134-155)
  - docker-compose.yml:70 caddy_data contains the CA including root.key; backup.sh:108 backs up caddy_data unencrypted
  - Whoever has root.key can issue certificates for arbitrary domains for all devices that installed the root (MITM), as long as the root carries no name constraints – check with “openssl x509 -in root.crt -noout -text”
  - Other modes are uncritical: Let's Encrypt with TLS 1.2/1.3 (infra/caddy/tls/acme.caddy:5-7, tls/dns-cloudflare.caddy:2-5)
  - **Recommendation:** Outside pure test devices use a dns-* mode (docs/runbook.md:81 recommends it); in mode internal remove the root from the devices after the test, do not use private devices, protect caddy_data and backups like a private CA key

### 🔵 Low (2)

- **deps-05 npm packages up to date** — 4 npm packages outdated, 2 of them major
  - MAJOR typescript 6.0.3 → 7.0.2 (devDependencies) [.]
  - MAJOR @types/node 22.20.5 → 26.6.5 (devDependencies) [.]
  - @angular/cli 22.2.3 → 22.2.4 (devDependencies) [.]
  - @angular/build 22.2.3 → 22.2.4 (devDependencies) [.]
  - **Recommendation:** `npm update` for minor/patch; update majors one at a time and test the frontend.
- **sup-04 Automatic dependency updates** — No Dependabot/Renovate; base images by tag instead of digest, xcaddy modules without a versioned go.sum, no NuGet lock file
  - [code] Neither .github/dependabot.yml nor renovate.json in the repo
  - [code] apps/api/Dockerfile:6, 21; infra/caddy/Dockerfile:9, 30, 41; docker-compose.yml:13, 120; infra/netem/Dockerfile:3 – tags without @sha256 digest
  - [code] infra/caddy/Dockerfile:31-38 modules pinned by version; transitive Go modules are resolved at build time (the Go checksum database protects against altered versions)
  - [code] infra/caddy/Dockerfile:16 npm ci with package-lock.json, but without --ignore-scripts: install scripts of the dependencies run in the build stage
  - [code] apps/api/Directory.Packages.props:17-46 central versions, but no packages.lock.json (RestorePackagesWithLockFile)
  - **Recommendation:** Set up Renovate or Dependabot for npm, NuGet, Dockerfiles, docker-compose.yml and Go modules; pin images with a digest (FROM …:tag@sha256:…); RestorePackagesWithLockFile + dotnet restore --locked-mode; consider npm ci --ignore-scripts

## Overview

### Dependencies — ✅ 5 / 6

- ✅ deps-01 No NuGet packages with known vulnerabilities — No known vulnerabilities in 1 project (including transitive, GitHub Advisory DB)
  - Temporary clone of HEAD dd13fd0 (uncommitted changes not included); dotnet restore apps/api/src/Opten.StudioFlow.Web/Opten.StudioFlow.Web.csproj -&gt; exit 0
- ✅ deps-02 No npm packages with known vulnerabilities — No known vulnerabilities (npm audit)
  - Build dependencies (devDependencies) mostly do not end up in the browser: check relevance per package
- ✅ deps-03 .NET and Umbraco still receive security updates — .NET 10 (LTS), all base images pinned to patch versions; patch currency and CVEs of the images not checked online *(code review)*
  - [code] apps/api/Directory.Build.props:4 &lt;TargetFramework&gt;net10.0&lt;/TargetFramework&gt; (TFM in Directory.Build.props, which is why the collector found no version)
  - [code] apps/api/Directory.Packages.props:26-36 ASP.NET Core / EF Core 10.0.13, Npgsql 10.0.3, IdentityModel 8.22.0
  - [code] apps/api/Dockerfile:6 mcr.microsoft.com/dotnet/sdk:10.0.402, :21 mcr.microsoft.com/dotnet/aspnet:10.0.13-alpine3.24
  - … 3 more (results-*.json, key `framework_support`)
- ✅ deps-04 NuGet packages up to date — All direct NuGet packages up to date
  - Temporary clone of HEAD dd13fd0 (uncommitted changes not included); dotnet restore apps/api/src/Opten.StudioFlow.Web/Opten.StudioFlow.Web.csproj -&gt; exit 0
- ❌ 🔵 deps-05 npm packages up to date — 4 npm packages outdated, 2 of them major
- ✅ deps-06 npm projects have a lock file — All npm projects have a versioned lock file

### Authentication & API — ✅ 4 / 6

- ✅ auth-01 State-changing endpoints require authentication — The 47 collector hits are false alarms: the policy is attached to the route group. The anonymous routes (login, webhook, 4 pairing routes, 4 output routes, asset content GET/HEAD) are intended and check token, key or signature themselves *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Web/Endpoints/ApiSurface.cs:39-40 Admin(): RequireAuthorization(Policies.Admin) + CsrfHeaderFilter on the groups productions, scenes, devices, pairing, assets, output (ApiSurface.cs:24-29)
  - [code] ApiSurface.cs:31 /api/device with Policies.Device; Security/DeviceAuthenticationHandler.cs:21-46 Bearer {deviceId}.{secret}, blocked devices fail at DeviceNotBlockedRequirement (DeviceAuthenticationHandler.cs:50-65)
  - [code] ApiSurface.cs:198-208 output routes without a group policy, but Endpoints/AdminEndpoints.cs:245,251,257,263 each call OutputService.AuthorizeAsync (Core/Application/Services/OutputService.cs:83-90: slug + key in constant time + IP rule, uniform 403)
  - … 65 more (results-*.json, key `api_auth`)
- ⏭ auth-02 Protected endpoints deny anonymous access (live) — No URL given: only the repo was checked
- ✅ auth-03 Form POSTs are protected against CSRF — CSRF protection through the mandatory header X-StudioFlow for all cookie-authenticated write requests, plus SameSite=Strict; no CORS *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Web/Security/RequestSecurity.cs:34-48 POST/PUT/PATCH/DELETE with sf_session without “X-StudioFlow: 1” → 403
  - [code] Endpoints/ApiSurface.cs:39-40 and 46-47 filter on all admin groups and logout; ApiSurface.cs:139 DisableAntiforgery() on the upload is covered by the group filter
  - [code] Hosting/StudioFlowHost.cs:205 SameSite=Strict; apps/studio/src/app/core/api/csrf.interceptor.ts:23-28 sets the header only for its own origin
  - … 2 more (results-*.json, key `antiforgery_forms`)
- ✅ auth-04 Token validation fully active — Webhook JWT fully validated; ValidateAudience=false is correct because LiveKit sets no aud. LiveKit tokens with minimal grants and 10 min TTL *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Infrastructure/LiveKit/LiveKitWebhookReceiver.cs:38-48 Issuer = API key, Lifetime + RequireExpirationTime, HS256 only, ClockSkew 1 min
  - [code] LiveKitWebhookReceiver.cs:49-55 claim sha256 over the raw body, comparison in constant time; invalid → 401 (Web/Endpoints/DeviceAndMediaEndpoints.cs:131-134)
  - [code] LiveKit/LiveKitTokenIssuer.cs:22 SetDefaultTimesOnTokenCreation=false is intentional: nbf/exp are set explicitly (LiveKitTokenIssuer.cs:66-68, 81-88), TTL 10 min (Web/appsettings.json:38)
  - … 6 more (results-*.json, key `jwt_validation`)
- ❌ 🟡 auth-05 Login and forms are throttled against brute force/spam — Throttling exists (login lockout, pairing limits), but the lockouts can be abused to lock people out: 20 failed attempts lock the admin name for everyone, 20 open pairing requests block /join; on Docker Desktop all clients share one IP *(code review)*
- ✅ auth-06 Protected member areas secured on the server — No member area; protected media is delivered by the server only with an admin session or output key *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Core/Application/Services/AssetService.cs:112-130 without cookie and key 401, wrong key or IP → 403
  - [code] apps/api/src/Opten.StudioFlow.Web/Endpoints/DeviceAndMediaEndpoints.cs:107-117 delivery with nosniff, CSP “default-src 'none'; sandbox”, inline with FileNameStar, Cache-Control private
  - [code] apps/output/src/config.ts:5-11, 181, 197 output key is removed from the address bar after loading and kept only in the tab's sessionStorage; infra/caddy/snippets/log-redact.caddy:5-6 masks ?k= and access_token in the log
  - … 1 more (results-*.json, key `member_routes`)

### Public routes & error pages — ✅ 5 / 5

- ✅ routes-01 No development files or dashboards public — According to the configuration no internal services or files are public (derived from Caddyfile/Compose, not checked live) *(code review)*
  - infra/caddy/Caddyfile:132-134 /api/livekit/* → 404; :179-182 /twirp → 404
  - docker-compose.yml:38-41 and 125-127 publish only 80/443 (Caddy) and 7881/7882 (LiveKit media); PostgreSQL, API and LiveKit 7880 only in the network studioflow
  - infra/caddy/tls/internal.caddy:6-14 /ca.crt delivers only root.crt through a rewrite; root.key stays unreachable
  - … 2 more (results-*.json, key `exposed_files`)
- ✅ routes-02 API documentation not public — Swagger/OpenAPI only active in Development
  - apps/api/src/Opten.StudioFlow.Web/Hosting/StudioFlowHost.cs:132: app.MapOpenApi();
  - Umbraco's own /umbraco/swagger is checked live with GET
- ✅ routes-03 No developer error pages in production — Developer exception page only in Development; web.config without debug/detailed errors
- ✅ routes-04 Error pages reveal no internals — Error responses without internals (according to code and Caddyfile, not checked live) *(code review)*
  - apps/api/src/Opten.StudioFlow.Web/Errors/StudioFlowExceptionHandler.cs:79 exception text only in Development, otherwise a generic “unexpected error” message
  - Web/Hosting/StudioFlowHost.cs:275 EnableDetailedErrors of the hubs only in Development; Web/Hubs/Hubs.cs:129-133 generic HubException
  - infra/caddy/Caddyfile:206-211 handle_errors answers only with status and status text
- ✅ routes-05 Diagnostic and job dashboards protected — Health endpoints without auth, but without details and not reachable through Caddy *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Web/Hosting/StudioFlowHost.cs:135-136 /health/live (no checks), /health/ready (DB check only)
  - [code] infra/caddy/Caddyfile:130-204 forwards only /api/*, /hubs/* and /rtc; /health/* ends up in the Regie (control room) SPA; docker-compose.yml:79-116 does not publish API port 8080
  - [code] infra/caddy/Caddyfile:99-103 Caddy health check only on 127.0.0.1:2020
  - … 2 more (results-*.json, key `diag_endpoints`)

### HTTP headers & cookies — ✅ 8 / 10

- ✅ hdr-01 Effective Content-Security-Policy — Strict CSP per area according to the Caddyfile (not checked live); only relaxation style-src 'unsafe-inline' because of Angular *(code review)*
  - infra/caddy/Caddyfile:54 default-src 'none'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; connect-src own host only; upgrade-insecure-requests
  - Caddyfile:186 /join/ and :201 / with frame-ancestors 'none'; :193 /o/ with 'self' + STUDIOFLOW_FRAME_ANCESTORS
  - Caddyfile:95 API responses “default-src 'none'; frame-ancestors 'none'; sandbox”; media additionally apps/api/src/Opten.StudioFlow.Web/Endpoints/DeviceAndMediaEndpoints.cs:114
  - … 1 more (results-*.json, key `hdr_csp`)
- ✅ hdr-02 HSTS with a long lifetime — HSTS max-age=31536000; includeSubDomains (mode internal: 3600) according to the Caddyfile, not checked live *(code review)*
  - infra/caddy/Caddyfile:39 Strict-Transport-Security max-age={$STUDIOFLOW_HSTS_MAX_AGE}; includeSubDomains
  - docker-compose.yml:51 default 31536000; setup.sh:15 INTERNAL_HSTS_MAX_AGE=3600 for mode internal
- ✅ hdr-03 X-Content-Type-Options: nosniff — nosniff on all responses, exactly once (according to Caddyfile and API) *(code review)*
  - infra/caddy/Caddyfile:40 and :78-80 (header_down removes the upstream's copy)
  - apps/api/src/Opten.StudioFlow.Web/Security/RequestSecurity.cs:86 the API sets nosniff also on direct access
- ✅ hdr-04 Protection against clickjacking — Clickjacking protection through CSP frame-ancestors per area (according to the Caddyfile) *(code review)*
  - infra/caddy/Caddyfile:186, 201 frame-ancestors 'none' for /join/ and /; :193 /o/ only 'self' + STUDIOFLOW_FRAME_ANCESTORS; :95 API 'none'
  - X-Frame-Options is missing; dispensable next to frame-ancestors
- ✅ hdr-05 Referrer-Policy set — Referrer-Policy: no-referrer (according to the Caddyfile) – important because ?k= and invite tokens appear in URLs *(code review)*
  - infra/caddy/Caddyfile:41
- ✅ hdr-06 Permissions-Policy set — Permissions-Policy per area; camera, microphone and screen only for /join/ (according to the Caddyfile) *(code review)*
  - infra/caddy/Caddyfile:186 /join/, :193 /o/, :201 Regie; everywhere geolocation=(), payment=(), usb=()
- ✅ hdr-07 No version information in headers — No Server header (according to Caddyfile and Kestrel configuration) *(code review)*
  - infra/caddy/Caddyfile:46 and :209 header -Server
  - apps/api/src/Opten.StudioFlow.Web/Hosting/StudioFlowHost.cs:60 AddServerHeader = false
- ✅ hdr-08 Cookies with Secure, HttpOnly, SameSite — sf_session: HttpOnly, SameSite=Strict, Secure outside Development/Testing (according to code, not checked live) *(code review)*
  - apps/api/src/Opten.StudioFlow.Web/Hosting/StudioFlowHost.cs:203-209
  - Remainder: no __Host- prefix (Web/Security/AuthSchemes.cs:46 “sf_session”)
- ⏭ hdr-09 CORS does not allow foreign origins — No URL given: only the repo was checked
- ℹ️ hdr-10 Cross-origin isolation headers (optional) — Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy not set (optional) *(code review)*
  - infra/caddy/Caddyfile:37-57 base_headers and page_headers without COOP/CORP

### Secrets & configuration — ✅ 8 / 9

- ℹ️ cfg-01 No secrets in the repo — Only placeholders, local development and test values are versioned; production secrets come exclusively from the .env *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Web/appsettings.json:38 is “TokenTtl”: “00:10:00” (false alarm)
  - [code] docs/architecture/implementation-spec.md:704 placeholder “Password=…”
  - [code] apps/api/src/Opten.StudioFlow.Web/appsettings.Development.json:3, 10, 14 values for local development (localhost DB, dev LiveKit); docker-compose.yml:89-96 sets all values through environment variables and aborts without .env (${…:?})
  - … 11 more (results-*.json, key `secrets_files`)
- ✅ cfg-02 No keys in the Git history — No key patterns (private keys, cloud/API tokens) in the Git history of all branches
  - Passwords in connection strings are not searched in the history (too many false reports); use e.g. gitleaks manually for that
- ✅ cfg-03 No debug mode in the release configuration — Development only in the example override for local development; the stack itself runs in Production *(code review)*
  - [code] docker-compose.override.example.yml:1-3, 18 example with a warning, on servers adopt only the caddy block; docker-compose.override.yml is in .gitignore:53
  - [code] docker-compose.yml:79-102 sets no ASPNETCORE_ENVIRONMENT (default Production); tests/e2e/docker-compose.e2e.yml:26 Production
  - [repo] ✗ docker-compose.override.example.yml:18: ASPNETCORE_ENVIRONMENT: Development
  - … 1 more (results-*.json, key `debug_settings`)
- ✅ cfg-04 CORS policy restrictive — No open CORS policy in the code
- ✅ cfg-05 No open redirects — No open redirects (API, Regie, Caddy) *(code review)*
  - [code] apps/studio/src/app/core/auth/auth.service.ts:14-19 safeNextPath only for relative paths (not “//”), navigation through the Angular router
  - [code] infra/caddy/Caddyfile:119-126 redirects only to fixed paths; token regex [A-Za-z0-9_-]+
- ✅ cfg-06 User input is output encoded — No HTML sinks in production code; Angular interpolation and CSP script-src 'self' *(code review)*
  - [code] Collector hits only in apps/studio/src/app/core/ui/keyboard.service.spec.ts:27,31 (test)
  - [code] Search for innerHTML, outerHTML, insertAdjacentHTML, bypassSecurityTrust, document.write, eval in apps/ and packages/ without *.spec.ts: only a comment (apps/studio/src/app/docks/pairing/qr-code.component.ts:41)
  - [code] infra/caddy/Caddyfile:54 script-src 'self'
  - … 3 more (results-*.json, key `xss_sinks`)
- ✅ cfg-07 No unsafe deserialisation — No unsafe deserialisers (BinaryFormatter, TypeNameHandling ≠ None)
- ✅ cfg-08 File uploads validated — Uploads checked by magic bytes, size and path, delivery defused; only for signed-in admins *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Infrastructure/Media/FileMediaStore.cs:45-48 type from the magic bytes (PNG, JPEG, WebP, MP4, WebM), otherwise 415
  - [code] FileMediaStore.cs:49-53 and 111-128 limits per type against declared and actually written bytes; :76-80 image size 1–16384 px
  - [code] FileMediaStore.cs:56-58 and 131-150 path only from validated IDs and a fixed extension; the file name serves only as a display name
  - … 3 more (results-*.json, key `file_upload`)
- ✅ cfg-09 Data protection keys persistent — Data protection keys persisted (volume keys), but unencrypted; whoever has the volume or a backup can forge valid admin cookies *(code review)*
  - [code] apps/api/src/Opten.StudioFlow.Web/Hosting/StudioFlowHost.cs:193-197 PersistKeysToFileSystem without ProtectKeysWith…
  - [code] backup.sh:98-108 backs up the volume keys unencrypted (docs/runbook.md:209-211 warns about this)
  - [repo] apps/api/src/Opten.StudioFlow.Web/Hosting/StudioFlowHost.cs:193: var dataProtection = services.AddDataProtection().SetApplicationName("StudioFlow");
  - … 1 more (results-*.json, key `dataprotection`)

### Umbraco hardening — ✅ 0 / 6

- ⏭ umb-01 Backoffice/member password rules and lockout not weakened — No Umbraco in the repo
- ⏭ umb-02 Backoffice with 2FA or SSO — No Umbraco in the repo
- ⏭ umb-03 Backoffice not freely reachable from the internet — No Umbraco in the repo
- ⏭ umb-04 Delivery API exposes only intended content — No Umbraco in the repo
- ⏭ umb-05 Production runtime mode — No Umbraco in the repo
- ⏭ umb-06 Umbraco enforces HTTPS — No Umbraco in the repo

### TLS, DNS & email — ✅ 1 / 6

- ✅ tr-01 HTTP redirects permanently to HTTPS — Caddy Automatic HTTPS redirects HTTP to HTTPS (no auto_https off; according to the Caddyfile, not checked live) *(code review)*
  - infra/caddy/Caddyfile:7-34 global options without auto_https; docker-compose.yml:39 port 80 only for the redirect and ACME (docs/runbook.md:53)
- ❌ 🟡 tr-02 Valid TLS certificate, modern protocol — Mode internal: every device trusts a local root CA whose private key sits in caddy_data and in every backup; according to the configuration the root is not restricted to the StudioFlow domain (manual confirmation) *(code review)*
- ⏭ tr-03 SPF record present and effective — No URL given: only the repo was checked
- ⏭ tr-04 DMARC with enforcement — No URL given: only the repo was checked
- ⏭ tr-05 DKIM active — No URL given: only the repo was checked
- ⏭ tr-06 CAA record restricts certificate authorities — No URL given: only the repo was checked

### Supply chain & frontend — ✅ 1 / 4

- ✅ sup-01 Checked-in JS libraries without known vulnerabilities — No versioned third-party libraries with a version banner found
  - Detection through licence banners (jQuery, Bootstrap, lodash, …); bundled code without a banner is covered by npm audit
- ⏭ sup-02 CDN resources with Subresource Integrity — No URL given: only the repo was checked
- ⏭ sup-03 CI workflows hardened — No GitHub Actions workflows
- ❌ 🔵 sup-04 Automatic dependency updates — No Dependabot/Renovate; base images by tag instead of digest, xcaddy modules without a versioned go.sum, no NuGet lock file *(code review)*

## Basis

- Repo: StudioFlow @ dd13fd0 (main), 802 versioned files, 64 endpoints in the inventory
- Code review by the agent: 2026-10-22T19:40:00Z
- File and line references point to the audited commit dd13fd0; they may have moved since (for example in `docs/runbook.md`, which has since been translated).
- Sources: dotnet list package (GitHub Advisory DB), npm audit, OSV.dev, endoflife.date, DNS-over-HTTPS (Cloudflare/Google).

## Changes since the audit (issue #4, first-run setup)

The audit above describes commit dd13fd0. The Regie account has changed since, and the references to
`Infrastructure/Security/AdminCredentials.cs` and to `Admin:Username`/`Admin:PasswordHash` in the findings are outdated:

- The account is no longer a setting in `.env` or Compose: it is created in the first-run setup, stored in the table
  `admin_account` (one row by primary key and check constraint) and hashed by `AdminPasswordHasher` (Identity v3,
  PBKDF2). Backups hold the hash, never the password. Old `ADMIN__*` values are ignored with a startup warning.
- The window between the start and the setup is closed by a one-time setup code (about 40 bits, memory only, written to
  the server log only, new on every start, invalid after the setup, constant-time comparison). Wrong codes count towards
  the same lockout as failed logins (5 per address, 20 in total in 15 minutes), so the lockout remark of auth-05 applies
  to the setup as well: anyone who can reach the page can block the setup for 15 minutes, but not complete it.
- Password rules: at least 12 characters, not the user name, not on a list of common passwords. A password change needs
  the old password (counted like a failed login when wrong) and ends every other session at once (security stamp in the
  cookie, hub connections closed). `reset-admin` needs shell access to the server.

## Secret scan of the Git history (issue #5)

Done before the repository becomes public, because everything in the history becomes readable then.

| | |
|---|---|
| Date | 2026-10-26 |
| Tool | gitleaks **v8.30.1** (`zricethezav/gitleaks:latest`, image digest `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`), default rule set |
| Scope | The complete history (`git fetch --unshallow` first): 142 commits of every branch, including the remote branches `main`, `ccr-acd310eb-etjxtd`, `release-please--branches--main--components--studioflow` and `wip/issue-16-backups` |
| Command | `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo --log-opts="--all" --redact` |
| Result | 17 findings, all of the rule `generic-api-key`, **all false positives**; no private key, cloud or GitHub token, certificate or real credential |

The 17 findings, by kind (the values are not repeated here):

- 14 made-up passwords and secrets in tests: the first-run and session tests of the E2E suite (`tests/e2e/specs/auth`, `specs/ops`, `support/env.ts`: throwaway
  credentials that the harness writes to its own `.env.e2e`), the API integration tests (`FirstRunSetupTests`, `ResetAdminTests`) and the device-secret
  fixtures of the sender unit tests.
- 2 dummy values (`LIVEKIT_API_SECRET`, `POSTGRES_PASSWORD`) in `.github/workflows/release.yml` that only let `docker compose config` read the release
  bundle.
- 1 password in the `ADMIN__PASSWORD` example of an E2E test for the removed setting.

`.gitleaks.toml` names these places (rule `generic-api-key` only; every other rule stays active there). With it the same scan finds **nothing**: `no leaks found`.
Besides, `git log --all --name-only` shows no `.env`, key, certificate or dump file that was ever committed (`.env.example` only).
The real secrets of an installation are generated by `setup` into `.env`, which `.gitignore` excludes.

Repeat the scan right before the visibility is switched (the commits since then are not covered), and enable GitHub secret scanning with push protection
for the public repository. Not secrets but personal data: a maintainer's e-mail address in a unit test (`AdminAccountTests`), replaced by `admin@example.com`; see
`docs/open-source-checklist.md`.
