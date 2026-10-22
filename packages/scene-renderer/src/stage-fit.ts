import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@flowstudio/scene-model';

import type { StageFit } from './types';

/** Container sizes that are not a positive finite number (hidden element, NaN) count as 0. */
function usableLength(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Fits the 1920 × 1080 canvas into a container without distortion: uniform scale, centred, bars on the long side
 * (letterbox or pillarbox). Pure, so the monitor overlay of the Regie can use the same math.
 */
export function fitStage(containerWidth: number, containerHeight: number): StageFit {
  const width = usableLength(containerWidth);
  const height = usableLength(containerHeight);
  const scale = Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT);
  const stageWidth = CANVAS_WIDTH * scale;
  const stageHeight = CANVAS_HEIGHT * scale;
  return {
    scale,
    offsetX: (width - stageWidth) / 2,
    offsetY: (height - stageHeight) / 2,
    width: stageWidth,
    height: stageHeight,
  };
}
