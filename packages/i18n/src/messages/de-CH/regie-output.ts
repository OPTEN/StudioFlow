import type { Translation } from '../../types';
import type { regieOutput as en } from '../en/regie-output';

export const regieOutput: Translation<typeof en> = {
  'regie.output.camera.audio':
    'Die Kamera überträgt nur Bild. Der Ton bleibt am Mischpult und geht von dort in Teams.',
  'regie.output.camera.close': 'Anleitung schliessen',
  'regie.output.camera.download': 'OBS-Szenensammlung herunterladen',
  'regie.output.camera.downloaded': 'OBS-Szenensammlung «{file}» heruntergeladen',
  'regie.output.camera.intro': 'OBS macht aus der Output-Seite die Kamera «OBS Virtual Camera».',
  'regie.output.camera.open': 'Als Kamera nutzen …',
  'regie.output.camera.runbook': 'Mehr im Runbook: «Output as a camera in Teams/Zoom».',
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
  'regie.output.link.rename': 'Umbenennen',
  'regie.output.link.renameLabel': 'Neuer Name von «{name}»',
  'regie.output.link.renamed': 'Link umbenannt in «{name}»',
  'regie.output.link.revoke': 'Link widerrufen',
  'regie.output.link.revokeConfirm': 'Widerrufen',
  'regie.output.link.revokeMessage':
    'Seiten, die «{name}» nutzen, werden sofort getrennt. Die anderen Links funktionieren weiter.',
  'regie.output.link.revoked': 'Link «{name}» widerrufen',
  'regie.output.link.stale': 'kein aktuelles Bild',
  'regie.output.links.empty':
    'Noch kein Link. Einen anlegen, damit ein Proxy oder eine Kamera den Output zeigen kann.',
  'regie.output.links.hint':
    'Ein Link pro Abnehmer: der Proxy, die Teams-Kamera, … Jeder lässt sich einzeln widerrufen.',
  'regie.output.links.title': 'Links',
};
