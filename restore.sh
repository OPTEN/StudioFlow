#!/usr/bin/env bash
# StudioFlow restore from a backup folder written by backup.sh / backup.ps1 or by the backup service. Same behaviour as
# restore.ps1. ./restore.sh --help for the options.
set -euo pipefail

SF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$SF_ROOT/infra/scripts/common.sh"
# shellcheck source=infra/scripts/backup-core.sh
. "$SF_ROOT/infra/scripts/backup-core.sh"

usage() {
	cat <<'EOF'
Restore StudioFlow: replaces database, media, login keys and certificates with a backup.

Usage: ./restore.sh BACKUP_FOLDER [options]

  --verify              only check the backup: verify the checksums and load the dump into a throwaway
                        database; nothing is replaced and nothing is stopped
  --yes                 no confirmation prompt
  --no-safety-backup    do not back up the current state first
  --force               even if a broadcast is live or the broadcast status is unknown
  -h, --help            this help

Sequence: verify checksums -> back up the current state (backups/..._pre-restore) -> stop api and caddy ->
restore the database into a new database and swap it in only afterwards -> replace volumes -> start the stack and
wait until all services are healthy. Blocked during a broadcast.

Backups of the backup service have no media.tar.gz: the media come from the folder media/ next to the backup folder
(the incremental copy), if it exists.
EOF
}

source_dir="" assume_yes=false safety_backup=true force=false verify_only=false
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
			[ -z "$source_dir" ] || sf_die "Only one backup folder is allowed."
			source_dir="$1"
			;;
	esac
	shift
done
[ -n "$source_dir" ] || sf_die "Backup folder missing. Usage: ./restore.sh backups/YYYY-MM-DD_HHMM"
[ -d "$source_dir" ] || sf_die "Folder not found: $source_dir"
source_dir="$(cd "$source_dir" && pwd)"

sf_require_docker
sf_require_env_file

# --- check the backup -----------------------------------------------------------------------------------------------

[ -f "$source_dir/$SF_CHECKSUMS" ] || sf_die "$SF_CHECKSUMS is missing in $source_dir - not a complete StudioFlow backup."
[ -f "$source_dir/$SF_DB_DUMP" ] || sf_die "$SF_DB_DUMP is missing in $source_dir."

sf_info "Verifying checksums ..."
problem="$(sf_backup_check_checksums "$source_dir")" || sf_die "$problem."
sf_info "Checksums OK."
[ -f "$source_dir/$SF_BACKUP_INFO" ] && sed 's/^/  /' "$source_dir/$SF_BACKUP_INFO"

host_source="$(sf_host_path "$source_dir")"
toolbox="" warn_on_exit=false

psql_admin() {
	sf_compose exec -T postgres psql -U studioflow -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

# --- --verify: load the dump into a throwaway database ------------------------------------------------------------

verify_cleanup() {
	psql_admin -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" >/dev/null 2>&1 || true
	sf_compose exec -T postgres rm -f /tmp/studioflow-verify.dump >/dev/null 2>&1 || true
}

if [ "$verify_only" = true ]; then
	sf_step "Load the dump into a throwaway database ($SF_VERIFY_DB)"
	sf_up_and_wait postgres
	trap verify_cleanup EXIT
	sf_quiet sf_compose cp "$host_source/$SF_DB_DUMP" postgres:/tmp/studioflow-verify.dump
	psql_admin -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" -c "CREATE DATABASE $SF_VERIFY_DB OWNER studioflow"
	sf_compose exec -T postgres pg_restore -U studioflow -d "$SF_VERIFY_DB" --no-owner --no-privileges --exit-on-error /tmp/studioflow-verify.dump ||
		sf_die "The dump could not be loaded (pg_restore failed). This backup cannot be restored."
	report="$(sf_compose exec -T postgres psql -U studioflow -d "$SF_VERIFY_DB" -tA -c "$SF_VERIFY_QUERY" | tr -d '\r')" ||
		sf_die "The restored database could not be queried."
	[ -n "$report" ] || sf_die "The dump was loaded, but the database is empty. This backup cannot be restored."
	sf_info "Dump loaded: $report"
	sf_step "Backup verified: $source_dir"
	exit 0
fi

sf_guard_broadcast "The restore" "$force"

if [ "$assume_yes" != true ]; then
	sf_warn "Database, media, login keys and certificates will be replaced by the backup."
	sf_confirm "Restore from $(basename "$source_dir")?" n || sf_die "Aborted, nothing changed."
fi

# --- safety backup of the current state --------------------------------------------------------------------------

sf_step "Start PostgreSQL"
sf_up_and_wait postgres

if [ "$safety_backup" = true ]; then
	sf_step "Back up the current state"
	bash "$SF_ROOT/backup.sh" --label pre-restore || sf_die "The safety backup of the current state failed; nothing was changed (use --no-safety-backup to skip it)."
fi

# --- database: restore into a new database, then swap (the old one stays intact if anything fails) ---------------

warn_on_exit=true
on_exit() {
	sf_toolbox_stop "$toolbox"
	sf_compose exec -T postgres rm -f /tmp/studioflow-restore.dump >/dev/null 2>&1 || true
	if [ "$warn_on_exit" = true ]; then
		sf_warn "The restore did not complete; api and caddy may be stopped."
		sf_warn "Check the output above. The previous state is in backups/..._pre-restore; start with: docker compose up -d"
	fi
}
trap on_exit EXIT

sf_step "Stop API and Caddy"
sf_compose stop api caddy

sf_step "Restore the database"
sf_quiet sf_compose cp "$host_source/$SF_DB_DUMP" postgres:/tmp/studioflow-restore.dump
psql_admin -c 'DROP DATABASE IF EXISTS studioflow_restore' -c 'CREATE DATABASE studioflow_restore OWNER studioflow'
if ! sf_compose exec -T postgres pg_restore -U studioflow -d studioflow_restore --no-owner --no-privileges --exit-on-error /tmp/studioflow-restore.dump; then
	psql_admin -c 'DROP DATABASE IF EXISTS studioflow_restore' || true
	sf_compose up -d >/dev/null 2>&1 || true
	warn_on_exit=false
	sf_die "pg_restore failed. The previous database is unchanged; the stack was started again."
fi
psql_admin \
	-c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'studioflow' AND pid <> pg_backend_pid()" \
	-c 'DROP DATABASE IF EXISTS studioflow_replaced' >/dev/null
psql_admin -1 \
	-c 'ALTER DATABASE studioflow RENAME TO studioflow_replaced' \
	-c 'ALTER DATABASE studioflow_restore RENAME TO studioflow'
psql_admin -c 'DROP DATABASE studioflow_replaced'
sf_info "Database replaced."

# --- volumes --------------------------------------------------------------------------------------------------------

# The backup service keeps the media as an incremental copy next to the dated folders instead of a media.tar.gz.
media_copy="$(dirname "$source_dir")/media"
toolbox_options=()
if [ ! -f "$source_dir/media.tar.gz" ] && [ -d "$media_copy" ]; then
	toolbox_options=(-v "$(sf_host_path "$media_copy"):/restore-media:ro")
fi

sf_step "Restore the volumes"
toolbox="$(sf_toolbox_start ${toolbox_options[@]+"${toolbox_options[@]}"})" || sf_die "The helper container (toolbox) could not be started."
for volume in $SF_BACKUP_VOLUMES; do
	archive="$volume.tar.gz"
	if [ ! -f "$source_dir/$archive" ]; then
		if [ "$volume" = media ] && [ ${#toolbox_options[@]} -gt 0 ]; then
			sf_info "Volume media from the incremental copy $media_copy ..."
			# The copy keeps the owner of the files; the API user owns the keys volume, so the media get the same owner.
			docker exec "$toolbox" sh -c "find /volumes/media -mindepth 1 -delete && cp -a /restore-media/. /volumes/media/ && chown -R \"\$(stat -c '%u:%g' /volumes/keys)\" /volumes/media"
			continue
		fi
		sf_warn "$archive is missing in the backup; volume $volume is left unchanged."
		continue
	fi
	sf_info "Volume $volume ..."
	sf_quiet docker cp "$host_source/$archive" "$toolbox:/tmp/$archive"
	docker exec "$toolbox" sh -c "find '/volumes/$volume' -mindepth 1 -delete && tar -xzf '/tmp/$archive' -C '/volumes/$volume'"
done
sf_toolbox_stop "$toolbox"
toolbox=""

# --- start ----------------------------------------------------------------------------------------------------------

sf_step "Start the stack"
sf_up_and_wait
warn_on_exit=false
sf_compose ps
sf_step "Restore complete from $source_dir"
