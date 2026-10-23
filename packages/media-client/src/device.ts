/**
 * `@studioflow/media-client/device`: the livekit-free part of the package – device facts (platform label, phone
 * detection, screen-share capability, battery, network type), the screen wake lock, the technical check and the slot
 * failure codes. Pages that do not publish (the sender's pairing screens) import this entry, so they do not load
 * livekit-client (~150 KB gzip). The main entry re-exports everything here.
 */
export { battery, canShareScreen, isLikelyPhone, networkType, platformLabel } from './device-info';
export { type SlotFailure, type SlotMessageKey, type SlotProblem } from './slot-failure';
export {
  TECH_CHECK,
  runTechCheck,
  techProblemText,
  type TechCheckOptions,
  type TechCheckResult,
  type TechProblem,
} from './tech-check';
export { ScreenWakeLock, type WakeLockEnvironment } from './wake-lock';
