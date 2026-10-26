#!/usr/bin/env bash
# Scheduler of the backup service (the default command of the image). It follows the server settings: the StudioFlow API
# writes backup-settings.json (schedule, time zone, retention, off-site target) and rclone.conf into the volume backup_config;
# this script reads them, builds the crontab for supercronic and starts it again when the settings change. It also runs the
# backup that "Back up now" in the Regie asks for (a file backup-now with a new token in the same volume).
#
# A setting that cannot be used (an unknown time zone, a remote that the rclone configuration does not define) switches the
# schedule off and says why in the status file (settingsError) and in the log, instead of failing at three in the morning.
# Texts are English and ASCII only.
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

backup_dir="${BACKUP_DIR:-/backups}"
crontab=/tmp/crontab
request_file="$SF_CONFIG_DIR/backup-now"
poll_seconds=2
cron_pid=""
applied_hash="unset"
handled_request=""

sf_load_database_password
mkdir -p "$backup_dir"

stop_cron() {
	if [ -n "$cron_pid" ] && kill -0 "$cron_pid" 2>/dev/null; then
		kill -TERM "$cron_pid" 2>/dev/null || true
		wait "$cron_pid" 2>/dev/null || true
	fi
	cron_pid=""
}

on_signal() {
	stop_cron
	exit 0
}
trap on_signal TERM INT

# Reads the settings and (re)starts supercronic with the schedule. Never fails: a problem is reported, the service stays up.
apply_settings() {
	local problem="" encrypted=false
	sf_settings_load
	if ! problem="$(sf_settings_check)"; then
		sf_warn "The backup settings cannot be used: $problem"
		schedule="" remote=""
	fi
	applied_hash="$(sf_settings_hash)"

	stop_cron
	: >"$crontab"
	if [ -n "$schedule" ]; then
		printf '%s %s --label auto\n' "$schedule" "$SF_HOME/backup-job.sh" >"$crontab"
		if ! supercronic -test "$crontab" >/dev/null 2>&1; then
			problem="The schedule is not a valid cron expression: $schedule"
			sf_warn "$problem"
			schedule=""
			: >"$crontab"
		fi
	fi

	if [ -n "$remote" ] && [ -n "$recipients" ]; then
		encrypted=true
	fi
	sf_status_init "$schedule" "$([ -n "$remote" ] && echo true || echo false)" "$encrypted"
	sf_status_update '.settingsSha256 = $hash | .settingsError = (if $problem == "" then null else $problem end)' --arg hash "$applied_hash" --arg problem "$problem"

	if [ -n "$schedule" ]; then
		sf_info "Automatic backups: '$schedule' (time zone ${timezone:-UTC}); keep $keep_daily daily and $keep_weekly weekly."
		if [ -z "$remote" ]; then
			sf_warn "No off-site target: the backups stay on this server."
		elif [ "$encrypted" = true ]; then
			sf_info "Off-site copy: encrypted with age."
		else
			sf_warn "Off-site copy: NOT encrypted by StudioFlow (the remote encrypts it)."
		fi
		TZ="${timezone:-UTC}" supercronic -passthrough-logs "$crontab" &
		cron_pid=$!
	else
		sf_info "Automatic backups are off. Switch them on in the Regie (Server settings, Backups) or run: docker compose run --rm backup backup-now"
	fi
	sf_status_backups "$backup_dir" || true
}

# "Back up now": the API writes a new token into backup-now; every token is run once (the status file remembers the last one,
# so a restart of this service does not repeat an old request).
handle_request() {
	local token
	[ -s "$request_file" ] || return 0
	token="$(tr -d '\r\n' <"$request_file")"
	[ -n "$token" ] && [ "$token" != "$handled_request" ] || return 0
	handled_request="$token"
	sf_status_update '.handledRequest = $token' --arg token "$token"
	if ! flock -n "$backup_dir/.backup.lock" true; then
		sf_info "A backup is running already: the request of the Regie is covered by it."
		return 0
	fi
	sf_info "Backup requested in the Regie."
	TZ="${timezone:-UTC}" "$SF_HOME/backup-job.sh" --label manual --now &
	job_pid=$!
}

job_pid=""
sf_settings_load
if [ -s "$SF_STATUS_FILE" ]; then
	handled_request="$(jq -r '.handledRequest // ""' "$SF_STATUS_FILE" 2>/dev/null || true)"
fi

while true; do
	if [ "$(sf_settings_hash)" != "$applied_hash" ]; then
		apply_settings
	elif [ -n "$schedule" ] && { [ -z "$cron_pid" ] || ! kill -0 "$cron_pid" 2>/dev/null; }; then
		sf_warn "The scheduler stopped; starting it again."
		apply_settings
	fi

	handle_request
	if [ -n "$job_pid" ] && ! kill -0 "$job_pid" 2>/dev/null; then
		wait "$job_pid" 2>/dev/null || true
		job_pid=""
	fi

	sleep "$poll_seconds" &
	wait $! # a signal interrupts a wait, but not a foreground sleep
done
