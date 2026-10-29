import type { Namespace } from '../../types';

/**
 * The production pages of the settings window (General, Slates, Text style, All productions), the production switcher
 * in the toolbar of the control room, and the save bar the production pages share.
 */
export const regieProduction = {
  'regie.production.switcher.offline':
    'No connection to the server. You can switch again once it is back.',
  'regie.production.switcher.settings': 'Production settings…',
  'regie.production.switcher.title': 'Productions',

  'regie.production.switch.confirm':
    '“{live}” is on air. Its output keeps running, but you can only switch its scenes again once you come back to it.',
  'regie.production.switch.to': 'Switch to',
  'regie.production.switch.toLabel': 'Switch to “{name}”',
  'regie.production.switch.now': 'Switch now',

  'regie.production.state.active': 'Active',
  'regie.production.state.created': 'Created {date}',
  'regie.production.state.onAir': 'On air',

  'regie.production.form.clean': 'No changes',
  'regie.production.form.discard': 'Discard changes',
  'regie.production.form.saving': 'Saving…',
  'regie.production.form.unsaved': 'Unsaved changes',

  'regie.production.name.hint':
    'Shown in the toolbar of the control room and in the list of productions.',
  'regie.production.name.invalid': 'Enter a name of 1 to {max} characters.',
  'regie.production.name.save': 'Save name',

  'regie.production.slates.endHint':
    'Shown when you end the broadcast, until you go back to the standby slate.',
  'regie.production.slates.lead': 'What the audience sees before and after the broadcast.',
  'regie.production.slates.noImages':
    'To show a picture behind the text, upload an image in the Sources dock first.',
  'regie.production.slates.optional': 'Optional',
  'regie.production.slates.preview': 'Preview of the slate “{title}”',
  'regie.production.slates.save': 'Save slates',
  'regie.production.slates.showing': 'On the output now',
  'regie.production.slates.standbyHint':
    'Shown from the moment the output opens until you start the broadcast.',
  'regie.production.slates.titleInvalid': 'Enter a title of at most {max} characters.',

  'regie.production.text.accentSub': 'Bar or line beside the text',
  'regie.production.text.backgroundSub': 'Box behind the text',
  'regie.production.text.colours': 'Colours',
  'regie.production.text.defaults': 'Use default colours',
  'regie.production.text.defaultsHint': 'Fills in the default colours. Save to apply them.',
  'regie.production.text.foregroundSub': 'Letters',
  'regie.production.text.hexInvalid': 'Enter the colour as #rrggbb, for example #1f6feb.',
  'regie.production.text.lead':
    'Colours of every lower third, title and note of this production. Saving changes the output at once.',
  'regie.production.text.preview': 'Preview',
  'regie.production.text.previewLabel':
    'Sample of a lower third, a title and a note in these colours',
  'regie.production.text.save': 'Save colours',

  'regie.production.list.footer':
    'The active production is the one the control room shows and new devices pair into.',
  'regie.production.list.loading': 'Loading productions…',
  'regie.production.list.offline':
    'No connection to the server. Switching and creating work again once it is back.',

  'regie.production.add.create': 'Create production',
  'regie.production.add.liveHint':
    'While “{name}” is on air, the new production is created but not opened. Switch to it after the broadcast.',
  'regie.production.add.newSub': 'Start empty, in the format you choose.',
  'regie.production.add.placeholder': 'e.g. Spring webinar',
  'regie.production.add.title': 'Add a production',

  'regie.production.this.title': 'This production',
} as const satisfies Namespace<'regie.production'>;
