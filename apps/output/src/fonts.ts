/** Fonts of the slates and the hold message (renderer) – preloaded by index.html. */
export const UI_FONT_PROBE = '600 72px "Sofia Sans Semi Condensed"';
/** Font of the measurement clock and the debug overlay. */
export const MONO_FONT_PROBE = '500 64px "JetBrains Mono"';
/** Longest wait for a font before rendering anyway (the files are local, this only guards a broken load). */
export const FONT_WAIT_MS = 1000;

/**
 * Resolves when the fonts are loaded or after `timeoutMs`, whichever comes first; never rejects. Rendering the first
 * slate after this avoids a visible swap from the fallback font (no reflow of the first slate).
 */
export function whenFontsReady(
  doc: Document,
  probes: readonly string[],
  timeoutMs = FONT_WAIT_MS,
): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof fonts.load !== 'function') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    Promise.all(probes.map((probe) => fonts.load(probe))).then(done, done);
  });
}
