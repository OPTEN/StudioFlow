#!/usr/bin/env bash
# Numbered E2E stacks (1-4) on one machine - tests/e2e/README.md, "Parallel stacks". No npm script and no dependency:
# the script only sets E2E_STACK=N (tests/e2e/support/env.ts turns it into the project name, ports and subnet) and
# calls Playwright or docker compose.
#
#   tests/e2e/stack.sh up 2                      start stack 2 (fs-e2e-2) and leave it running
#   tests/e2e/stack.sh test 2 --project=smoke    run Playwright against stack 2 (fresh stack, removed afterwards;
#                                                E2E_KEEP_STACK=1 keeps it, E2E_REUSE_STACK=1 uses the running one)
#   tests/e2e/stack.sh status 2                  containers and ports of stack 2
#   tests/e2e/stack.sh down 2                    remove stack 2 with its volumes
#
#   N  project    https http rtc tcp/udp api   livekit postgres subnet
#   1  fs-e2e-1   8491  8091 7901/7902  18091 17891   15491    172.31.201.0/24
#   2  fs-e2e-2   8492  8092 7903/7904  18092 17892   15492    172.31.202.0/24
#   3  fs-e2e-3   8493  8093 7905/7906  18093 17893   15493    172.31.203.0/24
#   4  fs-e2e-4   8494  8094 7907/7908  18094 17894   15494    172.31.204.0/24
set -euo pipefail

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
action="$1"
n="$2"
shift 2
case "$n" in 1 | 2 | 3 | 4) ;; *) echo "stack number must be 1, 2, 3 or 4, got '$n'" >&2; exit 2 ;; esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
project="fs-e2e-$n"
env_file="$here/.env.e2e.$project"
export E2E_STACK="$n"
cd "$repo"

compose() {
  if [ -f "$env_file" ]; then
    docker compose -p "$project" --env-file "$env_file" -f "$repo/docker-compose.yml" -f "$here/docker-compose.e2e.yml" --profile chaos --profile tools "$@"
  else
    docker compose -p "$project" "$@"
  fi
}

case "$action" in
  up)
    # The harness starts the stack in its global setup; one tiny test makes Playwright run it and keep the result.
    E2E_KEEP_STACK=1 npx playwright test -c tests/e2e/playwright.config.ts --project=smoke --grep H-STACK-01 "$@"
    echo
    echo "stack $project is up:"
    grep -E '^(E2E_HTTPS_PORT|E2E_HTTP_PORT|FLOWSTUDIO_RTC_TCP_PORT|FLOWSTUDIO_RTC_UDP_PORT|E2E_API_PORT|E2E_LIVEKIT_PORT|E2E_POSTGRES_PORT|FLOWSTUDIO_SUBNET|FLOWSTUDIO_PUBLIC_BASE_URL)=' "$env_file" || true
    ;;
  test)
    npx playwright test -c tests/e2e/playwright.config.ts "$@"
    ;;
  status)
    compose ps -a
    [ -f "$env_file" ] && grep -E '^(E2E_HTTPS_PORT|FLOWSTUDIO_RTC_TCP_PORT|FLOWSTUDIO_RTC_UDP_PORT|FLOWSTUDIO_SUBNET)=' "$env_file"
    ;;
  down)
    compose down --volumes --remove-orphans --timeout 30
    ;;
  *)
    usage
    ;;
esac
