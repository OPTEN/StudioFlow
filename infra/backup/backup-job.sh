#!/usr/bin/env bash
# shellcheck disable=SC2016 # the jq filters use jq variables ($now, $name ...), which must not expand in the shell
# StudioFlow backup job: one backup run. The scheduler (serve.sh, through supercronic) starts it on the schedule of the
# server settings with --label auto; the command backup-now and "Back up now" in the Regie start it with --label manual --now.
#
#   backup-job.sh [--label auto|manual|pre-restore] [--now]
#
# pg_dump connects over the network and the volumes are mounted, so no docker is needed. Sequence: wait while a broadcast is
# live (not with --now: somebody asked for this backup) -> database dump and archives of keys and caddy_data -> load the dump
# into a throwaway database (the backup must be restorable) -> checksums -> retention (folders labelled auto only) ->
# incremental copy of the media -> optional off-site copy (rclone, encrypted with age). The media are not archived again every
# day: files are immutable, so only new ones are copied. Texts are English and ASCII only.
set -euo pipefail

SF_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/backup/common.sh
. "$SF_HOME/common.sh"
# shellcheck source=infra/backup/backup-core.sh
. "$SF_HOME/backup-core.sh"
# shellcheck source=infra/backup/status.sh
. "$SF_HOME/status.sh"
# shellcheck source=infra/backup/settings.sh
. "$SF_HOME/settings.sh"

label=auto wait_for_broadcast=true
while [ $# -gt 0 ]; do
	case "$1" in
		--label)
			[ $# -ge 2 ] || sf_die "--label needs a value."
			label="$2"
			shift
			;;
		--now) wait_for_broadcast=false ;;
		*) sf_die "Unknown option: $1" ;;
	esac
	shift
done
[[ "$label" =~ ^[a-z][a-z-]{0,30}$ ]] || sf_die "The label may only contain lower case letters and hyphens."

backup_dir="${BACKUP_DIR:-/backups}"
volumes_dir="${BACKUP_VOLUMES_DIR:-/volumes}"
poll_seconds="${BACKUP_LIVE_POLL_SECONDS:-300}"
sf_settings_load
remote_base="${remote%/}"
# Media are copied, not archived, so the dated folders only hold what changes: the database and the small volumes.
archive_volumes="keys caddy_data"
# Folders labelled auto are removed by the retention; nothing else is (manual and pre-restore backups stay until somebody
# deletes them).
readonly AUTO_NAME_PATTERN='^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}_auto(-[0-9]+)?$'

sf_load_database_password

# Only one run at a time (the schedule, a command started with docker compose run, the Regie). The lock lives in the volume of
# the backups, which every container of this service shares.
mkdir -p "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || sf_die "Another backup run is in progress."

umask 077
# DROP DATABASE IF EXISTS would print a NOTICE every time.
export PGOPTIONS="-c client_min_messages=warning"

step="start" failure="" target="" name="" kept=false finished=false
age_args=()

# Records the reason and stops; on_exit writes it to the status file.
fail() {
	failure="$*"
	sf_die "$*"
}

on_exit() {
	local code=$?
	if [ "$finished" != true ]; then
		# An unfinished folder is removed; a complete one stays, even if a later step failed.
		if [ "$kept" != true ] && [ -n "$target" ]; then
			rm -rf "$target"
			sf_warn "The incomplete backup was removed."
		fi
		psql -d postgres -q -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" >/dev/null 2>&1 || true
		sf_status_update '.state = "idle" | .postponedSince = null | .lastAttempt = {at: $now, ok: false, message: $message}' \
			--arg message "$(sf_status_text "${failure:-Stopped unexpectedly in step: $step (exit code $code). See: docker compose logs backup}")" || true
	fi
}
trap on_exit EXIT
trap 'exit 143' TERM INT

# --- broadcast lock ---------------------------------------------------------------------------------------------

# live | idle | unknown, from the same fact as the API command broadcast-status: a production whose broadcast is live.
broadcast_state() {
	local answer
	answer="$(psql -tA -c "SELECT EXISTS (SELECT 1 FROM productions WHERE lower(broadcast) = 'live')" 2>/dev/null | tr -d '\r')" || answer=""
	case "$answer" in
		t) echo live ;;
		f) echo idle ;;
		*) echo unknown ;;
	esac
}

# The media archive loads disk and CPU, so nothing runs while a production is on air; the run waits for the end.
wait_for_idle() {
	local state announced=false
	step="broadcast check"
	while true; do
		state="$(broadcast_state)"
		case "$state" in
			live)
				if [ "$announced" != true ]; then
					sf_info "A broadcast is live: the backup is postponed until it has ended (checking every ${poll_seconds} s)."
					announced=true
				fi
				sf_status_update '.state = "postponed" | .postponedSince //= $now'
				sleep "$poll_seconds" &
				wait $! # a signal interrupts a wait, but not a foreground sleep
				;;
			idle) return 0 ;;
			*)
				# Without an answer the broadcast state is unknown. Missing a backup is worse than a short load.
				sf_warn "The broadcast state could not be read; the backup runs anyway."
				return 0
				;;
		esac
	done
}

# --- the backup -------------------------------------------------------------------------------------------------

# Folders left behind by a run that was killed (no checksum file) are removed; they are never restorable. Only one job runs at
# a time (the lock), so a folder without checksums is never one that is being written.
remove_incomplete() {
	local dir
	for dir in "$backup_dir"/*/; do
		[ -d "$dir" ] || continue
		[[ "$(basename "$dir")" =~ $SF_BACKUP_NAME_PATTERN ]] || continue
		[ -f "${dir}${SF_CHECKSUMS}" ] || rm -rf "$dir"
	done
}

# Names of the complete folders of this service, one per line.
list_auto_names() {
	local sums folder
	for sums in "$backup_dir"/*/"$SF_CHECKSUMS"; do
		[ -f "$sums" ] || continue
		folder="$(basename "$(dirname "$sums")")"
		[[ "$folder" =~ $AUTO_NAME_PATTERN ]] && printf '%s\n' "$folder"
	done
	return 0
}

# tar of a volume; one retry, because files of caddy_data can vanish while they are read.
archive_volume() {
	local volume="$1" attempt
	for attempt in 1 2; do
		tar -czf "$target/$volume.tar.gz" -C "$volumes_dir/$volume" . && return 0
		sf_warn "The archive of $volume failed (attempt $attempt of 2)."
		sleep 5
	done
	return 1
}

# The dump must load into an empty database and contain the schema; a backup that does not is no backup.
verify_dump() {
	local report
	psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" -c "CREATE DATABASE $SF_VERIFY_DB" ||
		fail "The throwaway database for the verification could not be created."
	if ! pg_restore -d "$SF_VERIFY_DB" --no-owner --no-privileges --exit-on-error "$target/$SF_DB_DUMP"; then
		psql -d postgres -q -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" >/dev/null 2>&1 || true
		fail "The new dump cannot be loaded (pg_restore failed). The backup was discarded."
	fi
	report="$(psql -d "$SF_VERIFY_DB" -tA -c "$SF_VERIFY_QUERY" | tr -d '\r')" || report=""
	psql -d postgres -q -c "DROP DATABASE IF EXISTS $SF_VERIFY_DB" >/dev/null 2>&1 || true
	[ -n "$report" ] || fail "The new dump loads, but the database is empty. The backup was discarded."
	sf_info "Verified: the dump loads ($report)."
}

create_backup() {
	local volume postgres_version bytes file archives=()
	target="$(sf_backup_unique_dir "$backup_dir" "$(date '+%Y-%m-%d_%H%M')_$label")"
	name="$(basename "$target")"
	mkdir "$target"
	sf_step "Backing up to $target"

	step="database dump"
	sf_info "Database (pg_dump) ..."
	pg_dump -Fc -f "$target/$SF_DB_DUMP" || fail "pg_dump failed."
	postgres_version="$(psql -tAc 'SHOW server_version' 2>/dev/null | tr -d '\r' || true)"

	for volume in $archive_volumes; do
		step="archive of $volume"
		sf_info "Volume $volume ..."
		archive_volume "$volume" || fail "The archive for $volume could not be created."
		archives+=("$volume.tar.gz")
	done

	step="verification"
	verify_dump

	step="checksums"
	sf_backup_write_info "$target/$SF_BACKUP_INFO" "" "" "$postgres_version" "$SF_DB_DUMP" "${archives[@]}"
	sf_backup_write_checksums "$target" "$SF_DB_DUMP" "${archives[@]}" "$SF_BACKUP_INFO"
	kept=true

	bytes=0
	for file in "$target"/*; do bytes=$((bytes + $(stat -c %s "$file"))); done
	sf_status_update '.state = "idle" | .postponedSince = null | .lastAttempt = {at: $now, ok: true, message: null}
		| .lastSuccess = {at: $now, name: $name, bytes: ($bytes | tonumber)}' --arg name "$name" --arg bytes "$bytes"
	sf_info "Backup complete: $name ($bytes bytes)."
}

# Retention of the local folders: the newest backup of each of the last BACKUP_KEEP_DAILY days and of the last
# BACKUP_KEEP_WEEKLY weeks.
prune_local() {
	local expired old
	step="retention"
	# The folder of this run is the newest, whatever its name sorts like (a name is reused in the minute after the older
	# folder of it was pruned), so it is never listed.
	expired="$(list_auto_names | sf_backup_expired "$keep_daily" "$keep_weekly" "$name" || true)"
	for old in $expired; do
		rm -rf "${backup_dir:?}/$old"
		sf_info "Old backup removed: $old"
	done
}

# Incremental copy of the media next to the dated folders: files are immutable (name = asset id), so only files that
# are not there yet are copied, and nothing is deleted when an asset is removed in the Regie. *.part are uploads in
# progress.
copy_media_local() {
	step="media copy"
	[ -d "$volumes_dir/media" ] || return 0
	sf_info "Media (new files to $backup_dir/media) ..."
	rclone copy "$volumes_dir/media" "$backup_dir/media" --ignore-existing --exclude '*.part' --transfers 2 --checkers 4 -q
}

# --- off-site copy ----------------------------------------------------------------------------------------------

# Uploads one file: encrypted with age (streamed, so nothing is staged on disk) or as it is.
offsite_put() {
	local source="$1" destination="$2"
	if [ ${#age_args[@]} -gt 0 ]; then
		age "${age_args[@]}" <"$source" | rclone rcat "$destination.age"
	else
		rclone copyto "$source" "$destination"
	fi
}

# Media that the remote does not have yet. Plain: rclone decides. Encrypted: every file is a separate .age object, so
# the remote listing decides (the encrypted copy of a file never changes, the file does not either).
offsite_media() {
	local listing rc=0 relative path
	declare -A known=()
	if [ ${#age_args[@]} -eq 0 ]; then
		rclone copy "$volumes_dir/media" "$remote_base/media" --ignore-existing --exclude '*.part' --transfers 2 --checkers 4 -q
		return
	fi
	listing="$(rclone lsf -R --files-only "$remote_base/media" 2>/dev/null)" || rc=$?
	# Exit code 3: the folder does not exist yet (first run).
	[ "$rc" -eq 0 ] || [ "$rc" -eq 3 ] || return 1
	while IFS= read -r relative; do [ -z "$relative" ] || known["$relative"]=1; done <<<"$listing"
	while IFS= read -r path; do
		relative="${path#"$volumes_dir"/media/}"
		[ -z "${known["$relative.age"]:-}" ] || continue
		offsite_put "$path" "$remote_base/media/$relative" || return 1
		sf_info "Uploaded media/$relative"
	done < <(find "$volumes_dir/media" -type f ! -name '*.part' 2>/dev/null)
}

# The same retention as on this server. Deleting needs permission at the remote; where the access is append-only, this
# only warns (use a lifecycle rule of the storage then).
offsite_prune() {
	local expired old
	expired="$(rclone lsf -R --files-only --include "/*/$SF_CHECKSUMS" "$remote_base" 2>/dev/null | sed "s#/$SF_CHECKSUMS\$##" |
		grep -E "$AUTO_NAME_PATTERN" | sf_backup_expired "$keep_daily" "$keep_weekly" "$name" || true)"
	for old in $expired; do
		if rclone purge "$remote_base/$old" -q; then
			sf_info "Old off-site backup removed: $old"
		else
			sf_warn "Off-site backup $old could not be removed (no permission to delete?)."
		fi
	done
}

# The dated folder first, SHA256SUMS last: a folder without it is not complete.
offsite_copy() {
	local file
	step="off-site copy"
	[ -n "$remote" ] || return 0
	sf_step "Off-site copy ($([ ${#age_args[@]} -gt 0 ] && echo encrypted with age || echo NOT encrypted))"
	for file in "$target"/*; do
		file="$(basename "$file")"
		[ "$file" != "$SF_CHECKSUMS" ] || continue
		offsite_put "$target/$file" "$remote_base/$name/$file" || return 1
	done
	rclone copyto "$target/$SF_CHECKSUMS" "$remote_base/$name/$SF_CHECKSUMS" || return 1
	offsite_media || return 1
	offsite_prune
	sf_info "Off-site copy complete: $name"
}

# --- run --------------------------------------------------------------------------------------------------------

main() {
	local problems="" recipient

	if [ -n "$remote" ] && [ -n "$recipients" ]; then
		for recipient in ${recipients//,/ }; do age_args+=(-r "$recipient"); done
	fi

	# rclone writes its configuration (tokens of some remotes are renewed) and the cache to /tmp; the settings volume is read-only.
	if [ -n "$remote" ] && [ -s "$SF_RCLONE_CONF" ]; then
		cp "$SF_RCLONE_CONF" "$RCLONE_CONFIG"
		chmod 600 "$RCLONE_CONFIG"
	fi

	sf_status_update '.state = "running" | .postponedSince = null'
	remove_incomplete
	if [ "$wait_for_broadcast" = true ]; then
		wait_for_idle
	elif [ "$(broadcast_state)" = live ]; then
		sf_warn "A broadcast is live. The backup runs anyway because it was asked for."
	fi
	create_backup
	[ "$label" != auto ] || prune_local

	if ! copy_media_local; then
		problems="The media could not be copied. "
	fi
	# The safety backup before a restore is not worth an upload.
	if [ -n "$remote" ] && [ "$label" != pre-restore ]; then
		if offsite_copy; then
			sf_status_update '.offsite.lastAttempt = {at: $now, ok: true, message: null} | .offsite.lastSuccess = {at: $now, name: $name}' --arg name "$name"
		else
			sf_status_update '.offsite.lastAttempt = {at: $now, ok: false, message: $message}' \
				--arg message "The off-site copy failed in step: $step. See: docker compose logs backup"
			problems="${problems}The off-site copy failed. "
		fi
	fi

	finished=true
	sf_status_backups "$backup_dir" || true
	if [ -n "$problems" ]; then
		sf_status_update '.lastAttempt = {at: $now, ok: false, message: $message}' --arg message "$(sf_status_text "${problems}The backup folder $name is complete. See: docker compose logs backup")"
		sf_die "${problems% }"
	fi
	sf_step "Done"
}

main "$@"
