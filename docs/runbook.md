# StudioFlow – Operations guide (runbook)

For everyone who runs StudioFlow on site or on a VPS: set it up, start it, back it up, update it and react quickly
during a webinar. Technical details are in `docs/architecture/implementation-spec.md` (section 10), the optional
overrides in `.env.example`. The only tool is `docker compose`.

Interface texts are quoted as they appear in the English interface. The German translation of each text is in
`packages/i18n/src/messages/de-CH/`; see section 13 for how the language is chosen. The Regie (control room) is the
operator's screen. The word "Regie" is kept as a proper noun throughout.

## 1. Overview

One Docker Compose stack. `docker compose up -d` is the whole installation: there is no script to run and no file to write.
The stack makes its own secrets on the first start, and the first-run wizard in the Regie sets up the rest.

| Service | Purpose | Data (volume) |
|---|---|---|
| `init` | Runs once per start and exits: makes the internal secrets (database password, LiveKit key pair) on the first start and never again | `secrets` |
| `caddy` | HTTPS, certificates, serves the Regie (`/`), sender (`/join`) and output (`/o/…`), forwards the API and signalling. Its configuration comes from the API | `caddy_data` (certificates, local CA), `caddy_config`, `caddy_certs` (an uploaded certificate) |
| `api` | ASP.NET Core: login, scenes, devices, tokens, SignalR, the server settings | `media` (images, videos), `keys` (login keys) |
| `livekit` | SFU: forwards the video and the sound of the phones and laptops. A thin wrapper restarts it when the media address changes | `livekit_config` |
| `postgres` | Database | `pgdata` |
| `backup` | Scheduled and manual backups, restore (section 7) | `backups`, `backup_status`, `backup_config` |

Media (WebRTC) goes directly between the devices and LiveKit (7881/tcp, 7882/udp), never through Caddy. Everything else
goes over HTTPS on one port, **8443** by default. **Nothing listens on port 80.**

The settings that used to be written into a `.env` file by a script (address, certificate, media address, embedding, backup
schedule) are saved in the database through the Regie ("Server settings") and are therefore part of every backup. The API
hands them to Caddy, LiveKit and the backup service over the internal networks of the stack. No container has access to the
Docker socket. The admin interface of Caddy is not a network service at all: it is a unix socket in a volume that only Caddy
and the API mount, so no other container (LiveKit, PostgreSQL, the backup service) can read the configuration or replace it.
The stack has two networks: `studioflow` (Caddy, API, LiveKit) and `backend` (API, PostgreSQL, backup service); LiveKit, the
one container that takes media traffic from the internet, cannot reach the database.

Two ways to operate it:

- **On site (recommended):** the server (mini PC, second laptop or the Regie computer) sits on the same network as the
  phones and the Regie, connected to the router by cable. Lowest latency (target about 0.15 s), no internet needed for the
  media. The certificate comes from the stack itself (every device trusts it once, section 4.4), from Let's Encrypt through
  a DNS challenge (section 4.2) or is your own.
- **VPS:** the same stack on a Linux server on the internet. The devices then send over the internet: more latency
  and more upload bandwidth needed on site (about 2–3 Mbit/s per camera, up to 3 Mbit/s per screen – rough guide
  values).

## 2. Prerequisites

- **Server:** Linux with Docker Engine and Compose v2.24 or newer (`docker compose version`), or Windows/macOS with Docker
  Desktop. Guide values: 4 CPU cores, 8 GB RAM, 20 GB free (plus space for videos and backups). The commands in this
  runbook are the same on every system and run in any terminal: no Git, no PowerShell or Bash scripts. Git is only needed
  to build from the source (section 5.4).
- **Windows:** Docker Desktop only starts after the user has signed in – so after a restart, sign in (or enable "Start
  Docker Desktop when you sign in" and set up automatic sign-in).
- **Docker Desktop (Windows/macOS) does not see real client IPs:** all devices appear with the same internal
  address. Consequences: the IP restriction of the output cannot be used, and the per-IP limits apply to all devices
  together (5 failed logins lock the login for 15 minutes for everyone; at most 10 pairing requests through `/join`
  in 10 minutes). For production use, prefer a Linux server.
- **Network on site:** a dedicated Wi-Fi (5 GHz) for the phones, without client isolation ("AP isolation", guest
  Wi-Fi), server and Regie laptop connected by cable. The server gets a fixed IP in the router (DHCP reservation):
  LiveKit passes this IP on to the devices (the "media address" of the wizard).
- **Domain (optional):** a name such as `studioflow.example.com` for the server. Needed for a Let's Encrypt certificate
  (a DNS provider with an API, section 4.2); optional for the local certificate; devices otherwise use the IP address.

## 3. Ports and firewall

| Port | Purpose | Reachable from |
|---|---|---|
| 8443/tcp | HTTPS: Regie, sender, output, API, signalling (`STUDIOFLOW_HTTPS_PORT`) | Devices on the Wi-Fi; proxy; on a VPS the internet |
| 8443/udp | HTTP/3 (optional, browsers otherwise fall back to HTTP/2) | same as 8443/tcp |
| 7881/tcp | LiveKit media over TCP (fallback when UDP is blocked) | all sending and receiving devices |
| 7882/udp | LiveKit media over UDP (main path) | all sending and receiving devices |

There is **no port 80** and no redirect: addresses are always written with the port (`https://192.168.1.50:8443/`). If
8443 is taken by another program, or you want the usual 443, set `STUDIOFLOW_HTTPS_PORT` (section 11, "Port already in
use"). Not published, and never to be opened: 7880 (LiveKit signalling, only through Caddy `/rtc`), 8080 (API),
5432 (PostgreSQL). The admin interface of Caddy has no port: it is a unix socket inside the stack.

- **Linux (ufw):** `sudo ufw allow 8443/tcp && sudo ufw allow 8443/udp && sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp`.
  Note: Docker bypasses ufw for published ports (its own iptables chain). Restrict only through the `DOCKER-USER`
  chain or the firewall of the VPS provider.
- **Windows:** the Wi-Fi/LAN must be set to the network profile "Private". On first start Windows asks for permissions
  for Docker Desktop – allow them. If devices cannot connect, create rules (PowerShell as administrator):

  ```powershell
  New-NetFirewallRule -DisplayName 'StudioFlow HTTPS' -Direction Inbound -Protocol TCP -LocalPort 8443 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow HTTP/3' -Direction Inbound -Protocol UDP -LocalPort 8443 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow Media TCP' -Direction Inbound -Protocol TCP -LocalPort 7881 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow Media UDP' -Direction Inbound -Protocol UDP -LocalPort 7882 -Profile Private -Action Allow
  ```

- **VPS:** open the same ports in the provider's firewall. The media address of the wizard is then the public IP.

## 4. DNS and certificate

Browsers only release camera and screen over HTTPS – on the Wi-Fi as well. The wizard step "Address and certificate" (and
the section of the same name in "Server settings") chooses how the server gets its certificate. No mode needs port 80:
Let's Encrypt is used through the DNS challenge only.

| Choice in the Regie | When | What is needed |
|---|---|---|
| **Local certificate (no domain needed)** (`internal`) | Default. On site and for a quick test. The domain is optional | Every device installs the root certificate (`ca.crt`) once, section 4.4 |
| **Let's Encrypt through DNS: <provider>** (`dns-<provider>`) | **Recommended with a domain**, on site and on a VPS. A real certificate, even if the server is only reachable internally | A record to the server, domain at one of the providers of section 4.2, an API token of that provider |
| **My own certificate** (`custom`) | A certificate from your IT | Upload the certificate chain and the private key (PEM, no password) in the Regie; renewal by hand |

Saving the choice is enough: the API hands the certificate settings to Caddy, which obtains or loads the certificate within
seconds. The page shows "Web server runs the saved settings" when it is done.

**A change of the domain or the certificate changes the address.** Paired phones, laptops and output links open the address
they were paired with; after a change they have to open the new one. The page says so before you save.

### 4.1 Subdomain pointing to the server

At the DNS provider, create an A record: `studioflow.example.com` → `192.168.1.50` (the LAN IP of the server). This is
safe: the address is only reachable inside your own network.

- Some routers discard DNS answers with private addresses ("DNS rebind protection", for example FRITZ!Box, pfSense).
  Then add an exception for the domain (FRITZ!Box: Home Network › Network › Network Settings › DNS rebind
  protection) or create a local DNS entry in the router. Menu names depend on the language of the device.
- Check from a device on the Wi-Fi: `nslookup studioflow.example.com` must return the internal IP.

### 4.2 Let's Encrypt through DNS, per provider

Choose "Let's Encrypt through DNS: <provider>", enter the domain and the access data. They are stored **encrypted** in the
database, never shown again and never part of an answer or a log; leaving a field empty on a later save keeps the stored
value.

| Provider | Fields in the Regie | Token permissions |
|---|---|---|
| Cloudflare | API token | Zone › Zone › Read and Zone › DNS › Edit for the zone |
| Infomaniak (CH) | API token | Scopes `domain:read dns:read dns:write` |
| Hetzner | API token | Token of the Hetzner Cloud project that holds the DNS zone (the old DNS console has been shut down) |
| deSEC | API token | Token of the account (also for the delegation below) |
| AWS Route 53 | Access key ID, Secret access key, Region | IAM: `route53:ListHostedZones*`, `GetChange`, `ChangeResourceRecordSets` |
| Gandi | API token | Personal access token with "Domain technical configurations" |
| OVHcloud | Endpoint (for example `ovh-eu`), Application key, Application secret, Consumer key | GET/POST/PUT/DELETE on `/domain/zone/*` |

The optional field "E-mail for expiry notices" is passed to Let's Encrypt. Caddy obtains the certificate when the settings
are saved; renewal is automatic. Check: `docker compose logs caddy | grep -i -E "certificate obtained|error"`.

### 4.3 Hostpoint, cyon and others without a module: delegate the challenge

There is no Caddy module for Hostpoint and cyon. The solution: delegate only the validation record `_acme-challenge`
by CNAME to a zone at deSEC (free) or Cloudflare. The A record stays with the current provider.

1. At [deSEC](https://desec.io), create an account and a domain, for example `studioflow-example.dedyn.io`, and create a
   token.
2. At the current provider (zone `example.com`), create a CNAME:
   `_acme-challenge.studioflow` → `_acme-challenge.studioflow-example.dedyn.io.`
3. In the Regie choose "Let's Encrypt through DNS: deSEC", enter the domain `studioflow.example.com` and the token, and
   put `_acme-challenge.studioflow-example.dedyn.io` into "Delegated challenge domain (optional)".
4. Check: `nslookup -type=CNAME _acme-challenge.studioflow.example.com` shows the target at deSEC.

The same works with Cloudflare ("Let's Encrypt through DNS: Cloudflare", CNAME target in a zone at Cloudflare).

### 4.4 Local certificate: install the root certificate on the devices

With the local certificate Caddy signs the certificates itself. Every device must trust the root CA once, otherwise the
browser blocks camera and screen. The CA lives in the volume `caddy_data` (valid for 10 years, included in every
backup). If the volume is lost, a new CA is created and all devices have to install it again.

Download on the device: `https://<address>:8443/ca.crt` (confirm the certificate warning once on the first visit), or the
button "Download the CA certificate" in the wizard and in "Server settings".

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

The server presents a certificate for every address it is opened with: its IP address (`https://192.168.1.50:8443/`) and,
when you entered one, the domain. A domain is optional, so a first start works with the IP address alone.

## 5. Install and first-run wizard

### 5.1 Start

```bash
docker compose up -d       # pulls (release) or builds (source) the images and starts the stack
docker compose ps          # all services "healthy", init "exited (0)"
```

That is all: no `.env`, no script. Everything in `.env.example` is an optional override (section 5.4). The first start with
images that are not on the machine yet takes a few minutes.

### 5.2 First-run account and wizard

1. Read the one-time **setup code**: `docker compose logs api` shows the line `Setup code: K7QM-3XD2` a few seconds after
   the start (PowerShell: `docker compose logs api | Select-String 'Setup code'`). It protects the short time between the
   start and the setup: whoever reaches the page first from the network still needs it.
2. Open `https://<address of this computer>:8443/` in a browser, for example `https://192.168.1.50:8443/`. The browser
   warns once, because the certificate comes from the stack's own certificate authority: accept it for now (section 4.4
   removes the warning).
3. **Step 1, Account:** enter the setup code, a user name and a password (at least 12 characters, not the user name, not a
   common password) and repeat the password. You are signed in at once. Wrong codes count like failed logins: 5 from the
   same address lock it for 15 minutes. The code is valid until the account exists or the API restarts (then a new one
   is logged).
4. **Step 2, Media address:** the IPv4 address of this computer in your network, which the devices use to send picture and
   sound. The wizard suggests the address you opened the page with. "Test connection" restarts the media server for a few
   seconds and sends a message from this browser through the address and back; it names what failed (the media server, the
   connection to the address, or the answer). Reserve the address in the router so that it stays the same.
5. **Step 3, Address and certificate:** section 4. "Keep the defaults" gives the local certificate without a domain.
6. **Step 4, Embedding:** the origins that may show the output in a frame, for example the domain of the streaming proxy,
   one per line (empty: none). The control room can never be embedded.

Each step is saved when you continue. When the last one is done, the server is "configured" and the wizard never opens
again; until then every sign-in leads back to it. Everything can be changed later under production menu (the production
name in the header) › **Server settings**.

The account is in the database and therefore part of every backup and restore. Change the password in the Regie:
production menu › Change password; it needs the old password and signs out all other sessions. The interface language
follows the browser by default and can be changed in the Regie (section 13).

### 5.3 Server settings

The page "Server settings" shows whether the web server, the media server and the backup service run the saved settings
("runs the saved settings", "is taking over the settings …", "refused the settings") and has one section for each of: media
address, address and certificate, embedding, backups (schedule, retention, off-site copy, section 7) and the list of the
latest backups with "Back up now". Saving a section is atomic: an invalid value is refused with the reason and nothing is
changed.

- A new **media address** restarts the media server (a few seconds of freeze frame). It is refused while a broadcast is
  live.
- A new **address or certificate** is applied by Caddy without a restart.
- Every change is written to the audit log (`settings.media.changed`, `settings.address.changed` (also for an uploaded
  certificate), `settings.embedding.changed`, `settings.backup.changed`; `backup.requested` for "Back up now").

### 5.4 Optional overrides, Git checkout

Create a `.env` next to `docker-compose.yml` only for one of the values in `.env.example`: another HTTPS port
(`STUDIOFLOW_HTTPS_PORT=9443`), other media ports, a subnet that does not collide with your LAN, the image version
(section 14), size limits. A variable that is empty or missing uses its default. Put values with spaces in single quotes.

From the source (development, or a server that builds itself):

```bash
git clone <repo> studioflow && cd studioflow
docker compose up -d --build       # builds the images (a few minutes), then as above
```

The ready-made images of a release (section 14) need neither Git nor a build and are the recommended way. Local development
with `ng serve`: see `docker-compose.override.example.yml`.

### 5.5 Moving from the script installation

An installation that was set up with `setup.sh` / `setup.ps1` keeps its data: the volumes have the same names.

1. Back up the old installation (`./backup.sh`) and keep the old `.env`.
2. Take the new files (`git pull`, or the folder of a release) **without deleting the old `.env`**. The init service adopts
   `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from it on its first start (the database keeps its
   password) and ignores them afterwards. Delete the host scripts of the old version.
3. `docker compose up -d`. The Regie account exists, so the wizard starts at step 2: enter the media address (the former
   `STUDIOFLOW_NODE_IP`), the domain and the certificate (the former `STUDIOFLOW_DOMAIN`, `STUDIOFLOW_TLS_MODE` and DNS
   token – they are **not** read from the `.env` any more) and the embedding origins (the former
   `STUDIOFLOW_FRAME_ANCESTORS`).
4. **The address now has a port:** 8443 instead of 443 and no port 80. Either open `https://<domain>:8443/` on the paired
   devices again, or put `STUDIOFLOW_HTTPS_PORT=443` into the `.env` to keep the old address. The firewall must allow the
   port (section 3).
5. The local certificate authority is in the volume `caddy_data`, so devices that trust it keep trusting it. Old backups in
   `./backups` can be restored with section 7.4.

## 6. Start, stop, logs

| What | Command |
|---|---|
| Start / after a change to `.env` | `docker compose up -d` |
| Status and health checks | `docker compose ps` |
| Logs (live) | `docker compose logs -f --tail 100 api` (or `caddy`, `livekit`, `postgres`, `backup`) |
| Restart one service | `docker compose restart api` |
| Stop (data stays) | `docker compose stop` or `docker compose down` |
| Resources | `docker stats`, `docker system df` |

- **Never `docker compose down -v`**: it deletes all volumes – database, media, certificates, the local CA and the secrets.
- All containers have `restart: unless-stopped` and start by themselves after a crash or restart. After a restart of the
  server, Caddy gets its configuration back from the API within seconds (the page is served by a bootstrap configuration
  until then).
- Logs are limited to 5 × 10 MB per container. Tokens, output keys and invite links are redacted in the Caddy logs
  (`REDACTED`).
- Health check in detail: `docker inspect --format '{{json .State.Health}}' studioflow-api-1`.
- The secrets (database password, LiveKit key pair) live in the volume `secrets`. They are never printed and no endpoint
  returns them. They are not part of the backups and are not needed there: a restore on a new server works with the new
  secrets of that server.

## 7. Backup and restore

A backup is only worth something if it is taken regularly, kept somewhere else than the server and has been restored at
least once. This section covers all three: backups by hand (7.1), automatic backups (7.2), the copy to a second place
(7.3), restoring and the restore drill (7.4); 7.5 is the other kind of copy: one production as a file. Backups and restores run
as commands of the `backup` service of the stack, the same on Linux, macOS and Windows; nothing is installed on the host.

### 7.1 Backup by hand

```bash
docker compose run --rm backup backup-now         # a backup now; during operation, no broadcast is disturbed
docker compose run --rm backup list               # the backups, newest first
```

Or in the Regie: Server settings › Latest backups › **Back up now** (the list shows the result). A backup is a folder
`YYYY-MM-DD_HHMM_manual` in the Docker volume `backups` with the database (`database.dump`, pg_dump), the volumes `keys` and
`caddy_data` as `.tar.gz`, `backup-info.txt` and `SHA256SUMS`; the media are an incremental copy in `media/` next to the
folders (7.2, step 5). It contains private keys (login, certificates, CA, the stored DNS access data in encrypted form):
store it protected and copy it off the server. Take one by hand before an update and before the webinar (section 9).

Fetch a backup to the host: `docker compose cp backup:/backups/2026-10-23_0300_manual ./backups/` (and
`backup:/backups/media ./backups/` for the media).

### 7.2 Automatic backups

Off until you set a schedule: Server settings › Backups › **Schedule** (five fields as in cron, for example `0 3 * * *` for
every day at 03:00; empty = no automatic backups), **Time zone of the schedule** (for example `Europe/Zurich`; empty =
UTC), and how many daily and weekly backups are kept. Saving hands the settings to the backup service within seconds.

```bash
docker compose logs backup         # "Automatic backups: '0 3 * * *' (time zone Europe/Zurich) ..."
docker compose run --rm backup backup-now     # take one now (same steps as the schedule)
```

What a run does, in this order:

1. **Waits while a broadcast is live.** The run looks every 5 minutes (`BACKUP_LIVE_POLL_SECONDS`) whether a production is
   live and starts as soon as the broadcast has ended. A broadcast that is never ended therefore blocks the backups
   (the warning below appears after 48 hours). If the state cannot be read, the backup runs anyway. A manual backup does
   not wait.
2. **Database and small volumes:** `pg_dump` over the network, `keys` and `caddy_data` as `.tar.gz`, into
   `YYYY-MM-DD_HHMM_auto/` with `backup-info.txt` and `SHA256SUMS`.
3. **Checks the new dump:** it is loaded into a throwaway database. A dump that does not load is discarded and counts as
   a failure, so a broken backup never pushes out a good one.
4. **Retention:** the newest backup of each of the last "Daily backups kept" (7) days and of the last "Weekly backups kept"
   (4) weeks is kept, the rest is deleted: about one month of history. Days and weeks without a backup are not counted,
   so a pause does not shorten the history. Only folders ending in `_auto` are touched; manual and safety backups
   (`_manual`, `_pre-restore`) stay until you delete them.
5. **Media, incrementally:** videos can be large, so they are not archived again every day. Files in `media` never
   change (the name is the asset id), so only files that are not yet in `media/` next to the dated folders are copied.
   Nothing is deleted when an asset is removed in the Regie, so the copy grows; remove old files by hand if needed.
6. **Off-site copy** if a second target is configured (7.3).

**Where the backups are.** In the Docker volume `backups` (`docker volume inspect studioflow_backups`), not in a folder of
the host: a named volume behaves the same on a Linux server and in Docker Desktop on Windows (no file permissions of the
host, no Windows paths, no virus scanner in between). The volume is on the same disk as everything else: **it does not
protect against a failed disk or a stolen server; the off-site copy (7.3) does.**

**Why inside the stack and not cron or the Task Scheduler.** The service runs on every system where the stack runs, with
the same files and the same behaviour, restarts with Docker (`restart: unless-stopped`) and needs nothing on the host: no
cron or systemd on Linux, no Task Scheduler, no signed-in user on Windows. It knows the broadcast state, verifies its own
result and reports to the API. On Docker Desktop the stack (and so the schedule) only runs while Docker Desktop runs; a
missed run is simply taken at the next scheduled time.

**How a failure is noticed.**

- The service writes a status file (`backup-status.json` in the volume `backup_status`, which the API mounts read-only) after
  every step. The readiness check of the API reads it: `docker compose exec api wget -q -O - http://127.0.0.1:8080/health/ready`.
  It prints `Healthy`, or `Degraded` followed by the reasons, with HTTP status 200: a warning, never an outage. It reports
  on automatic backups, so it prints `Healthy` while no schedule is set.
- With a schedule it warns when the last run failed (with the reason), when the last successful backup is older than
  `BACKUP_WARN_AFTER_HOURS` (default 48, `.env`), when there is no backup yet after that time, when no off-site copy is
  configured ("the backups stay on this server"), or when the last off-site copy failed or is too old. A successful run
  clears the failure.
- Server settings › Backups shows the state of the service ("A backup is running …", "A backup waits for the end of the
  broadcast.", "The last backup failed. Check: docker compose logs backup"). Details: `docker compose logs --tail 100 backup`.

Switch off: empty the schedule in Server settings. The backups stay in the volume until you remove it
(`docker volume rm studioflow_backups`).

### 7.3 Second target (off-site copy)

The copy goes to any storage that `rclone` supports: S3-compatible storage (for example from a Swiss provider), SFTP
(a NAS, another server), WebDAV. Backends that sign in through a browser (Google Drive, Dropbox) are not supported: their
token would have to be refreshed in a configuration that is read-only here. Everything that leaves the server is
encrypted with [age](https://age-encryption.org) and a **public** key; the private key is never on the server, so a
stolen server or a hacked storage account does not reveal the backups.

1. **Make a key pair on your own machine** (install `age`): `age-keygen -o studioflow-backup.key`. It prints the public key
   (`age1...`). Put the key file into the password vault and delete it from the machine. Without it the off-site
   copies cannot be read, with it anybody can read them. (Without installing anything:
   `docker compose run --rm --no-deps --entrypoint age-keygen backup` prints a pair once; copy the private part to the
   vault right away.)
2. **Define the target** on your own machine with `rclone config` (name it `offsite`; for S3 choose `s3`, provider
   `Other`, endpoint, region and access key; for a NAS `sftp`). Create the bucket or folder and test it:
   `rclone lsd offsite:`. Use credentials that may write and read; if they may not delete, the retention at the target
   only warns (use a lifecycle rule of the storage instead).
3. **Enter it in the Regie:** Server settings › Backups › Off-site copy. "rclone remote" is `offsite:studioflow-backups`
   (`<remote>:<bucket or folder>`), "rclone configuration" is the text of `rclone.conf` with only the remote(s) it needs
   (stored encrypted, never shown again; paste a new one to replace it), "Public age keys" the `age1…` line(s). The page
   refuses a remote that the configuration does not define, a key that is not an age key, and a target without any key
   (the box "The remote encrypts by itself" allows that if the remote encrypts by itself, for example an rclone `crypt`
   remote).
4. Save, then `docker compose run --rm backup backup-now` and look at the target.

At the target there is one folder per backup (`2026-10-23_0300_auto/` with `database.dump.age`, `keys.tar.gz.age`,
`caddy_data.tar.gz.age`, `backup-info.txt.age` and, uploaded last, the plain `SHA256SUMS`) and `media/` with every media
file as `<production>/<asset>.<ext>.age`. A folder without `SHA256SUMS` is incomplete. Media are uploaded once and
never again; the dated folders follow the same retention as the local ones. The upload of the first run can take long;
the next scheduled run waits for it.

### 7.4 Restore and the restore drill

Restore is a command, never a button: it replaces the database, so the API must not run. The command checks the checksums,
asks for confirmation (unless `--yes`), first takes a backup of the current state (`…_pre-restore`), restores the
database into a new database and only then swaps it in (if the restore fails, the old one stays unchanged), replaces the
volumes `keys`, `caddy_data` and `media`, and tells you to start the stack. The server settings, the stored certificate
and the DNS access data come back with the database. During a broadcast it refuses (`--force` overrides).

```bash
docker compose run --rm backup list                                   # the folder names
docker compose stop caddy api livekit                                 # nobody may use the database or the volumes
docker compose run --rm backup restore 2026-10-23_0300_auto          # asks "Restore from …?"; --yes skips the question
docker compose up -d
```

If the API still runs, the command stops with the exact command to run first. A restore of a backup from another server
or from the off-site copy is the same command with the folder in place (below).

**From a folder on the host** (a backup you copied off the server, or an old `./backups/…` of the script installation).
Mount the folder that holds the backup folders (and `media/` next to them) into the one-off container:

```bash
docker compose stop caddy api livekit
docker compose run --rm -v "$PWD/backups:/import:ro" backup restore /import/2026-10-23_0300_auto
docker compose up -d
```

(PowerShell: `-v "${PWD}/backups:/import:ro"`.) A backup without `media.tar.gz` takes the media from the folder `media/` next
to it. An old backup made by `backup.sh` has `media.tar.gz` and is restored as it is.

**From the off-site copy** (server lost): on a machine with `rclone` (same remote definition) and `age`, put the private
key next to you:

```bash
rclone copy offsite:studioflow-backups/2026-10-23_0300_auto backups/2026-10-23_0300_auto
rclone copy offsite:studioflow-backups/media backups/media
for f in backups/2026-10-23_0300_auto/*.age; do age -d -i studioflow-backup.key -o "${f%.age}" "$f" && rm "$f"; done
find backups/media -name '*.age' -exec sh -c 'age -d -i studioflow-backup.key -o "${1%.age}" "$1" && rm "$1"' _ {} \;
docker compose run --rm -v "$PWD/backups:/import:ro" backup restore /import/2026-10-23_0300_auto --verify     # checks before anything is replaced
docker compose stop caddy api livekit
docker compose run --rm -v "$PWD/backups:/import:ro" backup restore /import/2026-10-23_0300_auto
docker compose up -d
```

**Restore drill.** `docker compose run --rm backup restore <folder> --verify` verifies the checksums, loads the dump into a
throwaway database of the running PostgreSQL and reads the archives. It prints the number of tables and the newest
migration and removes the database again. Nothing is replaced or stopped, so it is safe at any time. The service does
the same check after every backup; the drill proves the rest: that you can get the files back and decrypt them. Do the
off-site variant above once a month, with the private key from the vault, and a full restore on a spare machine once a
year. A backup that was never restored is not a backup.

**Moving to a new server:** install the stack there (section 5.1) but do not run the wizard; copy the backup folder (and
`media/`) over, stop `caddy api livekit`, restore it as above and start everything. The restored settings still name the old
media address and domain: open the Regie and correct them under Server settings (the media address is the IP of the new
server; the DNS record of a domain has to point to it).

### 7.5 Move a production to another server

A backup moves the whole installation. To move **one production** (the next webinar, the proven set of scenes, a template for
a colleague's installation) export it as a file and import it where you need it. No shell access is needed; both steps are in the
Regie. The file has the extension `.studioflow.zip`; unpack it only to look inside (it holds `manifest.json` and the media).

**Export** (any time, also during the broadcast; nothing changes in the production):
1. Header → production name → "Export". The browser saves `{name}-{date}.studioflow.zip`.
2. The file holds the name, format and resolution, slates, text colours, texts, all scenes with their elements, the sound settings
   of the videos (fader, mute, mode and delay in the Audio dock), and **all media**
   (a production with videos is as large as its videos; the Regie shows the size on import).

**Import** on the other server (first start of the stack and the first-run setup done, section 5):
1. Header → production name → "Import…" → "Choose file…".
2. The Regie reads the file and shows what it contains before anything is created: the name, the number of scenes and texts,
   the media with their size, the cameras and screens that become placeholders and the warnings. A file from a newer StudioFlow
   is refused ("exported by a newer version … update this installation first"); a file that is not an export or is damaged is
   refused with "Nothing was imported".
3. "Import" creates a **new production** (a name that exists gets " (2)"). It is not the active production and the broadcast
   state is standby: switch to it in the production menu when you are ready.
4. **Pair the devices again.** Devices, pairings, invites, output links and their keys, IP restrictions, the log and the audit
   log are never part of a file. The cameras and screens of the original are placeholders in the scenes ("Source missing",
   with their code and name, listed under "Missing sources" in the Sources dock). Pair a phone or laptop; its station row offers
   "Use as K1 · Stage phone", which puts the new device in every scene where K1 was, and makes it K1. Or assign the placeholder
   to any existing camera, screen or medium with "Assign…" in the Sources dock; "Remove from all scenes…" drops a placeholder.
   The sound of devices is not part of the file either: the audio station, the microphones and the sound of shared screens appear
   in the Audio dock of the new production when the devices are paired, with their usual start values (the station always on,
   microphones muted); set the faders again.
5. **Fresh output links.** The new production has its own link with a new key: give the new URL to the proxy or the OBS
   scene collection ("Use as camera…") again.

**Duplicate** ("Duplicate production…" in the same menu) does the same inside one installation, without a file: the next webinar
starts as a copy of the last one. It works while the production is live, the original is only read.

Good to know:
- **Limits.** The file may be up to 4 GiB (`STUDIOFLOW_MAX_IMPORT`, default 4100 MiB at the edge, `TRANSFER__MAXIMPORTBYTES` 4 GiB
  in the API; raise both for larger files, `.env.example`); at most 1000 files, 8 GiB unpacked, a compression ratio of 100. A file
  above a limit is refused as a whole.
- **Free disk space.** An import needs about twice the size of the file on the server for the time it runs (the upload is
  buffered, the media are written once more under `/data/media`); a failed import removes what it wrote. After a crash of the API
  in the middle of an import an unreferenced folder `/data/media/prd_…` can stay behind; it does no harm and can be deleted when no
  production has that id (`docker compose exec api ls /data/media` and compare with the productions).
- **Time.** A few seconds for a production with pictures, minutes for gigabytes of video; the progress is shown while the file
  uploads, the import ends with a toast. The preview uploads the file once, "Import" a second time.
- **Safe.** The file is checked like any upload from the internet: file names, sizes, compression ratio and every picture and
  video (no SVG, no unknown types) before anything is stored. Nothing is imported partially.
- **Between versions.** An older file is converted when it is read; a newer one is refused. Update the target server first.
- The audit log has `production.duplicated`, `production.exported` and `production.imported` (section 17).

## 8. Update

**Never during a broadcast.** Check first: `docker compose exec -T api dotnet Opten.StudioFlow.Web.dll broadcast-status`
prints `live` (exit code 3) or `idle` (exit code 0); exit code 1 means the state could not be read.

A server that runs the ready-made images of a release updates with two commands (details, version choice and rollback in
section 14):

```bash
docker compose run --rm backup backup-now     # a backup before the update
docker compose pull && docker compose up -d   # new images, then only the changed services restart
```

The pull happens before anything is touched: when it fails (network, `denied`), the running stack stays as it was.
Volumes, secrets and settings are kept. The API migrates the database when it starts.

A server that builds from the source: `git pull --ff-only && docker compose up -d --build`. With local changes or a diverged
state, `git pull --ff-only` aborts without restarting anything.

- New variables in a new version: `docker compose` reports them at start; compare with `.env.example`. None is required.
- Back to an earlier version: section 14.4 (release images) or `git checkout <commit>` and `docker compose up -d --build`
  (source). If the new version migrated the database, also restore the backup taken before the update (section 7.4).
- Cleaning up after updates: `docker image prune` removes old, unused images.

## 9. Checklist before the webinar

**The day before**

- [ ] `docker compose run --rm backup backup-now`, then the update if one is pending (section 8) – afterwards no more updates until after the broadcast.
- [ ] `docker compose ps`: all services "healthy". Certificate valid (the Regie loads without a warning).
- [ ] Scenes, per-item fallbacks and slates (“Starting soon”, “Thanks for watching”) prepared.
- [ ] Output link tested at the proxy: the page loads in the iframe, the picture runs, the proxy's domain is in
      the allowed origins (Server settings › Embedding); if the IP restriction is active: proxy IP entered (on Docker Desktop the API only
      sees the internal Docker address – the IP restriction only works reliably on a Linux server).
- [ ] If the picture goes into Teams, Zoom or Webex through OBS (section 18): the link "Teams camera" shows "connected"
      in the output chip, a second participant sees the picture, background effects are off, and the computer with OBS
      and Teams is not the Regie laptop.
- [ ] Sound (section 20): the audio station is paired and plays by itself after a reload, the proxy's audio comes through
      the browser source in OBS ("Control audio via OBS") and the output chip does not say "Audio blocked".

**On site, 60 minutes before**

- [ ] Server and Regie laptop **connected by cable** to the router; phones on the **5 GHz** Wi-Fi without guests and
      without client isolation; the server has its fixed IP (the media address in Server settings).
- [ ] Phones **on a charging cable**, mounted firmly, Do Not Disturb on, battery saver off, auto-lock off.
- [ ] Pair the devices (phones by QR code, laptops through `/join` with a verification code or an invite link).
- [ ] **Tech check** in every sender: camera, network, bandwidth (≥ 6 Mbit/s good, ≥ 3 Mbit/s tight).
- [ ] Monitoring view: bitrate, packet loss and battery of all stations unremarkable.
- [ ] Output at the proxy: picture current, latency in the output chip plausible; test switch.
- [ ] Sound: audio station shows "Sending" with a moving level and a plausible input; start the broadcast for a moment and
      listen at the proxy (or in OBS); the meter of the program above Take moves; end the broadcast again.
- [ ] `docker compose run --rm backup backup-now`.
- [ ] With automatic backups: `docker compose exec api wget -q -O - http://127.0.0.1:8080/health/ready` prints `Healthy`
      (otherwise it lists what is wrong with the backups, section 7.2); Server settings shows all three services
      "runs the saved settings".

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
| A station says "CPU at limit" | the sender lowers the picture quality by itself and keeps sending | slightly less sharp or fewer frames | See section 11, "The computer cannot keep up". Ask the person to close other programs, share one window, or switch to 720p. |
| The output chip says "drops frames" | the output page shows what it can and keeps running | stutter | See section 11, "The computer cannot keep up". Lower the resolution of the production or use a faster computer for the output page. |
| The Wi-Fi is overloaded | Simulcast lowers the layers; the Regie shows packet loss and bitrate per station | slightly less sharp, no stutter | Take foreign devices off the Wi-Fi, set phones to 720p, stop sources that are not needed, have laptops share one window instead of the whole screen, change the Wi-Fi channel. |
| The Regie browser crashes | the output keeps running, it does not depend on the Regie browser | nothing | Reopen the browser and sign in (the login stays valid for 12 h); layout and Studio Mode come back from the browser. If necessary use the second Regie device. |
| API restart or update | on shutdown the API disconnects all hub connections immediately (restart within a few seconds, without "reconnecting"); SignalR reconnects, the state is reconciled by version; media keeps running. If a device with a source in Program or Preview does not return within 15 s, the Regie reports it ("reconnecting") | nothing | Nothing. (Still never update during a broadcast.) |
| The database (PostgreSQL) is gone | Regie commands fail within a few seconds with a "database currently unreachable, try again in a moment" message; hubs, output and media keep running; once the database is back everything works again without an API restart | nothing | `docker compose ps` / `docker compose logs --tail 200 postgres`; `docker compose start postgres`. Then repeat the command. |
| A container crashes | Docker restarts it; all clients reconnect by themselves | freeze frame, a few seconds (LiveKit) | `docker compose ps`; if a service keeps restarting ("Restarting"): `docker compose logs --tail 200 <service>` and section 11. |
| The whole server restarts | all containers start automatically, all devices come back by themselves | interruption until the server is back | Windows: sign in so that Docker Desktop starts. Wait until `docker compose ps` shows everything "healthy". If the server got a new IP: enter it under Server settings › Media address (the page can be opened by the new IP), save. |
| A device is opened in a second tab | the old tab is disconnected and stays off ("Opened in another tab"), no ping-pong | nothing | In the tab you want, click "Continue here". |

## 11. Troubleshooting

### Phones or laptops do not connect

**The page does not load or shows a certificate warning**

1. Right Wi-Fi? No guest Wi-Fi, no client isolation. Switch off mobile data; test with VPN and iCloud Private Relay
   off.
2. The address needs the port: `https://<address>:8443/` (there is no port 80 and no redirect from `http://`). If a
   domain is used, does `nslookup <domain>` on the device (or on a laptop on the same Wi-Fi) return the server IP? If
   not, see section 4.1 (DNS rebind protection).
3. Firewall: is 8443/tcp open (section 3)? Test from a laptop: `Test-NetConnection <ip> -Port 8443` or
   `nc -vz <ip> 8443`.
4. Certificate: local certificate → CA installed and (iOS) switched on in the certificate trust settings? Date and time
   of the device correct? Let's Encrypt through DNS → `docker compose logs caddy` (see below). After the domain or the
   certificate was changed, devices must open the new address (Server settings shows it).

**The page loads, but no picture ("connecting…")**

1. Media address wrong or outdated: `docker compose logs livekit | grep nodeIP` shows the announced IP. It must be the
   current LAN IP of the server (not 127.0.0.1, not a Docker or WSL address). Correct it under Server settings › Media
   address (with "Test connection"); saving restarts the media server.
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

### The computer cannot keep up (CPU at limit, drops frames)

Every picture costs a computer something: the sender encodes it, the Regie and the output page decode it. StudioFlow tells you
when one of them is at its limit, in amber, while the picture is still there:

- **"CPU at limit"** in a station line, in the monitoring table and in the station details: that device cannot encode fast
  enough and lowers the picture quality (the browser reports `qualityLimitation = cpu`). Close other programs on it; on a
  laptop share one window or a smaller area instead of the whole screen, and leave "Video in screen" off unless a video
  plays in the shared screen; on a phone choose 720p. "Bandwidth" as a reason is not shown here: that is the Wi-Fi (section 10).
- **"software encoding"** / **"software decoding"** in the station details ("Encoding", "Decoding here") and the output
  popover ("Decoding"): the graphics hardware is not used for that stream, so the CPU does the work. Laptops send screens as
  H.264 for that reason (hardware on practically every computer); VP9 is only chosen where the browser reports a hardware
  encoder. Where every stream is in software, use fewer or smaller sources in the scenes.
- **"drops frames"** in the output chip (from 5 % dropped frames of a connected output page; the popover shows "Dropped
  frames"): the computer that shows the output page, usually the proxy, cannot decode what it is given. Lower the resolution of
  the production (Format and resolution, section 19), take sources out of the program and the preview scene, close other
  programs on that computer, or use a faster one. The output page decodes only the program and the preview scene.
- A switch to a scene that is neither in the program nor in the preview takes about half a second until its pictures arrive
  (the output does not keep them ready). In Studio Mode, put the next scene in the preview and it comes on air with its picture.

How much hardware the audience's computer uses cannot be measured in the container the automated tests run in; the manual
measurement on real devices is MAN-16 (`docs/testing.md`).

### No sound

- Output chip says **"Audio blocked"**: the browser keeps the output page silent until somebody clicked it. In an OBS browser
  source switch on "Control audio via OBS" (the downloaded scene collection has it on) or click the page once
  (a "Sound on" button shows in its corner); in an iframe the page needs `allow="autoplay"` (section 19.3) and
  often one click on the embedding page.
- Output page open with `?audio=off`? That page is silent on purpose.
- Audio dock: is the channel **muted**, the fader down, the mode **Off**, or **Follows the picture** with no picture of it in the
  program? Nothing is heard before the broadcast is live ("PGM" in the row says that the channel is on air).
- The row says **"no signal for 10 s"**: the sender delivers silence. Audio station: cable of the mixing desk, the chosen input
  on the page ("Audio input"), the desk's output level. Laptop screen: the sound is only shared when "Share audio" was ticked
  *and* the browser delivered it ("with sound" next to the screen; otherwise "No sound is shared with this screen").
- The row says **"no sound"** or the status line **"A1 microphone stopped"** / **"A1 no sound"**: the microphone was switched
  off on the page, pulled out, taken by another program or its permission was taken back; the page looks for it by itself
  and the incident heals when it is back.
- Sound is there but late against the picture: open the row in the Audio dock (chevron) and raise **Sync offset** (0 to 500 ms)
  until lips and sound fit; the picture arrives with its own delay, the offset only delays the sound.
- Hum or echo in the Regie: monitoring is off by default (Audio dock → Monitor). With the program on loudspeakers the
  microphones hear it again: use headphones (Chromium can send the monitor to another device).

### High latency

- Output with `?debug=1`: estimated latency and jitter buffer.
- Server or Regie on Wi-Fi instead of cable? Phones on the 2.4 GHz band? Overloaded Wi-Fi (section 10)?
- Media over TCP instead of UDP (7882/udp blocked): in Chrome `chrome://webrtc-internals` › the active candidate pair
  shows `udp` or `tcp`.
- What the proxy adds in buffering is outside StudioFlow.

### Certificate is not issued (Let's Encrypt through DNS)

- Server settings shows "Web server … refused the settings" or "is taking over the settings …" for a long time:
  `docker compose logs api caddy | grep -i -E "acme|challenge|obtain|error|refused"`.
- Token and permissions at the provider (section 4.2); paste the token again under Server settings › Address and
  certificate (a field that is left empty keeps the stored value, a wrong one has to be replaced).
- Delegation: `nslookup -type=CNAME _acme-challenge.<domain>` shows the target; "Delegated challenge domain" matches the
  target exactly.
- The domain must belong to the account of the provider; the server needs access to the internet (DNS servers and Let's
  Encrypt) but nothing needs to reach the server from the internet.
- After several failed attempts Let's Encrypt blocks for an hour; Caddy keeps trying by itself (also with ZeroSSL).
  The stack keeps serving with its local certificate meanwhile.

### Port already in use

`docker compose up -d` stops with `failed to bind host port 0.0.0.0:8443/tcp: address already in use` (or `port is already
allocated`) when another program uses the port. Either free the port, or choose another one: put
`STUDIOFLOW_HTTPS_PORT=9443` (and, for the media ports, `STUDIOFLOW_RTC_TCP_PORT` / `STUDIOFLOW_RTC_UDP_PORT`) into a
`.env` next to `docker-compose.yml` and run `docker compose up -d` again; the stack is then at `https://<address>:9443/`
and the firewall must allow the port. If you freed the port instead, create the container anew:
`docker compose up -d --force-recreate caddy` (with some Docker versions a plain `up -d` starts the container that failed
without its network and ports, although `docker compose ps` calls it healthy).

### The API cannot reach the database after volumes were removed one by one

The database password is in the volume `secrets`, the data in `pgdata`. Removing only one of them (instead of restoring a
backup) leaves a database whose password no longer matches. Remove the volumes together (`docker compose down -v`, only when
a backup exists), start the stack and restore the backup (section 7.4); the backup does not need the old secrets.

### Login does not work

- After 5 failed attempts from the same IP the login is locked for 15 minutes (the API answers with 429).
- Forgot the password: reset the account, then create a new one in the first-run setup:

  ```bash
  docker compose exec api dotnet Opten.StudioFlow.Web.dll reset-admin      # asks for "yes"; --yes skips the question
  docker compose logs api | grep 'Setup code'                                # the new code, a few seconds later
  ```

  The command deletes the account only (productions, scenes, devices and media stay). The running API notices within 5
  seconds, signs everybody out and opens the first-run setup with a new code. In a script use `-T` and `--yes`:
  `docker compose exec -T api dotnet Opten.StudioFlow.Web.dll reset-admin --yes`. Exit code 2: not confirmed.
  Anyone who can run Docker commands on the server can do this; that is the recovery path by design.
- The Regie shows "First-run setup" instead of the login: there is no account yet (fresh install, restore of an empty
  database or a reset). Read the code as above. If the code is rejected, the API restarted since: read the newest one.
- `docker compose logs api` at start: `The Regie account exists` means the login is open, `Setup code: …` that the
  first-run setup is open. `Admin:Username … are ignored` warns about old `ADMIN__*` settings in the environment:
  remove them, they have no effect.
- A password change signs out every other session at once. If one of them is a Regie open on another device, it
  returns to the login.

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

- The backups, the `.env` (if you made one) and the volumes `caddy_data`, `keys` and `secrets` contain secrets and private
  keys: never pass them on, keep backups in a protected place and the off-site copy encrypted (section 7.3). DNS access
  data, the rclone configuration and the private key of an uploaded certificate are stored encrypted in the database and
  are never shown again.
- Only open the ports from section 3. The API, the database and the LiveKit signalling are only reachable through
  Caddy. The admin interface of Caddy (a unix socket that only Caddy and the API mount) and the files that configure
  LiveKit and the backup service are reachable inside the stack only, and no container has the Docker socket. LiveKit
  cannot reach PostgreSQL or the backup service (separate networks).
- The setup code and the sign-in protect the Server settings: they are only open to the signed-in admin.
- Never set `STUDIOFLOW_TRUSTED_PROXIES` to the LAN – otherwise the IP restriction of the output can be bypassed with a
  forged `X-Forwarded-For`.
- Give every output link only to the one consumer it is named after (the proxy, the Teams camera, …) and enter that
  consumer's address as the IP restriction of the link. If you suspect a link has leaked, regenerate its key; if the
  consumer is gone, revoke the link. Both only affect that link, the other consumers keep running (section 18).
- Create the Regie account right after the first start: until then the first-run setup is open to whoever knows the
  setup code, and the code is in the API log (anyone with access to Docker on the server can read it, nobody else).
  Do not open a new installation to the internet before the account exists. The log, the backups and the database
  hold no password: only its hash.
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
| `ghcr.io/opten/studioflow-api` | The API with its commands (`reset-admin`, `broadcast-status`) |
| `ghcr.io/opten/studioflow-livekit` | LiveKit with the small wrapper that restarts it when the media address changes |
| `ghcr.io/opten/studioflow-backup` | The backup service: schedule, `backup-now`, `list`, `restore` (section 7) |

All four always have the same version (`0.4.2`): they are built from one commit and must match. `postgres` is a third-party
image with a fixed version in the Compose file.

### 14.1 Install from a release

1. Sign in to the registry, as long as the repository is private (section 14.5): `docker login ghcr.io` with your
   GitHub user name and a personal access token (classic) with the scope `read:packages`.
2. Download `studioflow-X.Y.Z.tar.gz` and `SHA256SUMS` from the GitHub release (the release page, or
   `gh release download vX.Y.Z --repo OPTEN/StudioFlow`), check them and unpack the folder:

   ```bash
   sha256sum -c SHA256SUMS --ignore-missing     # macOS: shasum -a 256 -c ...
   tar -xzf studioflow-X.Y.Z.tar.gz && cd studioflow-X.Y.Z    # Windows 10/11: the same command works in a terminal
   ```

   (The release also offers `docker-compose.yml` and `QUICKSTART.md` on their own: the Compose file is all a server needs.)
3. `docker compose up -d` pulls the images of this release and starts the stack; `docker compose ps` shows five healthy
   services (and `init` exited). Read the setup code with `docker compose logs api` and follow the first-run wizard of
   section 5.2.

The folder holds `docker-compose.yml` (the release file: it names the images instead of building them),
`.env.example` (optional overrides), this runbook (`docs/runbook.md`), `QUICKSTART.md`, `VERSION` and the licence files.
There is no script. Everything else in this runbook (sections 3-7, 9-13) applies unchanged. Difference: the profile `chaos`
(`netem`) does not exist, and `docker compose build` has nothing to build.

### 14.2 Which version runs

The version is the variable `STUDIOFLOW_IMAGE_TAG`: in the `.env` if it is set there, otherwise `latest`, the newest release at
the moment of the pull. Ways to see what runs:

```bash
docker compose images                       # image names with their tags
docker compose ps api --format '{{.Image}}'
```

The API (`GET /api/system/info`, signed in as admin) and the file `backup-info.txt` of every backup report the
version as `0.4.2+1a2b3c4`: the release and the commit the image was built from. The Regie shows it in the last row of
the settings menu (the gear in the header), and the output page prints its own build as the last line of the `?debug=1`
overlay (`StudioFlow 0.4.2+1a2b3c4`), so a technician at the proxy can read what runs without a login. Pass it in a bug
report. A local build (`docker compose up --build`) has the version without the commit.

| `STUDIOFLOW_IMAGE_TAG` | Meaning |
|---|---|
| `latest` (default) | The newest release at the moment of the pull. Convenient; a server that must not change by itself pins a version |
| `0.4.2` | A release. Recommended for a production server: it runs a version that was chosen on purpose |
| `main` | The latest build of the main branch that passed all tests. For trying things out, never for a webinar |
| `sha-1a2b3c4` | The build of one commit |

`STUDIOFLOW_IMAGE_REGISTRY` (default `ghcr.io/opten`) replaces the registry path, for example for a mirror.

### 14.3 Update

**Never during a broadcast** (check as in section 8).

```bash
docker compose run --rm backup backup-now     # a backup before the update
docker compose pull                           # fetches the images; nothing is touched yet
docker compose up -d                          # restarts the services whose image changed
docker compose ps                             # all healthy
```

The pull happens before anything is touched: when it fails (network, `denied`), the running stack stays as it was. Volumes,
secrets and settings are kept; the API migrates the database when it starts.

- To stay on a version (or to go to a specific one), set `STUDIOFLOW_IMAGE_TAG=0.4.2` in the `.env` and run the commands
  again.
- The images carry the program; the Compose file in the folder belongs to the release it came from. When the release
  notes of a newer version say that it changed (a new service, a new volume), download that release and replace
  `docker-compose.yml` (and `.env.example`) in the folder; `.env` and `docker-compose.override.yml` are not part of it and
  stay (local changes to the Compose file belong into the override file).
- New variables: `docker compose` names them at the start; compare with `.env.example`. None is required.
- Cleaning up after updates: `docker image prune` removes the images of earlier versions that no container uses.

### 14.4 Roll back

```bash
# .env:  STUDIOFLOW_IMAGE_TAG=0.4.1    (the version that ran before)
docker compose pull && docker compose up -d
```

The database is migrated when the API starts, and a migration is not undone by starting an older API. Two cases:

- **The newer version did not change the database schema** (no migration in the release notes): the commands above are
  enough.
- **It did** (or you are not sure): after going back, restore the backup that was taken before the update. Its
  `backup-info.txt` shows the `version:` it belongs to, which must be the version you went back to:

  ```bash
  docker compose run --rm backup list
  docker compose stop caddy api livekit
  docker compose run --rm backup restore 2026-10-22_1430_manual
  docker compose up -d
  ```

  Everything that was entered after that backup is lost.

That is why every update starts with a backup.

### 14.5 Access while the repository is private

As long as the repository is private, the packages are private too. Every server needs a token once:

1. GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic): scope `read:packages`, and the
   account must be allowed to read the repository.
2. `docker login ghcr.io -u <github user>`, paste the token. Docker stores it on the server (`~/.docker/config.json`);
   treat it like a password and keep it in the vault.

When the repository is public (#5) the packages are made public and this step disappears. `pull access denied` or
`denied` during `up` or `pull` means: not signed in, a token without `read:packages`, or an expired token.

### 14.6 Verify what you got

Every image is signed by the release workflow, carries an SBOM and a provenance attestation, and the version tag has
the same digest as the commit's `sha-` tag that passed the tests. Commands: `docs/releasing.md`, section 6.

### 14.7 Images with a Git checkout

A Git checkout can run the ready-made images as well: put `COMPOSE_FILE=docker-compose.release.yml` into the `.env`, or
call `docker compose -f docker-compose.release.yml ...`. Without that, `docker-compose.yml` builds from the source as
described in sections 5.4 and 8.

## 15. Dependency updates (Renovate)

For the maintainers of the repository. [Renovate](https://docs.renovatebot.com) keeps the dependencies up to date: npm,
NuGet, the Docker images in `docker-compose.yml` and the Dockerfiles, the Caddy DNS modules in `infra/caddy/Dockerfile`,
the .NET SDK, the Node.js version and the GitHub Actions. Updates arrive as pull requests that the normal CI checks;
nothing is changed on a running server (apply them with section 8). The rules are in `.github/renovate.json5`.

**One-time setup by the repository owner**

1. Install the [Renovate GitHub app](https://github.com/apps/renovate) for the repository (free). It opens a
   "Configure Renovate" pull request first; the configuration is already in the repository, merge or close it.
2. Settings › Code security: enable the **dependency graph** and **Dependabot alerts** (not Dependabot version updates).
   Renovate reads the alerts and opens security fixes immediately; without them it still checks the OSV database.
3. Settings › Branches › protection for `main`: require the check `ci-ok` (it aggregates the CI jobs; a job skipped by
   the path filters passes, a red one blocks) and allow auto-merge (Settings › General). Automerge below only merges when
   it is green; the weekly dependency audit (`audit.yml`) is a report and not required.

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

**LiveKit.** Server and client are a pair: the specs document how version 1.13.11 of the server and 2.23.0 of the client
behave. Tick the LiveKit group on the dashboard only when both are meant to move. Then run the workflow **E2E full**
(Actions › E2E full › Run workflow, branch of the pull request) and read the LiveKit and net areas of the result before
merging. Test with real phones once (`docs/testing.md`, section 4).

**PostgreSQL.** Renovate proposes 17.x. A new major version cannot read the old data directory: it needs a dump and
restore (section 7) and is its own issue. Take a backup before updating to a new 17.x as usual.

**Reports.** Every pull request run has the job `audit` (`npm audit`, `dotnet list package --vulnerable`; warnings and a
summary, never a failure). The **E2E full** run (on demand) scans the images with Trivy and puts the result in its summary.

**Checking the configuration** (needs Node.js): `npx --yes --package renovate -- renovate-config-validator --strict`, and
what Renovate finds in the repository: `npx --yes renovate --platform=local --dry-run=extract` (with the repository
configuration passed as `RENOVATE_CONFIG_FILE=.github/renovate.json5` until it is committed).

## 16. Remote camera control

The Regie can zoom, switch the lens, lock the focus, shift the brightness and switch the light of a **phone** from the
Stations dock: open the station, press "Camera". Laptops and webcams are not controlled.

- **Only what the phone supports appears.** The phone reports what its browser allows; a control that is missing is not
  shown. If the panel says "Not available on this device", the browser reports no camera control at all. The Regie
  always shows the value the phone reports back, not the one that was requested (a slider that jumps back means the
  phone refused or rounded the value; a short message says so).
- **Lens switch.** The phone changes to another camera of the device (wide-angle, standard, tele, front). The picture
  freezes for less than a second. For a station that is in the program the Regie asks first. Zoom starts again at 1×
  on the new lens.
- **The last command wins.** If two operators move the same slider, the phone follows the last command and both Regies
  show the value of the phone. Settings belong to the phone, not to a scene; there are no presets.
- **After an interruption** (reload, call, other app, reconnect) the phone restores its lens, zoom, focus, brightness and
  light, because it keeps them in its browser storage. "Reset to auto" sets zoom, focus, brightness and light back to
  automatic (the lens stays).
- **Slow Wi-Fi.** A dragged slider sends at most about ten commands a second; the API merges what arrives faster
  (`Sources__CameraCommandInterval`, default `00:00:00.100`) and the phone applies only the newest value.

What a device can do depends on the model and the browser. Fill in the table when you test a phone (`docs/testing.md`,
MAN-14) and keep it with your setup notes:

| Phone, OS, browser | Lenses | Zoom | Focus | Brightness | Light |
|---|---|---|---|---|---|
| Android phone, Chrome | usually one entry per back camera, labels differ by model | most models | depends on the model | depends on the model | back camera, most models |
| iPhone, Safari | front and back, ultra-wide as a separate entry where iOS lists it | usually not | no | no | no |
| (your phone) | | | | | |

The first two rows are expectations from the browser documentation, not measurements: confirm them with MAN-14 before a
production relies on them.

## 17. What happened? View the audit log

The audit log answers questions such as "Who switched to the break scene at 14:03?", "When was phone K2 admitted?" or
"Were there failed sign-ins?". It records what the Regie and the server did, never secrets (no password, device secret,
output link or invite token).

**View it.** Production name (top left) → "Audit log". The page lists the entries newest first: time (in the time zone of
your browser, with seconds), who (Admin, a device with its slot codes and name, System), what, production. The arrow in
front of the time shows the raw details of an entry (for a sign-in the IP address, for a scene whether it went live with
Take or with a click). The list loads 50 entries at a time; "Load more" (or scrolling to the end) loads the next ones.
New entries appear at the top while the page is open.

**Narrow it down.**

- *Time range*: any time, today, last broadcast (from its start to its end, the question after a webinar), or a custom
  range. "Last broadcast" uses the chosen production, or the active one.
- *Production*: one production, all of them, or "No production" for sign-ins and account changes.
- *Category*: production (broadcast, scenes, slates), devices, access and security, media, output, system. Several
  categories can be on at once.
- *Search*: part of a device name, a scene, a user name or an action code such as `device.blocked`.

**Export.** "Export CSV" and "Export JSON" save the entries that match the current filters. The CSV opens in Excel with
umlauts (UTF-8 with byte order mark); the separator is a comma in the English interface and a semicolon in the German
one. Cells that start with `=`, `+`, `-` or `@` get a leading `'`, so a device name cannot run as a formula. An export is
limited to 50 000 entries (`Audit__ExportMaxRows`): with more, narrow the time range. At most 6 exports per minute and
client are allowed. Every export is an entry itself ("Audit log exported as csv, 42 rows"). The file name is
`studioflow-audit-YYYY-MM-DD.csv`.

**What is recorded.** Sign-ins (success, failure, lockout) and sign-outs, the account (set up, password changed, reset),
productions (created, duplicated, exported, imported, renamed, activated), missing sources assigned or removed, the broadcast (start, end, reset), scenes (live, created, deleted), the slates,
devices (paired, renamed, blocked, unblocked, removed, camera lens switched), invite links, knocks that were denied,
"Seen" on a message, media (uploaded, deleted), the output link and its access rules, the server settings (media
address, address and certificate, embedding, backup schedule; the values of secrets such as DNS tokens are never
written) and "Back up now" (category System), and the exports and the retention themselves. Not recorded: the preview, zoom and focus of a phone camera, the phone QR code that renews itself.

**How long it is kept (retention).** The API deletes entries older than `AUDIT_RETENTION_DAYS` (default 365) and removes
the IP address from entries older than `AUDIT_IP_RETENTION_DAYS` (default 90, at most the first value; IP addresses are
personal data under the Swiss FADP). Set both in a `.env` next to `docker-compose.yml`, then `docker compose up -d`. The step runs every hour, in
batches, and waits while a broadcast is live. When it changed something, the log says so ("Audit retention (365 days):
entries deleted 142, IP addresses removed 7", actor System) and so does the API log:

```bash
docker compose logs api | grep "Audit retention"
```

Entries cannot be changed or deleted from the Regie. If you must remove something earlier (a request under data
protection law), use SQL on the database after a backup:
`docker compose exec postgres psql -U studioflow studioflow -c "delete from audit_entries where id = 123"`.

**Troubleshooting.**

- "The export would be too large": narrow the time range or the filters.
- "Too many attempts" on an export: wait a minute.
- The page is empty after "Last broadcast": the production has had no broadcast yet, or choose another production.
- The table grows although retention is on: check the API log for "Maintenance step audit retention failed" (database
  problem) and that `AUDIT_RETENTION_DAYS` is what you expect (`docker compose exec api printenv AUDIT__RETENTIONDAYS`).

## 18. Output as a camera in Teams/Zoom

Teams, Zoom and Webex cannot embed a web page, but they can use a **camera**. OBS Studio (free) turns the output page into
the camera "OBS Virtual Camera" that all three list on Windows and macOS. Nothing has to be installed on the StudioFlow
server for this.

**Use a separate computer for OBS and Teams** (a laptop or mini PC on the same Wi-Fi or, better, on a cable). Teams, OBS,
the output page and the Regie together load a laptop heavily, and the output must not depend on the Regie laptop: if
the Regie browser or the laptop fails, the picture in Teams keeps running. In this chapter that computer is "the camera
computer". The camera carries **video only**; the sound keeps coming from the mixing desk into Teams as before.

### 18.1 Set it up (about 10 minutes)

1. **A link of its own for the camera.** In the Regie click the chip "Output" in the header. In the "Links" section
   type `Teams camera` into the field "Name of the new link" and click "Create link". The new link is selected and shows
   its masked address. Optional but recommended: under "Access" type the IP address of the camera computer, click "Add",
   then "Save"; from then on only that computer can open this link. Every consumer has its own link, so the proxy
   link (named "Proxy") is not touched.
2. **Download the OBS scene collection.** Click "Use as camera …" and then "Download OBS scene collection". The file
   `StudioFlow-Teams-camera.json` lands in the Downloads folder of the computer that runs the Regie. Copy it to the
   camera computer (USB stick, shared folder or mail to yourself). It contains the secret link: treat it like the
   link itself and delete it from shared places afterwards.
3. **Install OBS Studio 31 or newer** on the camera computer (obsproject.com, "Download Installer" for Windows or
   macOS). On the first start OBS shows the "Auto-Configuration Wizard": choose "I will only be using the Virtual
   Camera" and click "Next"; on the next page choose "Base (Canvas) Resolution" with the size from step 3 of the box "Use as camera" (`1920x1080`
   for the default 16:9 at 1080p, see chapter 19 for other formats) and "FPS" `30`, then finish the wizard. (You can open the wizard later under Tools → Auto-Configuration Wizard.)
4. **Import the collection.** In the OBS menu bar choose Scene Collection → Import. The dialog "Import Scene
   Collections" has a path field with a button "…" next to it; choose `StudioFlow-Teams-camera.json` and click "Import".
   Then open the "Scene Collection" menu again and click "StudioFlow – Teams camera". OBS shows one scene "StudioFlow"
   with one source "StudioFlow output"; within a few seconds the preview shows the output (the standby slate before
   the broadcast starts). In the Regie the chip now reads "Output" with "Teams camera" next to it, and the popover
   says "Teams camera · connected".
5. **Check the video settings.** In OBS choose Settings → Video. Set "Base (Canvas) Resolution" and "Output (Scaled)
   Resolution" to that size and "Common FPS Values" to `30`, then click "OK". A scene collection cannot carry
   these values, so this step is needed even after the wizard. The imported browser source is set up like this:
   the size of the production's canvas (1920 × 1080 by default), 30 fps, "Control audio via OBS" on, "Shutdown source when not visible" off, "Refresh browser when
   scene becomes active" off. Leave them as they are: they make the picture start once and keep running.
6. **Start the camera.** In the "Controls" dock (bottom right) click "Start Virtual Camera". The button changes to
   "Stop Virtual Camera" and OBS now provides the camera "OBS Virtual Camera" to all programs.
7. **Pick the camera in the meeting program.**
   - **Teams (new Teams app):** click your profile picture → Settings → Devices, and under "Camera" choose "OBS Virtual
     Camera". In a meeting's pre-join screen use the same list next to "Camera". **Switch background effects off**
     ("Background effects" → "No effect"/"Don't apply any background effect", including "Blur"): Teams would otherwise
     alter the picture.
   - **Zoom:** Settings → Video → "Camera" → "OBS Virtual Camera"; switch off "Touch up my appearance" and any
     virtual background, and switch off "Mirror my video" if you want to see the picture as the others see it.
   - **Webex:** Settings → Video → "Camera" → "OBS Virtual Camera", virtual background off.
8. **Test with a second participant** (another phone or computer in the same meeting) before the real one.

If the program does not list the camera: first "Start Virtual Camera" in OBS, then restart the program. Closing OBS
removes the camera; Teams then shows no picture.

### 18.2 Good to know

- **Your own preview is not what the others see.** Teams mirrors your self-view (text appears reversed there) and
  shows it in its own quality; the picture the others see is not mirrored. Judge the picture on a second device.
- **Teams reduces size and quality.** It downsizes the picture and compresses it hard, especially with motion. Text on
  slides must be large: use at least about 3 % of the picture height (32 px on a canvas with a short side of 1080 pixels) for body text,
  titles larger, and avoid thin fine print.
- **Background effects off.** Blur, virtual backgrounds and "appearance" filters in Teams, Zoom or Webex change the
  picture (blur softens the whole frame). Switch them all off.
- **Interruptions.** If the Wi-Fi of the camera computer drops, the output page keeps the last picture and returns by
  itself when the connection is back; the virtual camera does not have to be restarted. During the gap the Regie shows
  the link as "not connected" with the time it was last seen.
- **Latency.** OBS and the meeting program add delay on top of the output; plan about one second end to end and
  measure it as described in `docs/testing.md` (MAN-15) before relying on it for a live Q&A.
- **Audio.** The browser source is set to "Control audio via OBS" so that OBS owns its audio; the output page has no sound
  yet, so the meter of "StudioFlow output" stays silent. Keep sending the sound from the mixing desk into the meeting.
- **The camera computer is gone or the link leaked.** In the popover select "Teams camera" and click "Revoke link"
  (the page in OBS shows "No access" at once, all other links keep running), or "Regenerate link" to keep the name and
  get a new address; import the new collection afterwards. Revoke or regenerate never affects the proxy.
- **OBS shows a black picture.** Open the properties of "StudioFlow output" (double click) and check the URL; "No
  access" on the picture means the link was revoked, regenerated or the camera computer's address is not allowed.
  "Refresh cache of current page" in the same dialog reloads the page.
- **Which OBS versions.** The file is written in the format of OBS Studio 31 and 32. Older versions may refuse the
  import: update OBS.

For a very large event, a Teams town hall or another platform that accepts RTMP directly can take the picture without
a camera detour; that is not part of StudioFlow today (restream, plan phase 3).

## 19. Format and resolution of the output

Every production has one **format** (16:9, 9:16, 1:1 or 4:3) and one **target resolution** (720p or 1080p, counted on the
short side). A new production is 16:9 at 1080p, which is 1920 × 1080: whoever changes nothing notices no difference.

| Format | 720p | 1080p |
|---|---|---|
| 16:9 (widescreen) | 1280 × 720 | 1920 × 1080 |
| 9:16 (portrait, for phones and social media) | 720 × 1280 | 1080 × 1920 |
| 1:1 (square) | 720 × 720 | 1080 × 1080 |
| 4:3 | 960 × 720 | 1440 × 1080 |

**What the setting does.** The output page is a web page: it scales its picture to whatever window or iframe it runs in
(with bars where the shapes differ). The target resolution therefore does not decide how many pixels arrive at the
proxy; that depends on the proxy's window. Format and resolution set the **canvas** of the layouts: the coordinate system
of all elements, the shape of the monitors and thumbnails in the Regie, and the size of the picture OBS gets from the
"Use as camera" collection (chapter 18). The pictures the phones send do not depend on it: they follow the size of the
element on the output.

### 19.1 Choose it

- **New production:** header → production name → "New production…". Pick format and resolution below the name.
- **Existing production:** header → production name → "Format and resolution…".

### 19.2 What happens to the scenes

- **Same format, other resolution:** every element is scaled in proportion; nothing moves.
- **Other format:** the Regie asks first when scenes have elements. Every element is scaled by one factor so that the old
  picture fits into the new canvas, and centred; the Auto grid arranges itself for the new shape. Check the scenes
  afterwards; "Apply template" in Properties lays a scene out again (on 9:16 and 1:1 the templates stack the pictures:
  "Stacked", "Screen + camera row"). The undo history of the scenes is cleared, because it holds the old pixels, and
  switching back does not restore the old positions.
- **While the broadcast is live nothing can be changed:** the menu explains it, the API answers 409 `broadcast_live`.
  End the broadcast first (or reset it to standby), change the format, start again. Open output pages follow a change
  at once, without reloading.

### 19.3 Embedding

Give the iframe the shape of the canvas, or the output shows bars. For 9:16 at 1080p:

```html
<iframe src="https://studioflow.example/o/webinar?k=…" allow="autoplay; fullscreen"
        style="border:0; width:100%; aspect-ratio: 1080 / 1920"></iframe>
```

OBS: the browser source and the canvas need the size of the canvas; the "Use as camera" box names it in step 3 and the
downloaded scene collection already carries it (download it again after a change of format).

## 20. Audio

Audio is mixed by StudioFlow on the output page: the sound of the program arrives together with the picture at the proxy
(decision #7: the proxy is an OBS browser source with "Control audio via OBS", or another browser that is allowed to play
sound). There is one mixer per production, set in the **Audio** dock of the Regie; levels per scene and a separate preview
mix do not exist yet.

### 20.1 The audio station (the sound of the mixing desk)

1. On a laptop at the mixing desk (Chrome or Edge, a cable from the desk's output to a line or USB input of the laptop, no
   other program using that input) open `https://<server>/join/`, name it ("Mixing desk"), pick **Audio station (mixing
   desk)** and approve it in the Regie (Pair device → Laptop), or open an invite link of a laptop with `?station=audio`
   appended to it.
2. Allow the microphone when the browser asks, choose the **audio input** of the desk on the page and watch the level move.
   The page sends the sound **as it comes**: stereo, no echo cancellation, no noise suppression, no automatic gain, Opus
   at about 128 kbit/s. Set the level at the desk, not in the browser.
3. The page starts the sound **by itself** whenever it is opened (also after a restart of the laptop and the browser), unless
   somebody pressed "Switch microphone off". Keep the tab open, the laptop awake and on its charger; the page holds the screen
   awake.
4. In the Regie the station is the channel **A1**: always audible while the broadcast is live, 0 dB. Nothing else is needed.

### 20.2 Other sound

- **Shared screens:** a laptop ticks **Share audio** before it shares. Chrome and Edge on **Windows** can then share the sound of
  the whole computer when the *entire screen* is shared; with a browser tab, any browser based on Chromium can share the sound
  of that tab (tick "Also share tab audio" in the dialog); Firefox and Safari share no sound at all. The sender says "with
  sound" or "No sound is shared with this screen". The sound **follows the picture**: it is heard while the screen is shown in the
  live scene. Change the mode to **Always** to hear it without its picture.
- **Videos:** a video with an audio track has a channel that follows its picture (MP4 and WebM; the track is detected when the
  file is uploaded).
- **Microphones of phones and laptops:** a phone has a "Microphone off" button, a laptop "Add microphone". They start **muted** in
  the mixer, so nothing is on air by accident: unmute the channel in the Audio dock when the speaker is allowed to be heard. It
  then follows the picture of its device (the phone's camera, the laptop's screens); switch the mode to Always to hear it
  independently of any picture. The sender shows **"Mic live"** while its microphone is on air. These microphones use the
  browser's echo cancellation and noise suppression; use headphones at the speaker, or the mixing desk, if there is echo.

### 20.3 The Audio dock

- A row per channel: **PFL** (listen to this channel before its fader and mute, also off air), **M** (mute, also the key M for
  the selected channel), the fader (−∞ to +10 dB; double click = 0 dB, arrow keys, Home and End), the level, and under the
  chevron the **mode** (Always, Follows the picture, Off) and the **sync offset**.
- The meters and the "Program" level above Take start with the first click on the Regie page (a note says so).
- **Monitor** (Audio dock): Off after every reload, Program (the mix as the output plays it) or one channel with PFL; in Chromium
  the monitor can go to headphones. Use **headphones**: the Regie laptop's loudspeakers sound into the microphones.
- Ctrl+Z / Ctrl+Shift+Z in the dock undo and redo the mixer. Every change is in the audit log ("A1 muted", "A1 gain -6.0 dB").
- A fade between scenes fades the sound of the leaving and the arriving picture with the same duration; going live and ending
  the broadcast take 0.3 s; a cut, a mute and a fader move 20 ms.

### 20.4 What can go wrong

See "No sound" in section 11. Good to know:

- A **loud room is not a silence warning**: "no signal for 10 s" only appears for a channel that is on air and delivers
  nothing (levels under −60 dBFS); it is a hint, not an incident, and goes with the next sound.
- An audio station whose microphone is unplugged is an incident "A1 microphone stopped" while it is on air; plugged in again the page
  finds it by itself.
- **Security:** the output page and the Regie receive **every** microphone of the production (they have to, to mix them).
  Anyone who holds an output link can listen to all of them, also microphones that are muted in the mixer, by opening the page
  with developer tools. Keep output links private, restrict them by IP address and regenerate the key after an event; the planned
  public air mode will use its own room so that it can hand out only the mix.
- The sync offset delays the sound; it cannot make it earlier. The picture comes through the browser with about 0.15 s of delay, the
  sound with about the same; a larger difference is usually the proxy.
