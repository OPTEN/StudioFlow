import type { DesiredSize } from '@studioflow/scene-renderer';

/** Requests above 8K make no difference for layer selection and hint at a unit bug; they are clamped. */
const MAX_DIMENSION = 7680;

/**
 * Validates a consumer's size request: non-finite, zero or negative values mean “not needed” (null); fractions are
 * rounded up to whole pixels and huge values clamped.
 */
export function normalizeDesiredSize(size: DesiredSize | null): DesiredSize | null {
  if (size === null) {
    return null;
  }
  const { width, height } = size;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    width: Math.min(MAX_DIMENSION, Math.ceil(width)),
    height: Math.min(MAX_DIMENSION, Math.ceil(height)),
  };
}

/**
 * Picture sizes requested for one source by several consumers (renderer instances). The effective size is the
 * component-wise maximum, so the largest monitor (or output item) decides the simulcast layer.
 */
export class DesiredSizes {
  readonly #byConsumer = new Map<string, DesiredSize>();

  /** Sets or (with null / an invalid size) removes the request of one consumer. */
  set(consumerId: string, size: DesiredSize | null): void {
    const normalized = normalizeDesiredSize(size);
    if (normalized === null) {
      this.#byConsumer.delete(consumerId);
    } else {
      this.#byConsumer.set(consumerId, normalized);
    }
  }

  /** True when no consumer needs the source. */
  get isEmpty(): boolean {
    return this.#byConsumer.size === 0;
  }

  /** Component-wise maximum over all consumers, or null when nobody needs the source. */
  effective(): DesiredSize | null {
    if (this.#byConsumer.size === 0) {
      return null;
    }
    let width = 0;
    let height = 0;
    for (const size of this.#byConsumer.values()) {
      width = Math.max(width, size.width);
      height = Math.max(height, size.height);
    }
    return { width, height };
  }
}
