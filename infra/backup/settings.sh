# shellcheck shell=bash
# shellcheck disable=SC2034 # the variables are used by the sourcing scripts
# Settings of the backup service. Sourced, never executed. The StudioFlow API writes backup-settings.json (server settings,
# "Backups") and rclone.conf into the volume backup_config; this service and the commands of this image read them:
#
#   {"version":1,"schedule":"0 3 * * *","timezone":"Europe/Zurich","keepDaily":7,"keepWeekly":4,
#    "offsite":{"remote":"offsite:bucket","ageRecipients":["age1..."],"unencrypted":false,"rcloneConfigSha256":"..."}}
#
# Without the file everything is off and the retention has its defaults. Needs jq.

SF_CONFIG_DIR="${BACKUP_CONFIG_DIR:-/config}"
SF_SETTINGS_FILE="$SF_CONFIG_DIR/backup-settings.json"
SF_RCLONE_CONF="$SF_CONFIG_DIR/rclone.conf"

# Reads the file into schedule, timezone, keep_daily, keep_weekly, remote, recipients (space separated) and unencrypted.
# jq's @sh quotes every value for the shell, so the eval below cannot run anything from the file.
sf_settings_load() {
	schedule="" timezone="" keep_daily=7 keep_weekly=4 remote="" recipients="" unencrypted=false
	[ -s "$SF_SETTINGS_FILE" ] || return 0
	eval "$(jq -r '
		"schedule=" + ((.schedule // "") | @sh),
		"timezone=" + ((.timezone // "") | @sh),
		"keep_daily=" + ((.keepDaily // 7) | tostring | @sh),
		"keep_weekly=" + ((.keepWeekly // 4) | tostring | @sh),
		"remote=" + ((.offsite.remote // "") | @sh),
		"recipients=" + (((.offsite.ageRecipients // []) | join(" ")) | @sh),
		"unencrypted=" + ((.offsite.unencrypted // false) | tostring | @sh)
	' "$SF_SETTINGS_FILE")" || sf_die "$SF_SETTINGS_FILE cannot be read."
}

# SHA-256 of the settings file, or empty when there is none.
sf_settings_hash() {
	[ -s "$SF_SETTINGS_FILE" ] || return 0
	sha256sum "$SF_SETTINGS_FILE" | cut -d' ' -f1
}

# Checks the loaded settings. Prints the first problem and returns 1.
sf_settings_check() {
	[[ "$keep_daily" =~ ^[1-9][0-9]*$ ]] || { echo "keepDaily must be a number of 1 or more."; return 1; }
	[[ "$keep_weekly" =~ ^[1-9][0-9]*$ ]] || { echo "keepWeekly must be a number of 1 or more."; return 1; }
	[[ "${BACKUP_LIVE_POLL_SECONDS:-300}" =~ ^[1-9][0-9]*$ ]] || { echo "BACKUP_LIVE_POLL_SECONDS must be a number of 1 or more."; return 1; }
	# The schedule becomes a line of the crontab: no line breaks, no shell characters.
	[[ -z "$schedule" || "$schedule" =~ ^[-0-9A-Za-z@*/,\ ]+$ ]] || { echo "The schedule may only contain letters, digits and - * / , @ and spaces."; return 1; }
	[[ -z "$timezone" || -e "/usr/share/zoneinfo/$timezone" ]] || { echo "The time zone '$timezone' is unknown."; return 1; }
	if [ -n "$remote" ]; then
		local name="${remote%%:*}"
		if [ -n "$recipients" ]; then
			local recipient
			for recipient in $recipients; do
				[[ "$recipient" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || { echo "The off-site copy needs public age keys (age1...)."; return 1; }
			done
		elif [ "$unencrypted" != true ]; then
			echo "The off-site copy holds private keys: it needs a public age key, or the statement that the remote encrypts it."
			return 1
		fi
		if [ -s "$SF_RCLONE_CONF" ]; then
			RCLONE_CONFIG="$SF_RCLONE_CONF" rclone listremotes 2>/dev/null | grep -qx "$name:" || { echo "The rclone remote '$name' is not defined in the rclone configuration."; return 1; }
		else
			echo "The off-site copy needs an rclone configuration."
			return 1
		fi
	fi
}
