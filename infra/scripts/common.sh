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
sf_warn() { printf 'Warnung: %s\n' "$*" >&2; }
sf_die() {
	printf 'Fehler: %s\n' "$*" >&2
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
	command -v docker >/dev/null 2>&1 || sf_die "docker wurde nicht gefunden. Docker installieren (Linux: Docker Engine, Windows/macOS: Docker Desktop)."
	docker compose version >/dev/null 2>&1 || sf_die "Docker Compose v2 fehlt («docker compose version» schlägt fehl)."
	docker info >/dev/null 2>&1 || sf_die "Docker läuft nicht oder dieser Benutzer darf es nicht verwenden (Linux: Gruppe «docker»)."
}

sf_require_env_file() {
	[ -f "$SF_ROOT/.env" ] || sf_die ".env fehlt in $SF_ROOT. Zuerst ./setup.sh ausführen."
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

# Yes/no question on the terminal. $1 = question, $2 = default (j|n). Without a terminal the default applies.
sf_confirm() {
	local question="$1" default="${2:-n}" answer hint="[j/N]"
	[ "$default" = j ] && hint="[J/n]"
	if [ ! -r /dev/tty ] || ! { : </dev/tty; } 2>/dev/null; then
		[ "$default" = j ]
		return
	fi
	printf '%s %s ' "$question" "$hint" >/dev/tty
	IFS= read -r answer </dev/tty || answer=""
	case "${answer:-$default}" in
		j | J | ja | Ja | JA | y | Y | yes) return 0 ;;
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

# Refuses to continue while a broadcast may be on air. $1 = action (German noun), $2 = force (true|false).
sf_guard_broadcast() {
	local action="$1" force="$2" status
	status="$(sf_broadcast_status)"
	case "$status" in
		idle) sf_info "Sendestatus: keine Sendung live." ;;
		stopped) sf_info "Sendestatus: Stack läuft nicht, keine Sendung live." ;;
		live)
			if [ "$force" = true ]; then
				sf_warn "Eine Sendung ist LIVE. ${action} wird wegen --force trotzdem ausgeführt – das Bild beim Proxy bricht ab."
			else
				sf_die "Eine Sendung ist LIVE. ${action} ist während einer Sendung gesperrt. Zuerst «Sendung beenden» in der Regie (oder --force, wenn es wirklich sein muss)."
			fi
			;;
		*)
			if [ "$force" = true ]; then
				sf_warn "Sendestatus unbekannt (API antwortet nicht). ${action} wird wegen --force trotzdem ausgeführt."
			else
				sf_die "Sendestatus unbekannt: die API läuft nicht oder antwortet nicht. Prüfen mit «docker compose ps» und «docker compose logs api»; mit --force trotzdem fortfahren."
			fi
			;;
	esac
}

# Starts the stack (or the given services) and waits until every healthcheck passes.
sf_up_and_wait() {
	if ! sf_compose up -d --wait --wait-timeout "$SF_WAIT_TIMEOUT_SECONDS" "$@"; then
		sf_compose ps >&2 || true
		sf_die "Nicht alle Dienste sind gesund. Logs: docker compose logs --tail 100 <dienst>"
	fi
}

# Toolbox container (profile "tools") with the media, keys and caddy_data volumes under /volumes.
# Prints the container id; the caller removes it with sf_toolbox_stop.
sf_toolbox_start() {
	sf_compose --profile tools run -d --rm --no-deps toolbox 2>/dev/null
}

sf_toolbox_stop() {
	[ -n "${1:-}" ] && docker rm -f "$1" >/dev/null 2>&1 || true
}

# Backup layout, shared by backup.sh and restore.sh. Volumes in archive order: <volume> = file <volume>.tar.gz,
# mounted at /volumes/<volume> in the toolbox container.
# shellcheck disable=SC2034 # used by the sourcing scripts
readonly SF_BACKUP_VOLUMES="media keys caddy_data" SF_DB_DUMP=database.dump SF_CHECKSUMS=SHA256SUMS SF_BACKUP_INFO=backup-info.txt
