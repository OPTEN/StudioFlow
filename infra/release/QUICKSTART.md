# StudioFlow @VERSION@ - quick start

This is release @VERSION@ of StudioFlow. The folder holds the Compose file and the runbook (`docs/runbook.md`). The program
comes as ready-made Docker images from GitHub Container Registry; nothing is built on the server. There is no script to run,
no Git, and no configuration file to write: `docker compose` is the only tool you need.

You need Docker Engine (Linux) or Docker Desktop (Windows, macOS) with Compose v2.24 or newer. The commands are the same on
every system.

## Install

```bash
tar -xzf studioflow-@VERSION@.tar.gz && cd studioflow-@VERSION@   # Windows 10/11: the same command works in a terminal
docker login ghcr.io          # user name and a token with read:packages; needed while the repository is private
docker compose up -d          # pulls the images and starts the stack; it makes its own secrets on the first start
docker compose ps             # all services "healthy"
```

Open `https://<address of this computer>:8443/` in a browser (for example `https://192.168.1.50:8443/`). The browser warns
once, because the certificate comes from the stack's own certificate authority; accept it for now. Read the setup code with
`docker compose logs api` (the line "Setup code: XXXX-XXXX") and follow the first-run wizard: account, media address
(the IPv4 address of this computer, with a connection test), address and certificate, embedding.

Ports that must be open in the firewall of the server: 8443 (tcp and udp, the Regie, the output and the phones), 7881/tcp and
7882/udp (picture and sound). Nothing listens on port 80. If 8443 is taken, Docker says so when the stack starts; choose
another port with `STUDIOFLOW_HTTPS_PORT=9443` in a `.env` file next to the Compose file (`.env.example` lists the optional
overrides) and run `docker compose up -d` again. A second stack on the same Docker host also needs its own networks:
`STUDIOFLOW_SUBNET` and `STUDIOFLOW_BACKEND_SUBNET` (otherwise Docker reports "Pool overlaps with other one").

## Update and roll back

```bash
docker compose pull && docker compose up -d   # newest release
```

Choose the moment yourself (not during a broadcast); the data, the secrets and the settings stay. To go back to a release or to
stay on one, set `STUDIOFLOW_IMAGE_TAG=0.4.2` in `.env` and run the two commands again. A rollback to a version with a different
database schema needs the backup taken before the update.

## Back up and restore

```bash
docker compose run --rm backup backup-now                 # a backup now (the schedule is set in the Regie: Server settings)
docker compose run --rm backup list                       # the backups, newest first
docker compose run --rm backup restore 2026-10-26_0300_auto --verify   # check a backup without touching anything
docker compose stop caddy api livekit && docker compose run --rm backup restore 2026-10-26_0300_auto && docker compose up -d
```

Details: runbook, sections 7, 8 and 14.
