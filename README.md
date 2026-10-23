# StudioFlow

StudioFlow ist eine Web-Regie nach dem Vorbild von OBS, gedacht für Webinare.

- Handys und Laptops senden Kamera und Bildschirm direkt aus dem Browser.
- Die Regie stellt daraus Szenen zusammen.
- Ein 16:9-Output läuft als iframe beim Proxy, der das Bild an rund 30 Personen verteilt.
- Alles läuft in einem Docker-Compose-Stack auf dem eigenen Server.

Stand 22.10.2026: Plan und klickbarer Regie-Prototyp sind fertig. Es gibt noch keinen Produktcode.

## Was wo liegt

| Pfad | Inhalt |
|---|---|
| `docs/history/FlowStudio Architekturplan.html` | Architektur und Plan, Entwurf 2 (historisch, deutsch, nicht gepflegt). Im Browser öffnen. |
| `docs/history/regie-*.png` | Bilder der Regie im Plan |
| `docs/history/archiv/` | ältere Fassung (Entwurf 1 vom 21.10.2026) |
| `prototype/regie.html` | klickbarer Regie-Prototyp mit Beispieldaten |
| `prototype/fonts/` | Schriften des Prototyps mit Lizenztexten (SIL Open Font License) |
| `PRODUCT.md` | Produktkontext: Nutzer, Zweck, Grundsätze |
| `DESIGN.md`, `.impeccable/design.json` | Gestaltungssystem der Regie |
| `.impeccable/surfaces/prototype-regie-html.md` | Brief und Gestaltungsvertrag der Regie |
| `.impeccable/review/` | Screenshots aller Ansichten, Grundlage der Reviews |
| `.impeccable/qualitybar/`, `.impeccable/decision-payload.json` | die gewählte Richtung «Dunkle Konsole» und die Entscheidungsrunde dazu |
| `tools/` | Skripte für Screenshots und Artifact-Fassungen |

## Online

Beide Seiten sind privat. Freigeben kannst du sie über «Teilen» auf der jeweiligen Seite.

- Plan: https://claude.ai/artifact/FKKxDiTsDcu2nfYqfEQRGP
- Prototyp: https://claude.ai/artifact/AAF59C3MX62bjKvW2B4UYu

## Prototyp benutzen

1. `prototype/regie.html` im Browser öffnen. Das geht auch offline, weil die Schriften im Ordner liegen.
2. Bestimmte Ansichten direkt aufrufen mit diesen Ankern: `#studio`, `#stoerung`, `#koppeln`, `#docks`. Sie lassen sich mit `+` kombinieren, zum Beispiel `regie.html#studio+stoerung`.
3. Das Menü «Prototyp» spielt Störungen und eine Kopplungsanfrage ab. «Alles zurücksetzen» setzt auch das Layout und den Studio-Modus zurück.

## Entscheide in Kürze

**Betrieb**

- Ein Docker-Compose-Stack mit Caddy, ASP.NET Core API, LiveKit und PostgreSQL. Daten liegen in Volumes, es gibt keine Cloud-Dienste.
- Er läuft lokal per Docker oder auf einer VPS im Betrieb.
- Login mit einem Admin-Konto aus appsettings bzw. `.env`, ohne SSO.
- Alle Geräte sind vor Ort im selben WLAN. HTTPS gibt es trotzdem, per Subdomain und DNS-Challenge.

**Output und Ton**

- Der Output geht über einen geheimen, sperrbaren Link an einen Abnehmer, den Proxy.
- Der Air-Modus bleibt eine Reserve für später.
- Ton läuft extern über ein Mischpult. Die Architektur bleibt für Ton vorbereitet.

**Regie**

- Eine durchgehende dunkle Konsole ohne Kästen und ohne Rahmen.
- Studio-Modus wie bei OBS, standardmässig aus. Dann geht ein Klick auf eine Szene direkt live.
- Kein T-Bar: Es gibt Schnitt oder Blende, und eine Blende läuft immer ganz durch.
- Die Szenen liegen unten neben den Quellen.
- Alle Docks lassen sich verschieben (unten, links, rechts), in der Grösse ändern und ausblenden. Der Browser merkt sich das Layout.
- Schriften und Assets kommen aus dem eigenen Build, ohne CDN.

**Geräte koppeln**

- Handys per QR-Code.
- Laptops per Kurz-URL `/join` mit Prüfcode und Freigabe in der Regie, oder per einmaligem Einladungslink.

## Offen

- **Proxy:** Was genau ist der Proxy, zum Beispiel eine Browserquelle? Davon hängt ab, ob der Air-Modus nötig wird.
- **Zertifikat:** Welche Domain und welcher DNS-Anbieter, zum Beispiel `studioflow.opten.ch`?
- **Server:** Läuft er auf dem Regie-Laptop oder auf der VPS? Empfehlung: VPS oder ein zweiter Rechner per Kabel.
- **Leeres Artifact:** Das leere Design-Artifact «StudioFlow Regie» (https://claude.ai/artifact/NkhevB8Mp4ez2SmZoufRkN) wird nicht gebraucht und kann gelöscht werden.
- **Docks:** Ziehen und Andocken sind von Hand getestet, aber nicht als Screenshot festgehalten.

## Nächster Schritt

Phase 0 ist ein technischer Probelauf (Details im Plan, Abschnitt 9):

- Compose-Stack aufsetzen.
- HTTPS im WLAN einrichten.
- Handy über die SFU zum Browser schicken und die Latenz Glass-to-Glass messen.
- Reconnect testen.

## Werkzeuge

**Screenshots aller Ansichten** nach `.impeccable/review/`. Braucht Microsoft Edge, für `mobile.png` zusätzlich ffmpeg.

```
pwsh tools/capture.ps1
```

**Artifact-Fassung erzeugen.** Das Skript entfernt doctype, html, head und body. Beim Veröffentlichen die Zusatzdateien mitgeben: `fonts/*` beim Prototyp, `regie-*.png` beim Plan.

```
pwsh tools/make-artifact.ps1 -In prototype/regie.html -Out $env:TEMP/regie-artifact.html
```
