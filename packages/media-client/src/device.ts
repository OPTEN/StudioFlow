/**
 * `@studioflow/media-client/device`: the livekit-free part of the package – device facts (platform label, phone
 * detection, screen-share capability, battery, network type), the screen wake lock, the technical check, the slot
 * failure codes, the rules of the remote camera control (shared with the Regie) and the Web Audio mix of the output page
 * and the Regie. Pages that do not publish (the
 * sender's pairing screens) import this entry, so they do not load livekit-client (~150 KB gzip). The main entry
 * re-exports everything here.
 */
export {
  CAMERA_PROTOCOL_VERSION,
  clampToRange,
  isCameraControl,
  mergeCameraControl,
  type CameraImageSettings,
  type CameraProblem,
} from './camera-control';
export { battery, canShareScreen, isLikelyPhone, networkType, platformLabel } from './device-info';
export {
  type MicFailure,
  type SlotFailure,
  type SlotMessageKey,
  type SlotProblem,
} from './slot-failure';
export {
  TECH_CHECK,
  runTechCheck,
  techProblemText,
  type TechCheckOptions,
  type TechCheckResult,
  type TechProblem,
} from './tech-check';
export { ScreenWakeLock, type WakeLockEnvironment } from './wake-lock';
export {
  ANALYSER_FFT_SIZE,
  AudioGraph,
  SILENCE_DB,
  StreamLevelMeter,
  analyserPeakDb,
  levelBuffer,
  peakDb,
  rampCurve,
  rampParam,
  type ApplyOptions,
  type AudioGraphOptions,
  type AudioGraphState,
  type GraphLevels,
  type MonitorSelection,
  type RampCurve,
} from './audio';
