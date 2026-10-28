import type { Namespace } from '../../types';

/**
 * The header of the Regie (the control room): broadcast state and buttons, the output chip and its popover, the
 * production menu, the station health toasts, the layout popover and the presence chip.
 */
export const regieHeader = {
  'regie.header.broadcast.end': 'End broadcast',
  'regie.header.broadcast.endConfirm': 'The broadcast will end. The output then shows “{title}”.',
  'regie.header.broadcast.endConfirmNoTitle':
    'The broadcast will end. The output then shows the end slate.',
  'regie.header.broadcast.endDone': 'Broadcast ended',
  'regie.header.broadcast.ended': 'ENDED',
  'regie.header.broadcast.endedTitle': 'The broadcast has ended; the output shows the end slate',
  'regie.header.broadcast.live': 'LIVE',
  'regie.header.broadcast.ready': 'READY',
  'regie.header.broadcast.readyTitle': 'The output shows the slate before the broadcast',
  'regie.header.broadcast.reset': 'Back to Ready',
  'regie.header.broadcast.sinceStart': 'Since the broadcast started',
  'regie.header.broadcast.start': 'Start broadcast',
  'regie.header.broadcast.startDone': 'The broadcast is running',

  'regie.header.health.allSending': 'All stations are sending',
  'regie.header.health.noStations': 'No stations paired yet',

  'regie.header.layout.docks': 'Docks',
  'regie.header.layout.note':
    'Drag a dock by its header to the bottom, left or right. Drag the dividers to resize; a double click resets the size.',
  'regie.header.layout.open': 'Docks and layout',
  'regie.header.layout.title': 'Docks and layout',

  'regie.header.output.access': 'Access',
  'regie.header.output.accessNoRestriction':
    'Any address may open the output. For more security, enter the proxy’s address.',
  'regie.header.output.accessRestricted': 'Only these addresses may open the output.',
  'regie.header.output.accessSaved': 'Access saved',
  'regie.header.output.accessSavedOpen': 'Access saved: any address may open the output',
  'regie.header.output.addressesLabel': 'Consumers',
  'regie.header.output.dialog': 'Output',
  'regie.header.output.discard': 'Discard',
  'regie.header.output.embedAllowed': 'Embedding allowed for',
  'regie.header.output.formatLabel': 'Format',
  'regie.header.output.ipInvalid':
    'Please enter an IP address like 10.0.0.42 or a network like 10.0.0.0/24.',
  'regie.header.output.ipLabel': 'IP address or network (CIDR)',
  'regie.header.output.ipPlaceholder': '10.0.0.42 or 10.0.0.0/24',
  'regie.header.output.label': 'Output',
  'regie.header.output.latencyLabel': 'Latency',
  'regie.header.output.latencyMeasured': 'measured',
  'regie.header.output.latencyNone': 'not measured yet',
  'regie.header.output.linkLoading': 'Loading link…',
  'regie.header.output.linkNew': 'New link for “{name}” created. The old one is no longer valid.',
  'regie.header.output.regenerate': 'Regenerate link',
  'regie.header.output.regenerateConfirm': 'Regenerate',
  'regie.header.output.regenerateMessage':
    'The old link of “{name}” stops working immediately. Whatever uses it needs the new one afterwards.',
  'regie.header.output.removeIp': 'Remove {ip}',
  'regie.header.output.retry': 'Try again',
  'regie.header.output.stateConnected': {
    one: 'connected, {count} consumer',
    other: 'connected, {count} consumers',
  },
  'regie.header.output.stateLabel': 'State',
  'regie.header.output.stateNone': 'not connected',
  'regie.header.output.stateStale': 'connected, no current picture',

  'regie.header.presence.long': {
    one: 'One person in the control room',
    other: '{count} people in the control room',
  },
  'regie.header.presence.short': '{count} in the control room',

  'regie.header.production.afterBroadcast': 'After the broadcast',
  'regie.header.production.background': 'Background',
  'regie.header.production.backgroundNone': 'No image',
  'regie.header.production.beforeBroadcast': 'Before the broadcast',
  'regie.header.production.created': 'Production “{name}” created and active',
  'regie.header.production.createdSwitchLater':
    'Production “{name}” created. You can switch after the broadcast.',
  'regie.header.production.createSubmit': 'Create',
  'regie.header.production.dialog': 'Production',
  'regie.header.production.editSlates': 'Edit slates',
  'regie.header.production.listError': 'The productions could not be loaded.',
  'regie.header.production.listLoading': 'Loading…',
  'regie.header.production.menu': 'Production {name}, menu',
  'regie.header.production.name': 'Name',
  'regie.header.production.nameInvalid': 'Please enter a name of at most 80 characters.',
  'regie.header.production.namePlaceholder': 'e.g. Webinar “Headless with Umbraco”',
  'regie.header.production.new': 'New production',
  'regie.header.production.newMenu': 'New production…',
  'regie.header.production.noSwitchWhileLive':
    'The production cannot be switched during the broadcast.',
  'regie.header.production.renameTitle': 'Rename production',
  'regie.header.production.renamed': 'Production is now called “{name}”',
  'regie.header.production.signOut': 'Sign out',
  'regie.header.production.signOutFailed': 'Signing out failed. {reason}',
  'regie.header.production.slatesHint':
    'The output shows the slate before the broadcast starts and after it ends.',
  'regie.header.production.slatesInvalid': 'Both slates need a title.',
  'regie.header.production.slatesSaved': 'Slates saved',
  'regie.header.production.subtitle': 'Subtitle',
  'regie.header.production.switchTitle': 'Switch production',
  'regie.header.production.switched': 'Switched to “{name}”',
  'regie.header.production.textAccent': 'Accent',
  'regie.header.production.textBackground': 'Background',
  'regie.header.production.textColors': 'Text colours…',
  'regie.header.production.textColorsHint':
    'Colours of all lower thirds, titles and notes of this production. Saving applies them to the output at once.',
  'regie.header.production.textColorsInvalid':
    'Enter every colour as #rrggbb, for example #1f6feb.',
  'regie.header.production.textColorsReset': 'Reset to defaults',
  'regie.header.production.textColorsSaved': 'Text colours saved',
  'regie.header.production.textColorsTitle': 'Text colours',
  'regie.header.production.textContrastLow':
    'Contrast {ratio} : 1. The text is hard to read on this background; aim for at least 4.5 : 1.',
  'regie.header.production.textForeground': 'Text',
  'regie.header.production.textHex': '{colour}, hex value',
  'regie.header.production.textPick': '{colour}, colour picker',
  'regie.header.production.textSample': 'Sample of a lower third',
  'regie.header.production.title': 'Title',

  'regie.header.sponsor.prefix': 'Sponsored by',
} as const satisfies Namespace<'regie.header'>;
