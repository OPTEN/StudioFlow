#!/bin/sh
# StudioFlow LiveKit supervisor (PID 1 of the LiveKit image, docs/architecture/implementation-spec.md section 10).
#
# LiveKit reads its configuration once at start and has no reload. The StudioFlow API writes livekit.yaml into a shared
# volume (server settings: media address, key pair); this script starts the server with the file, watches it and restarts the
# server when it changes. No Docker socket, no restart of the container.
#
#   livekit.yaml   written by the API (volume livekit_config, mounted here read and write)
#   applied.json   written here: {"configSha256": "<sha256 of the file the running server was started with>"}. The API reads
#                  it to know that LiveKit runs the saved settings (or the media address under test). It exists only while
#                  the server is up and answers on its signalling port, so a restart in progress or a crash loop is visible.
#
# POSIX sh on busybox (Alpine). Texts are English and ASCII only.
set -u

config="${LIVEKIT_CONFIG_FILE:-/lk/livekit.yaml}"
applied="${LIVEKIT_APPLIED_FILE:-/lk/applied.json}"
server="${LIVEKIT_SERVER_BIN:-/livekit-server}"
signalling="${LIVEKIT_SIGNALLING_URL:-http://127.0.0.1:7880/}"
poll_seconds="${LIVEKIT_POLL_SECONDS:-1}"
ready_attempts="${LIVEKIT_READY_ATTEMPTS:-60}"

pid=""

log() { printf '%s livekit-supervisor: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

hash_of() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }

forget_applied() { rm -f "$applied" "$applied.tmp" 2>/dev/null; }

# Writes applied.json for $1 (a hash), atomically: the API never reads half a file.
remember_applied() {
	printf '{"configSha256":"%s"}\n' "$1" >"$applied.tmp" && chmod 644 "$applied.tmp" && mv -f "$applied.tmp" "$applied"
}

server_running() { [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; }

# SIGTERM first (LiveKit closes its rooms), SIGKILL after ten seconds.
stop_server() {
	if server_running; then
		kill -TERM "$pid" 2>/dev/null
		waited=0
		while server_running && [ "$waited" -lt 100 ]; do
			sleep 0.1
			waited=$((waited + 1))
		done
		server_running && kill -KILL "$pid" 2>/dev/null
		wait "$pid" 2>/dev/null
	fi
	pid=""
	forget_applied
}

on_signal() {
	log "stopping"
	stop_server
	exit 0
}
trap on_signal TERM INT

# Waits until the server answers on its signalling port, as long as it lives. Returns 1 when it died or did not answer.
wait_until_ready() {
	attempt=0
	while server_running && [ "$attempt" -lt "$ready_attempts" ]; do
		if wget -q -O /dev/null -T 2 "$signalling" 2>/dev/null; then
			return 0
		fi
		sleep 0.5
		attempt=$((attempt + 1))
	done
	return 1
}

forget_applied
while :; do
	if [ ! -s "$config" ]; then
		log "waiting for $config (the API writes it when it starts)"
		sleep "$poll_seconds" &
		wait $!
		continue
	fi

	hash="$(hash_of "$config")"
	log "starting the server with the configuration $(printf '%s' "$hash" | cut -c1-12)"
	"$server" --config "$config" &
	pid=$!

	if wait_until_ready; then
		remember_applied "$hash"
		log "the server is up"
	else
		log "the server did not come up with this configuration"
	fi

	# Watch: a changed file restarts the server, a server that ended on its own is started again after a pause.
	while server_running; do
		sleep "$poll_seconds" &
		wait $!
		current="$(hash_of "$config")"
		if [ -n "$current" ] && [ "$current" != "$hash" ]; then
			log "the configuration changed: restarting the server"
			stop_server
			break
		fi
	done

	if [ -n "$pid" ]; then
		wait "$pid" 2>/dev/null
		log "the server ended (exit code $?); starting it again in 2 seconds"
		pid=""
		forget_applied
		sleep 2 &
		wait $!
	fi
done
