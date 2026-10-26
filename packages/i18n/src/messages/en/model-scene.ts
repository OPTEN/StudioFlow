import type { Namespace } from '../../types';

/** Layout templates, the "On failure" options and the messages of the item validation (`validateItem`). */
export const modelScene = {
  'model.scene.field.borderWidth': 'Border width',
  'model.scene.field.cornerRadius': 'Corner radius',
  'model.scene.field.cropBottom': 'Crop bottom',
  'model.scene.field.cropLeft': 'Crop left',
  'model.scene.field.cropRight': 'Crop right',
  'model.scene.field.cropTop': 'Crop top',
  'model.scene.field.height': 'Height',
  'model.scene.field.width': 'Width',
  'model.scene.field.x': 'X position',
  'model.scene.field.y': 'Y position',

  'model.scene.holdForever': 'Hold freeze frame',
  'model.scene.holdThenDim10': 'Freeze frame 10 s, then dim',
  'model.scene.holdThenDim3': 'Freeze frame 3 s, then dim',

  'model.scene.sourceMissing': 'Source missing',

  'model.scene.templateInfo.auto': 'arranges itself by active cameras',
  'model.scene.templateInfo.col': 'Presentation with two people',
  'model.scene.templateInfo.full': 'one source',
  'model.scene.templateInfo.grid': 'Panel or Q&A',
  'model.scene.templateInfo.grid3': 'Gallery, many guests',
  'model.scene.templateInfo.onetwo': 'Host and two guests',
  'model.scene.templateInfo.pip': 'Screen large, camera in the corner',
  'model.scene.templateInfo.two': 'Interview, conversation',
  'model.scene.templateName.auto': 'Auto grid',
  'model.scene.templateName.col': 'Screen + camera column',
  'model.scene.templateName.colRow': 'Screen + camera row',
  'model.scene.templateName.full': 'Full screen',
  'model.scene.templateName.grid': '2 × 2',
  'model.scene.templateName.grid3': '3 × 3',
  'model.scene.templateName.onetwo': 'One plus two',
  'model.scene.templateName.pip': 'Picture in picture',
  'model.scene.templateName.two': 'Side by side',
  'model.scene.templateName.twoStacked': 'Stacked',

  'model.scene.validation.borderColor': 'The border colour must be a hex colour like #e3b341.',
  'model.scene.validation.cropAxisHorizontal':
    'Crop left and right together must be less than {max}.',
  'model.scene.validation.cropAxisVertical':
    'Crop top and bottom together must be less than {max}.',
  'model.scene.validation.cropSide': '{label} must be between 0 and {max}.',
  'model.scene.validation.fallbackMissing': 'The fallback source does not exist.',
  'model.scene.validation.fallbackSelf': 'The fallback source cannot be the item’s own source.',
  'model.scene.validation.fit': 'Fit must be “Fill” or “Show all”.',
  'model.scene.validation.holdDuration':
    'The freeze frame duration must be between 0 and {max} s (whole milliseconds).',
  'model.scene.validation.idMissing': 'The item ID is missing.',
  'model.scene.validation.integerRange': '{label} must be a whole number between {min} and {max}.',
  'model.scene.validation.rotation': 'Rotation must be 0, 90, 180 or 270 degrees.',
  'model.scene.validation.sourceMissing': 'The item has no source.',
} as const satisfies Namespace<'model.scene'>;
