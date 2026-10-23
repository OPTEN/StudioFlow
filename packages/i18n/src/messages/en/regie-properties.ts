import type { Namespace } from '../../types';

/** The Properties dock: header, scene inspector, element inspector and the hold-time option for custom values. */
export const regieProperties = {
  'regie.properties.crop.bottom': 'Bottom',
  'regie.properties.crop.left': 'Left',
  'regie.properties.crop.right': 'Right',
  'regie.properties.crop.top': 'Top',

  'regie.properties.dock.back': 'Back to scene',
  'regie.properties.dock.backLabel': 'Clear selection, back to scene',
  'regie.properties.dock.backTitle': 'Clear selection (Esc)',
  'regie.properties.dock.loadingTitle': 'Loading properties…',
  'regie.properties.dock.noSceneText': 'Create a scene under Scenes with “+ Scene”.',
  'regie.properties.dock.noSceneTitle': 'No scene.',
  'regie.properties.dock.titleItem': 'Item',
  'regie.properties.dock.titleScene': 'Scene',

  'regie.properties.element.border': 'Border',
  'regie.properties.element.borderColorLabel': 'Border colour',
  'regie.properties.element.borderShow': 'Show',
  'regie.properties.element.borderWidthLabel': 'Border width',
  'regie.properties.element.corners': 'Corners',
  'regie.properties.element.crop': 'Crop',
  'regie.properties.element.fallback': 'Fallback source',
  'regie.properties.element.fallbackHintHold':
    'With “Hold freeze frame” the last picture stays on screen.',
  'regie.properties.element.fallbackHintTimed':
    'Appears after the hold time instead of the freeze frame.',
  'regie.properties.element.fallbackNone': 'None',
  'regie.properties.element.fit': 'Fit',
  'regie.properties.element.fitContain': 'Show all',
  'regie.properties.element.fitCover': 'Fill',
  'regie.properties.element.heightShort': 'H',
  'regie.properties.element.layer': 'Layer',
  'regie.properties.element.layerBackward': 'Send backward',
  'regie.properties.element.layerForward': 'Bring forward',
  'regie.properties.element.layerToBack': 'Send to back',
  'regie.properties.element.layerToFront': 'Bring to front',
  'regie.properties.element.mirror': 'Mirror',
  'regie.properties.element.note':
    'Shift releases the aspect ratio, Alt turns snapping off, arrow keys move by 1 px. Esc clears the selection.',
  'regie.properties.element.onFailure': 'On failure',
  'regie.properties.element.position': 'Position',
  'regie.properties.element.radiusLabel': 'Corner radius',
  'regie.properties.element.remove': 'Remove from scene',
  'regie.properties.element.removeHint': 'Can be restored with Ctrl+Z.',
  'regie.properties.element.rotate': 'Rotate',
  'regie.properties.element.rotateBy': 'Rotate by {degrees} degrees',
  'regie.properties.element.size': 'Size',
  'regie.properties.element.widthShort': 'W',

  'regie.properties.group.camera': 'Cameras',
  'regie.properties.group.media': 'Media',
  'regie.properties.group.screen': 'Screens',

  'regie.properties.hold.custom': 'Freeze frame {seconds} s, then dim',

  'regie.properties.scene.autoGridActive': 'Auto grid active',
  'regie.properties.scene.background': 'Background',
  'regie.properties.scene.colorLabel': 'Background colour',
  'regie.properties.scene.delete': 'Delete scene',
  'regie.properties.scene.deleteHint': 'Deleting removes the scene with all its items.',
  'regie.properties.scene.deleteHintLive': 'The live scene cannot be deleted.',
  'regie.properties.scene.deleteHintLiveDirect':
    'The live scene cannot be deleted. Edit other scenes in Studio Mode.',
  'regie.properties.scene.deleteMessage': '“{name}” will be deleted. This cannot be undone.',
  'regie.properties.scene.imageLabel': 'Background image',
  'regie.properties.scene.imageMissing': 'Image missing',
  'regie.properties.scene.imageNone': 'No image',
  'regie.properties.scene.name': 'Name',
  'regie.properties.scene.templates': 'Apply template',
} as const satisfies Namespace<'regie.properties'>;
