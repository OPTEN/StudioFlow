#!/bin/sh
# Build-time check of the Caddy files (infra/caddy/Dockerfile): the bootstrap Caddyfile and, for every DNS provider, a
# Caddyfile in the shape the API pushes (apps/api, CaddyfileRenderer): a site with the DNS challenge, a site with the local
# CA and the catch-all site with on-demand certificates. A broken snippet fails the image build, not a settings change on a
# server. Uses dummy credentials and a throw-away data directory: a local CA baked into the image would be copied into
# every new caddy_data volume. The mode "custom" needs certificate files and is checked when the settings are applied.
set -eu

work=/tmp/validate
rm -rf "$work"
mkdir -p "$work"
export XDG_DATA_HOME="$work/data" XDG_CONFIG_HOME="$work/config" \
  STUDIOFLOW_HTTPS_PORT=8443 STUDIOFLOW_TRUSTED_PROXIES=127.0.0.1/32 STUDIOFLOW_MAX_UPLOAD=1MiB STUDIOFLOW_MAX_IMPORT=1MiB STUDIOFLOW_MAX_BODY=1MiB \
  STUDIOFLOW_DNS_RESOLVERS="1.1.1.1 9.9.9.9"

check() {
  echo "validate: $1"
  caddy validate --config "$2" --adapter caddyfile
}

check "bootstrap" /etc/caddy/Caddyfile

pushed() {
  cat <<EOF
{
	import /etc/caddy/global.caddy
	https_port 8443
	servers :8443 {
		name sf-validate
		import /etc/caddy/servers.caddy
	}
}

import /etc/caddy/studioflow.caddy
import /etc/caddy/health.caddy

$1

https://internal.build.invalid:8443 {
	tls internal
	import sf_ca_download
	import studioflow_site 3600 "'self'"
}

:8443 {
	tls internal {
		on_demand
	}
	import sf_ca_download
	import studioflow_site 3600 "'self'"
}
EOF
}

# Dummy credentials in the shape each module accepts.
TOKEN=build-validation-dummy-token-0123456789abcdef
for file in /etc/caddy/tls/*.caddy; do
  mode="$(basename "$file" .caddy)"
  case "$mode" in
    dns-ovh) credentials="\"ovh-eu\" \"dummy\" \"dummy\" \"dummy\"" ;;
    dns-route53) credentials="\"dummy\" \"dummy\" \"eu-central-1\"" ;;
    *) credentials="\"$TOKEN\"" ;;
  esac
  for email in '' 'build@example.com'; do
    pushed "https://dns.build.invalid:8443 {
	tls $email {
		import /etc/caddy/tls/$mode.caddy $credentials
		resolvers {\$STUDIOFLOW_DNS_RESOLVERS}
		dns_challenge_override_domain _acme-challenge.build.invalid
	}
	import studioflow_site 31536000 \"'self' https://embed.build.invalid\"
}" >"$work/pushed.caddyfile"
    check "$mode (e-mail: ${email:-none})" "$work/pushed.caddyfile"
  done
done

# The sites without a DNS provider.
pushed "" >"$work/pushed.caddyfile"
check "local CA only" "$work/pushed.caddyfile"

rm -rf "$work"
test ! -e /data/caddy/pki
