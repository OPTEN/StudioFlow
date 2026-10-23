#!/bin/sh
# Healthcheck of the backup service: the scheduler runs (see entrypoint.sh). Whether the backups succeed is shown by the
# status file and the readiness check of the API, not by the health of this container.
pgrep -x supercronic >/dev/null
