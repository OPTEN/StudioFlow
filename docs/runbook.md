# StudioFlow – Betriebshandbuch (Runbook)

Für alle, die StudioFlow vor Ort oder auf einer VPS betreiben: einrichten, starten, sichern, aktualisieren und im
Webinar schnell reagieren. Technische Details stehen in `docs/architecture/implementation-spec.md` (Abschnitt 10),
alle Variablen in `.env.example`.

## 1. Überblick

Ein Docker-Compose-Stack mit vier Diensten:

| Dienst | Aufgabe | Daten (Volume) |
|---|---|---|
| `caddy` | HTTPS, Zertifikate, liefert Regie (`/`), Sender (`/join`) und Output (`/o/…`) aus, leitet API und Signalisierung weiter | `caddy_data` (Zertifikate, lokale CA), `caddy_config` |
| `api` | ASP.NET Core: Login, Szenen, Geräte, Tokens, SignalR | `media` (Bilder, Videos), `keys` (Login-Schlüssel) |
| `livekit` | SFU: leitet die Videos der Handys und Laptops weiter | – |
| `postgres` | Datenbank | `pgdata` |

Medien (WebRTC) gehen direkt zwischen Geräten und LiveKit (7881/tcp, 7882/udp), nie über Caddy. Alles andere läuft
über HTTPS auf 443.

Zwei Betriebsarten:

- **Vor Ort (empfohlen):** Server (Mini-PC, zweiter Laptop oder der Regie-Rechner) im selben Netz wie Handys und
  Regie, per Kabel am Router. Eine Subdomain zeigt per A-Record auf die **interne** IP des Servers, das Zertifikat
  kommt per DNS-Challenge. Kleinste Latenz (Ziel rund 0,15 s), kein Internet für die Medien nötig.
- **VPS:** derselbe Stack auf einem Linux-Server im Internet. Die Geräte senden dann übers Internet: mehr Latenz und
  Upload-Bandbreite vor Ort nötig (pro Kamera etwa 2–3 Mbit/s, pro Bildschirm bis 3 Mbit/s – Richtwerte).

## 2. Voraussetzungen

- **Server:** Linux mit Docker Engine und Compose v2 (`docker compose version`), oder Windows/macOS mit Docker Desktop.
  Richtwert 4 CPU-Kerne, 8 GB RAM, 20 GB frei (plus Platz für Videos und Sicherungen). Git für Updates.
- **Windows:** PowerShell 7.4 oder neuer (`pwsh`) für die `.ps1`-Skripte; die `.sh`-Skripte laufen in Git Bash.
  Docker Desktop startet erst nach der Anmeldung des Benutzers – nach einem Neustart also anmelden (oder
  «Start Docker Desktop when you sign in» und automatische Anmeldung einrichten).
- **Docker Desktop (Windows/macOS) sieht keine echten Client-IPs:** Alle Geräte erscheinen mit derselben internen
  Adresse. Folgen: Die IP-Sperre des Outputs lässt sich nicht nutzen, und die Grenzen pro IP gelten für alle Geräte
  zusammen (5 Fehlversuche beim Login sperren den Login 15 Minuten für alle; höchstens 10 Kopplungsanfragen per
  `/join` in 10 Minuten). Für den Betrieb deshalb einen Linux-Server bevorzugen.
- **Netz vor Ort:** eigenes WLAN (5 GHz) für die Handys, ohne Client-Isolation («AP isolation», Gäste-WLAN), Server
  und Regie-Laptop per Kabel. Der Server bekommt im Router eine feste IP (DHCP-Reservierung): LiveKit gibt diese IP
  den Geräten weiter (`STUDIOFLOW_NODE_IP`).
- **Domain:** eine Subdomain, z. B. `studioflow.opten.ch`, bei einem DNS-Anbieter mit API (siehe Abschnitt 4).

Nach dem Klonen auf Linux die Skripte ausführbar machen, falls nötig: `chmod +x *.sh`.

## 3. Ports und Firewall

| Port | Wozu | Von wo erreichbar |
|---|---|---|
| 443/tcp | HTTPS: Regie, Sender, Output, API, Signalisierung | Geräte im WLAN; Proxy; bei VPS das Internet |
| 443/udp | HTTP/3 (optional, Browser fallen sonst auf HTTP/2 zurück) | wie 443/tcp |
| 80/tcp | Umleitung auf HTTPS; im Modus `acme` die Let's-Encrypt-Prüfung | wie 443/tcp |
| 7881/tcp | LiveKit-Medien über TCP (Ausweichweg, wenn UDP blockiert ist) | alle sendenden und empfangenden Geräte |
| 7882/udp | LiveKit-Medien über UDP (Hauptweg) | alle sendenden und empfangenden Geräte |

Nicht veröffentlicht und nie freigeben: 7880 (LiveKit-Signalisierung, nur über Caddy `/rtc`), 8080 (API),
5432 (PostgreSQL), 2019/2020 (Caddy intern).

- **Linux (ufw):** `sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp`.
  Achtung: Docker umgeht ufw für veröffentlichte Ports (eigene iptables-Kette). Einschränken nur über die Kette
  `DOCKER-USER` oder die Firewall des VPS-Anbieters.
- **Windows:** Das WLAN/LAN muss als Netzwerkprofil «Privat» eingestellt sein. Beim ersten Start fragt Windows nach
  Freigaben für Docker Desktop – zulassen. Falls Geräte nicht verbinden, Regeln anlegen (PowerShell als Administrator):

  ```powershell
  New-NetFirewallRule -DisplayName 'StudioFlow HTTPS' -Direction Inbound -Protocol TCP -LocalPort 80,443 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow HTTP/3' -Direction Inbound -Protocol UDP -LocalPort 443 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow Medien TCP' -Direction Inbound -Protocol TCP -LocalPort 7881 -Profile Private -Action Allow
  New-NetFirewallRule -DisplayName 'StudioFlow Medien UDP' -Direction Inbound -Protocol UDP -LocalPort 7882 -Profile Private -Action Allow
  ```

- **VPS:** dieselben Ports in der Firewall des Anbieters öffnen. `STUDIOFLOW_NODE_IP` ist dann die öffentliche IP.

## 4. DNS und Zertifikat

Browser geben Kamera und Bildschirm nur über HTTPS frei – auch im WLAN. Der TLS-Modus steht in `STUDIOFLOW_TLS_MODE`.

| Modus | Wann | Was nötig ist |
|---|---|---|
| `dns-<anbieter>` | **Empfohlen vor Ort und auf der VPS.** Echtes Let's-Encrypt-Zertifikat, auch wenn der Server nur intern erreichbar ist | A-Record auf die interne IP, API-Token des DNS-Anbieters |
| `acme` | VPS, öffentlich erreichbar | A-Record auf die öffentliche IP, 80/tcp und 443/tcp offen |
| `internal` | Schnelltest ohne Domain (`localhost`, IP, lokaler Name) | Jedes Gerät installiert einmal die Root-CA (`/ca.crt`) |
| `custom` | Eigenes Zertifikat (z. B. von der IT) | `fullchain.pem` und `privkey.pem` nach `/certs` mounten (siehe `docker-compose.override.example.yml`); Erneuerung von Hand |

### 4.1 Subdomain auf die interne IP

Beim DNS-Anbieter einen A-Record anlegen: `studioflow.opten.ch` → `192.168.1.50` (die LAN-IP des Servers). Das ist
unbedenklich: die Adresse ist nur im eigenen Netz erreichbar.

- Manche Router verwerfen DNS-Antworten mit privaten Adressen («DNS-Rebind-Schutz», z. B. FRITZ!Box, pfSense).
  Dann für die Domain eine Ausnahme eintragen (FRITZ!Box: Heimnetz › Netzwerk › Netzwerkeinstellungen ›
  DNS-Rebind-Schutz) oder im Router einen lokalen DNS-Eintrag anlegen.
- Prüfen von einem Gerät im WLAN: `nslookup studioflow.opten.ch` muss die interne IP liefern.

### 4.2 DNS-Challenge pro Anbieter

`./setup.sh` fragt Modus und Token ab. Die Zugangsdaten landen in der `.env`.

| Anbieter | Modus | Variablen | Rechte des Tokens |
|---|---|---|---|
| Cloudflare | `dns-cloudflare` | `CF_API_TOKEN` | Zone › Zone › Read und Zone › DNS › Edit für die Zone |
| Infomaniak (CH) | `dns-infomaniak` | `INFOMANIAK_API_TOKEN` | Scopes `domain:read dns:read dns:write` |
| Hetzner | `dns-hetzner` | `HETZNER_API_TOKEN` | Token des Hetzner-Cloud-Projekts mit der DNS-Zone (die alte DNS-Konsole ist abgeschaltet) |
| deSEC | `dns-desec` | `DESEC_TOKEN` | Token des Kontos (auch für die Delegation unten) |
| AWS Route 53 | `dns-route53` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | IAM: `route53:ListHostedZones*`, `GetChange`, `ChangeResourceRecordSets` |
| Gandi | `dns-gandi` | `GANDI_BEARER_TOKEN` | Personal Access Token mit «Domain technical configurations» |
| OVHcloud | `dns-ovh` | `OVH_ENDPOINT` (z. B. `ovh-eu`), `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY` | GET/POST/PUT/DELETE auf `/domain/zone/*` |

Das Zertifikat holt Caddy beim ersten Start; Erneuerung automatisch. Kontrolle:
`docker compose logs caddy | grep -i -E "certificate obtained|error"`.

### 4.3 Hostpoint, cyon und andere ohne Modul: Challenge delegieren

Für Hostpoint und cyon gibt es kein Caddy-Modul. Die Lösung: nur den Prüfeintrag `_acme-challenge` per CNAME an eine
Zone bei deSEC (kostenlos) oder Cloudflare delegieren. Der A-Record bleibt beim bisherigen Anbieter.

1. Bei [deSEC](https://desec.io) ein Konto und eine Domain anlegen, z. B. `studioflow-opten.dedyn.io`, und einen
   Token erstellen.
2. Beim bisherigen Anbieter (Zone `opten.ch`) einen CNAME anlegen:
   `_acme-challenge.studioflow` → `_acme-challenge.studioflow-opten.dedyn.io.`
3. Setup mit Delegation:

   ```bash
   DESEC_TOKEN=… ./setup.sh --domain studioflow.opten.ch --tls-mode dns-desec \
       --dns-challenge-domain _acme-challenge.studioflow-opten.dedyn.io
   ```

   (Windows: `$env:DESEC_TOKEN = '…'; ./setup.ps1 -Domain studioflow.opten.ch -TlsMode dns-desec -DnsChallengeDomain _acme-challenge.studioflow-opten.dedyn.io`)
4. Prüfen: `nslookup -type=CNAME _acme-challenge.studioflow.opten.ch` zeigt das Ziel bei deSEC.

Mit Cloudflare genauso (`dns-cloudflare`, CNAME-Ziel in einer Zone bei Cloudflare).

### 4.4 Interner Modus: Root-Zertifikat auf den Geräten installieren

Im Modus `internal` signiert Caddy selbst. Jedes Gerät muss die Root-CA einmal vertrauen, sonst blockiert der
Browser Kamera und Bildschirm. Die CA liegt im Volume `caddy_data` (10 Jahre gültig, in jeder Sicherung enthalten).
Geht das Volume verloren, entsteht eine neue CA und alle Geräte müssen sie neu installieren.

Download auf dem Gerät: `https://<domain>/ca.crt` (die Zertifikatswarnung beim ersten Aufruf einmal bestätigen).

- **iPhone/iPad:** Link in Safari öffnen › «Zulassen» › Einstellungen › Allgemein › VPN und Geräteverwaltung ›
  Profil «Caddy Local Authority» › Installieren. Danach **zusätzlich** Einstellungen › Allgemein › Info ›
  Zertifikatsvertrauenseinstellungen › «Caddy Local Authority» einschalten.
- **Android:** Datei laden › Einstellungen › Sicherheit › (Weitere Einstellungen) › Verschlüsselung und
  Anmeldedaten › Zertifikat installieren › **CA-Zertifikat** › Datei wählen. Chrome vertraut ihr danach.
- **Windows:** Datei doppelklicken › Zertifikat installieren › Lokaler Computer › «Alle Zertifikate in folgendem
  Speicher speichern» › Vertrauenswürdige Stammzertifizierungsstellen. Oder als Administrator:
  `certutil -addstore -f Root studioflow-root-ca.crt`.
- **macOS:** Datei doppelklicken › Schlüsselbund «System» › Zertifikat öffnen › Vertrauen › «Immer vertrauen».
- **Firefox** (eigener Zertifikatsspeicher, falls die Warnung bleibt): Einstellungen › Datenschutz & Sicherheit ›
  Zertifikate anzeigen › Zertifizierungsstellen › Importieren › «Dieser CA vertrauen, um Websites zu identifizieren».

Zugriff per IP statt Name: `--extra-hosts 192.168.1.50` bei `setup` (setzt auch `STUDIOFLOW_DEFAULT_SNI`), dann
gilt das Zertifikat auch für `https://192.168.1.50`. Oder gleich `--domain 192.168.1.50`.

## 5. Einrichten

```bash
git clone <repo> studioflow && cd studioflow
./setup.sh                      # Linux/macOS (Git Bash geht auch)
pwsh ./setup.ps1                # Windows
docker compose up -d --build    # erster Start: baut die Images (einige Minuten)
docker compose ps               # alle vier Dienste «healthy»?
```

`setup` fragt: LAN-IPv4 (automatisch erkannt, bestätigen), TLS-Modus (+ E-Mail und Token), Domain, weitere Adressen
(nur `internal`), Origins für das Einbetten des Outputs (`STUDIOFLOW_FRAME_ANCESTORS`, z. B. die Domain des Proxys),
Admin-Benutzer und Passwort (zweimal verdeckt, oder leer lassen für ein erzeugtes Passwort, das genau einmal
angezeigt wird). Es erzeugt LiveKit-Schlüssel und Datenbank-Passwort, baut das API-Image und speichert nur den
**Hash** des Passworts. Die `.env` bekommt die Rechte 600.

- Ohne Rückfragen: `./setup.sh --non-interactive --domain … --tls-mode … --generate-password` (alle Optionen:
  `./setup.sh --help`, `Get-Help ./setup.ps1 -Full`). Token kommen dann aus der Umgebung.
- Erneut ausführen (andere Domain, neues Passwort): `./setup.sh --force`. Die alte Datei bleibt als
  `.env.backup-<zeit>`; Datenbank-Passwort und LiveKit-Schlüssel werden übernommen (das Datenbank-Passwort lässt sich
  nach der ersten Initialisierung nicht über die `.env` ändern). Danach `docker compose up -d`.
- **Die `.env` sofort in den Passwort-Tresor (Keeper) legen.** Sie ist nicht im Git und nicht in den Sicherungen.
- Lokale Entwicklung mit `ng serve`: siehe `docker-compose.override.example.yml`.

Erster Login: `https://<domain>/` mit dem Admin-Konto. Beim ersten Start legt die API die Datenbank und die
Produktion «Webinar» an.

## 6. Starten, stoppen, Logs

| Was | Befehl |
|---|---|
| Starten / nach Änderung an `.env` | `docker compose up -d` |
| Status und Healthchecks | `docker compose ps` |
| Logs (live) | `docker compose logs -f --tail 100 api` (oder `caddy`, `livekit`, `postgres`) |
| Einen Dienst neu starten | `docker compose restart api` |
| Stoppen (Daten bleiben) | `docker compose stop` bzw. `docker compose down` |
| Ressourcen | `docker stats`, `docker system df` |

- **Nie `docker compose down -v`**: das löscht alle Volumes – Datenbank, Medien, Zertifikate und die lokale CA.
- Alle Container haben `restart: unless-stopped` und starten nach einem Absturz oder Neustart von selbst.
- Logs sind pro Container auf 5 × 10 MB begrenzt. Tokens, Output-Schlüssel und Einladungslinks werden in den
  Caddy-Logs geschwärzt (`REDACTED`).
- Healthcheck im Detail: `docker inspect --format '{{json .State.Health}}' studioflow-api-1`.

## 7. Sicherung und Wiederherstellung

```bash
./backup.sh                    # Windows: pwsh ./backup.ps1
./backup.sh --keep 14          # danach nur die 14 neusten Sicherungen behalten
./restore.sh backups/2026-10-22_1430
```

Eine Sicherung (`backups/YYYY-MM-DD_HHMM/`) enthält die Datenbank (`database.dump`, pg_dump), die Volumes `media`,
`keys` und `caddy_data` als `.tar.gz`, `backup-info.txt` und `SHA256SUMS`. Sie läuft im Betrieb und stört keine
Sendung. Sie enthält private Schlüssel (Login, Zertifikate, CA): Ordner geschützt aufbewahren und regelmässig auf
ein anderes Gerät kopieren.

Automatisch jede Nacht (Linux, `crontab -e`):

```cron
15 3 * * * cd /opt/studioflow && ./backup.sh --keep 14 >> backups/backup.log 2>&1
```

Windows: Aufgabenplanung › Aufgabe erstellen › Aktion `pwsh.exe -NoProfile -File C:\studioflow\backup.ps1 -Keep 14`.

Wiederherstellen (`./restore.sh` / `restore.ps1`): prüft die Prüfsummen, fragt nach (ausser `--yes`), legt zuerst
eine Sicherung des aktuellen Stands an (`backups/…_vor-restore`), stoppt API und Caddy, spielt die Datenbank in eine
neue Datenbank ein und tauscht sie erst danach aus (schlägt das Einspielen fehl, bleibt die alte unverändert),
ersetzt die Volumes und startet alles. Während einer Sendung verweigert es den Start (`--force` übersteuert).

Umzug auf einen neuen Server: Repo klonen, die `.env` aus dem Tresor zurücklegen (oder `setup` neu ausführen),
`docker compose up -d --build`, dann `./restore.sh <sicherung>`.

## 8. Update

**Nie während einer Sendung.** Das Skript prüft das selbst und bricht ab, solange eine Produktion live ist.

```bash
./update.sh --backup           # Windows: pwsh ./update.ps1 -Backup
```

Ablauf: Sendestatus prüfen (`broadcast-status` der API) → optional Sicherung → `git pull --ff-only` →
`docker compose up -d --build` → warten, bis alle Dienste gesund sind → Status. Volumes bleiben erhalten.

- Bei lokalen Änderungen oder abweichendem Stand bricht `git pull --ff-only` ab, ohne etwas neu zu starten.
- Neue Variablen in einer neuen Version: `docker compose` meldet sie beim Start; mit `.env.example` vergleichen.
- Antwortet die API nicht («Sendestatus unbekannt»), verweigert das Skript ebenfalls; mit `--force` geht es trotzdem
  (z. B. wenn die API wegen eines Fehlers dauernd neu startet und das Update die Korrektur bringt).
- Zurück auf eine frühere Version: `git log --oneline`, `git checkout <commit>`, `./update.sh --no-pull`. Hat die
  neue Version die Datenbank migriert, zusätzlich die Sicherung `…_vor-update` wiederherstellen. Später mit
  `git checkout main` zurück.
- Aufräumen nach Updates: `docker image prune` entfernt alte, unbenutzte Build-Images.

## 9. Checkliste vor dem Webinar

**Am Vortag**

- [ ] `./update.sh --backup` (falls ein Update ansteht) – danach kein Update mehr bis nach der Sendung.
- [ ] `docker compose ps`: alle Dienste «healthy». Zertifikat gültig (Regie lädt ohne Warnung).
- [ ] Szenen, Fallbacks pro Element und Slates («Gleich geht's los», «Danke fürs Zuschauen») vorbereitet.
- [ ] Output-Link beim Proxy getestet: Seite lädt im iframe, Bild läuft, die Domain des Proxys steht in
      `STUDIOFLOW_FRAME_ANCESTORS`; falls IP-Sperre aktiv: Proxy-IP eingetragen (auf Docker Desktop sieht die API
      nur die interne Docker-Adresse – die IP-Sperre funktioniert zuverlässig nur auf einem Linux-Server).

**Vor Ort, 60 Minuten vorher**

- [ ] Server und Regie-Laptop **per Kabel** am Router; Handys im **5-GHz**-WLAN ohne Gäste und ohne
      Client-Isolation; der Server hat seine feste IP (`STUDIOFLOW_NODE_IP`).
- [ ] Handys **am Ladekabel**, fest montiert, «Nicht stören» an, Energiesparmodus aus, automatische Sperre aus.
- [ ] Geräte koppeln (Handys per QR-Code, Laptops per `/join` mit Prüfcode oder Einladungslink).
- [ ] **Technik-Check** in jedem Sender: Kamera, Netzwerk, Bandbreite (≥ 6 Mbit/s gut, ≥ 3 Mbit/s knapp).
- [ ] Monitoring-Ansicht: Bitrate, Paketverlust und Akku aller Stationen unauffällig.
- [ ] Output beim Proxy: Bild aktuell, Latenz im Output-Chip plausibel; Probe-Umschaltung.
- [ ] `./backup.sh`.

**15 Minuten vorher**

- [ ] Standby-Slate läuft beim Proxy; alle Stationen grün; Sprecherinnen teilen den richtigen Bildschirm.
- [ ] Zweites Gerät für die Regie bereit (Login getestet) – falls der Regie-Browser abstürzt.

## 10. Was tun, wenn …

| Ereignis | StudioFlow reagiert von selbst | Beim Proxy | Was tun |
|---|---|---|---|
| Ein Handy verliert kurz das WLAN | ICE-Restart, die Session bleibt; die Station blinkt amber «verbindet neu» | kurzes Standbild (≈ 1–3 s) | Nichts. Danach «wieder da · war 9 s weg» mit «Gesehen» bestätigen. Dauert es länger als ≈ 30 s: Handy prüfen (WLAN, Sender-Seite im Vordergrund, Akku); bis dahin eine Szene ohne diese Kamera nehmen – nach der Haltezeit greift der Fallback bzw. das abgedunkelte Standbild. |
| Anruf oder andere App belegt die Kamera | Sender fordert die Kamera neu an und publiziert neu (3 Versuche) | Standbild, dann wieder live | Anruf beenden/ablehnen, die Sender-Seite wieder in den Vordergrund holen. Zeigt die Station «kein Bild»: Kamera in der Sender-Seite neu starten oder die Seite neu laden. Vorbeugen: «Nicht stören». |
| Die Sender-Seite wird neu geladen | gleiche Geräte-ID, gleicher Slot, Auto-Start mit den letzten Einstellungen | kurzes Standbild | Nichts – ausser der Browser fragt erneut nach der Kamera-Freigabe (iOS): «Erlauben». |
| Jemand beendet sein Screen-Sharing | die Regie warnt («S1 Teilen beendet»), der Sender zeigt «Erneut teilen» | Fallback der Kachel | In der Regie «Erneut teilen» anfordern oder die Person bitten, «Erneut teilen» zu klicken und den Bildschirm zu wählen; sonst Szene wechseln. Der Bildschirm kommt an dieselbe Stelle zurück. |
| Das WLAN ist überlastet | Simulcast senkt die Stufen; die Regie zeigt Paketverlust und Bitrate pro Station | etwas weniger scharf, kein Hänger | Fremde Geräte aus dem WLAN, Handys auf 720p, nicht benötigte Quellen stoppen, Laptops ein Fenster statt den ganzen Bildschirm teilen lassen, WLAN-Kanal wechseln. |
| Der Regie-Browser stürzt ab | der Output läuft weiter, er hängt nicht am Regie-Browser | nichts | Browser neu öffnen und anmelden (die Anmeldung bleibt 12 h gültig); Layout und Studio-Modus kommen aus dem Browser zurück. Notfalls das zweite Regie-Gerät nehmen. |
| API-Neustart oder Update | die API trennt beim Herunterfahren alle Hub-Verbindungen sofort (Neustart in wenigen Sekunden, ohne «verbindet neu»); SignalR verbindet neu, der Zustand wird per Version abgeglichen; Medien laufen weiter. Kommt ein Gerät mit einer Quelle im Program oder in der Preview nicht innert 15 s zurück, meldet die Regie es («verbindet neu») | nichts | Nichts. (Updates trotzdem nie während einer Sendung.) |
| Die Datenbank (PostgreSQL) ist weg | Befehle der Regie scheitern innert weniger Sekunden mit «Die Datenbank ist im Moment nicht erreichbar. Bitte gleich nochmals versuchen.»; Hubs, Output und Medien laufen weiter; ist die Datenbank zurück, funktioniert alles wieder ohne API-Neustart | nichts | `docker compose ps` / `docker compose logs --tail 200 postgres`; `docker compose start postgres`. Danach den Befehl wiederholen. |
| Ein Container stürzt ab | Docker startet ihn neu; alle Clients verbinden sich selbst neu | Standbild, einige Sekunden (LiveKit) | `docker compose ps`; startet ein Dienst dauernd neu («Restarting»): `docker compose logs --tail 200 <dienst>` und Abschnitt 11. |
| Der ganze Server startet neu | alle Container starten automatisch, alle Geräte kommen von selbst zurück | Unterbruch, bis der Server wieder da ist | Windows: anmelden, damit Docker Desktop startet. Warten, bis `docker compose ps` alles «healthy» zeigt. Hat der Server eine neue IP bekommen: `STUDIOFLOW_NODE_IP` in `.env` anpassen, `docker compose up -d`. |
| Ein Gerät wird in einem zweiten Tab geöffnet | der alte Tab wird getrennt und bleibt aus («In einem anderen Tab geöffnet»), kein Ping-Pong | nichts | Im gewünschten Tab «Hier weitermachen». |

## 11. Fehlersuche

### Handys oder Laptops verbinden nicht

**Die Seite lädt nicht oder zeigt eine Zertifikatswarnung**

1. Richtiges WLAN? Kein Gäste-WLAN, keine Client-Isolation. Mobile Daten ausschalten, VPN und
   iCloud-Privat-Relay testweise aus.
2. DNS: `nslookup <domain>` auf dem Gerät (oder einem Laptop im selben WLAN) liefert die Server-IP? Sonst Abschnitt
   4.1 (DNS-Rebind-Schutz).
3. Firewall: 443/tcp offen (Abschnitt 3)? Test von einem Laptop: `Test-NetConnection <ip> -Port 443` bzw.
   `nc -vz <ip> 443`.
4. Zertifikat: Modus `internal` → CA installiert und (iOS) in den Zertifikatsvertrauenseinstellungen
   eingeschaltet? Datum und Uhrzeit des Geräts korrekt? Modus `dns-*` → `docker compose logs caddy` (siehe unten).

**Die Seite lädt, aber kein Bild («verbindet …»)**

1. `STUDIOFLOW_NODE_IP` falsch oder veraltet: `docker compose logs livekit | grep nodeIP` zeigt die angekündigte
   IP. Sie muss die aktuelle LAN-IP des Servers sein (nicht 127.0.0.1, nicht eine Docker- oder WSL-Adresse).
   Korrigieren in `.env`, dann `docker compose up -d`.
2. Medienports: 7882/udp und 7881/tcp freigegeben (Abschnitt 3)? Test: `Test-NetConnection <ip> -Port 7881`.
3. Client-Isolation im WLAN verhindert Verbindungen zwischen Geräten und Server.
4. Funktioniert es nur über TCP (7881), läuft es, aber mit mehr Latenz – dann ist UDP 7882 blockiert.

### Schwarzes Bild

- In der Regie den Status der Quelle ansehen: «Teilen beendet», «kein Bild», «gesperrt», «nicht verbunden»?
- Handy: Die Sender-Seite muss im Vordergrund bleiben; mit gesperrtem Bildschirm oder in einer anderen App stoppt
  iOS die Kamera. Den Dunkelmodus der Sender-Seite statt der Bildschirmsperre verwenden.
- Laptop: Wurde ein minimiertes Fenster geteilt? Fenster wiederherstellen oder den ganzen Bildschirm teilen.
- Output beim Proxy: `/o/<slug>?k=…&debug=1` zeigt Verbindungsstatus, Auflösung, Bildrate und Bitrate pro Quelle.
  «Kein Zugang» → Schlüssel wurde neu erzeugt (neuen Link schicken) oder die IP-Sperre passt nicht.

### Hohe Latenz

- Output mit `?debug=1`: geschätzte Latenz und Jitter-Buffer.
- Server oder Regie über WLAN statt Kabel? Handys im 2,4-GHz-Band? Überlastetes WLAN (Abschnitt 10)?
- Medien über TCP statt UDP (7882/udp blockiert): in Chrome `chrome://webrtc-internals` › aktives Candidate-Paar
  zeigt `udp` oder `tcp`.
- Was der Proxy an Puffer dazufügt, liegt ausserhalb von StudioFlow.

### Zertifikat wird nicht ausgestellt (dns-*, acme)

- `docker compose logs caddy | grep -i -E "acme|challenge|obtain|error"`.
- Token und Rechte des Anbieters (Abschnitt 4.2); Token in `.env` ohne Leerzeichen am Ende.
- Delegation: `nslookup -type=CNAME _acme-challenge.<domain>` zeigt das Ziel; `STUDIOFLOW_DNS_CHALLENGE_DOMAIN`
  stimmt genau mit dem Ziel überein.
- Modus `acme`: 80/tcp und 443/tcp aus dem Internet erreichbar, A-Record auf die öffentliche IP.
- Nach mehreren Fehlversuchen sperrt Let's Encrypt für eine Stunde; Caddy versucht es selbst weiter (auch bei
  ZeroSSL). Nach einer Korrektur in `.env`: `docker compose up -d`.

### Login klappt nicht

- Nach 5 Fehlversuchen von derselben IP ist der Login 15 Minuten gesperrt (die API antwortet mit 429).
- Passwort vergessen: `./setup.sh --force`, «Bestehendes Admin-Passwort behalten?» verneinen, neues Passwort setzen,
  dann `docker compose up -d`.
- `docker compose logs api` beim Start: fehlt `ADMIN__PASSWORDHASH`/`ADMIN__PASSWORD`, startet die API nicht.

### Netzprobleme gezielt simulieren (Test, nie während einer Sendung)

Das Profil `chaos` verzögert und verliert Pakete im Netz von LiveKit (Medien, Signalisierung und API ↔ LiveKit):

```bash
docker compose --profile chaos run --rm netem apply 100 10 0          # 100 ms Verzögerung je Richtung, 10 ms Jitter
docker compose --profile chaos run --rm netem apply 0 0 5             # 5 % Paketverlust
docker compose --profile chaos run --rm netem apply 0 0 0 2mbit       # Bandbreite 2 Mbit/s
docker compose --profile chaos run --rm netem show
docker compose --profile chaos run --rm netem clear                   # immer wieder aufheben
```

Die Einstellung bleibt bis `clear` oder bis der LiveKit-Container neu erstellt wird.

## 12. Sicherheit im Betrieb

- `.env`, `backups/` und das Volume `caddy_data` enthalten Secrets und private Schlüssel: nie weitergeben, Backups
  verschlüsselt oder an einem geschützten Ort aufbewahren.
- Nur die Ports aus Abschnitt 3 freigeben. API, Datenbank und LiveKit-Signalisierung sind nur über Caddy erreichbar.
- `STUDIOFLOW_TRUSTED_PROXIES` nie auf das LAN setzen – sonst lässt sich die IP-Sperre des Outputs mit einem
  gefälschten `X-Forwarded-For` umgehen.
- Den Output-Link nur dem Proxy geben; bei Verdacht in der Regie den Schlüssel neu erzeugen.
- Betriebssystem und Docker aktuell halten; StudioFlow-Updates nach Abschnitt 8.
