#!/usr/bin/env bash
# Entry point of the backup image. Without a command it runs the scheduler of the backup service; the other commands are
# for the operator and run in their own container (docker compose run --rm backup <command>), the same on Linux, Windows and
# macOS:
#
#   serve                                    the scheduler (default): follows the server settings, runs the schedule and "Back up now"
#   backup-now                               one backup now (manual), including the off-site copy if one is configured
#   list                                     the backups of the volume, newest first
#   restore <backup> [--verify] [options]    restore a backup, or only check it (restore --help)
set -euo pipefail

SF_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/backup/common.sh
. "$SF_HOME/common.sh"
# shellcheck source=infra/backup/backup-core.sh
. "$SF_HOME/backup-core.sh"
# shellcheck source=infra/backup/settings.sh
. "$SF_HOME/settings.sh"

usage() {
	cat <<'EOF'
StudioFlow backup service.

Commands (docker compose run --rm backup <command>):
  backup-now                             back up now (database, keys, certificates, media; off-site copy if configured)
  list                                   list the backups, newest first
  restore BACKUP [--verify] [options]    restore a backup, or only check it with --verify (restore --help for the options)
  serve                                  the scheduler (what the service runs by default)

The schedule and the off-site target are set in the Regie: Server settings, Backups.
EOF
}

command="${1:-serve}"
[ $# -eq 0 ] || shift

case "$command" in
	serve)
		exec "$SF_HOME/serve.sh" "$@"
		;;
	backup-now)
		sf_settings_load
		# The folder names and the log use the time zone of the schedule.
		[ -z "$timezone" ] || export TZ="$timezone"
		"$SF_HOME/backup-job.sh" --label manual --now "$@"
		sf_info "Restore with: docker compose run --rm backup restore <folder>   (list the folders: docker compose run --rm backup list)"
		;;
	list)
		backup_dir="${BACKUP_DIR:-/backups}"
		found=false
		while IFS= read -r dir; do
			[[ "$(basename "$dir")" =~ $SF_BACKUP_NAME_PATTERN ]] || continue
			found=true
			printf '%s  %s\n' "$(basename "$dir")" "$(du -sh "$dir" | cut -f1)"
		done < <(sf_backup_list_newest_first "$backup_dir")
		[ "$found" = true ] || sf_info "There is no backup yet. Create one with: docker compose run --rm backup backup-now"
		;;
	restore)
		exec "$SF_HOME/restore.sh" "$@"
		;;
	-h | --help | help)
		usage
		;;
	*)
		usage >&2
		sf_die "Unknown command: $command"
		;;
esac
