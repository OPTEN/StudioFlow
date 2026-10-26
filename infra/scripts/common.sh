# shellcheck shell=bash
# Shared helpers for setup.sh, backup.sh, restore.sh and update.sh. Sourced, never executed.
# The PowerShell scripts use infra/scripts/StudioFlow.psm1 with the same behaviour.
#
# Contract for the sourcing script: `set -euo pipefail` is active and SF_ROOT is the repository root.

# Git Bash: keep container paths (/tmp/x, service:/path) as they are. Host paths go through sf_host_path.
export MSYS_NO_PATHCONV=1

# Commands the API image provides (see docs/architecture/implementation-spec.md section 5 and 10).
readonly SF_API_DLL=Opten.StudioFlow.Web.dll
readonly SF_BROADCAST_LIVE_EXIT=3
readonly SF_WAIT_TIMEOUT_SECONDS=600

sf_info() { printf '%s\n' "$*"; }
sf_step() { printf '\n==> %s\n' "$*"; }
sf_warn() { printf 'Warning: %s\n' "$*" >&2; }
sf_die() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

# A host path in the form the docker CLI understands (C:/... on Git Bash for Windows).
sf_host_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		printf '%s' "$1"
	fi
}

sf_require_docker() {
	command -v docker >/dev/null 2>&1 || sf_die "docker was not found. Install Docker (Linux: Docker Engine, Windows/macOS: Docker Desktop)."
	docker compose version >/dev/null 2>&1 || sf_die "Docker Compose v2 is missing ('docker compose version' fails)."
	docker info >/dev/null 2>&1 || sf_die "Docker is not running, or this user is not allowed to use it (Linux: group 'docker')."
}

sf_require_env_file() {
	[ -f "$SF_ROOT/.env" ] || sf_die ".env is missing in $SF_ROOT. Run ./setup.sh first."
}

# docker compose, always from the repository root (picks up .env and docker-compose.override.yml).
sf_compose() {
	(cd "$SF_ROOT" && docker compose "$@")
}

# git in the repository root (no path argument, so it also works on Git Bash without path conversion).
sf_git() {
	(cd "$SF_ROOT" && git "$@")
}

# Runs a command and shows its output only if it fails (docker cp / compose cp report progress on stderr).
sf_quiet() {
	local output
	if ! output="$("$@" 2>&1)"; then
		printf '%s\n' "$output" >&2
		return 1
	fi
}

# Yes/no question on the terminal. $1 = question, $2 = default (y|n). Without a terminal the default applies.
sf_confirm() {
	local question="$1" default="${2:-n}" answer hint="[y/N]"
	[ "$default" = y ] && hint="[Y/n]"
	if [ ! -r /dev/tty ] || ! { : </dev/tty; } 2>/dev/null; then
		[ "$default" = y ]
		return
	fi
	printf '%s %s ' "$question" "$hint" >/dev/tty
	IFS= read -r answer </dev/tty || answer=""
	case "${answer:-$default}" in
		y | Y | yes | Yes | YES) return 0 ;;
		*) return 1 ;;
	esac
}

sf_service_running() {
	sf_compose ps --status running --services 2>/dev/null | grep -qx "$1"
}

sf_any_service_running() {
	[ -n "$(sf_compose ps --status running --services 2>/dev/null)" ]
}

# Prints live | idle | stopped | unknown.
#   live/idle: answer of `broadcast-status` in the API container (exit 3 = a production is live, 0 = none).
#   stopped:   no container of the stack runs, so nothing can be on air.
#   unknown:   the stack runs but the API cannot answer (not running, crashed, command missing).
sf_broadcast_status() {
	if ! sf_any_service_running; then
		echo stopped
		return
	fi
	if ! sf_service_running api; then
		echo unknown
		return
	fi
	local rc=0
	sf_compose exec -T api dotnet "$SF_API_DLL" broadcast-status >/dev/null 2>&1 || rc=$?
	case "$rc" in
		0) echo idle ;;
		"$SF_BROADCAST_LIVE_EXIT") echo live ;;
		*) echo unknown ;;
	esac
}

# Refuses to continue while a broadcast may be on air. $1 = action (a noun phrase such as "The update"),
# $2 = force (true|false).
sf_guard_broadcast() {
	local action="$1" force="$2" status
	status="$(sf_broadcast_status)"
	case "$status" in
		idle) sf_info "Broadcast status: no broadcast is live." ;;
		stopped) sf_info "Broadcast status: the stack is not running, no broadcast is live." ;;
		live)
			if [ "$force" = true ]; then
				sf_warn "A broadcast is LIVE. ${action} will run anyway because of --force - the picture at the proxy will drop out."
			else
				sf_die "A broadcast is LIVE. ${action} is blocked during a broadcast. First click 'End broadcast' in the Regie (or use --force if you really must)."
			fi
			;;
		*)
			if [ "$force" = true ]; then
				sf_warn "Broadcast status unknown (the API does not answer). ${action} will run anyway because of --force."
			else
				sf_die "Broadcast status unknown: the API is not running or does not answer. Check with 'docker compose ps' and 'docker compose logs api'; use --force to continue anyway."
			fi
			;;
	esac
}

# --- ready-made images (docker-compose.release.yml, docs/releasing.md) ----------------------------------------------

# True when the Compose file pulls ready-made images (an installation from a release), false when it builds the images
# from the source (a Git checkout with docker-compose.yml) or cannot be read.
sf_uses_images() {
	local config
	config="$(sf_compose config --no-interpolate 2>/dev/null)" || return 1
	! printf '%s\n' "$config" | grep -q '^    build:'
}

# Image reference of the API for the given tag (default: the tag that is configured), e.g. ghcr.io/opten/studioflow-api:0.4.2.
sf_api_image() {
	local images
	if [ -n "${1:-}" ]; then
		images="$(STUDIOFLOW_IMAGE_TAG="$1" sf_compose config --images 2>/dev/null)" || true
	else
		images="$(sf_compose config --images 2>/dev/null)" || true
	fi
	printf '%s\n' "$images" | grep -m 1 'studioflow-api' || true
}

# Value of a label of a local image or container; empty if there is none.
sf_label() {
	docker inspect --format "{{ index .Config.Labels \"$2\" }}" "$1" 2>/dev/null || true
}

# Version of the API that runs now, as it reports itself (0.4.2+1a2b3c4); empty if the API container does not exist or
# comes from a build without a version label.
sf_running_version() {
	local id
	id="$(sf_compose ps -q api 2>/dev/null | head -n 1)"
	[ -z "$id" ] || sf_label "$id" org.opencontainers.image.version
}

# Sets KEY=VALUE in .env: replaces the line or appends it. The file stays private (mode 600).
sf_env_set() {
	local key="$1" value="$2" file="$SF_ROOT/.env" tmp
	tmp="$(umask 077 && mktemp "$SF_ROOT/.env.update.XXXXXX")"
	awk -v key="$key" -v line="$key=$value" '
		{
			name = $0; sub(/\r$/, "", name); sub(/=.*/, "", name); gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
			if (name == key) { if (!done) print line; done = 1; next }
			print
		}
		END { if (!done) print line }' "$file" >"$tmp"
	mv -f "$tmp" "$file"
}

# Starts the stack (or the given services) and waits until every healthcheck passes.
sf_up_and_wait() {
	if ! sf_compose up -d --wait --wait-timeout "$SF_WAIT_TIMEOUT_SECONDS" "$@"; then
		sf_compose ps >&2 || true
		sf_die "Not all services are healthy. Logs: docker compose logs --tail 100 <service>"
	fi
}

# Shows the state of the Regie account from the API log: the setup code while the first-run setup is open, or that the
# account exists. The newest of the two log lines counts (a reset-admin reopens the setup with a new code). Retries for
# up to $1 seconds (default 60), because the API writes the line during its start.
sf_show_setup_code() {
	local timeout="${1:-60}" waited=0 line
	while :; do
		line="$(sf_compose logs --no-color --no-log-prefix api 2>/dev/null |
			grep -E 'Setup code: [A-Z0-9]{4}-[A-Z0-9]{4}|The Regie account exists' | tail -n 1 || true)"
		case "$line" in
			*"Setup code: "*)
				sf_info "Setup code:  ${line##*Setup code: }"
				sf_info "Open the Regie and enter it in the first-run setup to create the account (valid until a restart)."
				return 0
				;;
			*"The Regie account exists"*)
				sf_info "The Regie account exists already. Forgotten password: reset-admin (docs/runbook.md)."
				return 0
				;;
		esac
		if [ "$waited" -ge "$timeout" ]; then
			sf_warn "The API has not logged the setup code yet. Read it later with: docker compose logs api | grep 'Setup code'"
			return 1
		fi
		sleep 2
		waited=$((waited + 2))
	done
}

# Toolbox container (profile "tools") with the media, keys and caddy_data volumes under /volumes. Arguments (for
# example -v host:container) go to `docker compose run`. Prints the container id; the caller removes it with
# sf_toolbox_stop.
sf_toolbox_start() {
	sf_compose --profile tools run -d --rm --no-deps "$@" toolbox 2>/dev/null
}

sf_toolbox_stop() {
	[ -n "${1:-}" ] && docker rm -f "$1" >/dev/null 2>&1 || true
}

# Backup layout, shared by backup.sh and restore.sh. Volumes in archive order: <volume> = file <volume>.tar.gz,
# mounted at /volumes/<volume> in the toolbox container.
# shellcheck disable=SC2034 # used by the sourcing scripts
readonly SF_BACKUP_VOLUMES="media keys caddy_data" SF_DB_DUMP=database.dump SF_CHECKSUMS=SHA256SUMS SF_BACKUP_INFO=backup-info.txt
