# Third-party notices

StudioFlow itself is licensed under the [MIT License](LICENSE) (see also [NOTICE](NOTICE)). It is built on the
open-source software named below. Each component stays under its own licence; the notices here are for the
components that are shipped inside the StudioFlow releases (the Docker images, the release files and the prototype) or
that run next to it in the Compose stack.

The lists of packages in the sections 4 and 5 are **generated** and must not be edited by hand: run `npm run notices`
after a change of the runtime dependencies (it reads `package-lock.json` and the NuGet restore of `apps/api`), and
`npm run check:notices` to see whether the file is current. The container images carry a complete software bill of
materials (SBOM) that also covers the operating-system packages, see [docs/releasing.md](docs/releasing.md).

## 1. Fonts (SIL Open Font License 1.1)

Both families are self-hosted in the frontends (`apps/studio`, `apps/sender`, `apps/output`, in `src/fonts`) and in the
prototype (`prototype/fonts`), as variable Latin subsets in WOFF2 format. The subset is a modified version in the sense of
the licence; neither font declares a Reserved Font Name. The full licence texts are stored next to the font files
(`OFL-JetBrainsMono.txt`, `OFL-SofiaSansSemiCondensed.txt`), are served by the Regie under `/licenses/`, and are
embedded in the standalone prototype file. The outlines of the wordmark in `docs/assets/logo-*.svg` are derived from
Sofia Sans Semi Condensed.

| Font | Copyright | Licence | Source |
|---|---|---|---|
| Sofia Sans Semi Condensed | Copyright 2019 The Sofia Sans Project Authors | SIL OFL 1.1 | <https://github.com/lettersoup/Sofia-Sans> |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors | SIL OFL 1.1 | <https://github.com/JetBrains/JetBrainsMono> |

## 2. Services of the Compose stack

These run as their own containers from their own images. StudioFlow does not modify them and does not redistribute their
source; it only builds or pulls the images named in `docker-compose.yml`.

| Component | Used for | Licence |
|---|---|---|
| [LiveKit](https://github.com/livekit/livekit) (`livekit/livekit-server`) | the WebRTC media server (SFU) | Apache-2.0 |
| [PostgreSQL](https://www.postgresql.org/) (`postgres`) | the database; `pg_dump` in the backup image | PostgreSQL License |
| [Caddy](https://github.com/caddyserver/caddy) | web server and TLS in the `studioflow-web` image | Apache-2.0 |
| [caddy-dns/cloudflare](https://github.com/caddy-dns/cloudflare) | DNS challenge module, built into Caddy | Apache-2.0 |
| [caddy-dns/infomaniak](https://github.com/caddy-dns/infomaniak), [hetzner](https://github.com/caddy-dns/hetzner), [desec](https://github.com/caddy-dns/desec), [route53](https://github.com/caddy-dns/route53), [gandi](https://github.com/caddy-dns/gandi), [ovh](https://github.com/caddy-dns/ovh) | DNS challenge modules, built into Caddy | MIT |
| [libdns](https://github.com/libdns/libdns) and the provider libraries the modules use | DNS record management (Go modules, resolved when the web image is built; listed in its SBOM) | MIT and others, see the SBOM |
| [Alpine Linux](https://alpinelinux.org/) | base of the `studioflow-web`, `studioflow-api` and `studioflow-backup` images | various (MIT, BSD, GPL for system utilities); see the SBOM |
| [.NET](https://github.com/dotnet/runtime) and [ASP.NET Core](https://github.com/dotnet/aspnetcore) runtime | runtime of the API image | MIT |

The backup image installs these Alpine packages unmodified: `age` (BSD-3-Clause), `bash` (GPL-3.0-or-later), `jq`
(MIT), `rclone` (MIT), `supercronic` (MIT) and `tzdata` (public domain).

## 3. Main libraries

The most important libraries by role. The complete lists are in the sections 4 and 5.

| Library | Used for | Licence |
|---|---|---|
| [Angular](https://github.com/angular/angular) (`@angular/*`) | the Regie and the sender PWA | MIT |
| [RxJS](https://github.com/ReactiveX/rxjs), [tslib](https://github.com/microsoft/tslib) | Angular runtime | Apache-2.0, 0BSD |
| [LiveKit client SDK](https://github.com/livekit/client-sdk-js) (`livekit-client`) with `@livekit/protocol`, `@livekit/mutex`, `@bufbuild/protobuf`, `jose`, `webrtc-adapter`, `sdp-transform` | the WebRTC connection of sender, Regie and output page | Apache-2.0 (and MIT, BSD-3-Clause for the helpers) |
| [SignalR JavaScript client](https://github.com/dotnet/aspnetcore) (`@microsoft/signalr`) | live connection to the API (hubs) | MIT |
| [uqr](https://github.com/unjs/uqr) | QR codes for pairing, generated in the browser | MIT |
| ASP.NET Core, Entity Framework Core | the API | MIT |
| [Npgsql Entity Framework Core provider](https://github.com/npgsql/efcore.pg) | database access | PostgreSQL License |
| Microsoft.IdentityModel | signing of the media tokens | MIT |

Tools that build and test StudioFlow (Vite, Vitest, Prettier, Playwright, xUnit, Testcontainers, the Angular CLI, and
so on) are not part of what is shipped and are not listed.

## 4. npm packages

The production dependency tree of the frontends and the tools that run in the product (the packages that only build or
test the code are left out). The licence texts are in the packages themselves (`node_modules/<package>/LICENSE`).

<!-- BEGIN generated:npm -->

Generated from `package-lock.json` (production dependencies, direct and transitive): 43 packages (MIT 33, Apache-2.0 4, BSD-3-Clause 2, (Apache-2.0 AND BSD-3-Clause) 1, 0BSD 1, BSD-2-Clause 1, Unlicense 1).

| Package | Version | Licence |
|---|---|---|
| @angular/common | 22.2.3 | MIT |
| @angular/compiler | 22.2.3 | MIT |
| @angular/core | 22.2.3 | MIT |
| @angular/forms | 22.2.3 | MIT |
| @angular/platform-browser | 22.2.3 | MIT |
| @angular/router | 22.2.3 | MIT |
| @angular/service-worker | 22.2.3 | MIT |
| @bufbuild/protobuf | 1.10.1 | (Apache-2.0 AND BSD-3-Clause) |
| @livekit/mutex | 1.1.1 | Apache-2.0 |
| @livekit/protocol | 1.52.1 | Apache-2.0 |
| @microsoft/signalr | 10.0.11 | MIT |
| @standard-schema/spec | 1.1.0 | MIT |
| @types/dom-mediacapture-record | 1.0.22 | MIT |
| abort-controller | 3.0.0 | MIT |
| event-target-shim | 5.0.1 | MIT |
| events | 3.3.0 | MIT |
| eventsource | 2.0.2 | MIT |
| fetch-cookie | 2.2.0 | Unlicense |
| jose | 6.2.13 | MIT |
| livekit-client | 2.23.0 | Apache-2.0 |
| loglevel | 1.9.2 | MIT |
| machina | 7.0.1 | MIT |
| node-fetch | 2.7.0 | MIT |
| psl | 1.15.0 | MIT |
| punycode | 2.3.1 | MIT |
| querystringify | 2.2.0 | MIT |
| requires-port | 1.0.0 | MIT |
| rxjs | 7.8.2 | Apache-2.0 |
| sdp | 3.2.2 | MIT |
| sdp-transform | 2.15.0 | MIT |
| set-cookie-parser | 2.7.2 | MIT |
| tough-cookie | 4.1.4 | BSD-3-Clause |
| tr46 | 0.0.3 | MIT |
| tslib | 2.8.1 | 0BSD |
| typed-emitter | 2.1.0 | MIT |
| universalify | 0.2.0 | MIT |
| uqr | 0.1.3 | MIT |
| url-parse | 1.5.10 | MIT |
| webidl-conversions | 3.0.1 | BSD-2-Clause |
| webrtc-adapter | 9.0.6 | BSD-3-Clause |
| whatwg-url | 5.0.0 | MIT |
| ws | 7.5.13 | MIT |
| zod | 4.6.6 | MIT |

<!-- END generated:npm -->

## 5. NuGet packages

The packages with assemblies that the API ships. The licence text of a package is in the package itself (the `.nupkg`,
folder `~/.nuget/packages/<package>/<version>`). The .NET runtime and the ASP.NET Core shared framework come with the
base image (section 2).

<!-- BEGIN generated:nuget -->

Generated from `apps/api` (`dotnet restore`; packages with assemblies, direct and transitive): 12 packages (MIT 10, PostgreSQL 2).

| Package | Version | Licence |
|---|---|---|
| Microsoft.AspNetCore.OpenApi | 10.0.13 | MIT |
| Microsoft.Bcl.Cryptography | 10.0.2 | MIT |
| Microsoft.EntityFrameworkCore | 10.0.13 | MIT |
| Microsoft.EntityFrameworkCore.Abstractions | 10.0.13 | MIT |
| Microsoft.EntityFrameworkCore.Relational | 10.0.13 | MIT |
| Microsoft.IdentityModel.Abstractions | 8.22.0 | MIT |
| Microsoft.IdentityModel.JsonWebTokens | 8.22.0 | MIT |
| Microsoft.IdentityModel.Logging | 8.22.0 | MIT |
| Microsoft.IdentityModel.Tokens | 8.22.0 | MIT |
| Microsoft.OpenApi | 2.12.2 | MIT |
| Npgsql | 10.0.3 | PostgreSQL |
| Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL |

<!-- END generated:nuget -->
