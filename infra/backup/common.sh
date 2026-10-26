# shellcheck shell=bash
# Shared helpers of the scripts in the backup image. Sourced, never executed. Texts are English and ASCII only (they appear in
# `docker compose logs backup` and in the terminal of `docker compose run`; no i18n layer).

sf_info() { printf '%s\n' "$*"; }
sf_step() { printf '\n==> %s\n' "$*"; }
sf_warn() { printf 'Warning: %s\n' "$*" >&2; }
sf_die() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

# Yes/no question on the terminal. $1 = question, $2 = default (y|n). Without a terminal the default applies.
sf_confirm() {
	local question="$1" default="${2:-n}" answer hint="[y/N]"
	[ "$default" = y ] && hint="[Y/n]"
	if [ ! -t 0 ]; then
		[ "$default" = y ]
		return
	fi
	printf '%s %s ' "$question" "$hint"
	IFS= read -r answer || answer=""
	case "${answer:-$default}" in
		y | Y | yes | Yes | YES) return 0 ;;
		*) return 1 ;;
	esac
}

# Sets PGPASSWORD from the secrets volume, unless the environment has one already (tests, a manual override).
sf_load_database_password() {
	local file="${BACKUP_SECRETS_DIR:-/run/secrets}/postgres-password"
	if [ -z "${PGPASSWORD:-}" ] && [ -r "$file" ]; then
		PGPASSWORD="$(cat "$file")"
		export PGPASSWORD
	fi
}
