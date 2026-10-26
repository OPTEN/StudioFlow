#!/usr/bin/env bash
# StudioFlow restore (docker compose run --rm backup restore <backup> [options]): replaces the database, the media, the
# login keys and the certificates with a backup of the backups volume. Runs inside the stack, the same on Linux, Windows and
# macOS. Texts are English and ASCII only.
set -euo pipefail

SF_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/backup/common.sh
. "$SF_HOME/common.sh"
# shellcheck source=infra/backup/backup-core.sh
. "$SF_HOME/backup-core.sh"
# shellcheck source=infra/backup/status.sh
. "$SF_HOME/status.sh"

usage() {
	cat <<'EOF'
Restore StudioFlow: replaces database, media, login keys and certificates with a backup.

Usage: docker compose run --rm backup restore BACKUP [options]

  BACKUP                the folder name in the backups volume (for example 2026-10-26_0300_auto; list them with
                        "docker compose run --rm backup list") or a path inside the container
  --verify              only check the backup: verify the checksums, load the dump into a throwaway database and read the
                        archives; nothing is replaced and nothing needs to be stopped
  --yes                 no confirmation prompt
  --no-safety-backup    do not back up the current state first
  --force               even if the database says that a broadcast is live
  -h, --help            this help

Sequence: verify the checksums -> make sure the API is stopped -> back up the current state (folder ..._pre-restore) ->
restore the database into a new database and swap it in only afterwards -> replace the volumes. The command refuses
while the API runs: stop it first with  docker compose stop caddy api livekit  and start everything again afterwards with
docker compose up -d

Backups of the backup service have no media.tar.gz: the media come from the folder media/ next to the backup folders (the
incremental copy), if it exists.
EOF
}

source_arg="" assume_yes=false safety_backup=true force=false verify_only=false
while [ $# -gt 0 ]; do
	case "$1" in
		--verify) verify_only=true ;;
		--yes) assume_yes=true ;;
		--no-safety-backup) safety_backup=false ;;
		--force) force=true ;;
		-h | --help)
			usage
			exit 0
			;;
		-*) sf_die "Unknown option: $1 (see --help)." ;;
		*)
			[ -z "$source_arg" ] || sf_die "Only one backup is allowed."
			source_arg="$1"
			;;
	esac
	shift
done

backup_dir="${BACKUP_DIR:-/backups}"
volumes_dir="${BACKUP_VOLUMES_DIR:-/volumes}"
[ -n "$source_arg" ] || sf_die "Backup missing. Usage: docker compose run --rm backup restore 2026-10-26_0300_auto (list them with: docker compose run --rm backup list)"
if [[ "$source_arg" == */* ]]; then
	source_dir="$source_arg"
else
	source_dir="$backup_dir/$source_arg"
fi
[ -d "$source_dir" ] || sf_die "Folder not found: $source_dir (list the backups with: docker compose run --rm backup list)"
source_dir="$(cd "$source_dir" && pwd)"

sf_load_database_password
umask 077
# DROP DATABASE IF EXISTS would print a NOTICE every time.
export PGOPTIONS="-c client_min_messages=warning"

# --- check the backup -------------------------------------------------------------------------------------------------

[ -f "$source_dir/$SF_CHECKSUMS" ] || sf_die "$SF_CHECKSUMS is missing in $source_dir - not a complete StudioFlow backup."
[ -f "$source_dir/$SF_DB_DUMP" ] || sf_die "$SF_DB_DUMP is missing in $source_dir."

sf_info "Verifying checksums ..."
problem="$(sf_backup_check_checksums "$source_dir")" || sf_die "$problem."
sf_info "Checksums OK."
if [ -f "$source_dir/$SF_BACKUP_INFO" ]; then sed 's/^/  /' "$source_dir/$SF_BACKUP_INFO"; fi

psql_admin() { psql -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

# Loads the dump of the backup into the throwaway database and reads what is in it.
verify_dump() {
	local report
	psql_admin -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" -c "CREATE DATABASE $SF_VERIFY_DB"
	if ! pg_restore -d "$SF_VERIFY_DB" --no-owner --no-privileges --exit-on-error "$source_dir/$SF_DB_DUMP"; then
		psql_admin -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" || true
		sf_die "The dump could not be loaded (pg_restore failed). This backup cannot be restored."
	fi
	report="$(psql -d "$SF_VERIFY_DB" -tA -c "$SF_VERIFY_QUERY" | tr -d '\r')" || report=""
	psql_admin -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" || true
	[ -n "$report" ] || sf_die "The dump was loaded, but the database is empty. This backup cannot be restored."
	sf_info "Dump loaded: $report"
}

# --- --verify: nothing is replaced ----------------------------------------------------------------------------------------

if [ "$verify_only" = true ]; then
	sf_step "Load the dump into a throwaway database ($SF_VERIFY_DB)"
	verify_dump
	for archive in "$source_dir"/*.tar.gz; do
		[ -e "$archive" ] || continue
		tar -tzf "$archive" >/dev/null || sf_die "The archive $(basename "$archive") cannot be read. This backup cannot be restored."
		sf_info "Archive $(basename "$archive") readable."
	done
	sf_step "Backup verified: $source_dir"
	exit 0
fi

# --- guards ---------------------------------------------------------------------------------------------------------------

# The API holds connections to the database and writes to the volumes: it must be stopped. There is no Docker socket in this
# container, so the operator stops it (the message says how); the connections show whether it is stopped.
api_connections="$(psql_admin -tA -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'studioflow' AND application_name = 'studioflow-api'" | tr -d '\r')"
if [ "$api_connections" != 0 ]; then
	sf_die "The API is running ($api_connections database connections). Stop it first: docker compose stop caddy api livekit - then run this command again, and afterwards: docker compose up -d"
fi

live="$(psql -d studioflow -tA -c "SELECT EXISTS (SELECT 1 FROM productions WHERE lower(broadcast) = 'live')" 2>/dev/null | tr -d '\r' || true)"
if [ "$live" = t ] && [ "$force" != true ]; then
	sf_die "The database says that a broadcast is live (the API was stopped without ending it). If that broadcast is over, run the command again with --force."
fi

if [ "$assume_yes" != true ]; then
	sf_warn "Database, media, login keys and certificates will be replaced by the backup."
	sf_confirm "Restore from $(basename "$source_dir")?" n || sf_die "Aborted, nothing changed. (Without a terminal pass --yes.)"
fi

# --- safety backup of the current state -------------------------------------------------------------------------------

if [ "$safety_backup" = true ]; then
	sf_step "Back up the current state"
	"$SF_HOME/backup-job.sh" --label pre-restore --now || sf_die "The safety backup of the current state failed; nothing was changed (use --no-safety-backup to skip it)."
fi

# --- database: restore into a new database, then swap (the old one stays intact if anything fails) ------------------------

warn_on_exit=true
on_exit() {
	if [ "$warn_on_exit" = true ]; then
		sf_warn "The restore did not complete. Check the output above. The previous state is in the backup ..._pre-restore."
	fi
}
trap on_exit EXIT

sf_step "Restore the database"
psql_admin -c 'DROP DATABASE IF EXISTS studioflow_restore' -c 'CREATE DATABASE studioflow_restore OWNER studioflow'
if ! pg_restore -d studioflow_restore --no-owner --no-privileges --exit-on-error "$source_dir/$SF_DB_DUMP"; then
	psql_admin -c 'DROP DATABASE IF EXISTS studioflow_restore' || true
	warn_on_exit=false
	sf_die "pg_restore failed. The previous database is unchanged."
fi
psql_admin \
	-c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'studioflow' AND pid <> pg_backend_pid()" \
	-c 'DROP DATABASE IF EXISTS studioflow_replaced' >/dev/null
psql_admin -1 \
	-c 'ALTER DATABASE studioflow RENAME TO studioflow_replaced' \
	-c 'ALTER DATABASE studioflow_restore RENAME TO studioflow'
psql_admin -c 'DROP DATABASE studioflow_replaced'
sf_info "Database replaced."

# --- volumes ----------------------------------------------------------------------------------------------------------

# The backup service keeps the media as an incremental copy next to the dated folders instead of a media.tar.gz.
media_copy="$(dirname "$source_dir")/media"

restore_volume() {
	local volume="$1" archive="$source_dir/$1.tar.gz" destination="$volumes_dir/$1"
	if [ -f "$archive" ]; then
		sf_info "Volume $volume ..."
		find "$destination" -mindepth 1 -delete
		tar -xzf "$archive" -C "$destination"
	elif [ "$volume" = media ] && [ -d "$media_copy" ]; then
		sf_info "Volume media from the incremental copy $media_copy ..."
		find "$destination" -mindepth 1 -delete
		cp -a "$media_copy/." "$destination/"
		# The copy keeps the owner of the files; the API user owns the keys volume, so the media get the same owner.
		chown -R "$(stat -c '%u:%g' "$volumes_dir/keys")" "$destination"
	elif [ "$volume" = media ]; then
		sf_info "This backup holds no media (no media.tar.gz, no copy in $(dirname "$source_dir")/media); the media volume is left unchanged."
	else
		sf_warn "$volume.tar.gz is missing in the backup; volume $volume is left unchanged."
	fi
}

sf_step "Restore the volumes"
for volume in $SF_BACKUP_VOLUMES; do
	restore_volume "$volume"
done

warn_on_exit=false
sf_status_backups "$backup_dir" || true
sf_step "Restore complete from $source_dir"
sf_info "Start the stack: docker compose up -d"
