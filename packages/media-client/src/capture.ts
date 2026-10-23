/**
 * Default camera / screen capture of the {@link Publisher}. The explanations of capture failures (codes and message
 * keys) are in `slot-failure.ts`, which does not load livekit-client.
 */
import {
  LocalVideoTrack,
  createLocalScreenTracks,
  createLocalVideoTrack,
  type ScreenShareCaptureOptions,
  type VideoCaptureOptions,
} from 'livekit-client';

/** Camera capture with livekit's `createLocalVideoTrack` (the SDK then restarts an ended camera by itself). */
export function captureCamera(options: VideoCaptureOptions): Promise<LocalVideoTrack> {
  return createLocalVideoTrack(options);
}

/**
 * Screen capture with the standalone `createLocalScreenTracks` instead of `room.localParticipant.createScreenTracks`:
 * both run the same getDisplayMedia code, but the standalone one needs no room, so a share can start while the
 * session is rejoining. Its only difference – it ignores `contentHint` – is compensated by the publisher setting the
 * hint itself. getDisplayMedia is called synchronously (no await before it), preserving the user gesture.
 */
export async function captureScreen(options: ScreenShareCaptureOptions): Promise<LocalVideoTrack> {
  const tracks = await createLocalScreenTracks(options);
  const video = tracks.find((track): track is LocalVideoTrack => track instanceof LocalVideoTrack);
  for (const track of tracks) {
    if (track !== video) {
      track.stop();
    }
  }
  if (video === undefined) {
    throw new Error('getDisplayMedia returned no video track');
  }
  return video;
}

/** Sets the encoder content hint; unsupported in Firefox, where it is silently skipped. */
export function setContentHint(track: MediaStreamTrack, hint: 'motion' | 'detail'): void {
  try {
    track.contentHint = hint;
  } catch {
    // Only an encoder hint: nothing to do where the browser rejects it.
  }
}
