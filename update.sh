#!/usr/bin/env bash
# StudioFlow update: refuses while a broadcast is live, then fetches the new version (ready-made images, or git pull
# and a local build), restarts the stack and waits for the health checks.
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
Update StudioFlow: fetch the new version and restart the stack. Never during a broadcast.

Usage: ./update.sh [options]

  --backup        back up first (./backup.sh --label pre-update)
  --version V     ready-made images only: the version to run - 0.4.2 (a release; also the way back to an earlier
                  one), latest (the newest release, default), main or sha-1a2b3c4. Written to .env as
                  STUDIOFLOW_IMAGE_TAG, so the stack keeps this version.
  --no-pull       fetch nothing (no git pull, no image pull), only restart (e.g. after a change to .env)
  --force         even if a broadcast is live or the broadcast status is unknown (the picture will drop out)
  -h, --help      this help

Sequence with ready-made images (docker-compose.release.yml, a release installation): check the broadcast status
(API: broadcast-status) -> optional backup -> docker compose pull -> docker compose up -d -> wait until all services
are healthy -> show the status.
Sequence when building from the source (a Git checkout with docker-compose.yml): check the broadcast status ->
optional backup -> git pull --ff-only -> docker compose up -d --build -> wait until all services are healthy -> show
the status. Volumes are kept in both cases.
EOF
}

# Ready-made images: pull the version, keep it in .env, restart.
update_images() {
	local version="$1" pull="$2" resolved="" previous api_image label repo_url bundle=""
	sf_compose config --quiet ||
		sf_die "The configuration is invalid - is a new variable missing? Compare .env with .env.example."

	# The way back: the version that runs now, or else the tag that is configured.
	previous="$(sf_running_version)"
	previous="${previous%%+*}"
	if ! [[ "$previous" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		previous="$(sf_api_image)"
		previous="${previous##*:}"
	fi

	if [ "$pull" = true ]; then
		resolved="${version:-latest}"
		sf_step "Pull the images ($resolved)"
		STUDIOFLOW_IMAGE_TAG="$resolved" sf_compose pull ||
			sf_die "The images could not be pulled. Nothing was restarted. While the repository is private, sign in first: docker login ghcr.io (user name and a token with read:packages)."
		# "latest" moves on with every release: keep the number it stands for, so that the stack stays on this version.
		if [ "$resolved" = latest ]; then
			label="$(sf_label "$(sf_api_image latest)" org.opencontainers.image.version)"
			label="${label%%+*}"
			if [[ "$label" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then resolved="$label"; fi
		fi
	else
		# Nothing is pulled; `up` fetches the images of a new version if they are missing.
		resolved="$version"
	fi
	if [ -n "$resolved" ]; then sf_env_set STUDIOFLOW_IMAGE_TAG "$resolved"; fi

	api_image="$(sf_api_image)"
	if [[ "$resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && [ -f "$SF_ROOT/VERSION" ]; then
		bundle="$(tr -d '[:space:]' <"$SF_ROOT/VERSION")"
	fi
	if [ -n "$bundle" ] && [ "$bundle" != "$resolved" ]; then
		repo_url="$(sf_label "$api_image" org.opencontainers.image.source)"
		sf_warn "The Compose file and the scripts in this folder are from release $bundle, the images are $resolved. If the release notes of $resolved${repo_url:+ ($repo_url/releases/tag/v$resolved)} mention changed files, unpack the bundle of that release over this folder (.env and backups/ stay) and run ./update.sh again."
	fi

	sf_step "Restart the stack${api_image:+ (images ${api_image##*:})}"
	sf_info "If the new version does not start, go back with: ./update.sh --version ${previous:-VERSION}"
	sf_info "A database migration of the new version stays; when the schema changed, restore the backup that was taken before the update (docs/runbook.md, section 14)."
	sf_up_and_wait --remove-orphans
	sf_info "Version running now: $(sf_running_version)"
}

# Source build: git pull --ff-only, then docker compose up -d --build.
update_source() {
	local pull="$1"
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
}

main() {
	local backup=false pull=true force=false version=""
	while [ $# -gt 0 ]; do
		case "$1" in
			--backup) backup=true ;;
			--no-pull) pull=false ;;
			--force) force=true ;;
			--version)
				[ $# -ge 2 ] || sf_die "Option --version needs a value (see --help)."
				version="$2"
				shift
				;;
			--version=*) version="${1#*=}" ;;
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

	local images=false
	sf_uses_images && images=true
	if [ -n "$version" ]; then
		[ "$images" = true ] ||
			sf_die "--version is for the ready-made images. This installation builds from the source: check out the version with git, then run ./update.sh --no-pull."
		[[ "$version" =~ ^(latest|main|sha-[0-9a-f]{7,40}|[0-9]+\.[0-9]+\.[0-9]+)$ ]] ||
			sf_die "Invalid version '$version' (examples: 0.4.2, latest, main, sha-1a2b3c4)."
	fi

	sf_step "Check the broadcast status"
	sf_guard_broadcast "The update" "$force"

	if [ "$backup" = true ]; then
		sf_step "Back up before the update"
		bash "$SF_ROOT/backup.sh" --label pre-update || sf_die "The backup failed; update aborted."
	fi

	if [ "$images" = true ]; then
		update_images "$version" "$pull"
	else
		update_source "$pull"
	fi

	sf_step "Status"
	sf_compose ps
	sf_info "Update complete."
}

{ main "$@"; exit; }
