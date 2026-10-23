import type { Translation } from '../../types';
import type { regieMedia as en } from '../en/regie-media';

export const regieMedia: Translation<typeof en> = {
  'regie.media.kind.image': 'Bild',
  'regie.media.kind.video': 'Video',

  'regie.media.label': 'Medien',

  'regie.media.library.delete': 'Löschen: {name}',
  'regie.media.library.deleteLabel': 'Datei löschen',
  'regie.media.library.deleteMessage':
    '«{name}» wird gelöscht. Das lässt sich nicht rückgängig machen.',
  'regie.media.library.empty': 'Noch keine Medien hochgeladen.',
  'regie.media.library.inUse': 'wird verwendet',
  'regie.media.library.nameLabel': 'Name der Datei',
  'regie.media.library.removeFirst': 'Erst dort entfernen.',
  'regie.media.library.rename': 'Umbenennen: {name}',
  'regie.media.library.title': 'Medien der Produktion',

  'regie.media.toast.addToScene': 'Zur Szene hinzufügen',
  'regie.media.toast.cancelled': 'Hochladen von «{name}» abgebrochen',
  'regie.media.toast.deleted': '«{name}» gelöscht',
  'regie.media.toast.failed': '«{name}» wurde nicht hochgeladen: {reason}',
  'regie.media.toast.renamed': 'Datei heisst jetzt «{name}»',
  'regie.media.toast.uploaded': '«{name}» ist hochgeladen und steht als {code} bereit',

  'regie.media.upload.hint': 'PNG, JPEG oder WebP bis 25 MB · MP4 oder WebM bis 1 GB',
  'regie.media.upload.pick': 'Datei wählen',
  'regie.media.upload.prompt': 'Hierher ziehen oder {pick}',
  'regie.media.upload.title': 'Bild oder Video hochladen',

  'regie.media.uploads.aborted': 'abgebrochen',
  'regie.media.uploads.addToScene': 'Zu «{scene}»',
  'regie.media.uploads.dismiss': 'Aus der Liste entfernen: {name}',
  'regie.media.uploads.done': 'hochgeladen',
  'regie.media.uploads.label': 'Uploads',
  'regie.media.uploads.progress': 'Hochladen von {name}',
  'regie.media.uploads.queued': 'wartet …',

  'regie.media.usage.asBackground': 'als Hintergrund von «{scene}»',
  'regie.media.usage.asFallback': 'als Ersatzquelle in «{scene}»',
  'regie.media.usage.inScene': 'in «{scene}»',
  'regie.media.usage.listAnd': '{head} und {last}',
  'regie.media.usage.onEndSlate': 'auf dem Slate nach der Sendung',
  'regie.media.usage.onStandbySlate': 'auf dem Slate vor der Sendung',
  'regie.media.usage.sentence': 'Wird {list} verwendet.',
  'regie.media.usage.sentenceMore': 'Wird {list} (und {more} weitere) verwendet.',
  'regie.media.usage.stillUsed': 'Wird noch verwendet.',

  'regie.media.validation.empty': '«{name}» ist leer.',
  'regie.media.validation.imageTooLarge':
    '«{name}» ist zu gross. Bilder dürfen höchstens 25 MB gross sein.',
  'regie.media.validation.offline':
    '«{name}»: Keine Verbindung zum Server. Bitte gleich nochmals versuchen.',
  'regie.media.validation.type':
    '«{name}»: Dieser Dateityp ist nicht erlaubt. Erlaubt sind PNG, JPEG, WebP, MP4 und WebM.',
  'regie.media.validation.videoTooLarge':
    '«{name}» ist zu gross. Videos dürfen höchstens 1 GB gross sein.',
};
