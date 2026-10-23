#!/usr/bin/env bash
# StudioFlow backup: database (pg_dump -Fc) and the volumes media, keys and caddy_data into
# backups/YYYY-MM-DD_HHMM/ with a checksum file. Same behaviour as backup.ps1. ./backup.sh --help for the options.
set -euo pipefail

SF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$SF_ROOT/infra/scripts/common.sh"

usage() {
	cat <<'EOF'
Back up StudioFlow: database (pg_dump) and the volumes media, keys and caddy_data.

Usage: ./backup.sh [options]

  --dir PATH      base folder of the backups (default: ./backups)
  --keep N        keep only the newest N backups in the base folder, delete older ones
  --label TEXT    suffix for the folder name, e.g. pre-update (letters, digits, -)
  -h, --help      this help

Result: <base>/YYYY-MM-DD_HHMM[_label]/ with database.dump, media.tar.gz, keys.tar.gz, caddy_data.tar.gz,
backup-info.txt and SHA256SUMS. The .env is not included (secrets): keep it in the password vault.
The backup contains private keys (login, certificates) - store the folder protected.
The stack must be running (at least postgres); a running broadcast is not disturbed.
EOF
}

base_dir="$SF_ROOT/backups" keep="" label=""
while [ $# -gt 0 ]; do
	arg="$1" value=""
	case "$arg" in
		--*=*) value="${arg#*=}" arg="${arg%%=*}" ;;
		--dir | --keep | --label)
			[ $# -ge 2 ] || sf_die "Option $arg needs a value (see --help)."
			value="$2"
			shift
			;;
	esac
	case "$arg" in
		--dir) base_dir="$value" ;;
		--keep) keep="$value" ;;
		--label) label="$value" ;;
		-h | --help)
			usage
			exit 0
			;;
		*) sf_die "Unknown option: $1 (see --help)." ;;
	esac
	shift
done
[ -z "$keep" ] || [[ "$keep" =~ ^[1-9][0-9]*$ ]] || sf_die "--keep expects a number of 1 or more."
[ -z "$label" ] || [[ "$label" =~ ^[A-Za-z0-9-]{1,40}$ ]] || sf_die "--label allows only letters, digits and - (max. 40)."

sf_require_docker
sf_require_env_file
sf_service_running postgres || sf_die "PostgreSQL is not running. Start the stack first: docker compose up -d"

sha256_file() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'
}

archives() {
	local volume
	for volume in $SF_BACKUP_VOLUMES; do printf '%s.tar.gz\n' "$volume"; done
}

# --- target folder (private: it holds login keys, certificates and the CA key) -----------------------------------

umask 077
mkdir -p "$base_dir"
base_dir="$(cd "$base_dir" && pwd)"
name="$(date '+%Y-%m-%d_%H%M')${label:+_$label}"
target="$base_dir/$name"
suffix=2
while [ -e "$target" ]; do
	target="$base_dir/$name-$suffix"
	suffix=$((suffix + 1))
done
mkdir "$target"
host_target="$(sf_host_path "$target")"

toolbox="" completed=false
on_exit() {
	sf_toolbox_stop "$toolbox"
	sf_compose exec -T postgres rm -f /tmp/studioflow-backup.dump >/dev/null 2>&1 || true
	if [ "$completed" != true ]; then
		rm -rf "$target"
		sf_warn "The incomplete backup was removed."
	fi
}
trap on_exit EXIT

sf_step "Backing up to $target"

# --- database -------------------------------------------------------------------------------------------------------

sf_info "Database (pg_dump) ..."
sf_compose exec -T postgres pg_dump -U studioflow -d studioflow -Fc -f /tmp/studioflow-backup.dump ||
	sf_die "pg_dump failed."
sf_quiet sf_compose cp postgres:/tmp/studioflow-backup.dump "$host_target/$SF_DB_DUMP" ||
	sf_die "The database dump could not be copied."
postgres_version="$(sf_compose exec -T postgres psql -U studioflow -d studioflow -tAc 'SHOW server_version' 2>/dev/null | tr -d '\r' || true)"
project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$(sf_compose ps -q postgres)" 2>/dev/null || true)"

# --- volumes --------------------------------------------------------------------------------------------------------

toolbox="$(sf_toolbox_start)" || sf_die "The helper container (toolbox) could not be started."
for volume in $SF_BACKUP_VOLUMES; do
	sf_info "Volume $volume ..."
	docker exec "$toolbox" tar -czf "/tmp/$volume.tar.gz" -C "/volumes/$volume" . ||
		sf_die "The archive for $volume could not be created."
	sf_quiet docker cp "$toolbox:/tmp/$volume.tar.gz" "$host_target/$volume.tar.gz" ||
		sf_die "The archive for $volume could not be copied."
done

# --- description and checksums ------------------------------------------------------------------------------------

{
	echo "StudioFlow backup"
	echo "created:   $(date '+%Y-%m-%d %H:%M:%S %z')"
	echo "host:      $(hostname 2>/dev/null || echo unknown)"
	echo "project:   ${project:-unknown}"
	echo "git:       $(sf_git rev-parse --short HEAD 2>/dev/null || echo unknown)"
	echo "postgres:  ${postgres_version:-unknown}"
	echo "contents:  $SF_DB_DUMP $(archives | tr '\n' ' ')"
} >"$target/$SF_BACKUP_INFO"

(
	cd "$target"
	for file in "$SF_DB_DUMP" $(archives) "$SF_BACKUP_INFO"; do
		printf '%s  %s\n' "$(sha256_file "$file")" "$file"
	done >"$SF_CHECKSUMS"
)
completed=true

# --- retention ------------------------------------------------------------------------------------------------------

if [ -n "$keep" ]; then
	# Only folders written by this script (date-named, with a checksum file), newest first by the time the checksum
	# file was written: names have minute resolution and labels, so they do not sort reliably.
	backups=()
	# shellcheck disable=SC2012 # ls -t is the portable way to sort by mtime (GNU and BSD stat differ)
	while IFS= read -r sums; do
		dir="$(dirname "$sums")"
		[[ "$(basename "$dir")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4} ]] && backups+=("$dir")
	done < <(ls -1t "$base_dir"/*/"$SF_CHECKSUMS" 2>/dev/null)
	for ((i = keep; i < ${#backups[@]}; i++)); do
		[ "${backups[i]}" = "$target" ] && continue
		rm -rf "${backups[i]}"
		sf_info "Old backup removed: $(basename "${backups[i]}")"
	done
fi

sf_step "Backup complete: $target ($(du -sh "$target" | awk '{ print $1 }'))"
sf_info "Restore with: ./restore.sh \"$target\""
