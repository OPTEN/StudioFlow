/**
 * Default camera / screen capture of the {@link Publisher}. The explanations of capture failures (codes and message
 * keys) are in `slot-failure.ts`, which does not load livekit-client.
 */
import {
  LocalAudioTrack,
  LocalVideoTrack,
  createLocalAudioTrack,
  createLocalScreenTracks,
  createLocalVideoTrack,
  type AudioCaptureOptions,
  type ScreenShareCaptureOptions,
  type VideoCaptureOptions,
} from 'livekit-client';

/** What one screen capture delivers: the picture and, if the user shared sound, the audio. */
export interface ScreenCapture {
  readonly video: LocalVideoTrack;
  readonly audio: LocalAudioTrack | null;
}

/** Microphone capture with livekit's `createLocalAudioTrack`. */
export function captureMic(options: AudioCaptureOptions): Promise<LocalAudioTrack> {
  return createLocalAudioTrack(options);
}

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
export async function captureScreen(options: ScreenShareCaptureOptions): Promise<ScreenCapture> {
  const tracks = await createLocalScreenTracks(options);
  const video = tracks.find((track): track is LocalVideoTrack => track instanceof LocalVideoTrack);
  const audio =
    options.audio === false || options.audio === undefined
      ? undefined
      : tracks.find((track): track is LocalAudioTrack => track instanceof LocalAudioTrack);
  for (const track of tracks) {
    if (track !== video && track !== audio) {
      track.stop();
    }
  }
  if (video === undefined) {
    throw new Error('getDisplayMedia returned no video track');
  }
  return { video, audio: audio ?? null };
}

/** Sets the encoder content hint; unsupported in Firefox, where it is silently skipped. */
export function setContentHint(track: MediaStreamTrack, hint: 'motion' | 'detail'): void {
  try {
    track.contentHint = hint;
  } catch {
    // Only an encoder hint: nothing to do where the browser rejects it.
  }
}
