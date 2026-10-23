#!/usr/bin/env bash
# Entry point of the backup service: checks the settings, prepares rclone, writes the status file and starts supercronic.
# A wrong setting stops the container at once with a message that names the variable (like the required variables of
# docker-compose.yml), instead of failing at three in the morning.
set -euo pipefail

SF_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$SF_HOME/common.sh"
# shellcheck source=infra/backup/status.sh
. "$SF_HOME/status.sh"

schedule="${BACKUP_SCHEDULE:-}"
remote="${BACKUP_RCLONE_REMOTE:-}"
recipients="${BACKUP_AGE_RECIPIENT:-}"
keep_daily="${BACKUP_KEEP_DAILY:-7}"
keep_weekly="${BACKUP_KEEP_WEEKLY:-4}"
crontab=/tmp/crontab

[[ "$keep_daily" =~ ^[1-9][0-9]*$ ]] || sf_die "BACKUP_KEEP_DAILY must be a number of 1 or more."
[[ "$keep_weekly" =~ ^[1-9][0-9]*$ ]] || sf_die "BACKUP_KEEP_WEEKLY must be a number of 1 or more."
[[ "${BACKUP_LIVE_POLL_SECONDS:-300}" =~ ^[1-9][0-9]*$ ]] || sf_die "BACKUP_LIVE_POLL_SECONDS must be a number of 1 or more."
[[ "${BACKUP_OFFSITE_UNENCRYPTED:-false}" =~ ^(true|false)$ ]] || sf_die "BACKUP_OFFSITE_UNENCRYPTED must be true or false."
# The schedule becomes a line of the crontab: no line breaks, no shell characters.
[[ -z "$schedule" || "$schedule" =~ ^[-0-9A-Za-z@*/,\ ]+$ ]] || sf_die "BACKUP_SCHEDULE may only contain letters, digits and - * / , @ and spaces."

# --- optional second target -------------------------------------------------------------------------------------

encrypted=false
if [ -n "$remote" ]; then
	if [ -n "$recipients" ]; then
		for recipient in ${recipients//,/ }; do
			[[ "$recipient" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] ||
				sf_die "BACKUP_AGE_RECIPIENT must list public age keys (age1...), separated by spaces or commas."
		done
		encrypted=true
	elif [ "${BACKUP_OFFSITE_UNENCRYPTED:-false}" != true ]; then
		sf_die "BACKUP_RCLONE_REMOTE is set without BACKUP_AGE_RECIPIENT. The backup holds private keys: encrypt the off-site copy, or set BACKUP_OFFSITE_UNENCRYPTED=true if the remote encrypts it itself."
	fi
	if [ -n "${BACKUP_RCLONE_CONFIG:-}" ]; then
		if ! { printf '%s' "$BACKUP_RCLONE_CONFIG" | base64 -d >"$RCLONE_CONFIG" 2>/dev/null && grep -q '^\[' "$RCLONE_CONFIG"; }; then
			sf_die "BACKUP_RCLONE_CONFIG is not the base64 text of an rclone.conf."
		fi
		chmod 600 "$RCLONE_CONFIG"
	fi
	# A remote of the form name:path must exist in the configuration (a path or a connection string needs none).
	if [[ "$remote" =~ ^([A-Za-z0-9_.-]+): ]]; then
		rclone listremotes 2>/dev/null | grep -qx "${BASH_REMATCH[1]}:" ||
			sf_die "The rclone remote '${BASH_REMATCH[1]}' of BACKUP_RCLONE_REMOTE is not defined in BACKUP_RCLONE_CONFIG."
	fi
fi

# --- status and schedule ----------------------------------------------------------------------------------------

sf_status_init "$schedule" "$([ -n "$remote" ] && echo true || echo false)" "$encrypted"

if [ -n "$schedule" ]; then
	printf '%s %s\n' "$schedule" "$SF_HOME/backup-job.sh" >"$crontab"
	supercronic -test "$crontab" >/dev/null 2>&1 || sf_die "BACKUP_SCHEDULE is not a valid cron expression: $schedule"
	sf_info "Automatic backups: '$schedule' (time zone ${TZ:-UTC}); keep $keep_daily daily and $keep_weekly weekly."
	if [ -z "$remote" ]; then
		sf_warn "No off-site target (BACKUP_RCLONE_REMOTE): the backups stay on this server."
	elif [ "$encrypted" = true ]; then
		sf_info "Off-site copy: encrypted with age."
	else
		sf_warn "Off-site copy: NOT encrypted by StudioFlow (BACKUP_OFFSITE_UNENCRYPTED=true)."
	fi
else
	: >"$crontab"
	sf_info "BACKUP_SCHEDULE is empty: automatic backups are off. Set it in .env (for example '0 3 * * *') and run: docker compose up -d"
fi

exec supercronic -passthrough-logs "$crontab"
