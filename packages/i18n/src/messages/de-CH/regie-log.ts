import type { Translation } from '../../types';
import type { regieLog as en } from '../en/regie-log';

export const regieLog: Translation<typeof en> = {
  'regie.log.assetDeleted': '{code} «{name}» gelöscht',
  'regie.log.assetUploaded': '{code} «{name}» hochgeladen',
  'regie.log.broadcastEnded': 'Sendung beendet',
  'regie.log.broadcastStarted': 'Sendung gestartet',
  'regie.log.cameraEnded': '{code} Kamera beendet',
  'regie.log.deviceBlocked': '{subject} gesperrt',
  'regie.log.devicePaired': '{subject} gekoppelt',
  'regie.log.deviceRemoved': '{subject} entfernt',
  'regie.log.deviceUnblocked': '{subject} entsperrt',
  'regie.log.inviteLinkCreated': 'Einladungslink erstellt',
  'regie.log.inviteLinkRevoked': 'Einladungslink widerrufen',
  'regie.log.outputAccessChanged': 'Output-Zugriff geändert',
  'regie.log.outputLinkRegenerated': 'Output-Link neu erzeugt',
  'regie.log.pairingDenied': 'Anfrage von {name} abgelehnt',
  'regie.log.sceneCreated': 'Szene «{scene}» erstellt',
  'regie.log.sceneDeleted': 'Szene «{scene}» gelöscht',
  'regie.log.sceneLive': 'Szene «{scene}» ist live',
  'regie.log.screenEnded': '{code} Teilen beendet',
  'regie.log.sourceLost': '{code} kein Bild',
  'regie.log.sourceReconnecting': '{code} verbindet neu',
  'regie.log.sourceRecovered': '{code} wieder da, war {downtime} weg',
};
