import type { Translation } from '../../types';
import type { regieOutput as en } from '../en/regie-output';

export const regieOutput: Translation<typeof en> = {
  'regie.output.access.save': 'Zugriff speichern',

  'regie.output.camera.audio':
    'Die Kamera überträgt nur Bild. Der Ton bleibt am Mischpult und geht von dort in Teams.',
  'regie.output.camera.download': 'OBS-Szenensammlung herunterladen',
  'regie.output.camera.downloaded': 'OBS-Szenensammlung «{file}» heruntergeladen',
  'regie.output.camera.intro': 'OBS macht aus der Output-Seite die Kamera «OBS Virtual Camera».',
  'regie.output.camera.separateMachine':
    'OBS und Teams auf einem eigenen Rechner betreiben, nicht auf dem Regie-Laptop: Der Output darf nicht von ihm abhängen.',
  'regie.output.camera.step1':
    'OBS Studio 31 oder neuer auf dem Rechner installieren, auf dem Teams oder Zoom läuft.',
  'regie.output.camera.step2':
    'In OBS «Szenensammlung → Importieren» wählen, die heruntergeladene Datei auswählen und danach unter «Szenensammlung» «{name}» wählen.',
  'regie.output.camera.step3':
    'In OBS unter «Einstellungen → Video» Basis- und Ausgabeauflösung auf {width} × {height} und die Bildrate auf {fps} stellen.',
  'regie.output.camera.step4': 'In OBS «Virtuelle Kamera starten» klicken.',
  'regie.output.camera.step5':
    'In Teams, Zoom oder Webex die Kamera «OBS Virtual Camera» wählen und Hintergrundeffekte ausschalten.',
  'regie.output.camera.title': '«{name}» als Kamera nutzen',

  'regie.output.detail.hide': 'Link verbergen',
  'regie.output.detail.link': 'Link',
  'regie.output.detail.secret':
    'Wer diesen Link hat, kann den Output öffnen. Gib ihn nur der Seite oder dem Gerät, für das er gedacht ist.',
  'regie.output.detail.show': 'Link zeigen',

  'regie.output.embed.change': 'Einbetten ändern …',
  'regie.output.embed.hint':
    'Websites, die den Output in einem Rahmen zeigen dürfen. Sie gelten für alle Produktionen.',
  'regie.output.embed.self': 'Dieser Server',
  'regie.output.embed.title': 'Einbetten',

  'regie.output.link.add': 'Link hinzufügen',
  'regie.output.link.connected': 'verbunden',
  'regie.output.link.created': 'Link «{name}» erstellt',
  'regie.output.link.keyLabel': 'Link «{name}»',
  'regie.output.link.lastSeen': 'zuletzt gesehen {time}',
  'regie.output.link.limit': 'Höchstens {max} Links. Einen widerrufen, um einen neuen anzulegen.',
  'regie.output.link.line': '{name} · {state}',
  'regie.output.link.nameInvalid': 'Bitte einen Namen mit 1 bis {max} Zeichen eingeben.',
  'regie.output.link.nameLabel': 'Name des neuen Links',
  'regie.output.link.namePlaceholder': 'z. B. Teams-Kamera',
  'regie.output.link.nameTaken': 'Einen Link mit diesem Namen gibt es schon.',
  'regie.output.link.neverSeen': 'noch nie verbunden',
  'regie.output.link.none': 'nicht verbunden',
  'regie.output.link.pages': { one: '{count} Seite', other: '{count} Seiten' },
  'regie.output.link.rename': 'Umbenennen',
  'regie.output.link.renameLabel': 'Neuer Name von «{name}»',
  'regie.output.link.renamed': 'Link umbenannt in «{name}»',
  'regie.output.link.revoke': 'Link widerrufen',
  'regie.output.link.revokeConfirm': 'Widerrufen',
  'regie.output.link.revokeMessage':
    '«{name}» funktioniert sofort nicht mehr und wird entfernt: Seiten, die ihn nutzen, zeigen «Kein Zugang». Die anderen Links funktionieren weiter.',
  'regie.output.link.revoked': 'Link «{name}» widerrufen',
  'regie.output.link.stale': 'kein aktuelles Bild',

  'regie.output.menu.copy': 'Link kopieren',
  'regie.output.menu.deleteKey': 'Entf',
  'regie.output.menu.more': 'Weitere Aktionen für «{name}»',

  'regie.output.links.empty':
    'Unten einen Link hinzufügen, damit ein Proxy, OBS oder eine Meeting-Kamera den Output zeigen kann.',
  'regie.output.links.emptyTitle': 'Noch kein Output-Link',
  'regie.output.links.hint':
    'Ein Link pro Seite oder Gerät, das den Output zeigt, etwa der Proxy oder eine Meeting-Kamera. Jeder lässt sich einzeln stoppen.',
  'regie.output.links.loading': 'Links werden geladen …',
  'regie.output.links.keys':
    'Rechtsklick auf einen Link zeigt seine Befehle. F2 benennt ihn um, Entf widerruft ihn.',
  'regie.output.links.title': 'Links',

  'regie.output.options.language': 'Sprache der Meldungen',
  'regie.output.options.languageSub':
    'Für die Meldungen, die die Output-Seite selbst zeigt, etwa «Kein Zugang».',
  'regie.output.options.sound': 'Ton',
  'regie.output.options.soundSub': 'Ausschalten für eine Seite, die nur das Bild zeigt.',
  'regie.output.options.sub': 'Sie werden Teil des kopierten Links.',
  'regie.output.options.title': 'Link-Optionen',
  'regie.output.options.transparent': 'Transparenter Hintergrund',
  'regie.output.options.transparentSub':
    'Für ein Overlay in OBS: Die leere Leinwand ist durchsichtig.',

  'regie.output.pop.addresses': 'Verbunden von',
  'regie.output.pop.copy': 'Link «{name}» kopieren',
  'regie.output.pop.empty': 'Noch kein Output-Link.',
  'regie.output.pop.manage': 'Output-Links verwalten …',

  'regie.output.renew.button': 'Neuer Link …',
  'regie.output.renew.confirm':
    'Der alte Link von «{name}» funktioniert sofort nicht mehr: Seiten, die ihn nutzen, zeigen «Kein Zugang» und brauchen den neuen Link.',
  'regie.output.renew.confirmButton': 'Neuen Link erzeugen',
  'regie.output.renew.sub': 'Einen neuen Link erzeugen und den alten stoppen.',
  'regie.output.renew.title': 'Neuer Link',

  'regie.output.revoke.button': 'Widerrufen …',
  'regie.output.revoke.sub':
    'Diesen Link endgültig stoppen. Die anderen Links funktionieren weiter.',

  'regie.output.tabs.access': 'Zugriff',
  'regie.output.tabs.label': 'Bereiche des Links «{name}»',
  'regie.output.tabs.obs': 'In OBS verwenden',
};
