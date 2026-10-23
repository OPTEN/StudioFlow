import type { Namespace } from '../../types';

/** The media popover of the Sources dock: upload, pre-check, the media library and where a medium is used. */
export const regieMedia = {
  'regie.media.kind.image': 'Image',
  'regie.media.kind.video': 'Video',

  'regie.media.label': 'Media',

  'regie.media.library.delete': 'Delete: {name}',
  'regie.media.library.deleteLabel': 'Delete file',
  'regie.media.library.deleteMessage': '“{name}” will be deleted. This cannot be undone.',
  'regie.media.library.empty': 'No media uploaded yet.',
  'regie.media.library.inUse': 'in use',
  'regie.media.library.nameLabel': 'File name',
  'regie.media.library.removeFirst': 'Remove it there first.',
  'regie.media.library.rename': 'Rename: {name}',
  'regie.media.library.title': 'Production media',

  'regie.media.toast.addToScene': 'Add to scene',
  'regie.media.toast.cancelled': 'Upload of “{name}” cancelled',
  'regie.media.toast.deleted': '“{name}” deleted',
  'regie.media.toast.failed': '“{name}” was not uploaded: {reason}',
  'regie.media.toast.renamed': 'File is now called “{name}”',
  'regie.media.toast.uploaded': '“{name}” is uploaded and available as {code}',

  'regie.media.upload.hint': 'PNG, JPEG or WebP up to 25 MB · MP4 or WebM up to 1 GB',
  'regie.media.upload.pick': 'choose a file',
  'regie.media.upload.prompt': 'Drag here or {pick}',
  'regie.media.upload.title': 'Upload image or video',

  'regie.media.uploads.aborted': 'cancelled',
  'regie.media.uploads.addToScene': 'Add to “{scene}”',
  'regie.media.uploads.dismiss': 'Remove from list: {name}',
  'regie.media.uploads.done': 'uploaded',
  'regie.media.uploads.label': 'Uploads',
  'regie.media.uploads.progress': 'Uploading {name}',
  'regie.media.uploads.queued': 'waiting…',

  'regie.media.usage.asBackground': 'as background of “{scene}”',
  'regie.media.usage.asFallback': 'as fallback in “{scene}”',
  'regie.media.usage.inScene': 'in “{scene}”',
  'regie.media.usage.listAnd': '{head} and {last}',
  'regie.media.usage.onEndSlate': 'on the slate after the broadcast',
  'regie.media.usage.onStandbySlate': 'on the slate before the broadcast',
  'regie.media.usage.sentence': 'Used {list}.',
  'regie.media.usage.sentenceMore': 'Used {list} (and {more} more).',
  'regie.media.usage.stillUsed': 'Still in use.',

  'regie.media.validation.empty': '“{name}” is empty.',
  'regie.media.validation.imageTooLarge': '“{name}” is too large. Images may be at most 25 MB.',
  'regie.media.validation.offline':
    '“{name}”: No connection to the server. Please try again in a moment.',
  'regie.media.validation.type':
    '“{name}”: This file type is not allowed. Allowed are PNG, JPEG, WebP, MP4 and WebM.',
  'regie.media.validation.videoTooLarge': '“{name}” is too large. Videos may be at most 1 GB.',
} as const satisfies Namespace<'regie.media'>;
