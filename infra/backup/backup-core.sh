# shellcheck shell=bash
# Backup logic shared by the backup job, the restore command and the scheduler of the backup image. Sourced after common.sh,
# never executed. It works on folders only.
#
# Backup folder: <base>/YYYY-MM-DD_HHMM[_label][-N]/ with database.dump, one <volume>.tar.gz per archived volume,
# backup-info.txt and SHA256SUMS. A folder without SHA256SUMS is not complete and is never touched by retention. The label
# is auto (the schedule), manual (backup-now, the Regie) or pre-restore (the safety backup of restore); only auto folders
# are removed by the retention.

# Layout of a backup (volumes in archive order, files of the folder).
# shellcheck disable=SC2034 # used by the sourcing scripts
readonly SF_BACKUP_VOLUMES="media keys caddy_data" SF_DB_DUMP=database.dump SF_CHECKSUMS=SHA256SUMS SF_BACKUP_INFO=backup-info.txt

# Folder names written by the backup scripts: date, time, optional label, optional collision counter.
readonly SF_BACKUP_NAME_PATTERN='^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}'

# Verification (restore --verify, the backup job): the dump is loaded into this throwaway database of the running
# PostgreSQL, and the query must then report the tables and the newest EF Core migration (it prints nothing for an
# empty database). The query has no double quotes (chr(34) builds the identifiers), so no shell mangles it as an argument.
# shellcheck disable=SC2034 # used by the sourcing scripts
readonly SF_VERIFY_DB=studioflow_verify
# shellcheck disable=SC2034 # used by the sourcing scripts
readonly SF_VERIFY_QUERY="SELECT count(*) || ' tables, newest migration ' || coalesce((xpath('/row/m/text()', query_to_xml('SELECT max(' || chr(34) || 'MigrationId' || chr(34) || ') AS m FROM ' || chr(34) || '__EFMigrationsHistory' || chr(34), false, true, '')))[1]::text, 'none') FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' HAVING count(*) > 0"

# Hex SHA-256 of a file.
sf_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'
}

# Prints a folder path below $1 that does not exist yet: $1/$2, or $1/$2-2, $1/$2-3 ... when the minute is taken.
sf_backup_unique_dir() {
	local base="$1" name="$2" target suffix=2
	target="$base/$name"
	while [ -e "$target" ]; do
		target="$base/$name-$suffix"
		suffix=$((suffix + 1))
	done
	printf '%s\n' "$target"
}

# Writes backup-info.txt. $1 = file, $2 = project, $3 = git revision, $4 = PostgreSQL version, $5... = contents.
sf_backup_write_info() {
	local file="$1" project="$2" revision="$3" postgres_version="$4"
	shift 4
	{
		echo "StudioFlow backup"
		echo "created:   $(date '+%Y-%m-%d %H:%M:%S %z')"
		echo "host:      $(hostname 2>/dev/null || echo unknown)"
		echo "project:   ${project:-unknown}"
		echo "version:   ${SF_BACKUP_VERSION:-unknown}"
		echo "git:       ${revision:-unknown}"
		echo "postgres:  ${postgres_version:-unknown}"
		echo "contents:  $* "
	} >"$file"
}

# Writes SHA256SUMS for the given files of folder $1 (names relative to the folder).
sf_backup_write_checksums() {
	local dir="$1" file
	shift
	(
		cd "$dir" || exit 1
		for file in "$@"; do
			printf '%s  %s\n' "$(sf_sha256 "$file")" "$file"
		done >"$SF_CHECKSUMS"
	)
}

# Checks every file listed in SHA256SUMS of folder $1. Prints the problem and returns 1 on the first mismatch.
sf_backup_check_checksums() {
	local dir="$1" expected file
	while read -r expected file; do
		[ -n "$expected" ] || continue
		case "$file" in */* | ..*)
			printf 'Invalid entry in %s: %s\n' "$SF_CHECKSUMS" "$file"
			return 1
			;;
		esac
		if [ ! -f "$dir/$file" ]; then
			printf 'File listed in %s is missing: %s\n' "$SF_CHECKSUMS" "$file"
			return 1
		fi
		if [ "$(sf_sha256 "$dir/$file")" != "$expected" ]; then
			printf 'Checksum mismatch: %s (the backup is damaged)\n' "$file"
			return 1
		fi
	done <"$dir/$SF_CHECKSUMS"
}

# Complete backup folders below $1, newest first. Newest = checksum file written last: the names have minute
# resolution and labels, so they do not sort reliably.
sf_backup_list_newest_first() {
	local base="$1" sums dir
	# shellcheck disable=SC2012 # ls -t is the portable way to sort by mtime (GNU and BSD stat differ)
	while IFS= read -r sums; do
		dir="$(dirname "$sums")"
		[[ "$(basename "$dir")" =~ $SF_BACKUP_NAME_PATTERN ]] && printf '%s\n' "$dir"
	done < <(ls -1t "$base"/*/"$SF_CHECKSUMS" 2>/dev/null)
	return 0
}

# Keeps the newest $2 complete backups in $1 and deletes the others; $3 (optional) is never deleted.
sf_backup_prune_newest() {
	local base="$1" keep="$2" current="${3:-}" backups=() dir i
	while IFS= read -r dir; do backups+=("$dir"); done < <(sf_backup_list_newest_first "$base")
	for ((i = keep; i < ${#backups[@]}; i++)); do
		[ "${backups[i]}" = "$current" ] && continue
		rm -rf "${backups[i]}"
		sf_info "Old backup removed: $(basename "${backups[i]}")"
	done
}

# Retention by days and weeks. Reads backup folder names (one per line, any order) and prints the names to delete.
#   $1 = number of days to keep   - the newest backup of each of the last $1 days that have a backup
#   $2 = number of weeks to keep  - the newest backup of each of the last $2 ISO weeks that have a backup
# Counting days and weeks that have a backup (not calendar days) keeps the promised history after a pause. Names that
# do not start with a date are ignored, so a foreign folder is never listed.
sf_backup_expired() {
	local keep_days="$1" keep_weeks="$2" name day week keep
	local days=0 weeks=0 last_day="" last_week=""
	# Newest first, so the first name of a day is the newest of that day and the first name of a week the newest of it.
	sort -r | while IFS= read -r name; do
		[[ "$name" =~ $SF_BACKUP_NAME_PATTERN ]] || continue
		day="${name:0:10}"
		if [ "$day" = "$last_day" ]; then
			printf '%s\n' "$name" # an older backup of a day that is already represented
			continue
		fi
		last_day="$day"
		keep=false
		if [ "$days" -lt "$keep_days" ]; then
			days=$((days + 1))
			keep=true
		fi
		week="$(date -d "$day" '+%G-%V')"
		if [ "$week" != "$last_week" ]; then
			last_week="$week"
			if [ "$weeks" -lt "$keep_weeks" ]; then
				weeks=$((weeks + 1))
				keep=true
			fi
		fi
		[ "$keep" = true ] || printf '%s\n' "$name"
	done
}
