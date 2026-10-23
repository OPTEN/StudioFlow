#!/usr/bin/env bash
# StudioFlow update: refuses while a broadcast is live, then git pull --ff-only, rebuild, restart and health wait.
# Same behaviour as update.ps1. ./update.sh --help for the options.
#
# The whole script runs inside main(): `git pull` may replace this file while it runs, and bash reads scripts
# incrementally – the last line is parsed completely before main starts.
set -euo pipefail

SF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$SF_ROOT/infra/scripts/common.sh"

usage() {
	cat <<'EOF'
StudioFlow aktualisieren: neuen Stand holen, Images bauen, Stack neu starten. Nie während einer Sendung.

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
			*) sf_die "Unbekannte Option: $1 (siehe --help)." ;;
		esac
		shift
	done

	sf_require_docker
	sf_require_env_file

	sf_step "Sendestatus prüfen"
	sf_guard_broadcast "Das Update" "$force"

	if [ "$backup" = true ]; then
		sf_step "Sicherung vor dem Update"
		bash "$SF_ROOT/backup.sh" --label vor-update || sf_die "Die Sicherung ist fehlgeschlagen; Update abgebrochen."
	fi

	if [ "$pull" = true ]; then
		sf_step "Neuen Stand holen (git pull --ff-only)"
		sf_git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
			sf_die "$SF_ROOT ist kein Git-Arbeitsverzeichnis. Neuen Stand von Hand einspielen und ./update.sh --no-pull ausführen."
		local before after
		before="$(sf_git rev-parse --short HEAD)"
		sf_git pull --ff-only ||
			sf_die "git pull --ff-only ist fehlgeschlagen (lokale Änderungen oder abweichender Stand). Nichts neu gestartet."
		after="$(sf_git rev-parse --short HEAD)"
		if [ "$before" = "$after" ]; then
			sf_info "Bereits aktuell ($after); die Images werden trotzdem neu gebaut und geprüft."
		else
			sf_info "Aktualisiert: $before → $after"
		fi
	fi

	sf_step "Images bauen und Stack neu starten"
	sf_compose config --quiet ||
		sf_die "Die Konfiguration ist ungültig – fehlt eine neue Variable? .env mit .env.example vergleichen."
	sf_up_and_wait --build --remove-orphans

	sf_step "Status"
	sf_compose ps
	sf_info "Update abgeschlossen."
}

{ main "$@"; exit; }
