import type { Namespace } from '../../types';

/**
 * Why a camera or screen share slot failed, by the stable `SlotFailure` code of `@studioflow/media-client`
 * (``t(`media.slot.failure.${failure}`)``), plus the two messages that have no failure code. The microphone has its
 * own texts (``t(`media.slot.mic.${failure}`)``): the camera ones talk about a picture.
 */
export const mediaSlot = {
  'media.slot.cameraSwitchFailed': 'Switching the camera failed.',
  'media.slot.failure.cancelled': 'Sharing cancelled',
  'media.slot.failure.in-use': 'The camera is not available. Is another app using it?',
  'media.slot.failure.needs-gesture': 'Please start sharing directly with a click.',
  'media.slot.failure.not-found': 'No camera found.',
  'media.slot.failure.not-supported': 'This browser cannot share the screen.',
  'media.slot.failure.permission-denied':
    'No access to the camera. Please allow access in the browser.',
  'media.slot.failure.publish-failed': 'The picture could not be sent.',
  'media.slot.failure.track-lost': 'The camera no longer delivers a picture.',
  'media.slot.failure.unknown': 'The screen could not be shared.',
  'media.slot.mic.ended': 'The microphone was disconnected.',
  'media.slot.mic.in-use': 'The microphone is not available. Is another app using it?',
  'media.slot.mic.not-found': 'No microphone found.',
  'media.slot.mic.permission-denied':
    'No access to the microphone. Please allow access in the browser.',
  'media.slot.mic.publish-failed': 'The sound could not be sent.',
  'media.slot.mic.track-lost': 'The microphone no longer delivers sound.',
  'media.slot.shareEnded': 'Sharing ended',
} as const satisfies Namespace<'media.slot'>;
