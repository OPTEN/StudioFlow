# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Angular (Standalone, Signals, OnPush) für Regie und Sender-PWA, ASP.NET Core (.NET 10) mit SignalR als API, LiveKit als WebRTC-SFU, PostgreSQL als Datenbank. Alles läuft in einem Docker-Compose-Stack auf einem Linux-Server oder lokal per Docker; Daten liegen in Volumes, es gibt keine Cloud-Dienste. Der aktuelle Regie-Entwurf ist ein klickbarer HTML-Prototyp unter `prototype/`.

## Users

- **Regie (primär):** eine Person, höchstens zwei gleichzeitig, OPTEN-intern. Arbeitet während eines Webinars vor Ort an einem 14–16-Zoll-Laptop bei normalem Raumlicht, baut vorher Szenen und schaltet während der Sendung zwischen ihnen um.
- **Sprecherinnen und Sprecher:** teilen einen oder mehrere Bildschirme vom eigenen Laptop über die Sender-Seite im Browser.
- **Kamera-Handys:** fest montierte Smartphones, die über die Sender-PWA als Kameras dienen und nach dem Einrichten unbeaufsichtigt laufen.
- **Abnehmer des Outputs:** ein Proxy öffnet die Output-Seite (16:9, als iframe) und verteilt das Bild an rund 30 Personen.

## Product Purpose

StudioFlow ist eine Web-Regie nach dem Vorbild von OBS für Webinare. Browser-Clients senden Kamera und Bildschirm mit möglichst kleiner Latenz, die Regie stellt daraus Szenen zusammen (Layout-Vorlagen und freies Verschieben, Skalieren, Zuschneiden), und ein fester 16:9-Output liefert das Program als Webseite.

Erfolg heisst: Einrichten geht schnell, Umschalten ist sicher, und kein Ausfall einer Quelle bleibt unbemerkt.

## Positioning

Alles läuft im Browser und auf einem eigenen Server: Handys und Laptops werden ohne App-Installation zu Quellen, das Program ist eine einbettbare Webseite, und der ganze Stack startet mit `docker compose up`. Es braucht weder einen OBS-Rechner noch Cloud-Dienste.

## Operating Context

- Vor Ort, alle Geräte im selben WLAN; der Server läuft lokal (PC mit Docker) oder als VPS im eigenen Betrieb.
- Vor dem Webinar: Geräte koppeln (Handys per QR-Code, Laptops per Kurz-URL mit Code und Freigabe oder per Einladungslink) und Szenen bauen.
- Während des Webinars: Szenen mit einem Klick live schalten oder, mit eingeschaltetem Studio-Modus, zuerst in der Preview prüfen und per Take ins Program schalten.
- Ton läuft ausserhalb von StudioFlow über ein Mischpult; die Architektur bleibt für Ton vorbereitet.
- Begriffe aus OBS und dem Broadcast: Szene, Quelle, Element, Preview, Program, Take, Tally, Slate, Fallback.

## Capabilities and Constraints

- Quellen: Kamera, Screen (mehrere pro Laptop), Bild, Video; später Text, Overlays und Webseiten.
- Output: fester Canvas 1920 × 1080, immer 16:9, als iframe einbettbar, ohne Bedienelemente.
- Latenz-Ziel vor Ort rund 0,15 s Glass-to-Glass (Schätzung, noch nicht gemessen).
- Login: ein Admin-Konto aus appsettings bzw. `.env`, kein SSO.
- Stabilität: automatischer Reconnect ohne Limit; Quellen kehren über Geräte-ID und Slot an ihren Platz in der Szene zurück.
- Regie-Arbeitsfläche wie bei OBS: Docks (Szenen, Quellen, Eigenschaften, Stationen) lassen sich frei anordnen, in der Grösse ändern und ausblenden; das Layout bleibt pro Browser gespeichert.
- Schriften und Assets kommen aus dem eigenen Build, ohne externe CDNs, weil die Regie im LAN läuft.
- Mandantenfähigkeit wird im Datenmodell vorgesehen, vorerst nutzt nur OPTEN das System.
- Später, nicht jetzt: Restream, Aufnahme, Ton in StudioFlow, öffentlicher Air-Modus für Zuschauer ohne Proxy.

## Brand Commitments

- Name: StudioFlow.
- Eigenständiges Werkzeug mit eigenem Look, nicht an das OPTEN-Website-CI gebunden.
- Sprache der Oberfläche: Deutsch (Schweiz), mit «ss» statt «ß» und Guillemets « ».

## Evidence on Hand

Keine echten Inhalte, Kundendaten oder Screenshots. Beispielinhalte in Entwürfen (Personennamen, Folien, Kamerabilder) sind synthetisch und als solche zu kennzeichnen. Architektur und Plan: https://claude.ai/artifact/FKKxDiTsDcu2nfYqfEQRGP

## Product Principles

1. Ausfälle sind sofort sichtbar: Jede Quelle zeigt ihren Zustand dort, wo man ohnehin hinschaut.
2. Einrichten in Minuten: Koppeln, Szenen bauen und Layouts anwenden mit möglichst wenigen Schritten.
3. Umschalten wie bei OBS: Ohne Studio-Modus geht eine Szene mit einem Klick live. Mit Studio-Modus wird in der Preview gebaut, und live geht erst, was mit Take geschaltet wird. Eine Blende läuft immer ganz durch, halbe Mischungen gibt es nicht.
4. Begriffe und Abläufe kommen von OBS, damit niemand umlernen muss.
5. Bei einem Unterbruch läuft alles weiter: Standbild statt Schwarzbild, Reconnect ohne Zutun.
