# StudioFlow @VERSION@ - quick start

This is release @VERSION@ of StudioFlow. The folder holds everything needed to run it: the Compose file, the
`setup`, `update`, `backup` and `restore` scripts and the runbook (`docs/runbook.md`). The program itself comes as
ready-made Docker images from GitHub Container Registry; nothing is built on the server and no Git is needed.

You need Docker Engine (Linux) or Docker Desktop (Windows, macOS) with Compose v2.24 or newer. On Windows the `.ps1`
scripts need PowerShell 7.4 (`pwsh`), the `.sh` scripts run in Git Bash.

## Install

```bash
tar -xzf studioflow-@VERSION@.tar.gz && cd studioflow-@VERSION@   # Windows 10/11: the same command works in a terminal
docker login ghcr.io          # user name and a token with read:packages; needed while the repository is private
./setup.sh                    # Windows: pwsh ./setup.ps1 - asks a few questions, writes .env with random secrets
docker compose up -d          # pulls the images of @VERSION@ and starts the stack
docker compose ps             # all four services "healthy"
```

Then open `https://<your domain>/` and sign in with the admin account that `setup` created. Put the `.env` file into
your password vault: it holds the secrets and is not part of any backup.

## Update and roll back

Never during a broadcast; the script refuses while one is live.

```bash
./update.sh --backup                 # newest release (Windows: pwsh ./update.ps1 -Backup)
./update.sh --version 0.4.2          # a specific release, also the way back to an earlier one
```

The images carry the program. The Compose file and the scripts in this folder belong to release @VERSION@: when the
release notes of a newer version say they changed, unpack that release over this folder (`.env` and `backups/` stay)
and run `./update.sh` again. A rollback to a version with a different database schema needs the backup taken before the update
(`./restore.sh`). Details: runbook, section 14.
