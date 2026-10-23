# syntax=docker/dockerfile:1
# StudioFlow backup service: runs backup-job.sh on the schedule BACKUP_SCHEDULE (docker-compose.yml, profile "backup").
# Build context is the repository root; docker-compose.yml passes the PostgreSQL image as POSTGRES_IMAGE, so the tools
# are those of the server (pg_dump and pg_restore of another major version cannot read each other's dumps) and the image
# adds only a few megabytes to the one that postgres already uses.

ARG POSTGRES_IMAGE
FROM ${POSTGRES_IMAGE}

# supercronic: cron for containers (logs to stdout, runs as the container user). age and rclone: the optional off-site
# copy. jq: the status file. bash: the scripts. tzdata: BACKUP_TIMEZONE.
RUN apk add --no-cache age bash jq rclone supercronic tzdata

COPY infra/scripts/common.sh infra/scripts/backup-core.sh \
     infra/backup/status.sh infra/backup/entrypoint.sh infra/backup/backup-job.sh infra/backup/healthcheck.sh \
     /opt/backup/
RUN chmod 755 /opt/backup/*.sh

# Runs as root on read-only volumes (the Caddy volume is readable for its own user only): docker-compose.yml drops every
# capability but DAC_READ_SEARCH and makes the root file system read-only. rclone writes its configuration and cache
# to /tmp.
ENV HOME=/tmp \
    RCLONE_CONFIG=/tmp/rclone.conf \
    BACKUP_DIR=/backups \
    BACKUP_STATUS_DIR=/status \
    BACKUP_VOLUMES_DIR=/volumes

# The PostgreSQL image stops with SIGINT and starts "postgres"; this image is a scheduler.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/opt/backup/entrypoint.sh"]
CMD []
