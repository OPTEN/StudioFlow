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
#
# Needs jq and common.sh. BACKUP_STATUS_DIR is the folder of the file (default /status).

SF_STATUS_FILE="${BACKUP_STATUS_DIR:-/status}/backup-status.json"

# UTC time stamp as the API reads it.
sf_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# sf_status_update JQ_FILTER [jq options]: applies a jq filter to the status file ($now is always defined).
sf_status_update() {
	local filter="$1" tmp
	shift
	tmp="$(mktemp "$(dirname "$SF_STATUS_FILE")/.status.XXXXXX")"
	if jq --arg now "$(sf_now)" "$@" "$filter" "$SF_STATUS_FILE" >"$tmp"; then
		chmod 644 "$tmp" # the API runs as another user
		mv -f "$tmp" "$SF_STATUS_FILE"
	else
		rm -f "$tmp"
		return 1
	fi
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
