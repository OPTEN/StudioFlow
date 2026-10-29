import type { Namespace } from '../../types';

/**
 * The output of the Regie: the live status and the links in the output popover, and the page "Output links" of the
 * settings window: one named link per consumer (the proxy, the Teams camera, …) with its access, its options, the
 * instructions to use it as a camera in Teams, Zoom or Webex through OBS (issue #9), and the embedding origins.
 */
export const regieOutput = {
  'regie.output.access.save': 'Save access',

  'regie.output.camera.audio':
    'The camera carries video only. The sound stays on the mixing desk and goes into Teams from there.',
  'regie.output.camera.download': 'Download OBS scene collection',
  'regie.output.camera.downloaded': 'OBS scene collection “{file}” downloaded',
  'regie.output.camera.hide': 'Hide steps',
  'regie.output.camera.intro': 'OBS turns the output page into the camera “OBS Virtual Camera”.',
  'regie.output.camera.open': 'Use as camera in OBS',
  'regie.output.camera.separateMachine':
    'Run OBS and Teams on a separate computer, not on the Regie laptop: the output must not depend on it.',
  'regie.output.camera.show': 'Show steps',
  'regie.output.camera.step1':
    'Install OBS Studio 31 or newer on the computer that runs Teams or Zoom.',
  'regie.output.camera.step2':
    'In OBS choose Scene Collection → Import, select the downloaded file, then choose “{name}” under Scene Collection.',
  'regie.output.camera.step3':
    'In OBS under Settings → Video set Base Resolution and Output Resolution to {width} × {height} and the frame rate to {fps}.',
  'regie.output.camera.step4': 'In OBS click Start Virtual Camera.',
  'regie.output.camera.step5':
    'In Teams, Zoom or Webex pick the camera “OBS Virtual Camera” and switch background effects off.',
  'regie.output.camera.sub': 'Show the output as a camera in Teams, Zoom or Webex.',
  'regie.output.camera.title': 'Use “{name}” as a camera',

  'regie.output.detail.hide': 'Hide link',
  'regie.output.detail.link': 'Link',
  'regie.output.detail.secret':
    'Anyone with this link can open the output. Give it only to the page or device it is meant for.',
  'regie.output.detail.show': 'Show link',

  'regie.output.embed.change': 'Change embedding…',
  'regie.output.embed.hint':
    'Websites that may show the output in a frame. They apply to every production.',
  'regie.output.embed.self': 'This server',
  'regie.output.embed.title': 'Embedding',

  'regie.output.link.add': 'Add link',
  'regie.output.link.connected': 'connected',
  'regie.output.link.created': 'Link “{name}” created',
  'regie.output.link.keyLabel': 'Link “{name}”',
  'regie.output.link.lastSeen': 'last seen {time}',
  'regie.output.link.limit': 'At most {max} links. Revoke one to add another.',
  'regie.output.link.line': '{name} · {state}',
  'regie.output.link.nameInvalid': 'Please enter a name of 1 to {max} characters.',
  'regie.output.link.nameLabel': 'Name of the new link',
  'regie.output.link.namePlaceholder': 'e.g. Teams camera',
  'regie.output.link.nameTaken': 'A link with this name exists already.',
  'regie.output.link.neverSeen': 'never connected',
  'regie.output.link.none': 'not connected',
  'regie.output.link.pages': { one: '{count} page', other: '{count} pages' },
  'regie.output.link.rename': 'Rename',
  'regie.output.link.renameLabel': 'New name of “{name}”',
  'regie.output.link.renamed': 'Link renamed to “{name}”',
  'regie.output.link.revoke': 'Revoke link',
  'regie.output.link.revokeConfirm': 'Revoke',
  'regie.output.link.revokeMessage':
    '“{name}” stops working at once and is removed: pages that use it show “No access”. The other links keep working.',
  'regie.output.link.revoked': 'Link “{name}” revoked',
  'regie.output.link.stale': 'no current picture',

  'regie.output.links.empty':
    'Add a link below to let a proxy, OBS or a meeting camera show the output.',
  'regie.output.links.emptyTitle': 'No output link yet',
  'regie.output.links.hint':
    'One link per page or device that shows the output, such as the proxy or a meeting camera. Each one can be stopped on its own.',
  'regie.output.links.loading': 'Loading links…',
  'regie.output.links.title': 'Links',

  'regie.output.options.language': 'Language of its messages',
  'regie.output.options.languageSub':
    'For the messages the output page shows by itself, such as “No access”.',
  'regie.output.options.sound': 'Sound',
  'regie.output.options.soundSub': 'Switch it off for a page that only shows the picture.',
  'regie.output.options.sub': 'They become part of the copied link.',
  'regie.output.options.title': 'Link options',
  'regie.output.options.transparent': 'Transparent background',
  'regie.output.options.transparentSub': 'For an overlay in OBS: the empty canvas is see-through.',

  'regie.output.pop.addresses': 'Connected from',
  'regie.output.pop.copy': 'Copy link “{name}”',
  'regie.output.pop.empty': 'No output link yet.',
  'regie.output.pop.manage': 'Manage output links…',

  'regie.output.renew.button': 'New link…',
  'regie.output.renew.confirm':
    'The old link of “{name}” stops working at once: pages that use it show “No access” and need the new link.',
  'regie.output.renew.confirmButton': 'Make new link',
  'regie.output.renew.sub': 'Make a new link and stop the old one.',
  'regie.output.renew.title': 'New link',

  'regie.output.revoke.button': 'Revoke…',
  'regie.output.revoke.sub': 'Stop this link for good. The other links keep working.',
} as const satisfies Namespace<'regie.output'>;
