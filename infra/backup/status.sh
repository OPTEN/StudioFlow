# shellcheck shell=bash
# shellcheck disable=SC2016 # the jq filters use jq variables ($now, $name ...), which must not expand in the shell
# Status file of the backup service, sourced by entrypoint.sh and backup-job.sh. The API reads it for the readiness
# check (/health/ready, apps/api/src/Opten.StudioFlow.Infrastructure/Backup) and only ever reads it; this service is
# the only writer. Every change is written to a temporary file and moved into place, so a reader never sees half a file.
#
#   version      1
#   createdAt    when the file was first written (never reset): the base of "no backup yet" in the API
#   startedAt    when the service last started
#   schedule     BACKUP_SCHEDULE, empty when automatic backups are off
#   state        idle | running | postponed (a broadcast is live)
#   postponedSince  since when the run has been waiting for the end of the broadcast
#   lastAttempt  { at, ok, message } of the last finished run (message: why it failed)
#   lastSuccess  { at, name, bytes } of the last complete, verified backup folder
#   offsite      { configured, encrypted, lastAttempt, lastSuccess } of the optional second target
#   settingsSha256  SHA-256 of the backup-settings.json this service runs (the API compares it with the file it wrote)
#   settingsError   why the settings cannot be used (the schedule is off then), or null
#   backups      the newest complete backup folders: [{ name, at, bytes, kind (auto | manual | other) }]
#
# Needs jq and common.sh. BACKUP_STATUS_DIR is the folder of the file (default /status). The scheduler and the commands of
# this image (docker compose run) write it, so every change is made under a lock.

SF_STATUS_FILE="${BACKUP_STATUS_DIR:-/status}/backup-status.json"

# UTC time stamp as the API reads it.
sf_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# sf_status_update JQ_FILTER [jq options]: applies a jq filter to the status file ($now is always defined). Several processes
# update the file (the scheduler, a backup job, a command started with docker compose run), so one change at a time.
sf_status_update() {
	local filter="$1" tmp
	shift
	(
		flock 8
		tmp="$(mktemp "$(dirname "$SF_STATUS_FILE")/.status.XXXXXX")"
		if jq --arg now "$(sf_now)" "$@" "$filter" "$SF_STATUS_FILE" >"$tmp"; then
			chmod 644 "$tmp" # the API runs as another user
			mv -f "$tmp" "$SF_STATUS_FILE"
		else
			rm -f "$tmp"
			exit 1
		fi
	) 8>"$(dirname "$SF_STATUS_FILE")/.status.lock"
}

# Creates the file on the first start and records the settings of this start. A run that was cut off by a restart
# is not "running" any more.
sf_status_init() {
	local schedule="$1" configured="$2" encrypted="$3"
	if [ ! -s "$SF_STATUS_FILE" ]; then
		printf '{"version":1,"createdAt":"%s","state":"idle","lastAttempt":null,"lastSuccess":null,"offsite":{"lastAttempt":null,"lastSuccess":null}}\n' "$(sf_now)" >"$SF_STATUS_FILE"
		chmod 644 "$SF_STATUS_FILE"
	fi
	sf_status_update '.startedAt = $now | .schedule = $schedule | .state = "idle" | .postponedSince = null
		| .offsite.configured = ($configured == "true") | .offsite.encrypted = ($encrypted == "true")' \
		--arg schedule "$schedule" --arg configured "$configured" --arg encrypted "$encrypted"
}

# A message for the status file: one line of at most 300 characters (jq escapes the rest).
sf_status_text() {
	printf '%s' "$*" | tr '\r\n\t' '   ' | cut -c1-300
}

# Lists the newest complete backup folders of $1 in the status file (at most 20, newest first). The kind comes from the label of
# the folder name; the size is the sum of its files. Folders without SHA256SUMS are not complete and not listed.
sf_status_backups() {
	local base="$1" sums dir name bytes at kind entries="[]" count=0
	while IFS= read -r sums; do
		dir="$(dirname "$sums")"
		name="$(basename "$dir")"
		[[ "$name" =~ $SF_BACKUP_NAME_PATTERN ]] || continue
		bytes="$(find "$dir" -type f -exec stat -c %s {} + | awk '{ total += $1 } END { print total + 0 }')"
		at="$(date -u -r "$sums" '+%Y-%m-%dT%H:%M:%SZ')"
		case "$name" in
			*_auto | *_auto-*) kind=auto ;;
			*_manual | *_manual-*) kind=manual ;;
			*) kind=other ;;
		esac
		entries="$(jq -c --arg name "$name" --arg at "$at" --arg bytes "$bytes" --arg kind "$kind" '. + [{name: $name, at: $at, bytes: ($bytes | tonumber), kind: $kind}]' <<<"$entries")"
		count=$((count + 1))
		[ "$count" -lt 20 ] || break
	done < <(ls -1t "$base"/*/"$SF_CHECKSUMS" 2>/dev/null)
	sf_status_update '.backups = ($entries | fromjson)' --arg entries "$entries"
}
