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
StudioFlow einrichten: schreibt die .env mit zufälligen Secrets und dem Hash des Admin-Passworts.

Aufruf: ./setup.sh [Optionen]

  --domain NAME              Hostname der Regie, z. B. studioflow.opten.ch (Test: localhost)
  --node-ip IPV4             LAN-IPv4 des Servers für die Medien (Standard: automatisch erkannt)
  --tls-mode MODUS           internal | acme | custom | dns-cloudflare | dns-infomaniak | dns-hetzner |
                             dns-desec | dns-route53 | dns-gandi | dns-ovh
  --acme-email MAIL          E-Mail für Let's Encrypt (acme, dns-*)
  --dns-challenge-domain N   CNAME-Ziel, wenn _acme-challenge delegiert ist (dns-*; z. B. für Hostpoint, cyon)
  --extra-hosts "A B"        weitere Adressen derselben Site, z. B. die IP (nur internal)
  --frame-ancestors "U V"    Origins, die den Output einbetten dürfen ('self' ist immer erlaubt)
  --admin-user NAME          Benutzername des Admin-Kontos (Standard: admin)
  --admin-password-stdin     Admin-Passwort von der Standardeingabe lesen (eine Zeile)
  --generate-password        starkes Admin-Passwort erzeugen und einmal anzeigen
  --plain-password           Passwort im Klartext speichern statt als Hash (nur lokale Entwicklung)
  --env-file PFAD            Ziel statt ./.env
  --non-interactive          nichts fragen; fehlende Pflichtwerte sind ein Fehler
  --force                    bestehende .env ersetzen (Kopie .env.backup-<zeit> bleibt; Secrets werden übernommen)
  -h, --help                 diese Hilfe

Zugangsdaten der DNS-Anbieter (dns-*) kommen aus der Umgebung, aus der bestehenden .env oder werden verdeckt
abgefragt: CF_API_TOKEN, INFOMANIAK_API_TOKEN, HETZNER_API_TOKEN, DESEC_TOKEN, GANDI_BEARER_TOKEN,
AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION, OVH_ENDPOINT + OVH_APPLICATION_KEY +
OVH_APPLICATION_SECRET + OVH_CONSUMER_KEY.

Beispiele:
  ./setup.sh
  ./setup.sh --non-interactive --domain studioflow.opten.ch --tls-mode dns-cloudflare --generate-password
  printf '%s' "$PASSWORT" | ./setup.sh --non-interactive --domain localhost --node-ip 127.0.0.1 \
      --tls-mode internal --admin-password-stdin

Danach: docker compose up -d --build   (Details: docs/runbook.md)
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
			[ $# -ge 2 ] || sf_die "Option $arg braucht einen Wert (siehe --help)."
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
		*) sf_die "Unbekannte Option: $1 (siehe --help)." ;;
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
		*"'"* | *$'\n'* | *$'\r'*) sf_die "Der Wert für $key enthält ein Hochkomma oder einen Zeilenumbruch; das ist in .env nicht möglich." ;;
	esac
	if [[ "$value" =~ ^[A-Za-z0-9_.,:/@+=-]*$ ]]; then
		printf '%s=%s\n' "$key" "$value"
	else
		printf "%s='%s'\n" "$key" "$value"
	fi
}

require_tty() {
	{ : </dev/tty; } 2>/dev/null || sf_die "Kein Terminal für Rückfragen. Mit --non-interactive und den Optionen aufrufen (siehe --help)."
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
	sf_die "--admin-password-stdin geht nur zusammen mit --non-interactive."
fi
[ "$interactive" = true ] && require_tty

env_dir="$(dirname "$env_file")"
[ -d "$env_dir" ] || sf_die "Verzeichnis $env_dir existiert nicht."
env_file="$(cd "$env_dir" && pwd)/$(basename "$env_file")"

if [ -e "$env_file" ] && [ "$force" != true ]; then
	sf_die "$env_file existiert bereits. Mit --force ersetzen (eine Kopie bleibt erhalten, Secrets werden übernommen)."
fi

sf_step "StudioFlow einrichten"
[ -e "$env_file" ] && sf_info "Bestehende $(basename "$env_file") wird ersetzt; Secrets und Admin-Konto werden übernommen."

# Node IP
node_ip="$opt_node_ip"
if [ -z "$node_ip" ]; then
	detected_ip="$(detect_node_ip || true)"
	default_ip="$(env_value STUDIOFLOW_NODE_IP)"
	default_ip="${default_ip:-$detected_ip}"
	if [ "$interactive" = true ]; then
		[ -n "$detected_ip" ] && sf_info "Erkannte LAN-IPv4 dieses Rechners: $detected_ip"
		node_ip="$(prompt "LAN-IPv4 des Servers (Medien für Handys und Laptops)" "$default_ip")"
	else
		node_ip="$default_ip"
	fi
fi
is_ipv4 "$node_ip" || sf_die "Ungültige oder fehlende LAN-IPv4: «$node_ip» (Option --node-ip)."

# TLS mode
tls_mode="$opt_tls_mode"
if [ -z "$tls_mode" ]; then
	tls_mode="$(env_value STUDIOFLOW_TLS_MODE)"
	tls_mode="${tls_mode:-internal}"
	if [ "$interactive" = true ]; then
		sf_info "TLS-Modi: internal (lokale CA, Test) | acme (VPS, öffentlich erreichbar) | custom (eigenes Zertifikat)"
		sf_info "          dns-cloudflare | dns-infomaniak | dns-hetzner | dns-desec | dns-route53 | dns-gandi | dns-ovh"
		tls_mode="$(prompt "TLS-Modus" "$tls_mode")"
	fi
fi
is_tls_mode "$tls_mode" || sf_die "Unbekannter TLS-Modus: «$tls_mode». Erlaubt: $TLS_MODES"

# Domain
domain="$opt_domain"
if [ -z "$domain" ]; then
	domain="$(env_value STUDIOFLOW_DOMAIN)"
	if [ -z "$domain" ] && [ "$tls_mode" = internal ]; then domain="$node_ip"; fi
	if [ "$interactive" = true ]; then
		domain="$(prompt "Domain der Regie (z. B. studioflow.opten.ch; im Modus internal auch die IP)" "$domain")"
	fi
fi
domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
is_host "$domain" || sf_die "Ungültige oder fehlende Domain: «$domain» (Option --domain)."
if is_ipv4 "$domain" && [ "$tls_mode" != internal ] && [ "$tls_mode" != custom ]; then
	sf_die "Für eine IP-Adresse gibt es kein Zertifikat per $tls_mode. TLS-Modus internal verwenden."
fi

# ACME e-mail and DNS challenge delegation
acme_email="" challenge_domain=""
case "$tls_mode" in
	acme | dns-*)
		if [ "$has_acme_email" = true ]; then
			acme_email="$opt_acme_email"
		else
			acme_email="$(env_value STUDIOFLOW_ACME_EMAIL)"
			[ "$interactive" = true ] && acme_email="$(prompt "E-Mail für Let's Encrypt (leer erlaubt)" "$acme_email")"
		fi
		[ -z "$acme_email" ] || is_email "$acme_email" || sf_die "Ungültige E-Mail: «$acme_email»."
		;;
esac
case "$tls_mode" in
	dns-*)
		if [ "$has_challenge_domain" = true ]; then
			challenge_domain="$opt_challenge_domain"
		else
			challenge_domain="$(env_value STUDIOFLOW_DNS_CHALLENGE_DOMAIN)"
			[ "$interactive" = true ] && challenge_domain="$(prompt "_acme-challenge per CNAME delegiert? Dann das CNAME-Ziel, sonst leer" "$challenge_domain")"
		fi
		challenge_domain="$(printf '%s' "$challenge_domain" | tr '[:upper:]' '[:lower:]')"
		[ -z "$challenge_domain" ] || is_hostname "${challenge_domain#_acme-challenge.}" || sf_die "Ungültiges CNAME-Ziel: «$challenge_domain»."
		;;
esac

# DNS provider credentials: environment > existing .env > prompt
provider_lines=""
for var in $(provider_vars "$tls_mode"); do
	value="${!var:-}"
	[ -n "$value" ] || value="$(env_value "$var")"
	if [ -z "$value" ] && [ "$interactive" = true ]; then
		if is_secret_var "$var"; then value="$(prompt_secret "$var (wird verdeckt eingegeben)")"; else value="$(prompt "$var" "")"; fi
	fi
	[ -n "$value" ] || sf_die "$var fehlt für den TLS-Modus $tls_mode (Umgebungsvariable setzen oder interaktiv eingeben)."
	provider_lines+="$(env_line "$var" "$value")"$'\n'
done

# Extra hosts (internal mode) and the certificate for clients without SNI
extra_hosts="" default_sni=""
if [ "$has_extra_hosts" = true ]; then
	extra_hosts="$opt_extra_hosts"
elif [ "$tls_mode" = internal ]; then
	extra_hosts="$(env_value STUDIOFLOW_EXTRA_HOSTS)"
	if [ "$interactive" = true ] && ! is_ipv4 "$domain"; then
		extra_hosts="$(prompt "Weitere Adressen, z. B. $node_ip für den Zugriff per IP (leer = keine)" "$extra_hosts")"
	fi
fi
extra_hosts="$(normalize_list "$(printf '%s' "$extra_hosts" | tr '[:upper:]' '[:lower:]')")"
for host in $extra_hosts; do
	is_host "$host" || sf_die "Ungültige weitere Adresse: «$host»."
	if [ -z "$default_sni" ] && is_ipv4 "$host"; then default_sni="$host"; fi
done
if [ -n "$extra_hosts" ] && [ "$tls_mode" != internal ]; then
	sf_warn "Weitere Adressen sind nur im Modus internal sinnvoll; für $tls_mode braucht jede ein eigenes Zertifikat."
fi

# Frame ancestors
if [ "$has_frame_ancestors" = true ]; then
	frame_ancestors="$opt_frame_ancestors"
else
	frame_ancestors="$(env_value STUDIOFLOW_FRAME_ANCESTORS)"
	[ "$interactive" = true ] && frame_ancestors="$(prompt "Origins, die den Output einbetten dürfen (z. B. https://proxy.example.ch; leer = nur StudioFlow selbst)" "$frame_ancestors")"
fi
frame_ancestors="$(normalize_list "$frame_ancestors")"
for origin in $frame_ancestors; do
	[ "$origin" = "'self'" ] && sf_die "'self' ist immer erlaubt und gehört nicht in --frame-ancestors."
	is_frame_ancestor "$origin" || sf_die "Ungültige Quelle für frame-ancestors: «$origin» (Beispiel: https://proxy.example.ch)."
done

# Admin account
admin_user="$opt_admin_user"
if [ -z "$admin_user" ]; then
	admin_user="$(env_value ADMIN__USERNAME)"
	admin_user="${admin_user:-admin}"
	[ "$interactive" = true ] && admin_user="$(prompt "Benutzername des Admin-Kontos" "$admin_user")"
fi
is_admin_user "$admin_user" || sf_die "Ungültiger Benutzername «$admin_user» (1–64 Zeichen: Buchstaben, Ziffern, . _ @ -)."

existing_hash="$(env_value ADMIN__PASSWORDHASH)"
existing_plain="$(env_value ADMIN__PASSWORD)"
password="" password_generated=false keep_credentials=false
case "$password_source" in
	stdin)
		IFS= read -r password || [ -n "$password" ] || sf_die "Kein Passwort auf der Standardeingabe."
		password="${password%$'\r'}"
		;;
	generate) password_generated=true ;;
	*)
		if [ -n "$existing_hash$existing_plain" ] && { [ "$interactive" != true ] || sf_confirm "Bestehendes Admin-Passwort behalten?" j; }; then
			keep_credentials=true
		elif [ "$interactive" = true ]; then
			while :; do
				password="$(prompt_secret "Admin-Passwort (mind. $MIN_PASSWORD_LENGTH Zeichen; leer = starkes Passwort erzeugen)")"
				[ -n "$password" ] || break
				if [ ${#password} -lt "$MIN_PASSWORD_LENGTH" ]; then sf_warn "Zu kurz."; continue; fi
				[ "$(prompt_secret "Admin-Passwort wiederholen")" = "$password" ] && break
				sf_warn "Die Eingaben stimmen nicht überein."
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
	sf_die "Das Admin-Passwort braucht mindestens $MIN_PASSWORD_LENGTH Zeichen."
fi

# Secrets: keep existing ones (the database password is fixed once PostgreSQL is initialised).
postgres_password="$(env_value POSTGRES_PASSWORD)"
[[ "$postgres_password" =~ ^[A-Za-z0-9]{16,}$ ]] || postgres_password="$(random_alnum 32)"
livekit_key="$(env_value LIVEKIT_API_KEY)"
[[ "$livekit_key" =~ ^[A-Za-z][A-Za-z0-9_-]{2,63}$ ]] || livekit_key=studioflow
livekit_secret="$(env_value LIVEKIT_API_SECRET)"
is_livekit_secret "$livekit_secret" || livekit_secret="sk$(random_hex 20)"

hsts_line=""
[ "$tls_mode" = internal ] && hsts_line="$(env_line STUDIOFLOW_HSTS_MAX_AGE "$INTERNAL_HSTS_MAX_AGE")"$'\n'

# --- write .env ---------------------------------------------------------------------------------------------------

umask 077
tmp_env="$(mktemp "$env_dir/.env.setup.XXXXXX")"
trap 'rm -f "$tmp_env"' EXIT

write_env() {
	local admin_lines="$1"
	{
		printf '# StudioFlow – erzeugt von setup.sh am %s. Nie ins Git; Kopie in den Passwort-Tresor.\n' "$(date '+%Y-%m-%d %H:%M')"
		printf '# Alle Variablen: .env.example und docs/architecture/implementation-spec.md (Abschnitt 10).\n\n'
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
	} >"$tmp_env"
}

# Hashes the password with the API image: `hash-password` reads it from stdin (sent without a newline) and prints
# the ASP.NET Identity v3 hash. Prints the hash, or returns 1 and shows the end of the error output.
hash_password() {
	local env_arg out err hash="" rc=0
	env_arg="$(sf_host_path "$tmp_env")"
	out="$(mktemp)"
	err="$(mktemp)"
	sf_info "API-Image wird gebaut (für den Passwort-Hash) …" >&2
	if ! sf_compose --env-file "$env_arg" build api >"$err" 2>&1; then
		rc=1
	elif ! printf '%s' "$password" | sf_compose --env-file "$env_arg" run --rm --no-deps -T --entrypoint dotnet api "$SF_API_DLL" hash-password >"$out" 2>"$err"; then
		rc=1
	else
		hash="$(tr -d '\r' <"$out" | awk 'NF { line = $0 } END { print line }')"
		is_password_hash "$hash" || { echo "hash-password lieferte keinen Identity-v3-Hash." >"$err"; rc=1; }
	fi
	[ "$rc" -eq 0 ] || grep -v -e '^[[:space:]]*$' -e 'View build details' "$err" | tail -n 5 >&2 || true
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
	sf_warn "Das Admin-Passwort wird im Klartext gespeichert (--plain-password). Nur für lokale Entwicklung."
	write_env "$(env_line ADMIN__PASSWORD "$password")"$'\n'
else
	write_env ""
	if docker_available && hash="$(hash_password)"; then
		write_env "$(env_line ADMIN__PASSWORDHASH "$hash")"$'\n'
		sf_info "Admin-Passwort als Hash gespeichert."
	else
		docker_available || sf_warn "Docker ist nicht verfügbar; der Passwort-Hash braucht das API-Image."
		sf_warn "Der Passwort-Hash konnte nicht über das API-Image erzeugt werden (Build fehlgeschlagen oder «hash-password» fehlt)."
		sf_warn "Das Passwort wird vorerst im Klartext (ADMIN__PASSWORD) gespeichert. Später ./setup.sh --force ausführen und ein neues Passwort setzen."
		write_env "$(env_line ADMIN__PASSWORD "$password")"$'\n'
	fi
fi

if [ -e "$env_file" ]; then
	backup_file="$env_file.backup-$(date '+%Y%m%d-%H%M%S')"
	cp -p "$env_file" "$backup_file"
	chmod 600 "$backup_file" 2>/dev/null || true
	sf_info "Bisherige Datei gesichert: $backup_file (eigene Ergänzungen von dort übernehmen)."
fi
chmod 600 "$tmp_env" 2>/dev/null || true
mv -f "$tmp_env" "$env_file"
trap - EXIT

# --- summary ------------------------------------------------------------------------------------------------------

sf_step "Fertig: $env_file"
sf_info "Regie:      https://$domain/"
sf_info "Sender:     https://$domain/join"
sf_info "Medien:     $node_ip (7881/tcp, 7882/udp)   TLS: $tls_mode"
case "$tls_mode" in
	internal) sf_info "Zertifikat: lokale CA – auf jedem Gerät einmal https://$domain/ca.crt installieren (docs/runbook.md)." ;;
	dns-*) sf_info "Zertifikat: Let's Encrypt per DNS-Challenge; der A-Record von $domain zeigt auf $node_ip." ;;
	acme) sf_info "Zertifikat: Let's Encrypt per HTTP-01; 80/tcp und 443/tcp müssen öffentlich erreichbar sein." ;;
	custom) sf_info "Zertifikat: ./certs/fullchain.pem und privkey.pem nach /certs mounten (docker-compose.override.example.yml)." ;;
esac
if [ "$password_generated" = true ]; then
	printf '\nAdmin-Konto: %s\nPasswort:    %s\n' "$admin_user" "$password"
	sf_info "Das Passwort wird nur jetzt angezeigt. Im Passwort-Tresor ablegen."
fi
sf_info ""
sf_info "Nächster Schritt: docker compose up -d --build"
