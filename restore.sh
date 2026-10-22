#!/usr/bin/env bash
# FlowStudio restore from a backup folder written by backup.sh / backup.ps1. Same behaviour as restore.ps1.
# ./restore.sh --help for the options.
set -euo pipefail

FS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$FS_ROOT/infra/scripts/common.sh"

usage() {
	cat <<'EOF'
FlowStudio wiederherstellen: ersetzt Datenbank, Medien, Login-Schlüssel und Zertifikate durch eine Sicherung.

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
		-*) fs_die "Unbekannte Option: $1 (siehe --help)." ;;
		*)
			[ -z "$source_dir" ] || fs_die "Nur ein Sicherungsordner erlaubt."
			source_dir="$1"
			;;
	esac
	shift
done
[ -n "$source_dir" ] || fs_die "Sicherungsordner fehlt. Aufruf: ./restore.sh backups/YYYY-MM-DD_HHMM"
[ -d "$source_dir" ] || fs_die "Ordner nicht gefunden: $source_dir"
source_dir="$(cd "$source_dir" && pwd)"

fs_require_docker
fs_require_env_file

# --- check the backup -----------------------------------------------------------------------------------------------

[ -f "$source_dir/$FS_CHECKSUMS" ] || fs_die "$FS_CHECKSUMS fehlt in $source_dir – keine vollständige FlowStudio-Sicherung."
[ -f "$source_dir/$FS_DB_DUMP" ] || fs_die "$FS_DB_DUMP fehlt in $source_dir."

verify_checksums() {
	local expected file actual
	while read -r expected file; do
		[ -n "$expected" ] || continue
		case "$file" in */* | ..*) fs_die "Ungültiger Eintrag in $FS_CHECKSUMS: $file" ;; esac
		[ -f "$source_dir/$file" ] || fs_die "Datei aus $FS_CHECKSUMS fehlt: $file"
		if command -v sha256sum >/dev/null 2>&1; then
			actual="$(sha256sum "$source_dir/$file" | awk '{ print $1 }')"
		else
			actual="$(shasum -a 256 "$source_dir/$file" | awk '{ print $1 }')"
		fi
		[ "$actual" = "$expected" ] || fs_die "Prüfsumme stimmt nicht: $file (Sicherung beschädigt)."
	done <"$source_dir/$FS_CHECKSUMS"
}
fs_info "Prüfsummen werden geprüft …"
verify_checksums
fs_info "Prüfsummen in Ordnung."
[ -f "$source_dir/$FS_BACKUP_INFO" ] && sed 's/^/  /' "$source_dir/$FS_BACKUP_INFO"

fs_guard_broadcast "Die Wiederherstellung" "$force"

if [ "$assume_yes" != true ]; then
	fs_warn "Datenbank, Medien, Login-Schlüssel und Zertifikate werden durch die Sicherung ersetzt."
	fs_confirm "Wiederherstellen aus $(basename "$source_dir")?" n || fs_die "Abgebrochen, nichts geändert."
fi

# --- safety backup of the current state --------------------------------------------------------------------------

fs_step "PostgreSQL starten"
fs_up_and_wait postgres

if [ "$safety_backup" = true ]; then
	fs_step "Sicherung des aktuellen Stands"
	bash "$FS_ROOT/backup.sh" --label vor-restore || fs_die "Die Sicherung des aktuellen Stands ist fehlgeschlagen; nichts geändert (oder --no-safety-backup)."
fi

# --- database: restore into a new database, then swap (the old one stays intact if anything fails) ---------------

host_source="$(fs_host_path "$source_dir")"
toolbox="" warn_on_exit=true
on_exit() {
	fs_toolbox_stop "$toolbox"
	fs_compose exec -T postgres rm -f /tmp/flowstudio-restore.dump >/dev/null 2>&1 || true
	if [ "$warn_on_exit" = true ]; then
		fs_warn "Die Wiederherstellung wurde nicht abgeschlossen; api und caddy sind evtl. gestoppt."
		fs_warn "Ausgabe oben prüfen. Der vorherige Stand liegt in backups/…_vor-restore; Start: docker compose up -d"
	fi
}
trap on_exit EXIT

psql_admin() {
	fs_compose exec -T postgres psql -U flowstudio -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

fs_step "API und Caddy stoppen"
fs_compose stop api caddy

fs_step "Datenbank wiederherstellen"
fs_quiet fs_compose cp "$host_source/$FS_DB_DUMP" postgres:/tmp/flowstudio-restore.dump
psql_admin -c 'DROP DATABASE IF EXISTS flowstudio_restore' -c 'CREATE DATABASE flowstudio_restore OWNER flowstudio'
if ! fs_compose exec -T postgres pg_restore -U flowstudio -d flowstudio_restore --no-owner --no-privileges --exit-on-error /tmp/flowstudio-restore.dump; then
	psql_admin -c 'DROP DATABASE IF EXISTS flowstudio_restore' || true
	fs_compose up -d >/dev/null 2>&1 || true
	warn_on_exit=false
	fs_die "pg_restore ist fehlgeschlagen. Die bisherige Datenbank ist unverändert; der Stack wurde wieder gestartet."
fi
psql_admin \
	-c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'flowstudio' AND pid <> pg_backend_pid()" \
	-c 'DROP DATABASE IF EXISTS flowstudio_replaced' >/dev/null
psql_admin -1 \
	-c 'ALTER DATABASE flowstudio RENAME TO flowstudio_replaced' \
	-c 'ALTER DATABASE flowstudio_restore RENAME TO flowstudio'
psql_admin -c 'DROP DATABASE flowstudio_replaced'
fs_info "Datenbank ersetzt."

# --- volumes --------------------------------------------------------------------------------------------------------

fs_step "Volumes wiederherstellen"
toolbox="$(fs_toolbox_start)" || fs_die "Der Hilfscontainer (toolbox) liess sich nicht starten."
for volume in $FS_BACKUP_VOLUMES; do
	archive="$volume.tar.gz"
	if [ ! -f "$source_dir/$archive" ]; then
		fs_warn "$archive fehlt in der Sicherung; Volume $volume bleibt unverändert."
		continue
	fi
	fs_info "Volume $volume …"
	fs_quiet docker cp "$host_source/$archive" "$toolbox:/tmp/$archive"
	docker exec "$toolbox" sh -c "find '/volumes/$volume' -mindepth 1 -delete && tar -xzf '/tmp/$archive' -C '/volumes/$volume'"
done
fs_toolbox_stop "$toolbox"
toolbox=""

# --- start ----------------------------------------------------------------------------------------------------------

fs_step "Stack starten"
fs_up_and_wait
warn_on_exit=false
fs_compose ps
fs_step "Wiederherstellung abgeschlossen aus $source_dir"
