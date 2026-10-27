import type { Translation } from '../../types';
import type { regieServer as en } from '../en/regie-server';

export const regieServer: Translation<typeof en> = {
  // --- Seite und Gemeinsames
  'regie.server.title': 'Servereinstellungen',
  'regie.server.menu': 'Servereinstellungen',
  'regie.server.back': 'Zurück zur Regie',
  'regie.server.loading': 'Einstellungen werden geladen …',
  'regie.server.loadError': 'Die Einstellungen konnten nicht geladen werden.',
  'regie.server.retry': 'Erneut versuchen',
  'regie.server.save': 'Speichern',
  'regie.server.saving': 'Wird gespeichert …',
  'regie.server.saved': 'Gespeichert.',
  'regie.server.apply.timeout':
    'Die Dienste haben die Einstellungen noch nicht übernommen. Prüfen mit: docker compose ps',
  'regie.server.apply.caddy':
    'Der Webserver (Caddy) hat die Einstellungen abgelehnt. Prüfen mit: docker compose logs api caddy',
  'regie.server.apply.liveKit':
    'Der Medienserver (LiveKit) ist nicht neu gestartet. Prüfen mit: docker compose logs livekit',
  'regie.server.apply.backup':
    'Der Sicherungsdienst hat die Einstellungen noch nicht übernommen. Prüfen mit: docker compose ps backup',
  'regie.server.status.heading': 'Dienste',
  'regie.server.status.caddy': 'Webserver',
  'regie.server.status.liveKit': 'Medienserver',
  'regie.server.status.backup': 'Sicherungsdienst',
  'regie.server.status.ok': 'läuft mit den gespeicherten Einstellungen',
  'regie.server.status.pending': 'übernimmt die Einstellungen …',
  'regie.server.status.failed': 'hat die Einstellungen abgelehnt',

  // --- Assistent
  'regie.server.wizard.title': 'Server einrichten',
  'regie.server.wizard.lead': 'Server einrichten',
  'regie.server.wizard.step': 'Schritt {current} von {total}',
  'regie.server.wizard.stepsAccount': 'Konto',
  'regie.server.wizard.stepsMedia': 'Medienadresse',
  'regie.server.wizard.stepsAddress': 'Adresse und Zertifikat',
  'regie.server.wizard.stepsEmbedding': 'Einbetten',
  'regie.server.wizard.next': 'Speichern und weiter',
  'regie.server.wizard.keep': 'Standard beibehalten',
  'regie.server.wizard.finish': 'Speichern und abschliessen',
  'regie.server.wizard.loadError':
    'Der Assistent konnte die Einstellungen des Servers nicht lesen.',
  'regie.server.wizard.doneTitle': 'Der Server ist bereit',
  'regie.server.wizard.doneText':
    'Die Regie öffnen und das erste Handy oder den ersten Laptop koppeln. Alles lässt sich später unter «Servereinstellungen» ändern.',
  'regie.server.wizard.doneOpen': 'Regie öffnen',
  'regie.server.wizard.doneNewAddress':
    'Die Regie antwortet jetzt auch unter der neuen Adresse. Geräte und Browser verwenden ab jetzt diese; dort muss man sich neu anmelden.',
  'regie.server.wizard.doneNewAddressLink': '{url} öffnen',

  // --- Medienadresse
  'regie.server.media.heading': 'Medienadresse',
  'regie.server.media.intro':
    'Kameras, Handys und der Output tauschen Bild und Ton direkt mit diesem Server aus. Bitte die IPv4-Adresse dieses Computers im Netzwerk eingeben; jedes Gerät muss sie erreichen können.',
  'regie.server.media.label': 'IPv4-Adresse dieses Servers',
  'regie.server.media.hint':
    'So findet man sie auf dem Server: Linux «hostname -I», Windows «ipconfig», macOS «ipconfig getifaddr en0». Die Adresse im Router reservieren, damit sie gleich bleibt.',
  'regie.server.media.suggest': '{address} verwenden',
  'regie.server.media.suggestFromHost': 'die Adresse, mit der diese Seite geöffnet wurde',
  'regie.server.media.required': 'Bitte die IPv4-Adresse eingeben.',
  'regie.server.media.invalid':
    'Bitte vier Zahlen von 0 bis 255 mit Punkten getrennt eingeben, zum Beispiel 192.168.1.50.',
  'regie.server.media.test': 'Verbindung testen',
  'regie.server.media.testing': 'Test läuft …',
  'regie.server.media.testNote':
    'Der Test startet den Medienserver für einige Sekunden neu und schickt eine Nachricht von diesem Browser über die Adresse und zurück.',
  'regie.server.media.testOk':
    'Der Test hat geklappt: Dieser Browser hat mit dem Medienserver unter {address} Daten ausgetauscht (Umlaufzeit {ms} ms).',
  'regie.server.media.testSignal':
    'Der Medienserver antwortet nicht über den Webserver. Prüfen mit: docker compose ps livekit caddy',
  'regie.server.media.testTransport':
    'Die Verbindung zu {address} kam nicht zustande. Prüfen, ob das die Adresse des Servers ist und ob seine Firewall die Medien-Ports durchlässt (standardmässig 7881/tcp und 7882/udp).',
  'regie.server.media.testData':
    'Verbunden, aber die Testnachricht kam nicht zurück. Firewall und allfälliges VPN auf diesem Computer prüfen, dann erneut testen.',
  'regie.server.media.changeNote':
    'Beim Speichern einer neuen Adresse startet der Medienserver neu. Das ist nicht möglich, solange eine Sendung läuft.',

  // --- Adresse und Zertifikat
  'regie.server.address.heading': 'Adresse und Zertifikat',
  'regie.server.address.intro':
    'Browser öffnen die Regie, den Output und die Kopplungsseite nur über HTTPS mit einem Zertifikat, dem sie vertrauen. Hier wird gewählt, wie der Server eines bekommt.',
  'regie.server.address.modeLabel': 'Zertifikat',
  'regie.server.address.modeInternal': 'Lokales Zertifikat (keine Domain nötig)',
  'regie.server.address.modeCustom': 'Eigenes Zertifikat',
  'regie.server.address.modeDns': 'Let’s Encrypt über DNS: {provider}',
  'regie.server.address.domainLabel': 'Domain',
  'regie.server.address.domainHintInternal':
    'Optional. Ein Name für diesen Server, den die Geräte auflösen können, zum Beispiel studioflow.example.com. Ohne Namen wird die Regie über die IP-Adresse geöffnet.',
  'regie.server.address.domainHintPublic':
    'Der Name, für den das Zertifikat gilt, zum Beispiel studioflow.example.com. Sein DNS-Eintrag muss auf diesen Server zeigen.',
  'regie.server.address.domainRequired': 'Bitte die Domain eingeben.',
  'regie.server.address.domainInvalid':
    'Bitte einen Hostnamen wie studioflow.example.com eingeben: Buchstaben, Ziffern und Bindestriche, mit einem Punkt.',
  'regie.server.address.internalNote':
    'Der Server signiert sein Zertifikat selbst. Jeder Browser und jedes Handy muss der Zertifizierungsstelle des Servers einmal vertrauen; bis dahin erscheint eine Warnung.',
  'regie.server.address.internalDownload': 'CA-Zertifikat herunterladen',
  'regie.server.address.internalInstall':
    'Auf jedem Gerät als vertrauenswürdiges Stammzertifikat installieren (Schritte im Betriebshandbuch).',
  'regie.server.address.dnsNote':
    'Der Server erhält ein Let’s-Encrypt-Zertifikat, indem er einen DNS-Eintrag setzt. Es muss also nichts aus dem Internet erreichbar sein. Die Domain muss zum Konto beim Anbieter gehören.',
  'regie.server.address.dnsEmailLabel': 'E-Mail für Ablaufhinweise (optional)',
  'regie.server.address.dnsEmailInvalid': 'Bitte eine gültige E-Mail-Adresse eingeben.',
  'regie.server.address.dnsChallengeLabel': 'Weitergeleitete Challenge-Domain (optional)',
  'regie.server.address.dnsChallengeHint':
    'Nur wenn _acme-challenge der Domain ein CNAME auf eine andere Zone ist: dessen Ziel eingeben, zum Beispiel _acme-challenge.studioflow.dedyn.io.',
  'regie.server.address.dnsChallengeInvalid': 'Bitte einen Hostnamen eingeben.',
  'regie.server.address.credentialsHeading': 'Zugang zu {provider}',
  'regie.server.address.credentialsHint':
    'Wird verschlüsselt auf dem Server gespeichert und nie mehr angezeigt.',
  'regie.server.address.credentialsStored': 'Gespeichert. Leer lassen, um den Wert zu behalten.',
  'regie.server.address.credentialsRequired': 'Bitte diesen Wert eingeben.',
  'regie.server.address.credentialsInvalid':
    'Dieser Wert enthält Zeichen oder hat eine Länge, die ein solcher Zugang nicht hat.',
  'regie.server.address.credentialToken': 'API-Token',
  'regie.server.address.credentialAccessKeyId': 'Access Key ID',
  'regie.server.address.credentialSecretAccessKey': 'Secret Access Key',
  'regie.server.address.credentialRegion': 'Region (zum Beispiel eu-central-1)',
  'regie.server.address.credentialEndpoint': 'Endpoint (zum Beispiel ovh-eu)',
  'regie.server.address.credentialApplicationKey': 'Application Key',
  'regie.server.address.credentialApplicationSecret': 'Application Secret',
  'regie.server.address.credentialConsumerKey': 'Consumer Key',
  'regie.server.address.customNote':
    'Die Zertifikatskette (PEM, zuerst das Zertifikat des Servers) und den privaten Schlüssel ohne Passwort hochladen.',
  'regie.server.address.customCertificate': 'Zertifikatsdatei (PEM)',
  'regie.server.address.customKey': 'Datei mit dem privaten Schlüssel (PEM)',
  'regie.server.address.customCurrent': 'Aktuelles Zertifikat: {subject}, gültig bis {date}.',
  'regie.server.address.customNames': 'Namen: {names}',
  'regie.server.address.customKeep': 'Zum Ersetzen beide Dateien wählen.',
  'regie.server.address.customFileRequired': 'Bitte die Datei wählen.',
  'regie.server.address.customReadError': 'Die Datei konnte nicht gelesen werden.',
  'regie.server.address.errorCertificateRequired': 'Bitte zuerst ein Zertifikat hochladen.',
  'regie.server.address.errorCertificateInvalid': 'Das ist kein PEM-Zertifikat.',
  'regie.server.address.errorPrivateKeyInvalid': 'Das ist kein privater PEM-Schlüssel.',
  'regie.server.address.errorPrivateKeyEncrypted':
    'Der Schlüssel ist mit einem Passwort geschützt. Das Passwort zuerst entfernen (openssl rsa -in key.pem -out key-plain.pem).',
  'regie.server.address.errorKeyMismatch': 'Der Schlüssel gehört nicht zum Zertifikat.',
  'regie.server.address.errorExpired': 'Das Zertifikat ist abgelaufen.',
  'regie.server.address.errorNotYetValid': 'Das Zertifikat ist noch nicht gültig.',
  'regie.server.address.errorNameMismatch': 'Das Zertifikat gilt nicht für die Domain.',
  'regie.server.address.errorTlsMode': 'Diese Zertifikatsart gibt es nicht.',
  'regie.server.address.warning':
    'Gekoppelte Handys, Laptops und Output-Links öffnen die Adresse, mit der sie gekoppelt wurden. Nach einer Änderung der Domain oder des Zertifikats müssen sie stattdessen {url} öffnen.',
  'regie.server.address.newUrl': 'Die Regie ist dann unter {url} erreichbar',
  'regie.server.address.openNew': '{url} öffnen',

  // --- Einbetten
  'regie.server.embedding.heading': 'Output einbetten',
  'regie.server.embedding.intro':
    'Der Output darf in Webseiten dieser Herkunft angezeigt werden, zum Beispiel in einem Streaming-Proxy. Die Regie selbst lässt sich nie einbetten.',
  'regie.server.embedding.label': 'Erlaubte Herkunft, eine pro Zeile',
  'regie.server.embedding.hint':
    'Zum Beispiel https://proxy.example.ch oder https://*.example.com. Leer lassen, um keine zu erlauben.',
  'regie.server.embedding.invalid':
    'Zeile {line} ist keine Herkunft. Erlaubt ist https://host oder https://*.host, optional mit Port.',
  'regie.server.embedding.tooMany': 'Es sind höchstens {max} Herkunftsangaben möglich.',

  // --- Sicherungen
  'regie.server.backup.heading': 'Sicherungen',
  'regie.server.backup.intro':
    'Der Sicherungsdienst kopiert die Datenbank, die Anmeldeschlüssel, die Zertifikate und die Medien auf das Sicherungsvolume dieses Servers. Eine geplante Sicherung startet nie während einer Sendung; sie wartet bis zum Ende.',
  'regie.server.backup.scheduleLabel': 'Zeitplan',
  'regie.server.backup.scheduleHint':
    'Fünf Felder wie bei Cron, zum Beispiel 0 3 * * * für jeden Tag um 03:00 Uhr. Leer: keine automatischen Sicherungen.',
  'regie.server.backup.scheduleInvalid':
    'Das ist kein Zeitplan aus fünf Feldern (Minute, Stunde, Tag, Monat, Wochentag).',
  'regie.server.backup.timezoneLabel': 'Zeitzone des Zeitplans',
  'regie.server.backup.timezoneHint': 'Zum Beispiel Europe/Zurich. Leer: UTC.',
  'regie.server.backup.timezoneInvalid': 'Bitte einen Zeitzonennamen wie Europe/Zurich eingeben.',
  'regie.server.backup.keepDailyLabel': 'Tägliche Sicherungen behalten',
  'regie.server.backup.keepWeeklyLabel': 'Wöchentliche Sicherungen behalten',
  'regie.server.backup.keepInvalid': 'Bitte eine ganze Zahl von {min} bis {max} eingeben.',
  'regie.server.backup.offsiteHeading': 'Kopie an einem anderen Ort',
  'regie.server.backup.offsiteIntro':
    'Kopiert jede Sicherung mit rclone an einen zweiten Ort (S3-kompatibler Speicher, SFTP und andere). Was den Server verlässt, ist mit age verschlüsselt.',
  'regie.server.backup.offsiteRemoteLabel': 'rclone-Remote',
  'regie.server.backup.offsiteRemoteHint':
    'Name und Ordner, zum Beispiel offsite:studioflow. Leer: keine Kopie an einem anderen Ort.',
  'regie.server.backup.offsiteRemoteInvalid': 'Bitte in der Form Name:Ordner eingeben.',
  'regie.server.backup.offsiteRemoteNotInConfig':
    'Die Konfiguration definiert keine Remote mit diesem Namen.',
  'regie.server.backup.offsiteConfigLabel': 'rclone-Konfiguration',
  'regie.server.backup.offsiteConfigHint':
    'Der Text der rclone.conf mit der Remote von oben. Wird verschlüsselt gespeichert und nie mehr angezeigt.',
  'regie.server.backup.offsiteConfigStored':
    'Eine Konfiguration ist gespeichert. Eine neue einfügen, um sie zu ersetzen.',
  'regie.server.backup.offsiteConfigInvalid':
    'Das ist keine rclone-Konfiguration: Sie braucht einen Abschnitt wie [offsite].',
  'regie.server.backup.offsiteAgeLabel': 'Öffentliche age-Schlüssel, einer pro Zeile',
  'regie.server.backup.offsiteAgeHint':
    'Erzeugt mit age-keygen. Den privaten Schlüssel nicht auf diesem Server aufbewahren: Nur wer ihn hat, kann die Kopie lesen.',
  'regie.server.backup.offsiteAgeInvalid':
    'Zeile {line} ist kein öffentlicher age-Schlüssel (er beginnt mit age1).',
  'regie.server.backup.offsiteAgeRequired':
    'Bitte mindestens einen öffentlichen age-Schlüssel eingeben oder unten bestätigen, dass die Remote selbst verschlüsselt.',
  'regie.server.backup.offsiteUnencrypted': 'Die Remote verschlüsselt selbst (Upload ohne age)',
  'regie.server.backup.listHeading': 'Letzte Sicherungen',
  'regie.server.backup.listEmpty': 'Es gibt noch keine Sicherung.',
  'regie.server.backup.listNow': 'Jetzt sichern',
  'regie.server.backup.listRequested':
    'Die Sicherung wurde angefordert. Sie erscheint in der Liste, sobald sie fertig ist.',
  'regie.server.backup.listRunning': 'Eine Sicherung läuft …',
  'regie.server.backup.listPostponed': 'Eine Sicherung wartet auf das Ende der Sendung.',
  'regie.server.backup.listNotSeen':
    'Der Sicherungsdienst hat sich noch nicht gemeldet. Prüfen mit: docker compose ps backup',
  'regie.server.backup.listFailed':
    'Die letzte Sicherung ist fehlgeschlagen. Prüfen mit: docker compose logs backup',
  'regie.server.backup.listAuto': 'automatisch',
  'regie.server.backup.listManual': 'manuell',
  'regie.server.backup.listRestore':
    'Wiederherstellen ist ein Befehl auf dem Server: docker compose run --rm backup restore <Ordner>. Das Betriebshandbuch beschreibt ihn.',
};
