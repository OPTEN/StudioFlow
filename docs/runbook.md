# StudioFlow – Operations guide (runbook)

For everyone who runs StudioFlow on site or on a VPS: set it up, start it, back it up, update it and react quickly
during a webinar. Technical details are in `docs/architecture/implementation-spec.md` (section 10), all variables in
`.env.example`.

Interface texts are quoted as they appear in the English interface. The German translation of each text is in
`packages/i18n/src/messages/de-CH/`; see section 13 for how the language is chosen. The Regie (control room) is the
operator's screen. The word "Regie" is kept as a proper noun throughout.

## 1. Overview

One Docker Compose stack with four services:

| Service | Purpose | Data (volume) |
|---|---|---|
| `caddy` | HTTPS, certificates, serves the Regie (`/`), sender (`/join`) and output (`/o/…`), forwards the API and signalling | `caddy_data` (certificates, local CA), `caddy_config` |
| `api` | ASP.NET Core: login, scenes, devices, tokens, SignalR | `media` (images, videos), `keys` (login keys) |
| `livekit` | SFU: forwards the video of the phones and laptops | – |
| `postgres` | Database | `pgdata` |

Media (WebRTC) goes directly between the devices and LiveKit (7881/tcp, 7882/udp), never through Caddy. Everything
else goes over HTTPS on 443.

An optional fifth service, `backup` (profile `backup`, data in the volumes `backups` and `backup_status`), takes the
automatic backups: section 7.2.

Two ways to operate it:

- **On site (recommended):** the server (mini PC, second laptop or the Regie computer) sits on the same network as the
  phones and the Regie, connected to the router by cable. A subdomain points with an A record to the **internal** IP of
  the server, and the certificate comes through a DNS challenge. Lowest latency (target about 0.15 s), no internet
  needed for the media.
- **VPS:** the same stack on a Linux server on the internet. The devices then send over the internet: more latency
  and more upload bandwidth needed on site (about 2–3 Mbit/s per camera, up to 3 Mbit/s per screen – rough guide
  values).

## 2. Prerequisites

- **Server:** Linux with Docker Engine and Compose v2 (`docker compose version`), or Windows/macOS with Docker Desktop.
  Guide values: 4 CPU cores, 8 GB RAM, 20 GB free (plus space for videos and backups). Git for updates (not needed
  when the server runs the ready-made images of a release, section 14).
- **Windows:** PowerShell 7.4 or newer (`pwsh`) for the `.ps1` scripts; the `.sh` scripts run in Git Bash.
  Docker Desktop only starts after the user has signed in – so after a restart, sign in (or enable "Start Docker
  Desktop when you sign in" and set up automatic sign-in).
- **Docker Desktop (Windows/macOS) does not see real client IPs:** all devices appear with the same internal
  address. Consequences: the IP restriction of the output cannot be used, and the per-IP limits apply to all devices
  together (5 failed logins lock the login for 15 minutes for everyone; at most 10 pairing requests through `/join`
  in 10 minutes). For production use, prefer a Linux server.
- **Network on site:** a dedicated Wi-Fi (5 GHz) for the phones, without client isolation ("AP isolation", guest
  Wi-Fi), server and Regie laptop connected by cable. The server gets a fixed IP in the router (DHCP reservation):
  LiveKit passes this IP on to the devices (`STUDIOFLOW_NODE_IP`).
- **Domain:** a subdomain, for example `studioflow.opten.ch`, at a DNS provider with an API (see section 4).

After cloning on Linux, make the scripts executable if necessary: `chmod +x *.sh`.

## 3. Ports and firewall

| Port | Purpose | Reachable from |
|---|---|---|
| 443/tcp | HTTPS: Regie, sender, output, API, signalling | Devices on the Wi-Fi; proxy; on a VPS the internet |
| 443/udp | HTTP/3 (optional, browsers otherwise fall back to HTTP/2) | same as 443/tcp |
| 80/tcp | Redirect to HTTPS; in `acme` mode the Let's Encrypt check | same as 443/tcp |
| 7881/tcp | LiveKit media over TCP (fallback when UDP is blocked) | all sending and receiving devices |
| 7882/udp | LiveKit media over UDP (main path) | all sending and receiving devices |

Not published, and never to be opened: 7880 (LiveKit signalling, only through Caddy `/rtc`), 8080 (API),
5432 (PostgreSQL), 2019/2020 (Caddy internal).

- **Linux (ufw):** `sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp`.
  Note: Docker bypasses ufw for published ports (its own iptables chain). Restrict only through the `DOCKER-USER`
  chain or the firewall of the VPS provider.
- **Windows:** the Wi-Fi/LAN must be set to the network profile "Private". On first start Windows asks for permissions
  for Docker Desktop – allow them. If devices cannot connect, create rules (PowerShell as administrator):

  ```powershell
  New-NetFirewallRule -DisplayName 'StudioFlow HTTPS' -Direction Inbound -Protocol TCP -LocalPort 80,443 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow HTTP/3' -Direction Inbound -Protocol UDP -LocalPort 443 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow Media TCP' -Direction Inbound -Protocol TCP -LocalPort 7881 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow Media UDP' -Direction Inbound -Protocol UDP -LocalPort 7882 -Profile Private -Action Allow
  ```

- **VPS:** open the same ports in the provider's firewall. `STUDIOFLOW_NODE_IP` is then the public IP.

## 4. DNS and certificate

Browsers only release camera and screen over HTTPS – on the Wi-Fi as well. The TLS mode is set in
`STUDIOFLOW_TLS_MODE`.

| Mode | When | What is needed |
|---|---|---|
| `dns-<provider>` | **Recommended on site and on a VPS.** A real Let's Encrypt certificate, even if the server is only reachable internally | A record to the internal IP, API token of the DNS provider |
| `acme` | VPS, publicly reachable | A record to the public IP, 80/tcp and 443/tcp open |
| `internal` | Quick test without a domain (`localhost`, IP, local name) | Every device installs the root CA (`/ca.crt`) once |
| `custom` | Your own certificate (for example from IT) | Mount `fullchain.pem` and `privkey.pem` to `/certs` (see `docker-compose.override.example.yml`); renewal by hand |

### 4.1 Subdomain pointing to the internal IP

At the DNS provider, create an A record: `studioflow.opten.ch` → `192.168.1.50` (the LAN IP of the server). This is
safe: the address is only reachable inside your own network.

- Some routers discard DNS answers with private addresses ("DNS rebind protection", for example FRITZ!Box, pfSense).
  Then add an exception for the domain (FRITZ!Box: Home Network › Network › Network Settings › DNS rebind
  protection) or create a local DNS entry in the router. Menu names depend on the language of the device.
- Check from a device on the Wi-Fi: `nslookup studioflow.opten.ch` must return the internal IP.

### 4.2 DNS challenge per provider

`./setup.sh` asks for the mode and the token. The credentials end up in the `.env`.

| Provider | Mode | Variables | Token permissions |
|---|---|---|---|
| Cloudflare | `dns-cloudflare` | `CF_API_TOKEN` | Zone › Zone › Read and Zone › DNS › Edit for the zone |
| Infomaniak (CH) | `dns-infomaniak` | `INFOMANIAK_API_TOKEN` | Scopes `domain:read dns:read dns:write` |
| Hetzner | `dns-hetzner` | `HETZNER_API_TOKEN` | Token of the Hetzner Cloud project that holds the DNS zone (the old DNS console has been shut down) |
| deSEC | `dns-desec` | `DESEC_TOKEN` | Token of the account (also for the delegation below) |
| AWS Route 53 | `dns-route53` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | IAM: `route53:ListHostedZones*`, `GetChange`, `ChangeResourceRecordSets` |
| Gandi | `dns-gandi` | `GANDI_BEARER_TOKEN` | Personal access token with "Domain technical configurations" |
| OVHcloud | `dns-ovh` | `OVH_ENDPOINT` (for example `ovh-eu`), `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY` | GET/POST/PUT/DELETE on `/domain/zone/*` |

Caddy obtains the certificate on first start; renewal is automatic. Check:
`docker compose logs caddy | grep -i -E "certificate obtained|error"`.

### 4.3 Hostpoint, cyon and others without a module: delegate the challenge

There is no Caddy module for Hostpoint and cyon. The solution: delegate only the validation record `_acme-challenge`
by CNAME to a zone at deSEC (free) or Cloudflare. The A record stays with the current provider.

1. At [deSEC](https://desec.io), create an account and a domain, for example `studioflow-opten.dedyn.io`, and create a
   token.
2. At the current provider (zone `opten.ch`), create a CNAME:
   `_acme-challenge.studioflow` → `_acme-challenge.studioflow-opten.dedyn.io.`
3. Setup with delegation:

   ```bash
   DESEC_TOKEN=… ./setup.sh --domain studioflow.opten.ch --tls-mode dns-desec \
       --dns-challenge-domain _acme-challenge.studioflow-opten.dedyn.io
   ```

   (Windows: `$env:DESEC_TOKEN = '…'; ./setup.ps1 -Domain studioflow.opten.ch -TlsMode dns-desec -DnsChallengeDomain _acme-challenge.studioflow-opten.dedyn.io`)
4. Check: `nslookup -type=CNAME _acme-challenge.studioflow.opten.ch` shows the target at deSEC.

The same works with Cloudflare (`dns-cloudflare`, CNAME target in a zone at Cloudflare).

### 4.4 Internal mode: install the root certificate on the devices

In `internal` mode Caddy signs the certificates itself. Every device must trust the root CA once, otherwise the
browser blocks camera and screen. The CA lives in the volume `caddy_data` (valid for 10 years, included in every
backup). If the volume is lost, a new CA is created and all devices have to install it again.

Download on the device: `https://<domain>/ca.crt` (confirm the certificate warning once on the first visit).

- **iPhone/iPad:** open the link in Safari › "Allow" › Settings › General › VPN & Device Management › profile
  "Caddy Local Authority" › Install. Then **additionally** Settings › General › About › Certificate Trust Settings ›
  switch on "Caddy Local Authority".
- **Android:** download the file › Settings › Security › (More settings) › Encryption & credentials › Install a
  certificate › **CA certificate** › choose the file. Chrome trusts it afterwards.
- **Windows:** double-click the file › Install Certificate › Local Machine › "Place all certificates in the following
  store" › Trusted Root Certification Authorities. Or as administrator:
  `certutil -addstore -f Root studioflow-root-ca.crt`.
- **macOS:** double-click the file › keychain "System" › open the certificate › Trust › "Always Trust".
- **Firefox** (own certificate store, if the warning stays): Settings › Privacy & Security › View Certificates ›
  Authorities › Import › "Trust this CA to identify websites".

Menu names are given for systems set to English and differ on systems set to another language.

Access by IP instead of name: `--extra-hosts 192.168.1.50` in `setup` (also sets `STUDIOFLOW_DEFAULT_SNI`), then the
certificate is also valid for `https://192.168.1.50`. Or use `--domain 192.168.1.50` right away.

## 5. Setup

```bash
git clone <repo> studioflow && cd studioflow
./setup.sh                      # Linux/macOS (Git Bash works too)
pwsh ./setup.ps1                # Windows
docker compose up -d --build    # first start: builds the images (a few minutes)
docker compose ps               # all four services "healthy"?
```

This is the installation from the source: the images are built on the server. A server normally runs the ready-made
images of a release instead, without Git and without a build: see section 14.

`setup` asks for: LAN IPv4 (detected automatically, confirm it), TLS mode (+ email and token), domain, additional
addresses (`internal` only), origins that may embed the output (`STUDIOFLOW_FRAME_ANCESTORS`, for example the domain
of the proxy), admin user and password (twice, hidden, or leave empty for a generated password that is shown exactly
once). It generates the LiveKit keys and the database password, builds the API image and stores only the **hash** of
the password. The `.env` gets permissions 600.

- Without prompts: `./setup.sh --non-interactive --domain … --tls-mode … --generate-password` (all options:
  `./setup.sh --help`, `Get-Help ./setup.ps1 -Full`). Tokens then come from the environment.
- Run again (different domain, new password): `./setup.sh --force`. The old file stays as `.env.backup-<time>`; the
  database password and the LiveKit keys are kept (the database password cannot be changed through the `.env` after the
  first initialisation). Then `docker compose up -d`.
- **Put the `.env` into the password vault (Keeper) right away.** It is not in Git and not in the backups.
- Local development with `ng serve`: see `docker-compose.override.example.yml`.

First login: `https://<domain>/` with the admin account. On first start the API creates the database and the
production "Webinar".

The interface language follows the browser by default and can be changed in the Regie (section 13).

## 6. Start, stop, logs

| What | Command |
|---|---|
| Start / after a change to `.env` | `docker compose up -d` |
| Status and health checks | `docker compose ps` |
| Logs (live) | `docker compose logs -f --tail 100 api` (or `caddy`, `livekit`, `postgres`) |
| Restart one service | `docker compose restart api` |
| Stop (data stays) | `docker compose stop` or `docker compose down` |
| Resources | `docker stats`, `docker system df` |

- **Never `docker compose down -v`**: it deletes all volumes – database, media, certificates and the local CA.
- All containers have `restart: unless-stopped` and start by themselves after a crash or restart.
- Logs are limited to 5 × 10 MB per container. Tokens, output keys and invite links are redacted in the Caddy logs
  (`REDACTED`).
- Health check in detail: `docker inspect --format '{{json .State.Health}}' studioflow-api-1`.

## 7. Backup and restore

A backup is only worth something if it is taken regularly, kept somewhere else than the server and has been restored at
least once. This section covers all three: backups by hand (7.1), automatic backups (7.2), the copy to a second place
(7.3), restoring and the restore drill (7.4).

### 7.1 Backup by hand

```bash
./backup.sh                    # Windows: pwsh ./backup.ps1
./backup.sh --keep 14          # afterwards keep only the 14 newest backups
./restore.sh backups/2026-10-22_1430
```

A backup (`backups/YYYY-MM-DD_HHMM/`) contains the database (`database.dump`, pg_dump), the volumes `media`, `keys` and
`caddy_data` as `.tar.gz`, `backup-info.txt` and `SHA256SUMS`. It runs during operation and does not disturb a
broadcast. It contains private keys (login, certificates, CA): store the folder protected and copy it to another
device regularly. Take one by hand before an update (`./update.sh --backup` does) and before the webinar (section 9).

### 7.2 Automatic backups

Off by default. Switch them on with two lines in `.env` (and `BACKUP_TIMEZONE` so that 03:00 means your 03:00), then
start the service:

```bash
COMPOSE_PROFILES=backup
BACKUP_SCHEDULE='0 3 * * *'        # cron expression, here: every day at 03:00
BACKUP_TIMEZONE=Europe/Zurich      # default UTC
```

```bash
docker compose up -d --build       # builds the small backup image, restarts the API with the new settings
docker compose logs backup         # "Automatic backups: '0 3 * * *' ..."
docker compose exec backup /opt/backup/backup-job.sh    # take one now (same steps as the schedule)
```

What a run does, in this order:

1. **Waits while a broadcast is live.** The run looks every 5 minutes (`BACKUP_LIVE_POLL_SECONDS`) whether a production is
   live and starts as soon as the broadcast has ended. A broadcast that is never ended therefore blocks the backups
   (the warning below appears after 48 hours). If the state cannot be read, the backup runs anyway.
2. **Database and small volumes:** `pg_dump` over the network, `keys` and `caddy_data` as `.tar.gz`, into
   `YYYY-MM-DD_HHMM_auto/` with `backup-info.txt` and `SHA256SUMS` (same layout as 7.1, without `media.tar.gz`).
3. **Checks the new dump:** it is loaded into a throwaway database. A dump that does not load is discarded and counts as
   a failure, so a broken backup never pushes out a good one.
4. **Retention:** the newest backup of each of the last `BACKUP_KEEP_DAILY` (7) days and of the last
   `BACKUP_KEEP_WEEKLY` (4) weeks is kept, the rest is deleted: about one month of history. Days and weeks without a
   backup are not counted, so a pause does not shorten the history. Only folders ending in `_auto` are touched.
5. **Media, incrementally:** videos can be large, so they are not archived again every day. Files in `media` never
   change (the name is the asset id), so only files that are not yet in `media/` next to the dated folders are copied.
   Nothing is deleted when an asset is removed in the Regie, so the copy grows; remove old files by hand if needed.
6. **Off-site copy** if a second target is configured (7.3).

**Where the backups are.** In the Docker volume `backups` (`docker volume inspect studioflow_backups`), not in
`./backups`: a named volume behaves the same on a Linux server and in Docker Desktop on Windows (no file permissions of
the host, no Windows paths, no virus scanner in between). Fetch a backup to the host with
`docker compose cp backup:/backups/2026-10-23_0300_auto ./backups/` (and `backup:/backups/media ./backups/` for the media)
and restore it as in 7.4. The volume is on the same disk as everything else: **it does not protect against a failed
disk or a stolen server; the off-site copy (7.3) does.**

**Why inside the stack and not cron or the Task Scheduler.** The service runs on every system where the stack runs, with
the same files and the same behaviour, restarts with Docker (`restart: unless-stopped`) and needs nothing on the host: no
cron or systemd on Linux, no Task Scheduler, no signed-in user, no `pwsh` or Git Bash on Windows. It knows the
broadcast state, verifies its own result and reports to the API. A host timer still works if you prefer it
(`15 3 * * * cd /opt/studioflow && ./backup.sh --keep 14 >> backups/backup.log 2>&1`; Windows: Task Scheduler, action
`pwsh.exe -NoProfile -File C:\studioflow\backup.ps1 -Keep 14`), but it knows nothing about broadcasts, does not verify and
is not noticed by the readiness check. On Docker Desktop the stack (and so the schedule) only runs while Docker Desktop
runs; a missed run is simply taken at the next scheduled time.

**How a failure is noticed.**

- The service writes a status file (`backup-status.json` in the volume `backup_status`, which the API mounts read-only) after
  every step. The readiness check of the API reads it: `docker compose exec api wget -q -O - http://127.0.0.1:8080/health/ready`.
  It prints `Healthy`, or `Degraded` followed by the reasons, with HTTP status 200: a warning, never an outage.
- It warns when the last run failed (with the reason), when the last successful backup is older than
  `BACKUP_WARN_AFTER_HOURS` (default 48), when there is no backup yet after that time, when no off-site copy is
  configured ("the backups stay on this server"), or when the last off-site copy failed or is too old. A successful run
  clears the failure.
- Details: `docker compose logs --tail 100 backup`. The Regie does not show the backup state yet (a UI task); it can read
  the same status file through the API.

Switch off: remove the two lines, `docker compose up -d --remove-orphans`, and `docker compose --profile backup rm -sf backup`.
The backups stay in the volume until you remove it (`docker volume rm studioflow_backups`).

`setup.sh --force` writes a new `.env`: copy `COMPOSE_PROFILES` and the `BACKUP_*` lines from `.env.backup-<time>` again.

### 7.3 Second target (off-site copy)

The copy goes to any storage that `rclone` supports: S3-compatible storage (for example from a Swiss provider), SFTP
(a NAS, another server), WebDAV. Backends that sign in through a browser (Google Drive, Dropbox) are not supported: their
token would have to be refreshed in a configuration that is read-only here. Everything that leaves the server is
encrypted with [age](https://age-encryption.org) and a **public** key; the private key is never on the server, so a
stolen server or a hacked storage account does not reveal the backups.

1. **Make a key pair on your own machine** (install `age`): `age-keygen -o studioflow-backup.key`. It prints the public key
   (`age1...`). Put the key file into the password vault (Keeper) and delete it from the machine. Without it the off-site
   copies cannot be read, with it anybody can read them. (Without installing anything:
   `docker compose --profile backup run --rm --no-deps --entrypoint age-keygen backup` prints a pair once; copy the
   private part to the vault right away.)
2. **Define the target** on your own machine with `rclone config` (name it `offsite`; for S3 choose `s3`, provider
   `Other`, endpoint, region and access key; for a NAS `sftp`). Create the bucket or folder and test it:
   `rclone lsd offsite:`. Use credentials that may write and read; if they may not delete, the retention at the target
   only warns (use a lifecycle rule of the storage instead).
3. **Hand the configuration to the service** as one line of base64 in `.env`. The file must contain only the remote(s) it
   needs. Linux and macOS: `base64 -w0 ~/.config/rclone/rclone.conf` (macOS: `base64 -i ...`); Windows PowerShell:
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:APPDATA\rclone\rclone.conf"))`.

```bash
BACKUP_RCLONE_REMOTE=offsite:studioflow-backups     # <remote>:<bucket or folder>
BACKUP_RCLONE_CONFIG=W29mZnNpdGVdCnR5cGUgPSBzMwo...  # the base64 line (a secret: it holds the access keys)
BACKUP_AGE_RECIPIENT=age1xxxxxxxx...                 # public key; several keys separated by spaces
```

4. `docker compose up -d`, then `docker compose exec backup /opt/backup/backup-job.sh` and look at the target. The service
   refuses to start with a clear message if the remote is not defined, the key is not an age key, or the target has no key
   at all (`BACKUP_OFFSITE_UNENCRYPTED=true` allows that if the remote encrypts by itself, for example an rclone `crypt`
   remote).

At the target there is one folder per backup (`2026-10-23_0300_auto/` with `database.dump.age`, `keys.tar.gz.age`,
`caddy_data.tar.gz.age`, `backup-info.txt.age` and, uploaded last, the plain `SHA256SUMS`) and `media/` with every media
file as `<production>/<asset>.<ext>.age`. A folder without `SHA256SUMS` is incomplete. Media are uploaded once and
never again; the dated folders follow the same retention as the local ones. The upload of the first run can take long;
the next scheduled run waits for it.

### 7.4 Restore and the restore drill

Restore (`./restore.sh` / `restore.ps1`): verifies the checksums, asks for confirmation (unless `--yes`), first takes a
backup of the current state (`backups/…_pre-restore`), stops the API and Caddy, restores the database into a new
database and only then swaps it in (if the restore fails, the old one stays unchanged), replaces the volumes and starts
everything. During a broadcast it refuses to start (`--force` overrides). If the schedule of the backup service could fire
while the restore runs, stop the service first (`docker compose stop backup`); the restore starts it again.

**From an automatic backup.** Fetch the folder and the media copy to the host, then restore the folder. A backup without
`media.tar.gz` takes the media from the folder `media/` next to it:

```bash
mkdir -p backups
docker compose cp backup:/backups/2026-10-23_0300_auto backups/
docker compose cp backup:/backups/media backups/
./restore.sh backups/2026-10-23_0300_auto
```

**From the off-site copy** (server lost): on a machine with `rclone` (same remote definition) and `age`, put the private
key next to you:

```bash
rclone copy offsite:studioflow-backups/2026-10-23_0300_auto backups/2026-10-23_0300_auto
rclone copy offsite:studioflow-backups/media backups/media
for f in backups/2026-10-23_0300_auto/*.age; do age -d -i studioflow-backup.key -o "${f%.age}" "$f" && rm "$f"; done
find backups/media -name '*.age' -exec sh -c 'age -d -i studioflow-backup.key -o "${1%.age}" "$1" && rm "$1"' _ {} \;
./restore.sh --verify backups/2026-10-23_0300_auto     # checks before anything is replaced
./restore.sh backups/2026-10-23_0300_auto
```

**Restore drill.** `./restore.sh --verify <folder>` (Windows: `pwsh ./restore.ps1 <folder> -Verify`) verifies the checksums
and loads the dump into a throwaway database of the running PostgreSQL. It prints the number of tables and the newest
migration and removes the database again. Nothing is replaced or stopped, so it is safe at any time. The service does
the same check after every backup; the drill proves the rest: that you can get the files back and decrypt them. Do the
off-site variant above once a month, with the private key from the vault, and a full restore on a spare machine once a
year. A backup that was never restored is not a backup.

Moving to a new server: clone the repo, put the `.env` back from the vault (or run `setup` again),
`docker compose up -d --build`, then `./restore.sh <backup>`.

## 8. Update

**Never during a broadcast.** The script checks this itself and aborts as long as a production is live.

This section describes an installation from the source (Git checkout, images built on the server). With the ready-made
images of a release the same command pulls the new version instead, and `--version` selects it (also to go back):
section 14.

```bash
./update.sh --backup           # Windows: pwsh ./update.ps1 -Backup
```

Sequence: check the broadcast status (`broadcast-status` of the API) → optional backup → `git pull --ff-only` →
`docker compose up -d --build` → wait until all services are healthy → status. Volumes are kept.

- With local changes or a diverged state, `git pull --ff-only` aborts without restarting anything.
- New variables in a new version: `docker compose` reports them at start; compare with `.env.example`.
- If the API does not answer (broadcast status unknown), the script refuses as well; with `--force` it goes ahead
  anyway (for example when the API restarts all the time because of a bug and the update brings the fix).
- Back to an earlier version: `git log --oneline`, `git checkout <commit>`, `./update.sh --no-pull`. If the new
  version migrated the database, also restore the backup `…_pre-update`. Later return with `git checkout main`.
- Cleaning up after updates: `docker image prune` removes old, unused build images.

## 9. Checklist before the webinar

**The day before**

- [ ] `./update.sh --backup` (if an update is pending) – afterwards no more updates until after the broadcast.
- [ ] `docker compose ps`: all services "healthy". Certificate valid (the Regie loads without a warning).
- [ ] Scenes, per-item fallbacks and slates (“Starting soon”, “Thanks for watching”) prepared.
- [ ] Output link tested at the proxy: the page loads in the iframe, the picture runs, the proxy's domain is in
      `STUDIOFLOW_FRAME_ANCESTORS`; if the IP restriction is active: proxy IP entered (on Docker Desktop the API only
      sees the internal Docker address – the IP restriction only works reliably on a Linux server).

**On site, 60 minutes before**

- [ ] Server and Regie laptop **connected by cable** to the router; phones on the **5 GHz** Wi-Fi without guests and
      without client isolation; the server has its fixed IP (`STUDIOFLOW_NODE_IP`).
- [ ] Phones **on a charging cable**, mounted firmly, Do Not Disturb on, battery saver off, auto-lock off.
- [ ] Pair the devices (phones by QR code, laptops through `/join` with a verification code or an invite link).
- [ ] **Tech check** in every sender: camera, network, bandwidth (≥ 6 Mbit/s good, ≥ 3 Mbit/s tight).
- [ ] Monitoring view: bitrate, packet loss and battery of all stations unremarkable.
- [ ] Output at the proxy: picture current, latency in the output chip plausible; test switch.
- [ ] `./backup.sh`.
- [ ] With automatic backups: `docker compose exec api wget -q -O - http://127.0.0.1:8080/health/ready` prints `Healthy`
      (otherwise it lists what is wrong with the backups, section 7.2).

**15 minutes before**

- [ ] Standby slate runs at the proxy; all stations green; speakers share the right screen.
- [ ] A second device ready for the Regie (login tested) – in case the Regie browser crashes.

## 10. What to do if …

| Event | StudioFlow reacts by itself | At the proxy | What to do |
|---|---|---|---|
| A phone briefly loses the Wi-Fi | ICE restart, the session stays; the station flashes amber "reconnecting" | brief freeze frame (≈ 1–3 s) | Nothing. Afterwards confirm the "recovered" message (for example "gone for 9 s") with "Seen". If it lasts longer than ≈ 30 s: check the phone (Wi-Fi, sender page in the foreground, battery); until then take a scene without this camera – after the hold time the fallback or the dimmed freeze frame takes over. |
| A call or another app takes the camera | The sender requests the camera again and republishes (3 attempts) | freeze frame, then live again | End/decline the call and bring the sender page back to the foreground. If the station shows "no picture": restart the camera in the sender page or reload the page. Prevent it with Do Not Disturb. |
| The sender page is reloaded | same device ID, same slot, auto start with the last settings | brief freeze frame | Nothing – unless the browser asks for camera permission again (iOS): "Allow". |
| Someone stops their screen sharing | the Regie warns (“S1 sharing stopped”), the sender shows "Share again" | the tile's fallback | In the Regie, ask for a new share ("Ask to share again") or ask the person to click "Share again" and choose the screen; otherwise change scene. The screen returns to the same place. |
| The Wi-Fi is overloaded | Simulcast lowers the layers; the Regie shows packet loss and bitrate per station | slightly less sharp, no stutter | Take foreign devices off the Wi-Fi, set phones to 720p, stop sources that are not needed, have laptops share one window instead of the whole screen, change the Wi-Fi channel. |
| The Regie browser crashes | the output keeps running, it does not depend on the Regie browser | nothing | Reopen the browser and sign in (the login stays valid for 12 h); layout and Studio Mode come back from the browser. If necessary use the second Regie device. |
| API restart or update | on shutdown the API disconnects all hub connections immediately (restart within a few seconds, without "reconnecting"); SignalR reconnects, the state is reconciled by version; media keeps running. If a device with a source in Program or Preview does not return within 15 s, the Regie reports it ("reconnecting") | nothing | Nothing. (Still never update during a broadcast.) |
| The database (PostgreSQL) is gone | Regie commands fail within a few seconds with a "database currently unreachable, try again in a moment" message; hubs, output and media keep running; once the database is back everything works again without an API restart | nothing | `docker compose ps` / `docker compose logs --tail 200 postgres`; `docker compose start postgres`. Then repeat the command. |
| A container crashes | Docker restarts it; all clients reconnect by themselves | freeze frame, a few seconds (LiveKit) | `docker compose ps`; if a service keeps restarting ("Restarting"): `docker compose logs --tail 200 <service>` and section 11. |
| The whole server restarts | all containers start automatically, all devices come back by themselves | interruption until the server is back | Windows: sign in so that Docker Desktop starts. Wait until `docker compose ps` shows everything "healthy". If the server got a new IP: adjust `STUDIOFLOW_NODE_IP` in `.env`, `docker compose up -d`. |
| A device is opened in a second tab | the old tab is disconnected and stays off ("Opened in another tab"), no ping-pong | nothing | In the tab you want, click "Continue here". |

## 11. Troubleshooting

### Phones or laptops do not connect

**The page does not load or shows a certificate warning**

1. Right Wi-Fi? No guest Wi-Fi, no client isolation. Switch off mobile data; test with VPN and iCloud Private Relay
   off.
2. DNS: does `nslookup <domain>` on the device (or on a laptop on the same Wi-Fi) return the server IP? If not, see
   section 4.1 (DNS rebind protection).
3. Firewall: is 443/tcp open (section 3)? Test from a laptop: `Test-NetConnection <ip> -Port 443` or
   `nc -vz <ip> 443`.
4. Certificate: `internal` mode → CA installed and (iOS) switched on in the certificate trust settings? Date and time
   of the device correct? `dns-*` mode → `docker compose logs caddy` (see below).

**The page loads, but no picture ("connecting…")**

1. `STUDIOFLOW_NODE_IP` wrong or outdated: `docker compose logs livekit | grep nodeIP` shows the announced IP. It must
   be the current LAN IP of the server (not 127.0.0.1, not a Docker or WSL address). Correct it in `.env`, then
   `docker compose up -d`.
2. Media ports: are 7882/udp and 7881/tcp open (section 3)? Test: `Test-NetConnection <ip> -Port 7881`.
3. Client isolation on the Wi-Fi prevents connections between devices and the server.
4. If it only works over TCP (7881), it runs, but with more latency – then UDP 7882 is blocked.

### Black picture

- In the Regie, look at the state of the source: "sharing stopped", "no picture", "blocked", "not connected"?
- Phone: the sender page must stay in the foreground; with the screen locked or in another app, iOS stops the camera.
  Use the sender page's dark mode instead of the screen lock.
- Laptop: was a minimised window shared? Restore the window or share the whole screen.
- Output at the proxy: `/o/<slug>?k=…&debug=1` shows connection state, resolution, frame rate and bitrate per source.
  "No access" → the key was regenerated (send the new link) or the IP restriction does not match.

### High latency

- Output with `?debug=1`: estimated latency and jitter buffer.
- Server or Regie on Wi-Fi instead of cable? Phones on the 2.4 GHz band? Overloaded Wi-Fi (section 10)?
- Media over TCP instead of UDP (7882/udp blocked): in Chrome `chrome://webrtc-internals` › the active candidate pair
  shows `udp` or `tcp`.
- What the proxy adds in buffering is outside StudioFlow.

### Certificate is not issued (dns-*, acme)

- `docker compose logs caddy | grep -i -E "acme|challenge|obtain|error"`.
- Token and permissions at the provider (section 4.2); token in `.env` without a trailing space.
- Delegation: `nslookup -type=CNAME _acme-challenge.<domain>` shows the target; `STUDIOFLOW_DNS_CHALLENGE_DOMAIN`
  matches the target exactly.
- `acme` mode: 80/tcp and 443/tcp reachable from the internet, A record to the public IP.
- After several failed attempts Let's Encrypt blocks for an hour; Caddy keeps trying by itself (also with ZeroSSL).
  After a correction in `.env`: `docker compose up -d`.

### Login does not work

- After 5 failed attempts from the same IP the login is locked for 15 minutes (the API answers with 429).
- Forgot the password: `./setup.sh --force`, answer no to the question about keeping the existing admin password, set a
  new password, then `docker compose up -d`.
- `docker compose logs api` at start: if `ADMIN__PASSWORDHASH`/`ADMIN__PASSWORD` is missing, the API does not start.

### Simulating network problems on purpose (test, never during a broadcast)

The profile `chaos` (only in `docker-compose.yml`, not in the release installation of section 14) delays and drops
packets in the LiveKit network (media, signalling and API ↔ LiveKit):

```bash
docker compose --profile chaos run --rm netem apply 100 10 0          # 100 ms delay per direction, 10 ms jitter
docker compose --profile chaos run --rm netem apply 0 0 5             # 5 % packet loss
docker compose --profile chaos run --rm netem apply 0 0 0 2mbit       # bandwidth 2 Mbit/s
docker compose --profile chaos run --rm netem show
docker compose --profile chaos run --rm netem clear                   # always remove it again
```

The setting stays until `clear` or until the LiveKit container is recreated.

## 12. Security in operation

- `.env`, `backups/` and the volume `caddy_data` contain secrets and private keys: never pass them on, keep backups
  encrypted or in a protected place.
- Only open the ports from section 3. The API, the database and the LiveKit signalling are only reachable through
  Caddy.
- Never set `STUDIOFLOW_TRUSTED_PROXIES` to the LAN – otherwise the IP restriction of the output can be bypassed with a
  forged `X-Forwarded-For`.
- Give the output link only to the proxy; if you suspect it has leaked, regenerate the key in the Regie.
- Keep the operating system and Docker up to date; apply StudioFlow updates as described in section 8.

## 13. Interface language

The interface is English by default, with German (Switzerland) as the first translation. Spelling in German follows
Swiss conventions (ss instead of ß, « » as quotation marks, decimal comma).

**Regie, monitoring page and sender**

- The language follows the browser by default. Browser languages `en` and `en-*` give English; `de` and `de-*`
  (`de-DE`, `de-AT`, `de-LI` and so on) give German (Switzerland); any other language falls back to English.
- To change it, open the language setting: in the Regie through the gear button in the header (also on the login
  page), in the sender in the footer of the start page and at the bottom of the tech check. The choices are
  "Automatic (browser language)", "English" and "Deutsch (Schweiz)".
- The choice is stored in the browser (`localStorage`, key `studioflow.locale`) and is shared by the Regie, the
  monitoring page and the sender on the same address. It takes effect immediately in all open tabs, without a reload and
  also during a broadcast.

**Output page**

- The output page has no setting and ignores the stored choice. It uses `?lang=` first, then the browser language, then
  English. On an OBS or proxy machine whose browser language does not match, add the flag to the link:
  `/o/<slug>?k=…&lang=de-CH` (values `en` and `de-CH`).
- It only affects the texts the page draws itself, such as "No access" or the hold message. Names you typed (scenes,
  standby and end slates) are shown as entered.
- All output flags: `bg=transparent` (transparent background), `debug=1` (measuring overlay), `latency=1` (test aid),
  `lang=` (language).

**Texts from the server**

- API error texts, log texts and defaults for new productions (scenes "Welcome", "Presentation", "Break", slates
  "Starting soon" and "Thanks for watching") are English. The Regie translates errors and log entries by code; the
  defaults stay English until you rename them.

## 14. Operating with ready-made images

Every release of StudioFlow comes as ready-made Docker images. A server pulls them: no Git checkout, no Node, .NET or
Caddy build, no build that can fail on a network problem. This is the recommended way to run a server. How releases
are made: `docs/releasing.md`.

| Image | Content |
|---|---|
| `ghcr.io/opten/studioflow-web` | Caddy (TLS, DNS modules) with the Regie, sender and output frontends |
| `ghcr.io/opten/studioflow-api` | The API with its commands (`hash-password`, `broadcast-status`) |

Both always have the same version (`0.4.2`): they are built from one commit and must match. `livekit` and `postgres`
are third-party images with a fixed version in the Compose file.

### 14.1 Install from a release

1. Sign in to the registry, as long as the repository is private (section 14.5): `docker login ghcr.io` with your
   GitHub user name and a personal access token (classic) with the scope `read:packages`.
2. Download `studioflow-X.Y.Z.tar.gz` and `SHA256SUMS` from the GitHub release (the release page, or
   `gh release download vX.Y.Z --repo OPTEN/FlowStudio`), check them and unpack the folder:

   ```bash
   sha256sum -c SHA256SUMS --ignore-missing     # macOS: shasum -a 256 -c ...
   tar -xzf studioflow-X.Y.Z.tar.gz && cd studioflow-X.Y.Z    # Windows 10/11: the same command works in a terminal
   ```

3. `./setup.sh` (Windows: `pwsh ./setup.ps1`) asks the questions of section 5, pulls the API image for the password hash
   and writes the `.env`. Put it into the password vault.
4. `docker compose up -d` pulls the images of this release and starts the stack; `docker compose ps` shows four
   healthy services. First login as in section 5.

The folder holds `docker-compose.yml` (the release file: it names the images instead of building them), `.env.example`,
the `setup`, `update`, `backup` and `restore` scripts, this runbook (`docs/runbook.md`), `QUICKSTART.md` and `VERSION`.
Everything else in this runbook (sections 3, 4, 6, 7, 9-13) applies unchanged. Differences: the profile `chaos`
(`netem`) does not exist, and `docker compose build` has nothing to build.

### 14.2 Which version runs

The version is the variable `STUDIOFLOW_IMAGE_TAG`: in the `.env` if it is set there, otherwise the default in
`docker-compose.yml`, which is the release the folder came from. `./update.sh --version` writes it to the `.env`.
Ways to see what runs:

```bash
docker compose images                       # image names with their tags
docker compose ps api --format '{{.Image}}'
```

The API (`GET /api/system/info`, signed in as admin) and the file `backup-info.txt` of every backup report the
version as `0.4.2+1a2b3c4`: the release and the commit the image was built from.

| `STUDIOFLOW_IMAGE_TAG` | Meaning |
|---|---|
| `0.4.2` | A release. Recommended: a server runs a version that was chosen on purpose |
| `latest` | The newest release at the moment of the pull. `./update.sh` resolves it and writes the number |
| `main` | The latest build of the main branch that passed all tests. For trying things out, never for a webinar |
| `sha-1a2b3c4` | The build of one commit |

`STUDIOFLOW_IMAGE_REGISTRY` (default `ghcr.io/opten`) replaces the registry path, for example for a mirror.

### 14.3 Update

**Never during a broadcast.** The script checks this and refuses while a production is live (section 8).

```bash
./update.sh --backup                 # the newest release; Windows: pwsh ./update.ps1 -Backup
./update.sh --backup --version 0.4.2 # a specific release; Windows: -Version 0.4.2
```

Sequence: check the broadcast status → optional backup (`backups/..._pre-update`) → `docker compose pull` → write
`STUDIOFLOW_IMAGE_TAG` to the `.env` → `docker compose up -d --wait` → status. The pull happens before anything is
touched: when it fails (network, `denied`), the running stack and the `.env` stay as they were. Volumes are kept.

- The images carry the program; the Compose file and the scripts in the folder belong to the release the folder came
  from. When the release notes of a newer version say that they changed (a new variable in `.env.example`, a new
  service), download that release and unpack its `studioflow-X.Y.Z.tar.gz` over the folder (`.env`, `backups/` and
  `docker-compose.override.yml` are not part of it and stay; local changes to the Compose file belong into the override
  file), then run `./update.sh` again. The script warns when the folder and the images are from different releases.
- New variables: `docker compose` names them at the start; compare with `.env.example`.
- `./update.sh --no-pull` only restarts, for example after a change to the `.env` (it fetches nothing).
- Cleaning up after updates: `docker image prune` removes the images of earlier versions that no container uses.

### 14.4 Roll back

```bash
./update.sh --version 0.4.1          # the version that ran before; the script prints it before it restarts
```

The database is migrated when the API starts, and a migration is not undone by starting an older API. Two cases:

- **The newer version did not change the database schema** (no migration in the release notes): the command above is
  enough.
- **It did** (or you are not sure): after going back, restore the backup that was taken before the update. It is the
  newest `backups/..._pre-update` folder; its `backup-info.txt` shows the `version:` it belongs to, which must be the
  version you went back to:

  ```bash
  ./update.sh --version 0.4.1
  ./restore.sh backups/2026-10-22_1430_pre-update
  ```

  Everything that was entered after that backup is lost.

That is why every update starts with `--backup`.

### 14.5 Access while the repository is private

As long as the repository is private, the packages are private too. Every server needs a token once:

1. GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic): scope `read:packages`, and the
   account must be allowed to read the repository.
2. `docker login ghcr.io -u <github user>`, paste the token. Docker stores it on the server (`~/.docker/config.json`);
   treat it like a password and keep it in the vault.

When the repository is public (#5) the packages are made public and this step disappears. `pull access denied` or
`denied` during `setup` or `update` means: not signed in, a token without `read:packages`, or an expired token.

### 14.6 Verify what you got

Every image is signed by the release workflow, carries an SBOM and a provenance attestation, and the version tag has
the same digest as the commit's `sha-` tag that passed the tests. Commands: `docs/releasing.md`, section 6.

### 14.7 Images with a Git checkout

A Git checkout can run the ready-made images as well: put `COMPOSE_FILE=docker-compose.release.yml` into the `.env`
(the scripts notice it), or call `docker compose -f docker-compose.release.yml ...`. Without that, `docker-compose.yml`
builds from the source as described in sections 5 and 8; `./update.sh --version` then explains that it is for the
ready-made images.

## 14. Dependency updates (Renovate)

For the maintainers of the repository. [Renovate](https://docs.renovatebot.com) keeps the dependencies up to date: npm,
NuGet, the Docker images in `docker-compose.yml` and the Dockerfiles, the Caddy DNS modules in `infra/caddy/Dockerfile`,
the .NET SDK, the Node.js version and the GitHub Actions. Updates arrive as pull requests that the normal CI checks;
nothing is changed on a running server (apply them with section 8). The rules are in `.github/renovate.json5`.

**One-time setup by the repository owner**

1. Install the [Renovate GitHub app](https://github.com/apps/renovate) for the repository (free). It opens a
   "Configure Renovate" pull request first; the configuration is already in the repository, merge or close it.
2. Settings › Code security: enable the **dependency graph** and **Dependabot alerts** (not Dependabot version updates).
   Renovate reads the alerts and opens security fixes immediately; without them it still checks the OSV database.
3. Settings › Branches › protection for `main`: require the six CI jobs (`lint-typecheck`, `unit-web`, `api`, `contracts`,
   `build-images`, `e2e-smoke`) and allow auto-merge (Settings › General). Automerge below only merges when these are green;
   the job `audit` is a report and not required.

**What arrives, and when**

| What | Pull requests | Merged by |
|---|---|---|
| Security fixes | at once, any time, label `security` | a person |
| Patch updates of npm dev dependencies and of the test packages of NuGet | Monday before 07:00 (Europe/Zurich), one PR each | **Renovate**, when CI is green |
| Minor updates of npm dev dependencies | Monday, one PR | a person |
| Angular (with TypeScript-compatible tools), `.NET and EF Core`, `Caddy and DNS modules`, `PostgreSQL` (17.x), `Node.js`, `Playwright`, `GitHub Actions` | Monday, one PR per group | a person |
| LiveKit (server image and `livekit-client`) | only after approval on the dashboard | a person, after a full E2E run |
| Major versions of Angular, .NET, npm, TypeScript | only after approval on the dashboard | a person |
| PostgreSQL 18 and later, the next Node.js and `@types/node` major | never (a project of its own) | - |
| `package-lock.json` refresh | first Monday of the month | a person |

The **Dependency dashboard** (an issue that Renovate keeps up to date) lists everything that is open, waiting for
approval or blocked. A release must be 3 days old before it is proposed. Images are pinned by digest next to the tag
(`postgres:17.11-alpine@sha256:...`) and actions by commit SHA; the first run proposes the pins in one pull request.

**Reviewing a pull request.** CI builds, tests and runs the smoke E2E set. Read the release notes that Renovate links.
For `.NET and EF Core` check that the SDK image and the runtime image come from the same release (comment in
`apps/api/Dockerfile`). Merge, then update the server (section 8) when no broadcast is planned.

**LiveKit.** Server and client are a pair: the specs document how version 1.13.10 of the server and 2.23.0 of the client
behave. Tick the LiveKit group on the dashboard only when both are meant to move. Then run the workflow **E2E full**
(Actions › E2E full › Run workflow, branch of the pull request) and read the LiveKit and net areas of the result before
merging. Test with real phones once (`docs/testing.md`, section 4).

**PostgreSQL.** Renovate proposes 17.x. A new major version cannot read the old data directory: it needs a dump and
restore (section 7) and is its own issue. Take a backup before updating to a new 17.x as usual.

**Reports.** Every pull request run has the job `audit` (`npm audit`, `dotnet list package --vulnerable`; warnings and a
summary, never a failure). The nightly **E2E full** run scans the images with Trivy and puts the result in its summary.

**Checking the configuration** (needs Node.js): `npx --yes --package renovate -- renovate-config-validator --strict`, and
what Renovate finds in the repository: `npx --yes renovate --platform=local --dry-run=extract` (with the repository
configuration passed as `RENOVATE_CONFIG_FILE=.github/renovate.json5` until it is committed).
