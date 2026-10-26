import type { Namespace } from '../../types';

/**
 * The output links in the output popover of the Regie: one named link per consumer (the proxy, the Teams camera, …),
 * and the instructions to use a link as a camera in Teams, Zoom or Webex through OBS (issue #9).
 */
export const regieOutput = {
  'regie.output.camera.audio':
    'The camera carries video only. The sound stays on the mixing desk and goes into Teams from there.',
  'regie.output.camera.close': 'Close instructions',
  'regie.output.camera.download': 'Download OBS scene collection',
  'regie.output.camera.downloaded': 'OBS scene collection “{file}” downloaded',
  'regie.output.camera.intro': 'OBS turns the output page into the camera “OBS Virtual Camera”.',
  'regie.output.camera.open': 'Use as camera …',
  'regie.output.camera.runbook': 'More in the runbook: “Output as a camera in Teams/Zoom”.',
  'regie.output.camera.separateMachine':
    'Run OBS and Teams on a separate computer, not on the Regie laptop: the output must not depend on it.',
  'regie.output.camera.step1':
    'Install OBS Studio 31 or newer on the computer that runs Teams or Zoom.',
  'regie.output.camera.step2':
    'In OBS choose Scene Collection → Import, select the downloaded file, then choose “{name}” under Scene Collection.',
  'regie.output.camera.step3':
    'In OBS under Settings → Video set Base Resolution and Output Resolution to {width} × {height} and the frame rate to {fps}.',
  'regie.output.camera.step4': 'In OBS click Start Virtual Camera.',
  'regie.output.camera.step5':
    'In Teams, Zoom or Webex pick the camera “OBS Virtual Camera” and switch background effects off.',
  'regie.output.camera.title': 'Use “{name}” as a camera',
  'regie.output.link.add': 'Create link',
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
  'regie.output.link.rename': 'Rename',
  'regie.output.link.renameLabel': 'New name of “{name}”',
  'regie.output.link.renamed': 'Link renamed to “{name}”',
  'regie.output.link.revoke': 'Revoke link',
  'regie.output.link.revokeConfirm': 'Revoke',
  'regie.output.link.revokeMessage':
    'Pages that use “{name}” are disconnected immediately. The other links keep working.',
  'regie.output.link.revoked': 'Link “{name}” revoked',
  'regie.output.link.stale': 'no current picture',
  'regie.output.links.empty': 'No link yet. Add one to let a proxy or a camera show the output.',
  'regie.output.links.hint':
    'One link per consumer: the proxy, the Teams camera, … Each one can be revoked on its own.',
  'regie.output.links.title': 'Links',
} as const satisfies Namespace<'regie.output'>;
