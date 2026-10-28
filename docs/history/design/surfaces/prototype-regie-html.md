---
version: 1
slug: "prototype-regie-html"
primary_target: "prototype/regie.html"
related_targets: []
---

# Regie (Studio)

Scope: die Regie-Oberfläche von StudioFlow, als klickbarer Prototyp. Modus: Operate.

Publikum und Aufgabe: eine Person, höchstens zwei, an einem 14–16-Zoll-Laptop vor Ort im WLAN. Vor dem Webinar Geräte koppeln (Handys per QR, Laptops per Kurz-URL mit Prüfcode, Einladungslink), Szenen bauen und die Arbeitsfläche einrichten. Während des Webinars Szenen umschalten: ohne Studio-Modus mit einem Klick direkt live, mit Studio-Modus zuerst in der Preview prüfen und per Take schalten.

Kritisch laut Interview: kein Ausfall einer Quelle bleibt unbemerkt; das Einrichten geht schnell.

Constraints: OBS-Begriffe (Szene, Quelle, Element, Preview, Program, Take, Studio-Modus, Dock); Deutsch (Schweiz) mit «ss» und « »; Beispieldaten sichtbar als synthetisch gekennzeichnet; hält von 1280 × 720 bis 1920 × 1080, stapelt darunter nach Priorität. Die Schriften liegen im eigenen Build (kein Abruf bei Google Fonts), weil die Regie im LAN läuft; der Prototyp lädt sie aus prototype/fonts (SIL Open Font License).

Entscheide des Nutzers nach dem ersten Entwurf (22.10.2026): keine Kästen mit Zwischenräumen und kein Rahmen aussen; kein T-Bar, weil eine Blende nie halb stehen bleibt; Szenen unten neben den Quellen; Preview nur im Studio-Modus, der sich wie bei OBS ein- und ausschalten lässt (Standard: aus); alle Docks (Szenen, Quellen, Eigenschaften, Stationen) lassen sich frei anordnen, verschieben und in der Grösse ändern, wie bei OBS.

Memorable moment: Eine Störung leuchtet überall auf, wo die Quelle gezeigt wird, und bleibt markiert, bis jemand sie bestätigt. Der Studio-Modus klappt die Preview ein und aus, ohne dass sich Docks und Bedienspalte verschieben.

Offen: ein helles Theme für sehr helle Räume ist nicht Teil dieses Entwurfs; der Ton-Mixer kommt später.

## Direction contract

THESIS: Die Regie als eine durchgehende Konsole auf Graphit: keine Kästen und kein Rahmen, die Bereiche stossen aneinander und sind nur durch Haarlinien bis an den Fensterrand getrennt. Die Haarlinien sind zugleich die Griffe, mit denen die Fläche eingeteilt wird. Farbe gehört nur Zuständen, und heikle Aktionen stehen mit Abstand für sich. Abgelehnt werden das OBS-Dock-Gewusel aus gleichrangigen grauen Fenstern, in dem ein Ausfall untergeht, und gerahmte Karten mit Lücken dazwischen.

OWN-WORLD: Grund #0D1117 für Monitore und Eingaben, Fläche #151A22, erhöht #1B212B, Haarlinien #262C36 statt Schatten und Rahmen; Text #E6EDF3, gedämpft #8B949E. Zustandsfarben aus der Syntax-Palette: Rot Program und live, Grün Preview und ok, Bernstein verbindet neu, Blau Auswahl, primäre Aktion und aktive Trennlinie, Violett editierbare Zahlenwerte. Kompakte Grotesk für alles, Mono nur für Messwerte, Zeitcodes und Platzcodes. Gefahr-Aktionen als gestrichelte rote Umrisse mit Abstand. 1-px-Punktraster nur beim Ziehen eines Elements.

STORY: Ein Blick zeigt, was live ist und ob alle Stationen gesund sind. Ohne Studio-Modus schaltet ein Klick auf eine Szene oder die Taste 1–9 sie direkt live, als Schnitt oder als Blende, die immer ganz durchläuft; Änderungen im Program wirken sofort und sind so beschriftet. Mit Studio-Modus kommt die Preview dazu: dort wird gebaut, Take schaltet. Fällt eine Station aus, markieren Kopfzeile, Meldungszeile, Monitor, Szenenliste, Quellen und Station sie gleichzeitig, bis jemand bestätigt; das Publikum sieht nach der Haltezeit ein stark verwischtes Standbild mit «Bild kommt gleich zurück». Neue Geräte sind in Sekunden gekoppelt, auch Laptops ohne QR. Wer anders arbeitet, zieht die Docks an der Kopfzeile nach unten, links oder rechts und die Trennlinien auf die passende Grösse; das Layout bleibt im Browser gespeichert und lässt sich zurücksetzen.

FIRST VIEWPORT: 1440 × 900. Kopfzeile 50 px: Produktion, LIVE-Laufzeit, Output-Zustand zum Proxy, Stationen-Gesundheit, Docks und Layout, Uhr. Darunter die Meldungszeile. Die Bühne: links die Monitore, rechts eine feste Spalte mit dem Schalter Studio-Modus, Übergang (Schnitt oder Blende, Dauer) und im Studio-Modus Take; die Spalte bleibt beim Umschalten stehen. Ohne Studio-Modus ein grosser Program-Monitor neben der Spalte und links ein leiser Hinweis auf den Platz der Preview; mit Studio-Modus Preview und Program nebeneinander, gegeneinander skalierbar. Mit Seiten-Docks richtet sich die Höhe der Bühne nach den Monitoren im Studio-Modus, damit kein leeres Band entsteht. Unten die Docks in der Standard-Anordnung Szenen | Quellen | Eigenschaften | Stationen, mit Haarlinien als Trenn- und Ziehgriffe. Primäre Aktion: Klick auf eine Szene, im Studio-Modus Take.

FORM: Dunkle Entwickler-Konsole, vom Wurf als Challenger ausgeteilt und in der Entscheidungsrunde gewählt (nicht auf der eigenen Liste). Seed-Key 28ec97e4. Signatur-Interaktion: der Schalter Studio-Modus, der die Preview ein- und ausklappt, während Docks und Bedienspalte an ihrem Platz bleiben; dazu Docks, die sich wie bei OBS an der Kopfzeile verschieben lassen, mit blauer Einfügelinie und Ablagestreifen für leere Ränder. Bewegung: Zustandswechsel 150–200 ms ease-out, eine Störung blinkt einmal und hält dann ihr Licht; die einzige längere Bewegung ist die Blende selbst, und sie läuft immer ganz durch.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
