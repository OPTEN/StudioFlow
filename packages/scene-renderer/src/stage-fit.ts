import type { CanvasSize } from '@studioflow/scene-model';

import type { StageFit } from './types';

/** Container sizes that are not a positive finite number (hidden element, NaN) count as 0. */
function usableLength(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Fits the canvas into a container without distortion: uniform scale, centred, bars on the long side (letterbox or
 * pillarbox). Pure, so the monitor overlay of the Regie can use the same math.
 */
export function fitStage(
  containerWidth: number,
  containerHeight: number,
  canvas: CanvasSize,
): StageFit {
  const width = usableLength(containerWidth);
  const height = usableLength(containerHeight);
  const scale = Math.min(width / canvas.width, height / canvas.height);
  const stageWidth = canvas.width * scale;
  const stageHeight = canvas.height * scale;
  return {
    scale,
    offsetX: (width - stageWidth) / 2,
    offsetY: (height - stageHeight) / 2,
    width: stageWidth,
    height: stageHeight,
  };
}
