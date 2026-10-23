#!/usr/bin/env bash
# StudioFlow restore from a backup folder written by backup.sh / backup.ps1. Same behaviour as restore.ps1.
# ./restore.sh --help for the options.
set -euo pipefail

SF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$SF_ROOT/infra/scripts/common.sh"

usage() {
	cat <<'EOF'
StudioFlow wiederherstellen: ersetzt Datenbank, Medien, Login-Schlüssel und Zertifikate durch eine Sicherung.

Aufruf: ./restore.sh SICHERUNGSORDNER [Optionen]

  --yes                 ohne Rückfrage
  --no-safety-backup    vorher keine Sicherung des aktuellen Stands anlegen
  --force               auch wenn eine Sendung live ist oder der Sendestatus unbekannt ist
  -h, --help            diese Hilfe

Ablauf: Prüfsummen prüfen → Sicherung des aktuellen Stands (backups/…_vor-restore) → api und caddy stoppen →
Datenbank in eine neue Datenbank einspielen und erst danach austauschen → Volumes ersetzen → Stack starten und
warten, bis alle Dienste gesund sind. Während einer Sendung gesperrt.
EOF
}

source_dir="" assume_yes=false safety_backup=true force=false
while [ $# -gt 0 ]; do
	case "$1" in
		--yes) assume_yes=true ;;
		--no-safety-backup) safety_backup=false ;;
		--force) force=true ;;
		-h | --help)
			usage
			exit 0
			;;
		-*) sf_die "Unbekannte Option: $1 (siehe --help)." ;;
		*)
			[ -z "$source_dir" ] || sf_die "Nur ein Sicherungsordner erlaubt."
			source_dir="$1"
			;;
	esac
	shift
done
[ -n "$source_dir" ] || sf_die "Sicherungsordner fehlt. Aufruf: ./restore.sh backups/YYYY-MM-DD_HHMM"
[ -d "$source_dir" ] || sf_die "Ordner nicht gefunden: $source_dir"
source_dir="$(cd "$source_dir" && pwd)"

sf_require_docker
sf_require_env_file

# --- check the backup -----------------------------------------------------------------------------------------------

[ -f "$source_dir/$SF_CHECKSUMS" ] || sf_die "$SF_CHECKSUMS fehlt in $source_dir – keine vollständige StudioFlow-Sicherung."
[ -f "$source_dir/$SF_DB_DUMP" ] || sf_die "$SF_DB_DUMP fehlt in $source_dir."

verify_checksums() {
	local expected file actual
	while read -r expected file; do
		[ -n "$expected" ] || continue
		case "$file" in */* | ..*) sf_die "Ungültiger Eintrag in $SF_CHECKSUMS: $file" ;; esac
		[ -f "$source_dir/$file" ] || sf_die "Datei aus $SF_CHECKSUMS fehlt: $file"
		if command -v sha256sum >/dev/null 2>&1; then
			actual="$(sha256sum "$source_dir/$file" | awk '{ print $1 }')"
		else
			actual="$(shasum -a 256 "$source_dir/$file" | awk '{ print $1 }')"
		fi
		[ "$actual" = "$expected" ] || sf_die "Prüfsumme stimmt nicht: $file (Sicherung beschädigt)."
	done <"$source_dir/$SF_CHECKSUMS"
}
sf_info "Prüfsummen werden geprüft …"
verify_checksums
sf_info "Prüfsummen in Ordnung."
[ -f "$source_dir/$SF_BACKUP_INFO" ] && sed 's/^/  /' "$source_dir/$SF_BACKUP_INFO"

sf_guard_broadcast "Die Wiederherstellung" "$force"

if [ "$assume_yes" != true ]; then
	sf_warn "Datenbank, Medien, Login-Schlüssel und Zertifikate werden durch die Sicherung ersetzt."
	sf_confirm "Wiederherstellen aus $(basename "$source_dir")?" n || sf_die "Abgebrochen, nichts geändert."
fi

# --- safety backup of the current state --------------------------------------------------------------------------

sf_step "PostgreSQL starten"
sf_up_and_wait postgres

if [ "$safety_backup" = true ]; then
	sf_step "Sicherung des aktuellen Stands"
	bash "$SF_ROOT/backup.sh" --label vor-restore || sf_die "Die Sicherung des aktuellen Stands ist fehlgeschlagen; nichts geändert (oder --no-safety-backup)."
fi

# --- database: restore into a new database, then swap (the old one stays intact if anything fails) ---------------

host_source="$(sf_host_path "$source_dir")"
toolbox="" warn_on_exit=true
on_exit() {
	sf_toolbox_stop "$toolbox"
	sf_compose exec -T postgres rm -f /tmp/studioflow-restore.dump >/dev/null 2>&1 || true
	if [ "$warn_on_exit" = true ]; then
		sf_warn "Die Wiederherstellung wurde nicht abgeschlossen; api und caddy sind evtl. gestoppt."
		sf_warn "Ausgabe oben prüfen. Der vorherige Stand liegt in backups/…_vor-restore; Start: docker compose up -d"
	fi
}
trap on_exit EXIT

psql_admin() {
	sf_compose exec -T postgres psql -U studioflow -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

sf_step "API und Caddy stoppen"
sf_compose stop api caddy

sf_step "Datenbank wiederherstellen"
sf_quiet sf_compose cp "$host_source/$SF_DB_DUMP" postgres:/tmp/studioflow-restore.dump
psql_admin -c 'DROP DATABASE IF EXISTS studioflow_restore' -c 'CREATE DATABASE studioflow_restore OWNER studioflow'
if ! sf_compose exec -T postgres pg_restore -U studioflow -d studioflow_restore --no-owner --no-privileges --exit-on-error /tmp/studioflow-restore.dump; then
	psql_admin -c 'DROP DATABASE IF EXISTS studioflow_restore' || true
	sf_compose up -d >/dev/null 2>&1 || true
	warn_on_exit=false
	sf_die "pg_restore ist fehlgeschlagen. Die bisherige Datenbank ist unverändert; der Stack wurde wieder gestartet."
fi
psql_admin \
	-c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'studioflow' AND pid <> pg_backend_pid()" \
	-c 'DROP DATABASE IF EXISTS studioflow_replaced' >/dev/null
psql_admin -1 \
	-c 'ALTER DATABASE studioflow RENAME TO studioflow_replaced' \
	-c 'ALTER DATABASE studioflow_restore RENAME TO studioflow'
psql_admin -c 'DROP DATABASE studioflow_replaced'
sf_info "Datenbank ersetzt."

# --- volumes --------------------------------------------------------------------------------------------------------

sf_step "Volumes wiederherstellen"
toolbox="$(sf_toolbox_start)" || sf_die "Der Hilfscontainer (toolbox) liess sich nicht starten."
for volume in $SF_BACKUP_VOLUMES; do
	archive="$volume.tar.gz"
	if [ ! -f "$source_dir/$archive" ]; then
		sf_warn "$archive fehlt in der Sicherung; Volume $volume bleibt unverändert."
		continue
	fi
	sf_info "Volume $volume …"
	sf_quiet docker cp "$host_source/$archive" "$toolbox:/tmp/$archive"
	docker exec "$toolbox" sh -c "find '/volumes/$volume' -mindepth 1 -delete && tar -xzf '/tmp/$archive' -C '/volumes/$volume'"
done
sf_toolbox_stop "$toolbox"
toolbox=""

# --- start ----------------------------------------------------------------------------------------------------------

sf_step "Stack starten"
sf_up_and_wait
warn_on_exit=false
sf_compose ps
sf_step "Wiederherstellung abgeschlossen aus $source_dir"
