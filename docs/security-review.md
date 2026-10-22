# Security-Audit — FlowStudio

**Phase: nur Repo** · Geprüft am 22.10.2026 21:20 vom Agent opten-security-audit

**Befunde: 🔴 0 Kritisch · 🟠 0 Hoch · 🟡 2 Mittel · 🔵 2 Niedrig** — 🔎 0 zu prüfen · ✅ 32 ok · ℹ️ 2 Info · ⚪ 0 nicht geprüft · ⏭ 14 nicht anwendbar

Live-Site nicht geprüft · Repo: FlowStudio @ dd13fd0 (main) · Code-Review: 27 Punkte vom Agent beurteilt

> Passive Prüfung: keine Angriffe, keine Logins, keine Formular-Sendungen, keine Payloads. Jeder Befund nennt seine Belege und eine Empfehlung; nichts wurde geändert.

## Befunde

### 🟡 Mittel (2)

- **auth-05 Login und Formulare sind gegen Brute Force/Spam gedrosselt** — Drosselung vorhanden (Login-Sperre, Pairing-Limits), aber die Sperren lassen sich zum Aussperren missbrauchen: 20 Fehlversuche sperren den Admin-Namen für alle, 20 offene Anklopf-Anfragen blockieren /join; auf Docker Desktop teilen sich alle Clients eine IP
  - [code] apps/api/src/Opten.FlowStudio.Core/Application/Services/LoginThrottle.cs:3-6 + apps/api/src/Opten.FlowStudio.Web/appsettings.json:17-22: 20 Fehlversuche pro Benutzername in 15 min sperren den Namen für jede IP; AdminLoginService.cs:32 prüft die Sperre vor dem Passwort – wer die Login-Seite erreicht, kann den Admin-Login wiederholt 15 min blockieren (bestehende Sitzungen laufen weiter)
  - [code] docs/runbook.md:36-38 Docker Desktop: alle Geräte mit derselben internen IP → 5 Fehlversuche sperren den Login für alle, Pairing-Limits gelten für alle zusammen, Output-IP-Sperre unbrauchbar
  - [code] Core/Application/Runtime/PairingRequestStore.cs:34 höchstens 20 offene Anklopf-Anfragen insgesamt (appsettings.json:30-34, 10 pro IP): zwei anonyme Clients halten /join für 10 min voll
  - [code] LoginThrottle.cs:83-89 bei 10 000 Einträgen wird der älteste Zähler verdrängt, auch einer mit aktiver Sperre
  - [code] Web/Hosting/FlowStudioHost.cs:290-297 und Web/Security/RequestSecurity.cs:102-112 partitionieren pro Einzeladresse (IPv6: pro /128, nicht pro /64)
  - [code] Positiv: PBKDF2-Hash (Infrastructure/Security/AdminCredentials.cs:45-61), 256-Bit-Secrets (Core/Domain/Secrets.cs:16) – Raten von Schlüsseln und Tokens ist auch ohne Limit nicht praktikabel
  - [repo] apps/api/src/Opten.FlowStudio.Web/Endpoints/ApiSurface.cs:168: .RequireRateLimiting(PairingRequestsLimit);
  - [repo] apps/api/src/Opten.FlowStudio.Web/Endpoints/ApiSurface.cs:175: .RequireRateLimiting(RedeemLimit);
  - … 23 weitere (results-*.json, Schlüssel `rate_limiting`)
  - **Empfehlung:** Harte Benutzer-Sperre durch progressive Verzögerung ersetzen oder nur IPs ohne früheren Erfolg sperren (LoginThrottle.cs:99-104); aktive Sperren nie verdrängen (LoginThrottle.cs:83-89); IPv6 pro /64 zählen (RequestSecurity.cs:102-112); offene Anklopf-Anfragen pro IP begrenzen statt nur global (PairingRequestStore.cs:34); im Betrieb Linux statt Docker Desktop (runbook.md:36)
- **tr-02 Gültiges TLS-Zertifikat, modernes Protokoll** — Modus internal: jedes Gerät vertraut einer lokalen Root-CA, deren privater Schlüssel in caddy_data und in jedem Backup liegt; die Root ist laut Konfiguration nicht auf die FlowStudio-Domain beschränkt (Bestätigung manuell)
  - infra/caddy/tls/internal.caddy:1-4 tls internal; Geräte installieren die Root über /ca.crt (internal.caddy:6-14, docs/runbook.md:134-155)
  - docker-compose.yml:70 caddy_data enthält die CA inkl. root.key; backup.sh:108 sichert caddy_data unverschlüsselt
  - Wer root.key hat, kann für alle Geräte mit installierter Root Zertifikate für beliebige Domains ausstellen (MITM), solange die Root keine Name Constraints trägt – prüfen mit «openssl x509 -in root.crt -noout -text»
  - Andere Modi unkritisch: Let's Encrypt mit TLS 1.2/1.3 (infra/caddy/tls/acme.caddy:5-7, tls/dns-cloudflare.caddy:2-5)
  - **Empfehlung:** Ausserhalb reiner Testgeräte einen dns-*-Modus verwenden (docs/runbook.md:81 empfiehlt das); im Modus internal die Root nach dem Test von den Geräten entfernen, keine privaten Geräte verwenden, caddy_data und Backups wie einen privaten CA-Schlüssel schützen

### 🔵 Niedrig (2)

- **deps-05 npm-Pakete aktuell** — 4 npm-Pakete veraltet, davon 2 Major
  - MAJOR typescript 6.0.3 → 7.0.2 (devDependencies) [.]
  - MAJOR @types/node 22.20.5 → 26.6.5 (devDependencies) [.]
  - @angular/cli 22.2.3 → 22.2.4 (devDependencies) [.]
  - @angular/build 22.2.3 → 22.2.4 (devDependencies) [.]
  - **Empfehlung:** `npm update` für Minor/Patch; Majors einzeln aktualisieren und das Frontend testen.
- **sup-04 Automatische Abhängigkeits-Updates** — Kein Dependabot/Renovate; Basis-Images per Tag statt Digest, xcaddy-Module ohne versioniertes go.sum, kein NuGet-Lockfile
  - [code] Weder .github/dependabot.yml noch renovate.json im Repo
  - [code] apps/api/Dockerfile:6, 21; infra/caddy/Dockerfile:9, 30, 41; docker-compose.yml:13, 120; infra/netem/Dockerfile:3 – Tags ohne @sha256-Digest
  - [code] infra/caddy/Dockerfile:31-38 Module per Version gepinnt; transitive Go-Module werden beim Build aufgelöst (Go-Checksum-DB schützt vor veränderten Versionen)
  - [code] infra/caddy/Dockerfile:16 npm ci mit package-lock.json, aber ohne --ignore-scripts: Install-Skripte der Abhängigkeiten laufen in der Build-Stage
  - [code] apps/api/Directory.Packages.props:17-46 zentrale Versionen, aber kein packages.lock.json (RestorePackagesWithLockFile)
  - **Empfehlung:** Renovate oder Dependabot für npm, NuGet, Dockerfiles, docker-compose.yml und Go-Module einrichten; Images mit Digest pinnen (FROM …:tag@sha256:…); RestorePackagesWithLockFile + dotnet restore --locked-mode; npm ci --ignore-scripts prüfen

## Übersicht

### Abhängigkeiten — ✅ 5 / 6

- ✅ deps-01 Keine NuGet-Pakete mit bekannten Schwachstellen — Keine bekannten Schwachstellen in 1 Projekten (inkl. transitiv, GitHub Advisory DB)
  - Temp-Klon von HEAD dd13fd0 (uncommittete Änderungen nicht enthalten); dotnet restore apps/api/src/Opten.FlowStudio.Web/Opten.FlowStudio.Web.csproj -&gt; exit 0
- ✅ deps-02 Keine npm-Pakete mit bekannten Schwachstellen — Keine bekannten Schwachstellen (npm audit)
  - Build-Abhängigkeiten (devDependencies) landen meist nicht im Browser: Relevanz pro Paket prüfen
- ✅ deps-03 .NET und Umbraco erhalten noch Sicherheitsupdates — .NET 10 (LTS), alle Basis-Images auf Patch-Versionen gepinnt; Patch-Aktualität und CVEs der Images nicht online geprüft *(Code-Review)*
  - [code] apps/api/Directory.Build.props:4 &lt;TargetFramework&gt;net10.0&lt;/TargetFramework&gt; (TFM in Directory.Build.props, deshalb fand der Collector keine Version)
  - [code] apps/api/Directory.Packages.props:26-36 ASP.NET Core / EF Core 10.0.13, Npgsql 10.0.3, IdentityModel 8.22.0
  - [code] apps/api/Dockerfile:6 mcr.microsoft.com/dotnet/sdk:10.0.402, :21 mcr.microsoft.com/dotnet/aspnet:10.0.13-alpine3.24
  - … 3 weitere (results-*.json, Schlüssel `framework_support`)
- ✅ deps-04 NuGet-Pakete aktuell — Alle direkten NuGet-Pakete aktuell
  - Temp-Klon von HEAD dd13fd0 (uncommittete Änderungen nicht enthalten); dotnet restore apps/api/src/Opten.FlowStudio.Web/Opten.FlowStudio.Web.csproj -&gt; exit 0
- ❌ 🔵 deps-05 npm-Pakete aktuell — 4 npm-Pakete veraltet, davon 2 Major
- ✅ deps-06 npm-Projekte haben eine Lock-Datei — Alle npm-Projekte haben eine versionierte Lock-Datei

### Authentifizierung & API — ✅ 4 / 6

- ✅ auth-01 Zustandsändernde Endpunkte verlangen Authentifizierung — Die 47 Collector-Treffer sind Fehlalarme: die Policy hängt an der Routengruppe. Die anonymen Routen (Login, Webhook, 4 Pairing-, 4 Output-Routen, Asset-Inhalt GET/HEAD) sind gewollt und prüfen Token, Schlüssel oder Signatur selbst *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Web/Endpoints/ApiSurface.cs:39-40 Admin(): RequireAuthorization(Policies.Admin) + CsrfHeaderFilter auf den Gruppen productions, scenes, devices, pairing, assets, output (ApiSurface.cs:24-29)
  - [code] ApiSurface.cs:31 /api/device mit Policies.Device; Security/DeviceAuthenticationHandler.cs:21-46 Bearer {deviceId}.{secret}, gesperrte Geräte scheitern an DeviceNotBlockedRequirement (DeviceAuthenticationHandler.cs:50-65)
  - [code] ApiSurface.cs:198-208 Output-Routen ohne Gruppen-Policy, aber Endpoints/AdminEndpoints.cs:245,251,257,263 rufen jeweils OutputService.AuthorizeAsync (Core/Application/Services/OutputService.cs:83-90: Slug + Schlüssel in konstanter Zeit + IP-Regel, einheitlich 403)
  - … 65 weitere (results-*.json, Schlüssel `api_auth`)
- ⏭ auth-02 Geschützte Endpunkte verweigern anonymen Zugriff (live) — Keine URL angegeben: nur Repo geprüft
- ✅ auth-03 Formular-POSTs sind gegen CSRF geschützt — CSRF-Schutz per Pflicht-Header X-FlowStudio für alle cookie-authentifizierten schreibenden Anfragen, zusätzlich SameSite=Strict; kein CORS *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Web/Security/RequestSecurity.cs:34-48 POST/PUT/PATCH/DELETE mit fs_session ohne «X-FlowStudio: 1» → 403
  - [code] Endpoints/ApiSurface.cs:39-40 und 46-47 Filter auf allen Admin-Gruppen und Logout; ApiSurface.cs:139 DisableAntiforgery() beim Upload ist durch den Gruppenfilter abgedeckt
  - [code] Hosting/FlowStudioHost.cs:205 SameSite=Strict; apps/studio/src/app/core/api/csrf.interceptor.ts:23-28 setzt den Header nur für die eigene Origin
  - … 2 weitere (results-*.json, Schlüssel `antiforgery_forms`)
- ✅ auth-04 Token-Validierung vollständig aktiv — Webhook-JWT vollständig geprüft; ValidateAudience=false ist korrekt, weil LiveKit kein aud setzt. LiveKit-Tokens mit minimalen Grants und 10 min TTL *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Infrastructure/LiveKit/LiveKitWebhookReceiver.cs:38-48 Issuer = API-Key, Lifetime + RequireExpirationTime, nur HS256, ClockSkew 1 min
  - [code] LiveKitWebhookReceiver.cs:49-55 Claim sha256 über den Rohbody, Vergleich in konstanter Zeit; ungültig → 401 (Web/Endpoints/DeviceAndMediaEndpoints.cs:131-134)
  - [code] LiveKit/LiveKitTokenIssuer.cs:22 SetDefaultTimesOnTokenCreation=false ist Absicht: nbf/exp werden explizit gesetzt (LiveKitTokenIssuer.cs:66-68, 81-88), TTL 10 min (Web/appsettings.json:38)
  - … 6 weitere (results-*.json, Schlüssel `jwt_validation`)
- ❌ 🟡 auth-05 Login und Formulare sind gegen Brute Force/Spam gedrosselt — Drosselung vorhanden (Login-Sperre, Pairing-Limits), aber die Sperren lassen sich zum Aussperren missbrauchen: 20 Fehlversuche sperren den Admin-Namen für alle, 20 offene Anklopf-Anfragen blockieren /join; auf Docker Desktop teilen sich alle Clients eine IP *(Code-Review)*
- ✅ auth-06 Geschützte Mitgliederbereiche serverseitig abgesichert — Kein Mitgliederbereich; geschützte Medien werden serverseitig nur mit Admin-Sitzung oder Output-Schlüssel ausgeliefert *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Core/Application/Services/AssetService.cs:112-130 ohne Cookie und Schlüssel 401, falscher Schlüssel oder IP → 403
  - [code] apps/api/src/Opten.FlowStudio.Web/Endpoints/DeviceAndMediaEndpoints.cs:107-117 Auslieferung mit nosniff, CSP «default-src 'none'; sandbox», inline mit FileNameStar, Cache-Control private
  - [code] apps/output/src/config.ts:5-11, 181, 197 Output-Key wird nach dem Laden aus der Adresszeile entfernt und nur im sessionStorage des Tabs gehalten; infra/caddy/snippets/log-redact.caddy:5-6 maskiert ?k= und access_token im Log
  - … 1 weitere (results-*.json, Schlüssel `member_routes`)

### Öffentliche Routen & Fehlerseiten — ✅ 5 / 5

- ✅ routes-01 Keine Entwicklungsdateien oder Dashboards öffentlich — Laut Konfiguration keine internen Dienste oder Dateien öffentlich (aus Caddyfile/Compose abgeleitet, nicht live geprüft) *(Code-Review)*
  - infra/caddy/Caddyfile:132-134 /api/livekit/* → 404; :179-182 /twirp → 404
  - docker-compose.yml:38-41 und 125-127 veröffentlichen nur 80/443 (Caddy) und 7881/7882 (LiveKit-Medien); PostgreSQL, API und LiveKit 7880 nur im Netz flowstudio
  - infra/caddy/tls/internal.caddy:6-14 /ca.crt liefert per Rewrite nur root.crt; root.key bleibt unerreichbar
  - … 2 weitere (results-*.json, Schlüssel `exposed_files`)
- ✅ routes-02 API-Dokumentation nicht öffentlich — Swagger/OpenAPI nur in Development aktiv
  - apps/api/src/Opten.FlowStudio.Web/Hosting/FlowStudioHost.cs:132: app.MapOpenApi();
  - Umbraco-eigene /umbraco/swagger wird live per GET geprüft
- ✅ routes-03 Keine Entwickler-Fehlerseiten in Produktion — Developer-Exception-Page nur in Development; web.config ohne Debug/Detailed Errors
- ✅ routes-04 Fehlerseiten verraten keine Interna — Fehlerantworten ohne Interna (laut Code und Caddyfile, nicht live geprüft) *(Code-Review)*
  - apps/api/src/Opten.FlowStudio.Web/Errors/FlowStudioExceptionHandler.cs:79 Exception-Text nur in Development, sonst «Ein unerwarteter Fehler ist aufgetreten.»
  - Web/Hosting/FlowStudioHost.cs:275 EnableDetailedErrors der Hubs nur in Development; Web/Hubs/Hubs.cs:129-133 generische HubException
  - infra/caddy/Caddyfile:206-211 handle_errors antwortet nur mit Status und Statustext
- ✅ routes-05 Diagnose- und Job-Dashboards geschützt — Health-Endpunkte ohne Auth, aber ohne Details und nicht über Caddy erreichbar *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Web/Hosting/FlowStudioHost.cs:135-136 /health/live (keine Checks), /health/ready (nur DB-Check)
  - [code] infra/caddy/Caddyfile:130-204 leitet nur /api/*, /hubs/* und /rtc weiter; /health/* landet in der Regie-SPA; docker-compose.yml:79-116 veröffentlicht den API-Port 8080 nicht
  - [code] infra/caddy/Caddyfile:99-103 Caddy-Healthcheck nur auf 127.0.0.1:2020
  - … 2 weitere (results-*.json, Schlüssel `diag_endpoints`)

### HTTP-Header & Cookies — ✅ 8 / 10

- ✅ hdr-01 Wirksame Content-Security-Policy — Strikte CSP pro Bereich laut Caddyfile (nicht live geprüft); einzige Lockerung style-src 'unsafe-inline' wegen Angular *(Code-Review)*
  - infra/caddy/Caddyfile:54 default-src 'none'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; connect-src nur eigener Host; upgrade-insecure-requests
  - Caddyfile:186 /join/ und :201 / mit frame-ancestors 'none'; :193 /o/ mit 'self' + FLOWSTUDIO_FRAME_ANCESTORS
  - Caddyfile:95 API-Antworten «default-src 'none'; frame-ancestors 'none'; sandbox»; Medien zusätzlich apps/api/src/Opten.FlowStudio.Web/Endpoints/DeviceAndMediaEndpoints.cs:114
  - … 1 weitere (results-*.json, Schlüssel `hdr_csp`)
- ✅ hdr-02 HSTS mit langer Laufzeit — HSTS max-age=31536000; includeSubDomains (Modus internal: 3600) laut Caddyfile, nicht live geprüft *(Code-Review)*
  - infra/caddy/Caddyfile:39 Strict-Transport-Security max-age={$FLOWSTUDIO_HSTS_MAX_AGE}; includeSubDomains
  - docker-compose.yml:51 Standard 31536000; setup.sh:15 INTERNAL_HSTS_MAX_AGE=3600 für den Modus internal
- ✅ hdr-03 X-Content-Type-Options: nosniff — nosniff auf allen Antworten, genau einmal (laut Caddyfile und API) *(Code-Review)*
  - infra/caddy/Caddyfile:40 und :78-80 (header_down entfernt die Kopie des Upstreams)
  - apps/api/src/Opten.FlowStudio.Web/Security/RequestSecurity.cs:86 die API setzt nosniff auch bei Direktzugriff
- ✅ hdr-04 Schutz gegen Clickjacking — Clickjacking-Schutz über CSP frame-ancestors pro Bereich (laut Caddyfile) *(Code-Review)*
  - infra/caddy/Caddyfile:186, 201 frame-ancestors 'none' für /join/ und /; :193 /o/ nur 'self' + FLOWSTUDIO_FRAME_ANCESTORS; :95 API 'none'
  - X-Frame-Options fehlt; neben frame-ancestors entbehrlich
- ✅ hdr-05 Referrer-Policy gesetzt — Referrer-Policy: no-referrer (laut Caddyfile) – wichtig, weil ?k= und Einladungs-Tokens in URLs stehen *(Code-Review)*
  - infra/caddy/Caddyfile:41
- ✅ hdr-06 Permissions-Policy gesetzt — Permissions-Policy pro Bereich; Kamera, Mikrofon und Bildschirm nur für /join/ (laut Caddyfile) *(Code-Review)*
  - infra/caddy/Caddyfile:186 /join/, :193 /o/, :201 Regie; überall geolocation=(), payment=(), usb=()
- ✅ hdr-07 Keine Versionsangaben in Headern — Kein Server-Header (laut Caddyfile und Kestrel-Konfiguration) *(Code-Review)*
  - infra/caddy/Caddyfile:46 und :209 header -Server
  - apps/api/src/Opten.FlowStudio.Web/Hosting/FlowStudioHost.cs:60 AddServerHeader = false
- ✅ hdr-08 Cookies mit Secure, HttpOnly, SameSite — fs_session: HttpOnly, SameSite=Strict, Secure ausserhalb Development/Testing (laut Code, nicht live geprüft) *(Code-Review)*
  - apps/api/src/Opten.FlowStudio.Web/Hosting/FlowStudioHost.cs:203-209
  - Rest: kein __Host--Präfix (Web/Security/AuthSchemes.cs:46 «fs_session»)
- ⏭ hdr-09 CORS gibt keine fremden Origins frei — Keine URL angegeben: nur Repo geprüft
- ℹ️ hdr-10 Cross-Origin-Isolation-Header (optional) — Cross-Origin-Opener-Policy und Cross-Origin-Resource-Policy nicht gesetzt (optional) *(Code-Review)*
  - infra/caddy/Caddyfile:37-57 base_headers und page_headers ohne COOP/CORP

### Secrets & Konfiguration — ✅ 8 / 9

- ℹ️ cfg-01 Keine Secrets im Repo — Nur Platzhalter, lokale Entwicklungs- und Testwerte versioniert; produktive Secrets kommen ausschliesslich aus der .env *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Web/appsettings.json:38 ist «TokenTtl»: «00:10:00» (Fehlalarm)
  - [code] docs/architecture/implementation-spec.md:704 Platzhalter «Password=…»
  - [code] apps/api/src/Opten.FlowStudio.Web/appsettings.Development.json:3, 10, 14 Werte für die lokale Entwicklung (localhost-DB, Dev-LiveKit); docker-compose.yml:89-96 setzt alle Werte per Umgebungsvariable und bricht ohne .env ab (${…:?})
  - … 11 weitere (results-*.json, Schlüssel `secrets_files`)
- ✅ cfg-02 Keine Schlüssel im Git-Verlauf — Keine Schlüssel-Muster (Private Keys, Cloud-/API-Tokens) im Git-Verlauf aller Branches
  - Passwörter in Connection Strings werden im Verlauf nicht gesucht (zu viele Falschmeldungen); dafür z.B. gitleaks manuell
- ✅ cfg-03 Kein Debug-Modus in Release-Konfiguration — Development nur im Beispiel-Override für lokale Entwicklung; der Stack selbst läuft in Production *(Code-Review)*
  - [code] docker-compose.override.example.yml:1-3, 18 Beispiel mit Warnung, auf Servern nur den caddy-Block zu übernehmen; docker-compose.override.yml ist in .gitignore:53
  - [code] docker-compose.yml:79-102 setzt kein ASPNETCORE_ENVIRONMENT (Standard Production); tests/e2e/docker-compose.e2e.yml:26 Production
  - [repo] ✗ docker-compose.override.example.yml:18: ASPNETCORE_ENVIRONMENT: Development
  - … 1 weitere (results-*.json, Schlüssel `debug_settings`)
- ✅ cfg-04 CORS-Policy restriktiv — Keine offene CORS-Policy im Code
- ✅ cfg-05 Keine offenen Weiterleitungen — Keine offenen Weiterleitungen (API, Regie, Caddy) *(Code-Review)*
  - [code] apps/studio/src/app/core/auth/auth.service.ts:14-19 safeNextPath nur für relative Pfade (nicht «//»), Navigation per Angular-Router
  - [code] infra/caddy/Caddyfile:119-126 Weiterleitungen nur auf feste Pfade; Token-Regex [A-Za-z0-9_-]+
- ✅ cfg-06 Benutzereingaben werden encodiert ausgegeben — Keine HTML-Sinks im Produktionscode; Angular-Interpolation und CSP script-src 'self' *(Code-Review)*
  - [code] Collector-Treffer nur in apps/studio/src/app/core/ui/keyboard.service.spec.ts:27,31 (Test)
  - [code] Suche nach innerHTML, outerHTML, insertAdjacentHTML, bypassSecurityTrust, document.write, eval in apps/ und packages/ ohne *.spec.ts: nur ein Kommentar (apps/studio/src/app/docks/pairing/qr-code.component.ts:41)
  - [code] infra/caddy/Caddyfile:54 script-src 'self'
  - … 3 weitere (results-*.json, Schlüssel `xss_sinks`)
- ✅ cfg-07 Keine unsichere Deserialisierung — Keine unsicheren Deserialisierer (BinaryFormatter, TypeNameHandling ≠ None)
- ✅ cfg-08 Datei-Uploads validiert — Uploads nach Magic Bytes, Grösse und Pfad geprüft, Auslieferung entschärft; nur für angemeldete Admins *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Infrastructure/Media/FileMediaStore.cs:45-48 Typ aus den Magic Bytes (PNG, JPEG, WebP, MP4, WebM), sonst 415
  - [code] FileMediaStore.cs:49-53 und 111-128 Grenzen pro Typ gegen deklarierte und tatsächlich geschriebene Bytes; :76-80 Bildgrösse 1–16384 px
  - [code] FileMediaStore.cs:56-58 und 131-150 Pfad nur aus validierten IDs und fester Endung; der Dateiname dient nur als Anzeigename
  - … 3 weitere (results-*.json, Schlüssel `file_upload`)
- ✅ cfg-09 Data-Protection-Keys persistent — Data-Protection-Keys persistiert (Volume keys), aber unverschlüsselt; wer das Volume oder ein Backup hat, kann gültige Admin-Cookies erzeugen *(Code-Review)*
  - [code] apps/api/src/Opten.FlowStudio.Web/Hosting/FlowStudioHost.cs:193-197 PersistKeysToFileSystem ohne ProtectKeysWith…
  - [code] backup.sh:98-108 sichert das Volume keys unverschlüsselt (docs/runbook.md:209-211 warnt davor)
  - [repo] apps/api/src/Opten.FlowStudio.Web/Hosting/FlowStudioHost.cs:193: var dataProtection = services.AddDataProtection().SetApplicationName("FlowStudio");
  - … 1 weitere (results-*.json, Schlüssel `dataprotection`)

### Umbraco-Härtung — ✅ 0 / 6

- ⏭ umb-01 Backoffice-/Member-Passwortregeln und Lockout nicht abgeschwächt — Kein Umbraco im Repo
- ⏭ umb-02 Backoffice mit 2FA oder SSO — Kein Umbraco im Repo
- ⏭ umb-03 Backoffice nicht frei aus dem Internet erreichbar — Kein Umbraco im Repo
- ⏭ umb-04 Delivery API gibt nur gewollte Inhalte frei — Kein Umbraco im Repo
- ⏭ umb-05 Production-Runtime-Mode — Kein Umbraco im Repo
- ⏭ umb-06 Umbraco erzwingt HTTPS — Kein Umbraco im Repo

### TLS, DNS & E-Mail — ✅ 1 / 6

- ✅ tr-01 HTTP leitet permanent auf HTTPS um — Caddy Automatic HTTPS leitet HTTP auf HTTPS um (kein auto_https off; laut Caddyfile, nicht live geprüft) *(Code-Review)*
  - infra/caddy/Caddyfile:7-34 globale Optionen ohne auto_https; docker-compose.yml:39 Port 80 nur für Umleitung und ACME (docs/runbook.md:53)
- ❌ 🟡 tr-02 Gültiges TLS-Zertifikat, modernes Protokoll — Modus internal: jedes Gerät vertraut einer lokalen Root-CA, deren privater Schlüssel in caddy_data und in jedem Backup liegt; die Root ist laut Konfiguration nicht auf die FlowStudio-Domain beschränkt (Bestätigung manuell) *(Code-Review)*
- ⏭ tr-03 SPF-Record vorhanden und wirksam — Keine URL angegeben: nur Repo geprüft
- ⏭ tr-04 DMARC mit Durchsetzung — Keine URL angegeben: nur Repo geprüft
- ⏭ tr-05 DKIM aktiv — Keine URL angegeben: nur Repo geprüft
- ⏭ tr-06 CAA-Record beschränkt Zertifizierungsstellen — Keine URL angegeben: nur Repo geprüft

### Supply Chain & Frontend — ✅ 1 / 4

- ✅ sup-01 Eingecheckte JS-Bibliotheken ohne bekannte Schwachstellen — Keine versionierten Fremd-Bibliotheken mit Versions-Banner gefunden
  - Erkennung über Lizenz-Banner (jQuery, Bootstrap, lodash, …); gebündelter Code ohne Banner wird über npm audit abgedeckt
- ⏭ sup-02 CDN-Ressourcen mit Subresource Integrity — Keine URL angegeben: nur Repo geprüft
- ⏭ sup-03 CI-Workflows gehärtet — Keine GitHub-Actions-Workflows
- ❌ 🔵 sup-04 Automatische Abhängigkeits-Updates — Kein Dependabot/Renovate; Basis-Images per Tag statt Digest, xcaddy-Module ohne versioniertes go.sum, kein NuGet-Lockfile *(Code-Review)*

## Grundlage

- Repo: `C:\Dev\02_Intern\FlowStudio` @ dd13fd0 (main), 802 versionierte Dateien, 64 Endpunkte im Inventar
- Code-Review durch den Agent: 2026-10-22T19:40:00Z
- Quellen: dotnet list package (GitHub Advisory DB), npm audit, OSV.dev, endoflife.date, DNS-over-HTTPS (Cloudflare/Google).
