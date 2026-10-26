import { t } from '@studioflow/i18n';
import type { OutputAudio } from './output-audio';

/** Events a browser accepts as a user gesture for starting the sound. */
const GESTURE_EVENTS = ['click', 'keydown', 'touchend', 'pointerup'] as const;

/**
 * The “Sound on” button of the output page. It is only there while the browser blocks the sound and some channel could
 * be heard; a click on it – or any click, key or touch on the page – starts the audio context, and the button goes away.
 * OBS with “Control audio via OBS” and a frame with `allow="autoplay"` never show it. Returns the function that removes it.
 */
export function mountSoundButton(doc: Document, audio: OutputAudio): () => void {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'c-sound-on';
  button.textContent = t('output.audio.soundOn');
  button.title = t('output.audio.soundOnHint');
  const show = (needed: boolean): void => {
    button.hidden = !needed;
  };
  show(audio.needsGesture);
  doc.body.append(button);
  const start = (): void => {
    if (audio.state === 'blocked') {
      void audio.resume();
    }
  };
  for (const event of GESTURE_EVENTS) {
    doc.addEventListener(event, start, { capture: true, passive: true });
  }
  const unsubscribe = audio.onNeedsGestureChange(show);
  return () => {
    unsubscribe();
    for (const event of GESTURE_EVENTS) {
      doc.removeEventListener(event, start, { capture: true });
    }
    button.remove();
  };
}
