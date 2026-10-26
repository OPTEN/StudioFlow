# StudioFlow edge image: Caddy with the DNS-challenge modules, the Caddyfile and the three built frontends.
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
RUN npm run build:web \
 && test -s dist/studio/browser/index.html \
 && test -s dist/sender/browser/index.html \
 && test -s dist/output/index.html

# --- 2. Caddy with DNS provider modules (each pinned to an exact tag) --------------------------------------------
FROM caddy:${CADDY_VERSION}-builder-alpine AS caddy
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare@v0.2.4 \
    --with github.com/caddy-dns/infomaniak@v1.0.2 \
    --with github.com/caddy-dns/hetzner/v2@v2.0.1 \
    --with github.com/caddy-dns/desec@v1.1.0 \
    --with github.com/caddy-dns/route53@v1.6.2 \
    --with github.com/caddy-dns/gandi@v1.2.1 \
    --with github.com/caddy-dns/ovh@v1.1.0

# --- 3. Runtime ----------------------------------------------------------------------------------------------------
FROM caddy:${CADDY_VERSION}-alpine

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
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY infra/caddy/snippets/ /etc/caddy/snippets/
COPY infra/caddy/tls/ /etc/caddy/tls/
COPY --from=web /src/dist/studio/browser/ /srv/studio/
COPY --from=web /src/dist/sender/browser/ /srv/join/
COPY --from=web /src/dist/output/ /srv/o/

# Fail the build on a broken config: validate every TLS mode, with and without ACME e-mail and extra hosts, with
# dummy credentials ("custom" needs mounted certificate files and is checked at startup). Validation provisions a
# local CA, so it runs with a throwaway data directory: a CA baked into the image would be copied into every new
# caddy_data volume.
RUN set -eu; \
    export XDG_DATA_HOME=/tmp/validate/data XDG_CONFIG_HOME=/tmp/validate/config \
      STUDIOFLOW_DOMAIN=build.invalid STUDIOFLOW_DEFAULT_SNI=build.invalid \
      STUDIOFLOW_TRUSTED_PROXIES=127.0.0.1/32 STUDIOFLOW_HSTS_MAX_AGE=0 STUDIOFLOW_FRAME_ANCESTORS= \
      STUDIOFLOW_MAX_UPLOAD=1MiB STUDIOFLOW_MAX_BODY=1MiB \
      STUDIOFLOW_DNS_RESOLVERS=1.1.1.1 STUDIOFLOW_DNS_CHALLENGE_DOMAIN=_acme-challenge.build.invalid \
      CF_API_TOKEN=build-validation-dummy-token-0123456789abcdef \
      INFOMANIAK_API_TOKEN=dummy HETZNER_API_TOKEN=dummy DESEC_TOKEN=dummy GANDI_BEARER_TOKEN=dummy \
      AWS_ACCESS_KEY_ID=dummy AWS_SECRET_ACCESS_KEY=dummy AWS_REGION=eu-central-1 \
      OVH_ENDPOINT=ovh-eu OVH_APPLICATION_KEY=dummy OVH_APPLICATION_SECRET=dummy OVH_CONSUMER_KEY=dummy; \
    for file in /etc/caddy/tls/*.caddy; do \
      mode="$(basename "$file" .caddy)"; \
      [ "$mode" = custom ] && continue; \
      for email in '' build@example.com; do \
        echo "validate TLS mode: $mode (e-mail: ${email:-none})"; \
        STUDIOFLOW_TLS_MODE="$mode" STUDIOFLOW_ACME_EMAIL="$email" STUDIOFLOW_EXTRA_HOSTS="${email:+127.0.0.1 build2.invalid}" \
          caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; \
      done; \
    done; \
    rm -rf /tmp/validate; \
    test ! -e /data/caddy/pki

USER caddy

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --start-interval=2s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:2020/healthz || exit 1
