#!/usr/bin/env bash
# FlowStudio update: refuses while a broadcast is live, then git pull --ff-only, rebuild, restart and health wait.
# Same behaviour as update.ps1. ./update.sh --help for the options.
#
# The whole script runs inside main(): `git pull` may replace this file while it runs, and bash reads scripts
# incrementally – the last line is parsed completely before main starts.
set -euo pipefail

FS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$FS_ROOT/infra/scripts/common.sh"

usage() {
	cat <<'EOF'
FlowStudio aktualisieren: neuen Stand holen, Images bauen, Stack neu starten. Nie während einer Sendung.

Aufruf: ./update.sh [Optionen]

  --backup      vorher eine Sicherung anlegen (./backup.sh --label vor-update)
  --no-pull     kein git pull, nur neu bauen und starten (z. B. nach einer Änderung an .env)
  --force       auch wenn eine Sendung live ist oder der Sendestatus unbekannt ist (das Bild bricht ab)
  -h, --help    diese Hilfe

Ablauf: Sendestatus prüfen (API: broadcast-status) → optional Sicherung → git pull --ff-only →
docker compose up -d --build → warten, bis alle Dienste gesund sind → Status anzeigen. Volumes bleiben erhalten.
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
			*) fs_die "Unbekannte Option: $1 (siehe --help)." ;;
		esac
		shift
	done

	fs_require_docker
	fs_require_env_file

	fs_step "Sendestatus prüfen"
	fs_guard_broadcast "Das Update" "$force"

	if [ "$backup" = true ]; then
		fs_step "Sicherung vor dem Update"
		bash "$FS_ROOT/backup.sh" --label vor-update || fs_die "Die Sicherung ist fehlgeschlagen; Update abgebrochen."
	fi

	if [ "$pull" = true ]; then
		fs_step "Neuen Stand holen (git pull --ff-only)"
		fs_git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
			fs_die "$FS_ROOT ist kein Git-Arbeitsverzeichnis. Neuen Stand von Hand einspielen und ./update.sh --no-pull ausführen."
		local before after
		before="$(fs_git rev-parse --short HEAD)"
		fs_git pull --ff-only ||
			fs_die "git pull --ff-only ist fehlgeschlagen (lokale Änderungen oder abweichender Stand). Nichts neu gestartet."
		after="$(fs_git rev-parse --short HEAD)"
		if [ "$before" = "$after" ]; then
			fs_info "Bereits aktuell ($after); die Images werden trotzdem neu gebaut und geprüft."
		else
			fs_info "Aktualisiert: $before → $after"
		fi
	fi

	fs_step "Images bauen und Stack neu starten"
	fs_compose config --quiet ||
		fs_die "Die Konfiguration ist ungültig – fehlt eine neue Variable? .env mit .env.example vergleichen."
	fs_up_and_wait --build --remove-orphans

	fs_step "Status"
	fs_compose ps
	fs_info "Update abgeschlossen."
}

{ main "$@"; exit; }
