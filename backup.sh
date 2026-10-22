#!/usr/bin/env bash
# FlowStudio backup: database (pg_dump -Fc) and the volumes media, keys and caddy_data into
# backups/YYYY-MM-DD_HHMM/ with a checksum file. Same behaviour as backup.ps1. ./backup.sh --help for the options.
set -euo pipefail

FS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/common.sh
. "$FS_ROOT/infra/scripts/common.sh"

usage() {
	cat <<'EOF'
FlowStudio sichern: Datenbank (pg_dump) und die Volumes media, keys und caddy_data.

Aufruf: ./backup.sh [Optionen]

  --dir PFAD      Basisordner der Sicherungen (Standard: ./backups)
  --keep N        nur die neusten N Sicherungen im Basisordner behalten, ältere löschen
  --label TEXT    Zusatz zum Ordnernamen, z. B. vor-update (Buchstaben, Ziffern, -)
  -h, --help      diese Hilfe

Ergebnis: <basis>/YYYY-MM-DD_HHMM[_label]/ mit database.dump, media.tar.gz, keys.tar.gz, caddy_data.tar.gz,
backup-info.txt und SHA256SUMS. Die .env ist nicht dabei (Secrets): sie gehört in den Passwort-Tresor.
Die Sicherung enthält private Schlüssel (Login, Zertifikate) – Ordner geschützt aufbewahren.
Der Stack muss laufen (mindestens postgres); eine laufende Sendung wird nicht gestört.
EOF
}

base_dir="$FS_ROOT/backups" keep="" label=""
while [ $# -gt 0 ]; do
	arg="$1" value=""
	case "$arg" in
		--*=*) value="${arg#*=}" arg="${arg%%=*}" ;;
		--dir | --keep | --label)
			[ $# -ge 2 ] || fs_die "Option $arg braucht einen Wert (siehe --help)."
			value="$2"
			shift
			;;
	esac
	case "$arg" in
		--dir) base_dir="$value" ;;
		--keep) keep="$value" ;;
		--label) label="$value" ;;
		-h | --help)
			usage
			exit 0
			;;
		*) fs_die "Unbekannte Option: $1 (siehe --help)." ;;
	esac
	shift
done
[ -z "$keep" ] || [[ "$keep" =~ ^[1-9][0-9]*$ ]] || fs_die "--keep erwartet eine Zahl ab 1."
[ -z "$label" ] || [[ "$label" =~ ^[A-Za-z0-9-]{1,40}$ ]] || fs_die "--label erlaubt nur Buchstaben, Ziffern und - (max. 40)."

fs_require_docker
fs_require_env_file
fs_service_running postgres || fs_die "PostgreSQL läuft nicht. Zuerst den Stack starten: docker compose up -d"

sha256_file() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'
}

archives() {
	local volume
	for volume in $FS_BACKUP_VOLUMES; do printf '%s.tar.gz\n' "$volume"; done
}

# --- target folder (private: it holds login keys, certificates and the CA key) -----------------------------------

umask 077
mkdir -p "$base_dir"
base_dir="$(cd "$base_dir" && pwd)"
name="$(date '+%Y-%m-%d_%H%M')${label:+_$label}"
target="$base_dir/$name"
suffix=2
while [ -e "$target" ]; do
	target="$base_dir/$name-$suffix"
	suffix=$((suffix + 1))
done
mkdir "$target"
host_target="$(fs_host_path "$target")"

toolbox="" completed=false
on_exit() {
	fs_toolbox_stop "$toolbox"
	fs_compose exec -T postgres rm -f /tmp/flowstudio-backup.dump >/dev/null 2>&1 || true
	if [ "$completed" != true ]; then
		rm -rf "$target"
		fs_warn "Die unvollständige Sicherung wurde entfernt."
	fi
}
trap on_exit EXIT

fs_step "Sicherung nach $target"

# --- database -------------------------------------------------------------------------------------------------------

fs_info "Datenbank (pg_dump) …"
fs_compose exec -T postgres pg_dump -U flowstudio -d flowstudio -Fc -f /tmp/flowstudio-backup.dump ||
	fs_die "pg_dump ist fehlgeschlagen."
fs_quiet fs_compose cp postgres:/tmp/flowstudio-backup.dump "$host_target/$FS_DB_DUMP" ||
	fs_die "Die Datenbanksicherung konnte nicht kopiert werden."
postgres_version="$(fs_compose exec -T postgres psql -U flowstudio -d flowstudio -tAc 'SHOW server_version' 2>/dev/null | tr -d '\r' || true)"
project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$(fs_compose ps -q postgres)" 2>/dev/null || true)"

# --- volumes --------------------------------------------------------------------------------------------------------

toolbox="$(fs_toolbox_start)" || fs_die "Der Hilfscontainer (toolbox) liess sich nicht starten."
for volume in $FS_BACKUP_VOLUMES; do
	fs_info "Volume $volume …"
	docker exec "$toolbox" tar -czf "/tmp/$volume.tar.gz" -C "/volumes/$volume" . ||
		fs_die "Das Archiv für $volume konnte nicht erstellt werden."
	fs_quiet docker cp "$toolbox:/tmp/$volume.tar.gz" "$host_target/$volume.tar.gz" ||
		fs_die "Das Archiv für $volume konnte nicht kopiert werden."
done

# --- description and checksums ------------------------------------------------------------------------------------

{
	echo "FlowStudio-Sicherung"
	echo "erstellt:  $(date '+%Y-%m-%d %H:%M:%S %z')"
	echo "rechner:   $(hostname 2>/dev/null || echo unbekannt)"
	echo "projekt:   ${project:-unbekannt}"
	echo "git:       $(fs_git rev-parse --short HEAD 2>/dev/null || echo unbekannt)"
	echo "postgres:  ${postgres_version:-unbekannt}"
	echo "inhalt:    $FS_DB_DUMP $(archives | tr '\n' ' ')"
} >"$target/$FS_BACKUP_INFO"

(
	cd "$target"
	for file in "$FS_DB_DUMP" $(archives) "$FS_BACKUP_INFO"; do
		printf '%s  %s\n' "$(sha256_file "$file")" "$file"
	done >"$FS_CHECKSUMS"
)
completed=true

# --- retention ------------------------------------------------------------------------------------------------------

if [ -n "$keep" ]; then
	# Only folders written by this script (date-named, with a checksum file), newest first by the time the checksum
	# file was written: names have minute resolution and labels, so they do not sort reliably.
	backups=()
	# shellcheck disable=SC2012 # ls -t is the portable way to sort by mtime (GNU and BSD stat differ)
	while IFS= read -r sums; do
		dir="$(dirname "$sums")"
		[[ "$(basename "$dir")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4} ]] && backups+=("$dir")
	done < <(ls -1t "$base_dir"/*/"$FS_CHECKSUMS" 2>/dev/null)
	for ((i = keep; i < ${#backups[@]}; i++)); do
		[ "${backups[i]}" = "$target" ] && continue
		rm -rf "${backups[i]}"
		fs_info "Alte Sicherung entfernt: $(basename "${backups[i]}")"
	done
fi

fs_step "Sicherung fertig: $target ($(du -sh "$target" | awk '{ print $1 }'))"
fs_info "Wiederherstellen mit: ./restore.sh \"$target\""
