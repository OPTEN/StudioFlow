import { t } from '@studioflow/i18n';
import type { OutputAudio } from './output-audio';

/** Events a browser accepts as a user gesture for starting the sound. */
const GESTURE_EVENTS = ['click', 'keydown', 'touchend', 'pointerup'] as const;

/**
 * The “Sound on” button of the output page. It is in the document only while the browser blocks the sound and some channel could
 * be heard; a click on it – or any click, key or touch on the page – starts the audio context, and the button goes away.
 * OBS with “Control audio via OBS” and a frame with `allow="autoplay"` never show it. Returns the function that removes it.
 */
export function mountSoundButton(doc: Document, audio: OutputAudio): () => void {
  // The button exists only while it is needed: the page of the audience has no control at all otherwise (E2E-OUT-01).
  let button: HTMLButtonElement | null = null;
  const show = (needed: boolean): void => {
    if (needed && button === null) {
      button = doc.createElement('button');
      button.type = 'button';
      button.className = 'c-sound-on';
      button.textContent = t('output.audio.soundOn');
      button.title = t('output.audio.soundOnHint');
      doc.body.append(button);
    } else if (!needed && button !== null) {
      button.remove();
      button = null;
    }
  };
  show(audio.needsGesture);
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
    show(false);
  };
}
