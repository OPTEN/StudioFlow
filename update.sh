#!/usr/bin/env bash
# StudioFlow update: refuses while a broadcast is live, then git pull --ff-only, rebuild, restart and health wait.
# Same behaviour as update.ps1. ./update.sh --help for the options.
#
# The whole script runs inside main(): `git pull` may replace this file while it runs, and bash reads scripts
# incrementally - the last line is parsed completely before main starts.
set -euo pipefail

SF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$SF_ROOT/infra/scripts/common.sh"

usage() {
	cat <<'EOF'
Update StudioFlow: fetch the new version, build the images, restart the stack. Never during a broadcast.

Usage: ./update.sh [options]

  --backup      back up first (./backup.sh --label pre-update)
  --no-pull     no git pull, only rebuild and restart (e.g. after a change to .env)
  --force       even if a broadcast is live or the broadcast status is unknown (the picture will drop out)
  -h, --help    this help

Sequence: check the broadcast status (API: broadcast-status) -> optional backup -> git pull --ff-only ->
docker compose up -d --build -> wait until all services are healthy -> show the status. Volumes are kept.
EOF
}

main() {
	local backup=false pull=true force=false
	while [ $# -gt 0 ]; do
		case "$1" in
			--backup) backup=true ;;
			--no-pull) pull=false ;;
			--force) force=true ;;
			-h | --help)
				usage
				return 0
				;;
			*) sf_die "Unknown option: $1 (see --help)." ;;
		esac
		shift
	done

	sf_require_docker
	sf_require_env_file

	sf_step "Check the broadcast status"
	sf_guard_broadcast "The update" "$force"

	if [ "$backup" = true ]; then
		sf_step "Back up before the update"
		bash "$SF_ROOT/backup.sh" --label pre-update || sf_die "The backup failed; update aborted."
	fi

	if [ "$pull" = true ]; then
		sf_step "Pull the new version (git pull --ff-only)"
		sf_git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
			sf_die "$SF_ROOT is not a Git working directory. Apply the new version by hand and run ./update.sh --no-pull."
		local before after
		before="$(sf_git rev-parse --short HEAD)"
		sf_git pull --ff-only ||
			sf_die "git pull --ff-only failed (local changes or diverged history). Nothing was restarted."
		after="$(sf_git rev-parse --short HEAD)"
		if [ "$before" = "$after" ]; then
			sf_info "Already up to date ($after); the images are rebuilt and checked anyway."
		else
			sf_info "Updated: $before -> $after"
		fi
	fi

	sf_step "Build the images and restart the stack"
	sf_compose config --quiet ||
		sf_die "The configuration is invalid - is a new variable missing? Compare .env with .env.example."
	sf_up_and_wait --build --remove-orphans

	sf_step "Status"
	sf_compose ps
	sf_info "Update complete."
}

{ main "$@"; exit; }
