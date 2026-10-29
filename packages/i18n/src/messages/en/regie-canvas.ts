import type { Namespace } from '../../types';

/**
 * Format and resolution of the output canvas in the Regie: the picker of the new-production form and of the General
 * page of the production settings, and the confirmation before the elements of the scenes are fitted to a new format.
 * The ratios (16:9), the resolutions (1080p) and the sizes (1920 × 1080) are written by the code.
 */
export const regieCanvas = {
  'regie.canvas.confirm': {
    '=0': 'The format changes. No scene has elements, so nothing else changes.',
    one: 'The undo history of the scenes is cleared, and the elements of {count} scene are scaled to fit the new canvas and centred. Check the scene afterwards; “Apply template” lays it out again.',
    other:
      'The undo history of the scenes is cleared, and the elements of {count} scenes are scaled to fit the new canvas and centred. Check the scenes afterwards; “Apply template” lays them out again.',
  },
  'regie.canvas.confirmButton': 'Change format',
  'regie.canvas.currentSize': 'Canvas {size}',
  'regie.canvas.format': 'Format',
  'regie.canvas.formatName.portrait': 'Portrait, for phones and social media',
  'regie.canvas.formatName.square': 'Square',
  'regie.canvas.formatName.standard': 'Classic 4:3',
  'regie.canvas.formatName.widescreen': 'Widescreen',
  'regie.canvas.liveLocked':
    'Format and resolution are locked while the broadcast is live. You can change them after it ends.',
  'regie.canvas.note':
    'Your scenes are laid out on this canvas. The output page scales it to the window it runs in, so it fills a proxy or a camera of any size.',
  'regie.canvas.resolution': 'Resolution',
  'regie.canvas.resolutionOnly':
    'Same format: every element is scaled in proportion, nothing moves.',
  'regie.canvas.save': 'Save format',
  'regie.canvas.saved': 'Output is now {size} ({ratio})',
  'regie.canvas.title': 'Format and resolution',
} as const satisfies Namespace<'regie.canvas'>;
