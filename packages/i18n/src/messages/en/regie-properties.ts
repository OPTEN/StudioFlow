import type { Namespace } from '../../types';

/**
 * The Properties dock: the inspector head, the sections of the scene and the element inspector, and the choices of
 * "When the source fails".
 */
export const regieProperties = {
  'regie.properties.crop.bottom': 'Bottom',
  'regie.properties.crop.left': 'Left',
  'regie.properties.crop.right': 'Right',
  'regie.properties.crop.top': 'Top',

  'regie.properties.dock.back': 'Back to scene',
  'regie.properties.dock.backLabel': 'Clear selection, back to scene',
  'regie.properties.dock.backTitle': 'Clear selection (Esc)',
  'regie.properties.dock.loadingTitle': 'Loading properties…',
  'regie.properties.dock.noSceneText': 'Add a scene in the Scenes dock first.',
  'regie.properties.dock.noSceneTitle': 'No scene.',
  'regie.properties.dock.titleItem': 'Item',
  'regie.properties.dock.titleScene': 'Scene',

  'regie.properties.element.border': 'Border',
  'regie.properties.element.borderColorLabel': 'Border colour',
  'regie.properties.element.borderWidthLabel': 'Border width',
  'regie.properties.element.canvas': 'Canvas {width} × {height}',
  'regie.properties.element.corners': 'Corners',
  'regie.properties.element.crop': 'Crop',
  'regie.properties.element.fallback': 'Then',
  'regie.properties.element.fallbackHintHold': 'The last picture stays until the source is back.',
  'regie.properties.element.fallbackNone': 'The last picture, dimmed',
  'regie.properties.element.fit': 'Fit',
  'regie.properties.element.fitContain': 'Show all',
  'regie.properties.element.fitCover': 'Fill',
  'regie.properties.element.heightShort': 'H',
  'regie.properties.element.layerBackward': 'Send backward',
  'regie.properties.element.layerForward': 'Bring forward',
  'regie.properties.element.layerToBack': 'Send to back',
  'regie.properties.element.layerToFront': 'Bring to front',
  'regie.properties.element.mirror': 'Mirror',
  'regie.properties.element.note':
    'Shift releases the aspect ratio, Alt turns snapping off, arrow keys move by 1 px. Esc clears the selection.',
  'regie.properties.element.onFailure': 'First',
  'regie.properties.element.radiusLabel': 'Corner radius',
  'regie.properties.element.remove': 'Remove from scene',
  'regie.properties.element.removeHint': 'Ctrl+Z brings it back.',
  'regie.properties.element.rotate': 'Rotate',
  'regie.properties.element.rotateBy': 'Rotate by {degrees} degrees',
  'regie.properties.element.widthShort': 'W',

  'regie.properties.group.camera': 'Cameras',
  'regie.properties.group.media': 'Media',
  'regie.properties.group.screen': 'Screens',

  'regie.properties.hold.forever': 'Last picture until the source is back',
  'regie.properties.hold.timed': 'Last picture for {seconds} s',

  'regie.properties.scene.applyTo': 'Apply to “{scene}”',
  'regie.properties.scene.autoGridActive':
    'Auto grid active: the sources fill the grid in the order of the list.',
  'regie.properties.scene.background': 'Background',
  'regie.properties.scene.colorLabel': 'Background colour',
  'regie.properties.scene.delete': 'Delete scene',
  'regie.properties.scene.deleteButton': 'Delete scene…',
  'regie.properties.scene.deleteHint': 'Removes the scene with everything in it.',
  'regie.properties.scene.deleteHintLive': 'The live scene cannot be deleted.',
  'regie.properties.scene.deleteHintLiveDirect':
    'The live scene cannot be deleted. Other scenes can be deleted from their menu in Scenes.',
  'regie.properties.scene.deleteMessage': '“{name}” will be deleted. This cannot be undone.',
  'regie.properties.scene.imageLabel': 'Background image',
  'regie.properties.scene.imageMissing': 'Image missing',
  'regie.properties.scene.imageNone': 'No image',
  'regie.properties.scene.name': 'Name',
  'regie.properties.scene.templatesHint': 'A template arranges the visible sources of the scene.',

  'regie.properties.section.background': 'Background',
  'regie.properties.section.failure': 'When the source fails',
  'regie.properties.section.fit': 'Fit & crop',
  'regie.properties.section.geometry': 'Position & size',
  'regie.properties.section.layer': 'Layer',
  'regie.properties.section.layout': 'Layout templates',
  'regie.properties.section.style': 'Style',
  'regie.properties.section.text': 'Text',

  'regie.properties.tabs.failure': 'When it fails',
  'regie.properties.tabs.label': 'Properties of the source',
  'regie.properties.tabs.layout': 'Layout',
  'regie.properties.tabs.style': 'Style',
  'regie.properties.tabs.text': 'Text',
} as const satisfies Namespace<'regie.properties'>;
