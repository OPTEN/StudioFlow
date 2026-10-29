import type { Translation } from '../../types';
import type { regieServer as en } from '../en/regie-server';

export const regieServer: Translation<typeof en> = {
  // --- was die Serverseiten und der Assistent teilen
  'regie.server.menu': 'Servereinstellungen',
  'regie.server.loading': 'Einstellungen werden geladen …',
  'regie.server.loadError': 'Die Einstellungen konnten nicht geladen werden.',
  'regie.server.loadErrorHint': 'Prüfen, ob der Server läuft, dann erneut versuchen.',
  'regie.server.retry': 'Erneut versuchen',
  'regie.server.save': 'Speichern',
  'regie.server.saving': 'Wird gespeichert …',
  'regie.server.saved': 'Gespeichert.',
  'regie.server.onAir': 'Nicht möglich, solange die Sendung läuft. Zuerst die Sendung beenden.',
  'regie.server.details.summary': 'Technische Details',
  'regie.server.details.run': 'Wer den Server betreibt, sieht mit diesem Befehl mehr:',
  'regie.server.apply.timeout':
    'Die Dienste haben die Einstellungen noch nicht übernommen. Der Status oben auf der Seite zeigt, wann es so weit ist.',
  'regie.server.apply.caddy':
    'Der Webserver hat die Einstellungen nicht angenommen. Die bisherigen Einstellungen bleiben aktiv.',
  'regie.server.apply.liveKit': 'Der Medienserver ist mit der neuen Adresse nicht neu gestartet.',
  'regie.server.apply.backup':
    'Der Sicherungsdienst hat die Einstellungen noch nicht übernommen. Sie sind gespeichert und gelten, sobald er läuft.',
  'regie.server.status.label': 'Status',
  'regie.server.status.caddy': 'Webserver',
  'regie.server.status.liveKit': 'Medienserver',
  'regie.server.status.backup': 'Sicherungsdienst',
  'regie.server.status.ok': 'Läuft mit den gespeicherten Einstellungen',
  'regie.server.status.pending': 'Übernimmt die neuen Einstellungen …',
  'regie.server.status.failed': 'Hat die gespeicherten Einstellungen nicht übernommen',
  'regie.server.status.unknown': 'Wird geprüft …',
  'regie.server.status.unreachable':
    'Der Status konnte nicht gelesen werden. Die nächste Prüfung folgt gleich.',
  'regie.server.status.checked': 'Geprüft um {time}',

  // --- Assistent
  'regie.server.wizard.title': 'Server einrichten',
  'regie.server.wizard.steps': 'Schritte der Einrichtung',
  'regie.server.wizard.stepsAccount': 'Konto',
  'regie.server.wizard.stepsMedia': 'Medienserver',
  'regie.server.wizard.stepsAddress': 'Adresse',
  'regie.server.wizard.stepsEmbedding': 'Einbetten',
  'regie.server.wizard.stepsDone': 'Fertig',
  'regie.server.wizard.stepDone': 'erledigt',
  'regie.server.wizard.mediaTitle': 'Medienserver verbinden',
  'regie.server.wizard.mediaLead':
    'Kameras, Handys und der Output tauschen Bild und Ton direkt mit diesem Server aus. Bitte die Adresse dieses Computers im Netzwerk eingeben.',
  'regie.server.wizard.addressTitle': 'Wählen, wie Browser den Server erreichen',
  'regie.server.wizard.addressLead':
    'Browser öffnen die Regie, den Output und die Kopplungsseite nur über HTTPS, mit einem Zertifikat, dem sie vertrauen.',
  'regie.server.wizard.embeddingTitle': 'Webseiten den Output zeigen lassen',
  'regie.server.wizard.embeddingLead':
    'Die Seite eintragen, die den Output dem Publikum zeigt, zum Beispiel den Streaming-Proxy.',
  'regie.server.wizard.next': 'Speichern und weiter',
  'regie.server.wizard.finish': 'Speichern und abschliessen',
  'regie.server.wizard.back': 'Zurück',
  'regie.server.wizard.keep': 'Standard beibehalten',
  'regie.server.wizard.keepAddress':
    'Standard beibehalten: Der Server behält sein lokales Zertifikat und wird über seine IP-Adresse geöffnet. Das lässt sich später in den Einstellungen ändern.',
  'regie.server.wizard.keepEmbedding':
    'Standard beibehalten: Keine andere Webseite darf den Output zeigen. Webseiten lassen sich später in den Einstellungen hinzufügen.',
  'regie.server.wizard.loadError':
    'Der Assistent konnte die Einstellungen des Servers nicht lesen.',
  'regie.server.wizard.doneTitle': 'Der Server ist bereit',
  'regie.server.wizard.doneText':
    'Die Regie öffnen und das erste Handy oder den ersten Laptop hinzufügen. Diese Einstellungen lassen sich jederzeit in den Einstellungen ändern.',
  'regie.server.wizard.doneOpen': 'Regie öffnen',
  'regie.server.wizard.doneHere': 'Bei dieser Adresse bleiben',
  'regie.server.wizard.doneNewAddress':
    'Die Regie antwortet jetzt unter einer neuen Adresse. Geräte verwenden ab jetzt diese; dort öffnen und neu anmelden.',
  'regie.server.wizard.doneNewAddressLink': '{url} öffnen',

  // --- Medienserver
  'regie.server.media.heading': 'Medienadresse',
  'regie.server.media.intro':
    'Kameras, Handys und der Output tauschen über diese Adresse Bild und Ton direkt mit diesem Server aus.',
  'regie.server.media.label': 'IPv4-Adresse dieses Servers',
  'regie.server.media.hint':
    'So findet man sie auf dem Server: Linux «hostname -I», Windows «ipconfig», macOS «ipconfig getifaddr en0». Die Adresse im Router reservieren, damit sie gleich bleibt.',
  'regie.server.media.suggestions': 'Vorschläge',
  'regie.server.media.suggestFromHost': 'Adresse dieser Seite',
  'regie.server.media.suggestInterface': 'Netzwerk des Servers',
  'regie.server.media.suggestName': '{address} verwenden ({source})',
  'regie.server.media.required': 'Bitte die IPv4-Adresse eingeben.',
  'regie.server.media.invalid':
    'Bitte vier Zahlen von 0 bis 255 mit Punkten getrennt eingeben, zum Beispiel 192.168.1.50.',
  'regie.server.media.testHeading': 'Verbindungstest',
  'regie.server.media.testLabel': 'Diese Adresse testen',
  'regie.server.media.testNote':
    'Startet den Medienserver für einige Sekunden neu und schickt dann eine Nachricht von diesem Browser über die Adresse und zurück.',
  'regie.server.media.test': 'Verbindung testen',
  'regie.server.media.testing': 'Test läuft …',
  'regie.server.media.testOk':
    'Der Test hat geklappt: Dieser Browser hat mit dem Medienserver unter {address} Daten ausgetauscht (Umlaufzeit {ms} ms).',
  'regie.server.media.testSignal': 'Der Medienserver antwortet nicht über den Webserver.',
  'regie.server.media.testTransport':
    'Die Verbindung zu {address} kam nicht zustande. Prüfen, ob das die Adresse des Servers ist und ob seine Firewall die Medien-Ports durchlässt (7881/tcp und 7882/udp).',
  'regie.server.media.testData':
    'Verbunden, aber die Testnachricht kam nicht zurück. Firewall und allfälliges VPN auf diesem Computer prüfen, dann erneut testen.',
  'regie.server.media.changeNote': 'Beim Speichern einer neuen Adresse startet der Medienserver neu.',

  // --- Adresse und Zertifikat
  'regie.server.address.intro':
    'Browser öffnen die Regie, den Output und die Kopplungsseite nur über HTTPS, mit einem Zertifikat, dem sie vertrauen.',
  'regie.server.address.modeLabel': 'Zertifikat',
  'regie.server.address.modeInternal': 'Lokales Zertifikat',
  'regie.server.address.modeInternalText':
    'Der Server signiert sein Zertifikat selbst. Jedes Gerät vertraut ihm einmal; eine Domain ist nicht nötig.',
  'regie.server.address.recommended': 'Empfohlen im LAN',
  'regie.server.address.modeCustom': 'Eigenes Zertifikat',
  'regie.server.address.modeCustomText':
    'Ein vorhandenes Zertifikat und seinen Schlüssel hochladen.',
  'regie.server.address.modeDns': 'Let’s Encrypt über DNS',
  'regie.server.address.modeDnsText':
    'Ein kostenloses Zertifikat für die eigene Domain, bestätigt über den DNS-Anbieter. Es muss nichts aus dem Internet erreichbar sein.',
  'regie.server.address.provider': 'DNS-Anbieter',
  'regie.server.address.providerHint': 'Die Domain muss zum eigenen Konto bei diesem Anbieter gehören.',
  'regie.server.address.nameHeading': 'Name',
  'regie.server.address.domainLabel': 'Domain',
  'regie.server.address.domainHintInternal':
    'Optional. Ein Name für diesen Server, den die Geräte auflösen können, zum Beispiel studioflow.example.com. Ohne Namen wird die Regie über die IP-Adresse geöffnet.',
  'regie.server.address.domainHintPublic':
    'Der Name, für den das Zertifikat gilt, zum Beispiel studioflow.example.com. Sein DNS-Eintrag muss auf diesen Server zeigen.',
  'regie.server.address.domainRequired': 'Bitte die Domain eingeben.',
  'regie.server.address.domainInvalid':
    'Bitte einen Hostnamen wie studioflow.example.com eingeben: Buchstaben, Ziffern und Bindestriche, mit einem Punkt.',
  'regie.server.address.trustHeading': 'Vertrauen auf jedem Gerät',
  'regie.server.address.internalNote':
    'Jeder Browser und jedes Handy muss der Zertifizierungsstelle dieses Servers einmal vertrauen; bis dahin erscheint eine Warnung.',
  'regie.server.address.internalDownload': 'CA-Zertifikat herunterladen',
  'regie.server.address.internalInstall':
    'Auf jedem Gerät als vertrauenswürdiges Stammzertifikat installieren.',
  'regie.server.address.more': 'Weitere Optionen',
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
  'regie.server.address.customHeading': 'Zertifikatsdateien',
  'regie.server.address.customNote':
    'Die Zertifikatskette (PEM, zuerst das Zertifikat des Servers) und ihr privater Schlüssel ohne Passwort.',
  'regie.server.address.customCertificate': 'Zertifikatsdatei (PEM)',
  'regie.server.address.customKey': 'Datei mit dem privaten Schlüssel (PEM)',
  'regie.server.address.customChoose': 'Datei wählen …',
  'regie.server.address.customNoFile': 'Keine Datei gewählt',
  'regie.server.address.customKeep':
    'Beide Dateien nur wählen, um das aktuelle Zertifikat zu ersetzen.',
  'regie.server.address.currentHeading': 'Aktuelles Zertifikat',
  'regie.server.address.currentSubject': 'Ausgestellt für',
  'regie.server.address.currentNames': 'Namen',
  'regie.server.address.currentExpiry': 'Gültig bis',
  'regie.server.address.currentFingerprint': 'Fingerabdruck',
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
  'regie.server.address.newUrl': 'Die Regie ist dann unter {url} erreichbar.',
  'regie.server.address.openNew': '{url} öffnen',

  // --- Einbetten
  'regie.server.embedding.heading': 'Erlaubte Webseiten',
  'regie.server.embedding.intro':
    'Webseiten, die den Output zeigen dürfen, zum Beispiel der Streaming-Proxy. Die Regie selbst lässt sich nie einbetten.',
  'regie.server.embedding.row': 'Webseite {index}',
  'regie.server.embedding.add': 'Webseite hinzufügen',
  'regie.server.embedding.remove': 'Webseite {index} entfernen',
  'regie.server.embedding.empty': 'Noch darf keine Webseite den Output zeigen.',
  'regie.server.embedding.hint':
    'Jede Adresse als https://host eingeben, oder https://*.example.com für alle Subdomains, optional mit Port.',
  'regie.server.embedding.invalid':
    'Das ist keine Webseitenadresse. Erlaubt ist https://host oder https://*.host, optional mit Port.',
  'regie.server.embedding.tooMany': 'Es sind höchstens {max} Webseiten möglich.',

  // --- Sicherungen: Zeitplan, Aufbewahrung und Kopie an einem anderen Ort
  'regie.server.backup.intro':
    'Der Sicherungsdienst kopiert die Datenbank, die Anmeldeschlüssel, die Zertifikate und die Medien auf das Sicherungsvolume dieses Servers. Eine geplante Sicherung startet nie während einer Sendung; sie wartet bis zum Ende.',
  'regie.server.backup.scheduleHeading': 'Zeitplan',
  'regie.server.backup.scheduleLabel': 'Automatische Sicherungen',
  'regie.server.backup.presetOff': 'Aus',
  'regie.server.backup.presetDaily': 'Täglich',
  'regie.server.backup.presetWeekly': 'Wöchentlich',
  'regie.server.backup.presetCustom': 'Eigener',
  'regie.server.backup.timeLabel': 'Uhrzeit',
  'regie.server.backup.dayLabel': 'Tag',
  'regie.server.backup.cronLabel': 'Zeitplan (Cron)',
  'regie.server.backup.scheduleHint':
    'Fünf Felder wie bei Cron, zum Beispiel 0 3 * * 1-5 für 03:00 Uhr von Montag bis Freitag.',
  'regie.server.backup.scheduleInvalid':
    'Das ist kein Zeitplan aus fünf Feldern (Minute, Stunde, Tag, Monat, Wochentag).',
  'regie.server.backup.timeInvalid': 'Bitte eine Uhrzeit wie 03:00 eingeben.',
  'regie.server.backup.timezoneLabel': 'Zeitzone',
  'regie.server.backup.timezoneInvalid': 'Bitte einen Zeitzonennamen wie Europe/Zurich eingeben.',
  'regie.server.backup.nextToday': 'Nächste Sicherung heute um {time} Uhr.',
  'regie.server.backup.nextTomorrow': 'Nächste Sicherung morgen um {time} Uhr.',
  'regie.server.backup.nextDay': 'Nächste Sicherung am {day} um {time} Uhr.',
  'regie.server.backup.nextOff': 'Keine automatischen Sicherungen. «Jetzt sichern» geht trotzdem.',
  'regie.server.backup.nextCustom': 'Der Server führt diesen Zeitplan in der gewählten Zeitzone aus.',
  'regie.server.backup.keepHeading': 'Aufbewahren',
  'regie.server.backup.keepDailyLabel': 'Tägliche Sicherungen',
  'regie.server.backup.keepWeeklyLabel': 'Wöchentliche Sicherungen',
  'regie.server.backup.keepFooter':
    'Die neusten Sicherungen bleiben erhalten; ältere werden gelöscht.',
  'regie.server.backup.keepInvalid': 'Bitte eine ganze Zahl von {min} bis {max} eingeben.',
  'regie.server.backup.offsiteHeading': 'Kopie an einem anderen Ort',
  'regie.server.backup.offsiteSwitch': 'Jede Sicherung an einen zweiten Ort kopieren',
  'regie.server.backup.offsiteIntro':
    'Mit rclone auf S3-kompatiblen Speicher, SFTP und andere. Was den Server verlässt, ist mit age verschlüsselt.',
  'regie.server.backup.offsiteRemoteLabel': 'rclone-Remote',
  'regie.server.backup.offsiteRemoteHint': 'Name und Ordner, zum Beispiel offsite:studioflow.',
  'regie.server.backup.offsiteRemoteRequired':
    'Bitte die Remote eingeben oder die Kopie an einem anderen Ort ausschalten.',
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

  // --- Sicherungen: die letzten Sicherungen
  'regie.server.backup.listHeading': 'Letzte Sicherungen',
  'regie.server.backup.listEmpty': 'Es gibt noch keine Sicherung.',
  'regie.server.backup.listEmptyHint':
    'Die erste erscheint hier nach dem nächsten geplanten Lauf oder nach «Jetzt sichern».',
  'regie.server.backup.listNow': 'Jetzt sichern',
  'regie.server.backup.listIdle': 'Bereit',
  'regie.server.backup.listRequested':
    'Die Sicherung wurde angefordert. Sie erscheint in der Liste, sobald sie fertig ist.',
  'regie.server.backup.listRunning': 'Eine Sicherung läuft …',
  'regie.server.backup.listPostponed': 'Eine Sicherung wartet auf das Ende der Sendung.',
  'regie.server.backup.listNotSeen': 'Der Sicherungsdienst hat sich noch nicht gemeldet.',
  'regie.server.backup.listFailed': 'Die letzte Sicherung ist fehlgeschlagen.',
  'regie.server.backup.listLoadError': 'Die Liste der Sicherungen konnte nicht geladen werden.',
  'regie.server.backup.listAuto': 'Automatisch',
  'regie.server.backup.listManual': 'Manuell',
  'regie.server.backup.listColumnName': 'Sicherung',
  'regie.server.backup.listColumnKind': 'Art',
  'regie.server.backup.listColumnSize': 'Grösse',
  'regie.server.backup.listColumnTime': 'Fertig',
  'regie.server.backup.listCaption': 'Die letzten Sicherungen, die neuste zuerst',
  'regie.server.backup.listCopy': 'Befehl zum Wiederherstellen von {name} kopieren',
  'regie.server.backup.listRestore':
    'Wiederherstellen ersetzt die Datenbank und braucht den gestoppten Stack, darum ist es ein Befehl auf dem Server. Ihn aus einer Zeile oben kopieren oder diesen mit dem Namen der Sicherung verwenden:',
  'regie.server.backup.listRestoreCopy': 'Befehl kopieren',
};
