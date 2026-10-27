# StudioFlow LiveKit image: the LiveKit server and a supervisor that restarts it when the API writes a new livekit.yaml
# (server settings: media address). LiveKit has no configuration reload, and the stack has no Docker socket, so the restart
# happens inside the container (infra/livekit/supervisor.sh). Build context is the repository root.
#
# The server version is pinned to an exact tag: livekit-client of the frontends and the server move together
# (.github/renovate.json5, group LiveKit).
ARG LIVEKIT_VERSION=v1.13.11
FROM livekit/livekit-server:${LIVEKIT_VERSION}

# The commit this image was built from. CI and the release workflow pass it to every image (the images are built from the
# same commit and can be told apart in `docker inspect`); nothing in the image reads it.
ARG STUDIOFLOW_REVISION=unknown
LABEL org.opencontainers.image.revision=${STUDIOFLOW_REVISION}

COPY infra/livekit/supervisor.sh /usr/local/bin/livekit-supervisor
RUN chmod 755 /usr/local/bin/livekit-supervisor \
 && mkdir -p /lk

# livekit.yaml (written by the API) and applied.json (written by the supervisor) live in this volume.
VOLUME ["/lk"]

# Signalling (7880) is only reachable through Caddy (/rtc) and by the API; media goes straight to the clients on the ports
# of the configuration (docker-compose.yml: 7881/tcp, 7882/udp).
EXPOSE 7880

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --start-interval=1s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:7880/ || exit 1

ENTRYPOINT ["/usr/local/bin/livekit-supervisor"]
