# StudioFlow edge image: Caddy with the DNS-challenge modules, its bootstrap configuration and snippets, and the three built
# frontends. The sites themselves come from the API at runtime (admin API of Caddy, docs/architecture/implementation-spec.md
# section 10).
# Build context is the repository root (docker-compose.yml: context ".", dockerfile infra/caddy/Dockerfile).

ARG NODE_VERSION=22.22.3
ARG CADDY_VERSION=2.11.7

# --- 1. Frontends: Regie (/), sender PWA (/join/), output page (/o/) ---------------------------------------------
FROM node:${NODE_VERSION}-alpine AS web
WORKDIR /src
ENV CI=true \
    NG_CLI_ANALYTICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Only what the web build reads, so changes to the API, docs or infra do not invalidate this stage.
COPY angular.json tsconfig.json tsconfig.packages.json ./
COPY packages/ packages/
COPY apps/studio/ apps/studio/
COPY apps/sender/ apps/sender/
COPY apps/output/ apps/output/
RUN npm run build:studio && npm run build:sender
# The release workflow passes the commit; the output page then shows its version as 0.1.0+1a2b3c4 in the ?debug=1
# overlay (apps/output/src/build-info.ts). Declared after the Angular builds, so that a new commit rebuilds only the
# small output page. (The three builds are `npm run build:web`.)
ARG STUDIOFLOW_REVISION=
RUN STUDIOFLOW_REVISION="$STUDIOFLOW_REVISION" npm run build:output \
 && test -s dist/studio/browser/index.html \
 && test -s dist/sender/browser/index.html \
 && test -s dist/output/index.html

# --- 2. Caddy with DNS provider modules (each pinned to an exact tag) --------------------------------------------
# golang.org/x/net is raised above the version of Caddy 2.11.7 (v0.59.0, HTTP/2 SETTINGS flood CVE-2026-78669, fixed in
# v0.60.0). It is no Caddy module, so --replace (a go.mod directive without the blank import that --with adds). Drop the
# line once a Caddy release brings v0.60.0 or newer.
FROM caddy:${CADDY_VERSION}-builder-alpine AS caddy
RUN xcaddy build \
    --replace golang.org/x/net=golang.org/x/net@v0.61.0 \
    --with github.com/caddy-dns/cloudflare@v0.2.4 \
    --with github.com/caddy-dns/infomaniak@v1.0.2 \
    --with github.com/caddy-dns/hetzner/v2@v2.0.1 \
    --with github.com/caddy-dns/desec@v1.1.0 \
    --with github.com/caddy-dns/route53@v1.6.2 \
    --with github.com/caddy-dns/gandi@v1.2.1 \
    --with github.com/caddy-dns/ovh@v1.1.0

# --- 3. Runtime ----------------------------------------------------------------------------------------------------
FROM caddy:${CADDY_VERSION}-alpine

# The upstream image is rebuilt rarely: take the fixes of the Alpine packages (brotli, curl ...) that were published since.
RUN apk upgrade --no-cache

# Unprivileged user: compose sets net.ipv4.ip_unprivileged_port_start=0 (Docker's default since 20.10), so the
# container binds 80/443 without any capability and compose drops them all.
# /data holds the private keys (and the local CA in internal mode): only this user may read it. New volumes copy
# owner and mode from here.
RUN addgroup -S -g 10001 caddy \
 && adduser -S -D -H -u 10001 -G caddy -h /data caddy \
 && chown -R caddy:caddy /data /config \
 && chmod -R u=rwX,go= /data /config

# The builder sets cap_net_bind_service on the binary. Not needed here, and with no-new-privileges and no
# capabilities a file capability makes exec fail ("operation not permitted"), so remove it.
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
RUN setcap -r /usr/bin/caddy
COPY infra/caddy/Caddyfile infra/caddy/global.caddy infra/caddy/servers.caddy infra/caddy/health.caddy infra/caddy/studioflow.caddy /etc/caddy/
COPY infra/caddy/snippets/ /etc/caddy/snippets/
COPY infra/caddy/tls/ /etc/caddy/tls/
COPY infra/caddy/validate.sh /usr/local/bin/validate-caddy-config
COPY --from=web /src/dist/studio/browser/ /srv/studio/
COPY --from=web /src/dist/sender/browser/ /srv/join/
COPY --from=web /src/dist/output/ /srv/o/
# What the bundles contain and under which licence (Apache-2.0 section 4): the licence texts of the npm packages that
# Angular extracts (not part of dist/*/browser) and the notices of the repository, served under /licenses/.
COPY --from=web /src/dist/studio/3rdpartylicenses.txt /srv/studio/3rdpartylicenses.txt
COPY --from=web /src/dist/sender/3rdpartylicenses.txt /srv/join/3rdpartylicenses.txt
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /srv/studio/licenses/

# Fail the build on a broken config: the bootstrap file and, for every DNS provider, a Caddyfile in the shape the API pushes
# (infra/caddy/validate.sh). Runs with a throwaway data directory: a local CA baked into the image would be copied into
# every new caddy_data volume.
RUN sh /usr/local/bin/validate-caddy-config \
 && rm /usr/local/bin/validate-caddy-config

USER caddy

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --start-interval=2s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:2020/healthz || exit 1
