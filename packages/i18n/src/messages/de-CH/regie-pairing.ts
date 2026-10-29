import type { Translation } from '../../types';
import type { regiePairing as en } from '../en/regie-pairing';

export const regiePairing: Translation<typeof en> = {
  'regie.pairing.dock.close': 'Gerät hinzufügen schliessen',
  'regie.pairing.dock.tabs': 'Art des Geräts',
  'regie.pairing.dock.tipsText':
    'Ans Ladekabel hängen und im Querformat montieren. StudioFlow hält den Bildschirm wach und startet nach einem Neuladen mit den letzten Einstellungen.',
  'regie.pairing.dock.tipsTitle': 'Tipps für fest montierte Handys',
  'regie.pairing.dock.title': 'Gerät hinzufügen',

  'regie.pairing.expiry.expired': 'abgelaufen',
  'regie.pairing.expiry.minutes': {
    one: 'läuft in {count} Minute ab',
    other: 'läuft in {count} Minuten ab',
  },
  'regie.pairing.expiry.soon': 'läuft gleich ab',

  'regie.pairing.knock.allow': 'Zulassen',
  'regie.pairing.knock.codeLabel': 'Prüfcode {digits}',
  'regie.pairing.knock.deny': 'Ablehnen',
  'regie.pairing.knock.label': 'Kopplungsanfrage',
  'regie.pairing.knock.question': 'Derselbe Code auf dem Gerät?',
  'regie.pairing.knock.title': '{name} möchte beitreten',

  'regie.pairing.laptop.step1': 'Auf dem Laptop im Browser diese Adresse öffnen:',
  'regie.pairing.laptop.step2':
    'Dort einen Namen eingeben. Für den Ton vom Mischpult «Audiostation» wählen.',
  'regie.pairing.laptop.step3':
    'Die Anfrage erscheint hier mit einem Prüfcode. Zulassen, wenn das Gerät denselben Code zeigt.',
  'regie.pairing.laptop.title': 'Laptop oder Audiostation',

  'regie.pairing.link.create': 'Link erstellen',
  'regie.pairing.link.createAnother': 'Weiteren Link erstellen',
  'regie.pairing.link.gone': 'Dieser Link gilt schon nicht mehr.',
  'regie.pairing.link.open': 'Offene Einladungen',
  'regie.pairing.link.revoke': 'Link widerrufen',
  'regie.pairing.link.revokeInvite': 'Einladung widerrufen: {url}',
  'regie.pairing.link.revokeShort': 'Widerrufen',
  'regie.pairing.link.show': 'Link anzeigen',
  'regie.pairing.link.showHint':
    'Die Links sind verborgen, damit sie niemand von einem geteilten Bildschirm abschreibt.',
  'regie.pairing.link.text':
    'Für Laptops, die schon vor dem Webinar gekoppelt werden. Den Link per Teams oder Mail schicken.',
  'regie.pairing.link.title': 'Einladungslink',
  'regie.pairing.link.toastCreated': 'Einladungslink erstellt',
  'regie.pairing.link.toastRevoked': 'Einladungslink widerrufen',
  'regie.pairing.link.validity': 'Gilt einmal und {expiry}. Wer ihn öffnet, ist direkt gekoppelt.',

  'regie.pairing.phone.generating': 'QR-Code wird erzeugt …',
  'regie.pairing.phone.qrLabel': 'QR-Code zum Koppeln eines Handys',
  'regie.pairing.phone.renew': 'Neuen Code erzeugen',
  'regie.pairing.phone.step1': 'Auf dem Handy die Kamera-App öffnen.',
  'regie.pairing.phone.step2': 'Diesen Code scannen. StudioFlow öffnet sich im Browser.',
  'regie.pairing.phone.step3': 'Die Kamera erlauben. Danach erscheint das Handy unter Geräte.',
  'regie.pairing.phone.title': 'Handy als Kamera',
  'regie.pairing.phone.toastRenewed': 'Neuer QR-Code, der alte gilt nicht mehr',
  'regie.pairing.phone.valid': 'Gilt einmal, noch {time}.',

  'regie.pairing.requests.empty':
    'Noch keine Anfrage. Sobald jemand die Adresse öffnet und einen Namen eingibt, erscheint die Anfrage hier mit Prüfcode.',
  'regie.pairing.requests.title': 'Wartende Anfragen',

  'regie.pairing.tab.laptop': 'Laptop',
  'regie.pairing.tab.link': 'Link',
  'regie.pairing.tab.phone': 'Handy',

  'regie.pairing.toast.denied': 'Anfrage von {name} abgelehnt',
  'regie.pairing.toast.gone': 'Diese Anfrage ist abgelaufen oder wurde schon beantwortet.',
  'regie.pairing.toast.paired': '{name} ist gekoppelt',
  'regie.pairing.toast.pairedAs': '{name} ist gekoppelt und kommt als {code}',
};
