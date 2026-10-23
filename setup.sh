#!/usr/bin/env bash
# StudioFlow setup: writes .env (domain, node IP, TLS mode, admin account, random secrets).
# Same behaviour as setup.ps1. Run ./setup.sh --help for the options.
set -euo pipefail
# Lists (hosts, origins) are split on whitespace below; never expand globs such as https://*.example.com.
set -f

SF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$SF_ROOT/infra/scripts/common.sh"

readonly TLS_MODES="internal acme custom dns-cloudflare dns-infomaniak dns-hetzner dns-desec dns-route53 dns-gandi dns-ovh"
readonly MIN_PASSWORD_LENGTH=12
readonly GENERATED_PASSWORD_LENGTH=24
readonly INTERNAL_HSTS_MAX_AGE=3600

usage() {
	cat <<'EOF'
Set up StudioFlow: writes .env with random secrets and the hash of the admin password.

Usage: ./setup.sh [options]

  --domain NAME              host name of the Regie, e.g. studioflow.opten.ch (test: localhost)
  --node-ip IPV4             LAN IPv4 of the server for media (default: detected automatically)
  --tls-mode MODE            internal | acme | custom | dns-cloudflare | dns-infomaniak | dns-hetzner |
                             dns-desec | dns-route53 | dns-gandi | dns-ovh
  --acme-email MAIL          e-mail for Let's Encrypt (acme, dns-*)
  --dns-challenge-domain N   CNAME target if _acme-challenge is delegated (dns-*; e.g. for Hostpoint, cyon)
  --extra-hosts "A B"        further addresses of the same site, e.g. the IP (internal only)
  --frame-ancestors "U V"    origins allowed to embed the output ('self' is always allowed)
  --admin-user NAME          user name of the admin account (default: admin)
  --admin-password-stdin     read the admin password from standard input (one line)
  --generate-password        generate a strong admin password and show it once
  --plain-password           store the password in plain text instead of as a hash (local development only)
  --env-file PATH            target file instead of ./.env
  --non-interactive          ask nothing; missing required values are an error
  --force                    replace an existing .env (a copy .env.backup-<time> is kept; secrets are carried over)
  -h, --help                 this help

Credentials of the DNS providers (dns-*) come from the environment, from the existing .env or are asked for
without echo: CF_API_TOKEN, INFOMANIAK_API_TOKEN, HETZNER_API_TOKEN, DESEC_TOKEN, GANDI_BEARER_TOKEN,
AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION, OVH_ENDPOINT + OVH_APPLICATION_KEY +
OVH_APPLICATION_SECRET + OVH_CONSUMER_KEY.

Examples:
  ./setup.sh
  ./setup.sh --non-interactive --domain studioflow.opten.ch --tls-mode dns-cloudflare --generate-password
  printf '%s' "$PASSWORD" | ./setup.sh --non-interactive --domain localhost --node-ip 127.0.0.1 \
      --tls-mode internal --admin-password-stdin

Then: docker compose up -d --build   (details: docs/runbook.md)
      docker compose up -d           (installation from a release with ready-made images, docs/runbook.md section 14)
EOF
}

# --- options ----------------------------------------------------------------------------------------------------

opt_domain="" opt_node_ip="" opt_tls_mode="" opt_acme_email="" opt_challenge_domain="" opt_extra_hosts=""
opt_frame_ancestors="" opt_admin_user="" password_source="" plain_password=false env_file="$SF_ROOT/.env"
interactive=true force=false
has_extra_hosts=false has_frame_ancestors=false has_acme_email=false has_challenge_domain=false

while [ $# -gt 0 ]; do
	arg="$1"
	value=""
	case "$arg" in
		--*=*)
			value="${arg#*=}"
			arg="${arg%%=*}"
			;;
		--domain | --node-ip | --tls-mode | --acme-email | --dns-challenge-domain | --extra-hosts | --frame-ancestors | --admin-user | --env-file)
			[ $# -ge 2 ] || sf_die "Option $arg needs a value (see --help)."
			value="$2"
			shift
			;;
	esac
	case "$arg" in
		--domain) opt_domain="$value" ;;
		--node-ip) opt_node_ip="$value" ;;
		--tls-mode) opt_tls_mode="$value" ;;
		--acme-email) opt_acme_email="$value" has_acme_email=true ;;
		--dns-challenge-domain) opt_challenge_domain="$value" has_challenge_domain=true ;;
		--extra-hosts) opt_extra_hosts="$value" has_extra_hosts=true ;;
		--frame-ancestors) opt_frame_ancestors="$value" has_frame_ancestors=true ;;
		--admin-user) opt_admin_user="$value" ;;
		--env-file) env_file="$value" ;;
		--admin-password-stdin) password_source=stdin ;;
		--generate-password) password_source=generate ;;
		--plain-password) plain_password=true ;;
		--non-interactive) interactive=false ;;
		--force) force=true ;;
		-h | --help)
			usage
			exit 0
			;;
		*) sf_die "Unknown option: $1 (see --help)." ;;
	esac
	shift
done

# --- validation -------------------------------------------------------------------------------------------------

is_ipv4() {
	local ip="$1" octet
	[[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
	for octet in "${BASH_REMATCH[@]:1}"; do
		[ $((10#$octet)) -le 255 ] || return 1
	done
}

is_hostname() {
	local label='[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?'
	[ ${#1} -le 253 ] && [[ "$1" =~ ^${label}(\.${label})*$ ]]
}

is_host() { is_ipv4 "$1" || is_hostname "$1"; }

is_tls_mode() {
	local mode
	for mode in $TLS_MODES; do
		[ "$mode" = "$1" ] && return 0
	done
	return 1
}

is_email() { [[ "$1" =~ ^[^[:space:]@\'\"]+@[^[:space:]@\'\"]+\.[^[:space:]@\'\"]+$ ]]; }

# CSP host sources: https://host[:port], https://*.host, host, https: - no keywords, quotes or separators.
is_frame_ancestor() { [[ "$1" =~ ^(https?://)?(\*\.)?[A-Za-z0-9.-]+(:([0-9]{1,5}|\*))?$|^https?:$ ]]; }

is_admin_user() { [[ "$1" =~ ^[A-Za-z0-9._@-]{1,64}$ ]]; }

is_livekit_secret() { [[ "$1" =~ ^[A-Za-z][A-Za-z0-9]{31,}$ ]]; }

is_password_hash() { [[ "$1" =~ ^AQAAAA[A-Za-z0-9+/]{20,}={0,2}$ ]]; }

# --- helpers ----------------------------------------------------------------------------------------------------

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

random_alnum() {
	local length="$1" out=""
	while [ ${#out} -lt "$length" ]; do
		out+="$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
	done
	printf '%s' "${out:0:length}"
}

# Primary LAN IPv4: the source address of the default route.
detect_node_ip() {
	local ip="" iface
	if command -v ip >/dev/null 2>&1; then
		ip="$(ip -4 route get 192.0.2.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }')"
	fi
	if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1 && command -v route >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then
		iface="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')"
		[ -n "$iface" ] && ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
	fi
	if [ -z "$ip" ] && command -v powershell.exe >/dev/null 2>&1; then
		# Git Bash on Windows: ask the routing table the same way setup.ps1 does.
		# shellcheck disable=SC2016 # PowerShell code, expanded by PowerShell
		ip="$(powershell.exe -NoProfile -NonInteractive -Command '$s = [Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork, [Net.Sockets.SocketType]::Dgram, [Net.Sockets.ProtocolType]::Udp); try { $s.Connect("192.0.2.1", 9); $s.LocalEndPoint.Address.ToString() } finally { $s.Dispose() }' 2>/dev/null | tr -d '\r' || true)"
	fi
	if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
		ip="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"
	fi
	is_ipv4 "$ip" && printf '%s' "$ip"
}

# Reads KEY from an existing .env (quotes removed). Prints nothing if absent.
env_value() {
	[ -f "$env_file" ] || return 0
	awk -v key="$1" '
		BEGIN { FS = "=" }
		/^[[:space:]]*#/ { next }
		{
			line = $0; sub(/\r$/, "", line)
			name = substr(line, 1, index(line, "=") - 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
			if (name != key) next
			value = substr(line, index(line, "=") + 1)
			if (value ~ /^'\''.*'\''$/ || value ~ /^".*"$/) value = substr(value, 2, length(value) - 2)
			result = value
		}
		END { printf "%s", result }' "$env_file"
}

# KEY=VALUE for .env; values with other characters than [A-Za-z0-9_.,:/@+=-] in single quotes (literal).
env_line() {
	local key="$1" value="$2"
	case "$value" in
		*"'"* | *$'\n'* | *$'\r'*) sf_die "The value for $key contains a single quote or a line break; that is not possible in .env." ;;
	esac
	if [[ "$value" =~ ^[A-Za-z0-9_.,:/@+=-]*$ ]]; then
		printf '%s=%s\n' "$key" "$value"
	else
		printf "%s='%s'\n" "$key" "$value"
	fi
}

require_tty() {
	{ : </dev/tty; } 2>/dev/null || sf_die "No terminal for questions. Run with --non-interactive and the options (see --help)."
}

# prompt <question> <default> -> answer (default on empty input).
prompt() {
	local answer
	if [ -n "$2" ]; then printf '%s [%s]: ' "$1" "$2" >/dev/tty; else printf '%s: ' "$1" >/dev/tty; fi
	IFS= read -r answer </dev/tty || answer=""
	printf '%s' "${answer:-$2}"
}

prompt_secret() {
	local answer
	printf '%s: ' "$1" >/dev/tty
	IFS= read -rs answer </dev/tty || answer=""
	printf '\n' >/dev/tty
	printf '%s' "$answer"
}

# provider_vars <tls-mode> -> the credential variables of a dns-* mode.
provider_vars() {
	case "$1" in
		dns-cloudflare) echo CF_API_TOKEN ;;
		dns-infomaniak) echo INFOMANIAK_API_TOKEN ;;
		dns-hetzner) echo HETZNER_API_TOKEN ;;
		dns-desec) echo DESEC_TOKEN ;;
		dns-route53) echo AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION ;;
		dns-gandi) echo GANDI_BEARER_TOKEN ;;
		dns-ovh) echo OVH_ENDPOINT OVH_APPLICATION_KEY OVH_APPLICATION_SECRET OVH_CONSUMER_KEY ;;
	esac
}

is_secret_var() { case "$1" in AWS_REGION | OVH_ENDPOINT) return 1 ;; *) return 0 ;; esac }

# Collapses whitespace in a space-separated list (no quote processing, unlike xargs).
normalize_list() {
	local -a parts
	read -ra parts <<<"$1" || true
	printf '%s' "${parts[*]:-}"
}

docker_available() { docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }

# --- collect the configuration ------------------------------------------------------------------------------------

if [ "$password_source" = stdin ] && [ "$interactive" = true ]; then
	sf_die "--admin-password-stdin only works together with --non-interactive."
fi
[ "$interactive" = true ] && require_tty

env_dir="$(dirname "$env_file")"
[ -d "$env_dir" ] || sf_die "Directory $env_dir does not exist."
env_file="$(cd "$env_dir" && pwd)/$(basename "$env_file")"

if [ -e "$env_file" ] && [ "$force" != true ]; then
	sf_die "$env_file already exists. Replace it with --force (a copy is kept, secrets are carried over)."
fi

sf_step "Set up StudioFlow"
[ -e "$env_file" ] && sf_info "The existing $(basename "$env_file") will be replaced; secrets and admin account are carried over."

# Node IP
node_ip="$opt_node_ip"
if [ -z "$node_ip" ]; then
	detected_ip="$(detect_node_ip || true)"
	default_ip="$(env_value STUDIOFLOW_NODE_IP)"
	default_ip="${default_ip:-$detected_ip}"
	if [ "$interactive" = true ]; then
		[ -n "$detected_ip" ] && sf_info "Detected LAN IPv4 of this machine: $detected_ip"
		node_ip="$(prompt "LAN IPv4 of the server (media for phones and laptops)" "$default_ip")"
	else
		node_ip="$default_ip"
	fi
fi
is_ipv4 "$node_ip" || sf_die "Invalid or missing LAN IPv4: '$node_ip' (option --node-ip)."

# TLS mode
tls_mode="$opt_tls_mode"
if [ -z "$tls_mode" ]; then
	tls_mode="$(env_value STUDIOFLOW_TLS_MODE)"
	tls_mode="${tls_mode:-internal}"
	if [ "$interactive" = true ]; then
		sf_info "TLS modes: internal (local CA, test) | acme (VPS, publicly reachable) | custom (own certificate)"
		sf_info "           dns-cloudflare | dns-infomaniak | dns-hetzner | dns-desec | dns-route53 | dns-gandi | dns-ovh"
		tls_mode="$(prompt "TLS mode" "$tls_mode")"
	fi
fi
is_tls_mode "$tls_mode" || sf_die "Unknown TLS mode: '$tls_mode'. Allowed: $TLS_MODES"

# Domain
domain="$opt_domain"
if [ -z "$domain" ]; then
	domain="$(env_value STUDIOFLOW_DOMAIN)"
	if [ -z "$domain" ] && [ "$tls_mode" = internal ]; then domain="$node_ip"; fi
	if [ "$interactive" = true ]; then
		domain="$(prompt "Domain of the Regie (e.g. studioflow.opten.ch; in mode internal also the IP)" "$domain")"
	fi
fi
domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
is_host "$domain" || sf_die "Invalid or missing domain: '$domain' (option --domain)."
if is_ipv4 "$domain" && [ "$tls_mode" != internal ] && [ "$tls_mode" != custom ]; then
	sf_die "No certificate can be issued for an IP address with $tls_mode. Use TLS mode internal."
fi

# ACME e-mail and DNS challenge delegation
acme_email="" challenge_domain=""
case "$tls_mode" in
	acme | dns-*)
		if [ "$has_acme_email" = true ]; then
			acme_email="$opt_acme_email"
		else
			acme_email="$(env_value STUDIOFLOW_ACME_EMAIL)"
			[ "$interactive" = true ] && acme_email="$(prompt "E-mail for Let's Encrypt (may be empty)" "$acme_email")"
		fi
		[ -z "$acme_email" ] || is_email "$acme_email" || sf_die "Invalid e-mail: '$acme_email'."
		;;
esac
case "$tls_mode" in
	dns-*)
		if [ "$has_challenge_domain" = true ]; then
			challenge_domain="$opt_challenge_domain"
		else
			challenge_domain="$(env_value STUDIOFLOW_DNS_CHALLENGE_DOMAIN)"
			[ "$interactive" = true ] && challenge_domain="$(prompt "Is _acme-challenge delegated by CNAME? Then enter the CNAME target, otherwise leave empty" "$challenge_domain")"
		fi
		challenge_domain="$(printf '%s' "$challenge_domain" | tr '[:upper:]' '[:lower:]')"
		[ -z "$challenge_domain" ] || is_hostname "${challenge_domain#_acme-challenge.}" || sf_die "Invalid CNAME target: '$challenge_domain'."
		;;
esac

# DNS provider credentials: environment > existing .env > prompt
provider_lines=""
for var in $(provider_vars "$tls_mode"); do
	value="${!var:-}"
	[ -n "$value" ] || value="$(env_value "$var")"
	if [ -z "$value" ] && [ "$interactive" = true ]; then
		if is_secret_var "$var"; then value="$(prompt_secret "$var (input is hidden)")"; else value="$(prompt "$var" "")"; fi
	fi
	[ -n "$value" ] || sf_die "$var is missing for TLS mode $tls_mode (set the environment variable or enter it interactively)."
	provider_lines+="$(env_line "$var" "$value")"$'\n'
done

# Extra hosts (internal mode) and the certificate for clients without SNI
extra_hosts="" default_sni=""
if [ "$has_extra_hosts" = true ]; then
	extra_hosts="$opt_extra_hosts"
elif [ "$tls_mode" = internal ]; then
	extra_hosts="$(env_value STUDIOFLOW_EXTRA_HOSTS)"
	if [ "$interactive" = true ] && ! is_ipv4 "$domain"; then
		extra_hosts="$(prompt "Extra hosts, e.g. $node_ip for access by IP (empty = none)" "$extra_hosts")"
	fi
fi
extra_hosts="$(normalize_list "$(printf '%s' "$extra_hosts" | tr '[:upper:]' '[:lower:]')")"
for host in $extra_hosts; do
	is_host "$host" || sf_die "Invalid extra host: '$host'."
	if [ -z "$default_sni" ] && is_ipv4 "$host"; then default_sni="$host"; fi
done
if [ -n "$extra_hosts" ] && [ "$tls_mode" != internal ]; then
	sf_warn "Extra hosts only make sense in mode internal; with $tls_mode each one needs its own certificate."
fi

# Frame ancestors
if [ "$has_frame_ancestors" = true ]; then
	frame_ancestors="$opt_frame_ancestors"
else
	frame_ancestors="$(env_value STUDIOFLOW_FRAME_ANCESTORS)"
	[ "$interactive" = true ] && frame_ancestors="$(prompt "Origins allowed to embed the output (e.g. https://proxy.example.ch; empty = StudioFlow only)" "$frame_ancestors")"
fi
frame_ancestors="$(normalize_list "$frame_ancestors")"
for origin in $frame_ancestors; do
	[ "$origin" = "'self'" ] && sf_die "'self' is always allowed and does not belong in --frame-ancestors."
	is_frame_ancestor "$origin" || sf_die "Invalid source for frame-ancestors: '$origin' (example: https://proxy.example.ch)."
done

# Admin account
admin_user="$opt_admin_user"
if [ -z "$admin_user" ]; then
	admin_user="$(env_value ADMIN__USERNAME)"
	admin_user="${admin_user:-admin}"
	[ "$interactive" = true ] && admin_user="$(prompt "User name of the admin account" "$admin_user")"
fi
is_admin_user "$admin_user" || sf_die "Invalid user name '$admin_user' (1-64 characters: letters, digits, . _ @ -)."

existing_hash="$(env_value ADMIN__PASSWORDHASH)"
existing_plain="$(env_value ADMIN__PASSWORD)"
password="" password_generated=false keep_credentials=false
case "$password_source" in
	stdin)
		IFS= read -r password || [ -n "$password" ] || sf_die "No password on standard input."
		password="${password%$'\r'}"
		;;
	generate) password_generated=true ;;
	*)
		if [ -n "$existing_hash$existing_plain" ] && { [ "$interactive" != true ] || sf_confirm "Keep the existing admin password?" y; }; then
			keep_credentials=true
		elif [ "$interactive" = true ]; then
			while :; do
				password="$(prompt_secret "Admin password (at least $MIN_PASSWORD_LENGTH characters; empty = generate a strong password)")"
				[ -n "$password" ] || break
				if [ ${#password} -lt "$MIN_PASSWORD_LENGTH" ]; then sf_warn "Too short."; continue; fi
				[ "$(prompt_secret "Repeat the admin password")" = "$password" ] && break
				sf_warn "The entries do not match."
			done
			[ -n "$password" ] || password_generated=true
		else
			password_generated=true
		fi
		;;
esac
if [ "$password_generated" = true ]; then
	password="$(random_alnum "$GENERATED_PASSWORD_LENGTH")"
elif [ "$keep_credentials" != true ] && [ ${#password} -lt "$MIN_PASSWORD_LENGTH" ]; then
	sf_die "The admin password needs at least $MIN_PASSWORD_LENGTH characters."
fi

# Secrets: keep existing ones (the database password is fixed once PostgreSQL is initialised).
postgres_password="$(env_value POSTGRES_PASSWORD)"
[[ "$postgres_password" =~ ^[A-Za-z0-9]{16,}$ ]] || postgres_password="$(random_alnum 32)"
livekit_key="$(env_value LIVEKIT_API_KEY)"
[[ "$livekit_key" =~ ^[A-Za-z][A-Za-z0-9_-]{2,63}$ ]] || livekit_key=studioflow
livekit_secret="$(env_value LIVEKIT_API_SECRET)"
is_livekit_secret "$livekit_secret" || livekit_secret="sk$(random_hex 20)"

# Ready-made images: keep the version and the registry the stack runs with (./update.sh --version wrote them), so that
# running setup again does not switch the stack back to the version of the release files.
image_tag="$(env_value STUDIOFLOW_IMAGE_TAG)"
image_registry="$(env_value STUDIOFLOW_IMAGE_REGISTRY)"

hsts_line=""
[ "$tls_mode" = internal ] && hsts_line="$(env_line STUDIOFLOW_HSTS_MAX_AGE "$INTERNAL_HSTS_MAX_AGE")"$'\n'

# --- write .env ---------------------------------------------------------------------------------------------------

umask 077
tmp_env="$(mktemp "$env_dir/.env.setup.XXXXXX")"
trap 'rm -f "$tmp_env"' EXIT

write_env() {
	local admin_lines="$1"
	{
		printf '# StudioFlow - generated by setup.sh on %s. Never commit it to Git; keep a copy in the password vault.\n' "$(date '+%Y-%m-%d %H:%M')"
		printf '# All variables: .env.example and docs/architecture/implementation-spec.md (section 10).\n\n'
		env_line STUDIOFLOW_DOMAIN "$domain"
		env_line STUDIOFLOW_NODE_IP "$node_ip"
		[ -n "$extra_hosts" ] && env_line STUDIOFLOW_EXTRA_HOSTS "$extra_hosts"
		[ -n "$default_sni" ] && env_line STUDIOFLOW_DEFAULT_SNI "$default_sni"
		env_line STUDIOFLOW_TLS_MODE "$tls_mode"
		[ -n "$acme_email" ] && env_line STUDIOFLOW_ACME_EMAIL "$acme_email"
		[ -n "$challenge_domain" ] && env_line STUDIOFLOW_DNS_CHALLENGE_DOMAIN "$challenge_domain"
		printf '%s' "$provider_lines" "$hsts_line"
		[ -n "$frame_ancestors" ] && env_line STUDIOFLOW_FRAME_ANCESTORS "$frame_ancestors"
		printf '\n'
		env_line ADMIN__USERNAME "$admin_user"
		printf '%s' "$admin_lines"
		printf '\n'
		env_line LIVEKIT_API_KEY "$livekit_key"
		env_line LIVEKIT_API_SECRET "$livekit_secret"
		env_line POSTGRES_PASSWORD "$postgres_password"
		if [ -n "$image_tag$image_registry" ]; then printf '\n# Ready-made images (docs/runbook.md, section 14)\n'; fi
		if [ -n "$image_tag" ]; then env_line STUDIOFLOW_IMAGE_TAG "$image_tag"; fi
		if [ -n "$image_registry" ]; then env_line STUDIOFLOW_IMAGE_REGISTRY "$image_registry"; fi
	} >"$tmp_env"
}

# Hashes the password with the API image: `hash-password` reads it from stdin (sent without a newline) and prints
# the ASP.NET Identity v3 hash. Prints the hash, or returns 1 and shows the end of the error output.
hash_password() {
	local env_arg out err hash="" rc=0 fetch=build
	env_arg="$(sf_host_path "$tmp_env")"
	out="$(mktemp)"
	err="$(mktemp)"
	# A release installation (ready-made images) pulls the API image, a source checkout builds it.
	if sf_uses_images; then
		fetch=pull
		sf_info "Pulling the API image (for the password hash) ..." >&2
	else
		sf_info "Building the API image (for the password hash) ..." >&2
	fi
	if ! sf_compose --env-file "$env_arg" "$fetch" api >"$err" 2>&1; then
		rc=1
	elif ! printf '%s' "$password" | sf_compose --env-file "$env_arg" run --rm --no-deps -T --entrypoint dotnet api "$SF_API_DLL" hash-password >"$out" 2>"$err"; then
		rc=1
	else
		hash="$(tr -d '\r' <"$out" | awk 'NF { line = $0 } END { print line }')"
		is_password_hash "$hash" || { echo "hash-password did not return an Identity v3 hash." >"$err"; rc=1; }
	fi
	[ "$rc" -eq 0 ] || grep -v -e '^[[:space:]]*$' -e 'View build details' "$err" | tail -n 5 >&2 || true
	[ "$rc" -eq 0 ] || [ "$fetch" != pull ] || sf_warn "While the repository is private, sign in to the registry first: docker login ghcr.io (user name and a token with read:packages)."
	rm -f "$out" "$err"
	[ "$rc" -eq 0 ] && printf '%s' "$hash"
	return "$rc"
}

if [ "$keep_credentials" = true ]; then
	admin_lines=""
	[ -n "$existing_hash" ] && admin_lines+="$(env_line ADMIN__PASSWORDHASH "$existing_hash")"$'\n'
	[ -n "$existing_plain" ] && admin_lines+="$(env_line ADMIN__PASSWORD "$existing_plain")"$'\n'
	write_env "$admin_lines"
elif [ "$plain_password" = true ]; then
	sf_warn "The admin password is stored in plain text (--plain-password). For local development only."
	write_env "$(env_line ADMIN__PASSWORD "$password")"$'\n'
else
	write_env ""
	if docker_available && hash="$(hash_password)"; then
		write_env "$(env_line ADMIN__PASSWORDHASH "$hash")"$'\n'
		sf_info "Admin password stored as a hash."
	else
		docker_available || sf_warn "Docker is not available; the password hash needs the API image."
		sf_warn "The password hash could not be generated with the API image (it could not be built or pulled, or 'hash-password' is missing)."
		sf_warn "The password is stored in plain text (ADMIN__PASSWORD) for now. Later run ./setup.sh --force and set a new password."
		write_env "$(env_line ADMIN__PASSWORD "$password")"$'\n'
	fi
fi

if [ -e "$env_file" ]; then
	backup_file="$env_file.backup-$(date '+%Y%m%d-%H%M%S')"
	cp -p "$env_file" "$backup_file"
	chmod 600 "$backup_file" 2>/dev/null || true
	sf_info "Previous file saved as: $backup_file (copy your own additions from there)."
fi
chmod 600 "$tmp_env" 2>/dev/null || true
mv -f "$tmp_env" "$env_file"
trap - EXIT

# --- summary ------------------------------------------------------------------------------------------------------

sf_step "Done: $env_file"
sf_info "Regie:       https://$domain/"
sf_info "Sender:      https://$domain/join"
sf_info "Media:       $node_ip (7881/tcp, 7882/udp)   TLS: $tls_mode"
case "$tls_mode" in
	internal) sf_info "Certificate: local CA - install https://$domain/ca.crt once on every device (docs/runbook.md)." ;;
	dns-*) sf_info "Certificate: Let's Encrypt via DNS challenge; the A record of $domain points to $node_ip." ;;
	acme) sf_info "Certificate: Let's Encrypt via HTTP-01; 80/tcp and 443/tcp must be publicly reachable." ;;
	custom) sf_info "Certificate: mount ./certs/fullchain.pem and privkey.pem to /certs (docker-compose.override.example.yml)." ;;
esac
if [ "$password_generated" = true ]; then
	printf '\nAdmin user:  %s\nPassword:    %s\n' "$admin_user" "$password"
	sf_info "The password is shown only now. Store it in the password vault."
fi
sf_info ""
if sf_uses_images; then
	sf_info "Next step: docker compose up -d   (pulls the images; while the repository is private: docker login ghcr.io first)"
else
	sf_info "Next step: docker compose up -d --build"
fi
