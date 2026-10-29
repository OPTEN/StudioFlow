import type { Namespace } from '../../types';

/** Texts and lower thirds in the Regie: the text editor in the Properties dock and the placeholders of new texts. */
export const regieText = {
  'regie.text.align.center': 'Centre',
  'regie.text.align.label': 'Alignment',
  'regie.text.align.left': 'Left',
  'regie.text.align.right': 'Right',

  'regie.text.counter': '{count} of {max}',

  'regie.text.delete.button': 'Delete text…',
  'regie.text.delete.confirm': 'Delete this text',
  'regie.text.delete.hint': 'The text is removed from every scene.',
  'regie.text.delete.message': {
    '=0': '{code} is deleted. It is not in any scene.',
    one: '{code} is deleted and removed from {count} scene.',
    other: '{code} is deleted and removed from {count} scenes.',
  },
  'regie.text.delete.toast': '{code} deleted',

  'regie.text.editor.hintLive': 'Changes reach the output as you type.',
  'regie.text.editor.label': 'Text',
  'regie.text.editor.line1': 'Line 1',
  'regie.text.editor.line1Placeholder': 'Name or title',
  'regie.text.editor.line2': 'Line 2 (optional)',
  'regie.text.editor.line2Placeholder': 'Role or subtitle',
  'regie.text.editor.line1Required': 'Enter the first line.',
  'regie.text.editor.offline': 'No connection to the server. Editing works again when it is back.',
  'regie.text.editor.sharedHint': 'Shown in {count} scenes. A change applies to all of them.',
  'regie.text.editor.style': 'Style',

  'regie.text.placeholder.name': 'Name',
  'regie.text.placeholder.note': 'Note',
  'regie.text.placeholder.role': 'Role',
  'regie.text.placeholder.title': 'Title',

  'regie.text.preview.label': 'Preview of the text',
  'regie.text.preview.title': 'Preview',

  'regie.text.style.lowerThird': 'Lower third',
  'regie.text.style.note': 'Note',
  'regie.text.style.title': 'Title',

  'regie.text.visibility.hint': 'Works while the scene is live, too.',
  'regie.text.visibility.label': 'Show on the output',
} as const satisfies Namespace<'regie.text'>;
