import type { Namespace } from '../../types';

/**
 * Format and resolution of the output canvas in the Regie: the picker of the new-production form and of the
 * "Format and resolution" settings, and the confirmation before the elements of the scenes are fitted to a new format.
 * The ratios (16:9), the resolutions (1080p) and the sizes (1920 × 1080) are written by the code.
 */
export const regieCanvas = {
  'regie.canvas.confirm': {
    '=0': 'The format changes. No scene has elements, so nothing else changes.',
    one: 'The format changes. The elements of {count} scene are scaled to fit the new canvas and centred; check the scene afterwards, “Apply template” lays it out again. The undo history of the scenes is cleared.',
    other:
      'The format changes. The elements of {count} scenes are scaled to fit the new canvas and centred; check the scenes afterwards, “Apply template” lays them out again. The undo history of the scenes is cleared.',
  },
  'regie.canvas.confirmButton': 'Change format',
  'regie.canvas.currentSize': 'Canvas {size}',
  'regie.canvas.format': 'Format',
  'regie.canvas.formatName.portrait': 'Portrait, for phones and social media',
  'regie.canvas.formatName.square': 'Square',
  'regie.canvas.formatName.standard': 'Classic 4:3',
  'regie.canvas.formatName.widescreen': 'Widescreen',
  'regie.canvas.liveLocked':
    'The format and resolution cannot be changed while the broadcast is live. End the broadcast first.',
  'regie.canvas.menu': 'Format and resolution…',
  'regie.canvas.note':
    'The output page scales the picture to the window of the proxy. The format and the target resolution set the canvas of the layouts, not the pixels that arrive at the proxy.',
  'regie.canvas.resolution': 'Target resolution',
  'regie.canvas.resolutionOnly':
    'Same format: every element is scaled in proportion, nothing moves.',
  'regie.canvas.saved': 'Output is now {size} ({ratio})',
  'regie.canvas.title': 'Format and resolution',
} as const satisfies Namespace<'regie.canvas'>;
