/**
 * UI test fixtures (page objects and helpers) for the Regie, the sender, the output page and the pairing flow.
 * Overview and conventions: tests/e2e/README.md, "UI fixtures".
 */
export { expectNoSeriousViolations, runAxe, type AxeOptions, type AxeSummary } from './a11y';
export { CdpCounters, growth, slopePerMinute, type CounterGrowth, type Counters } from './counters';
export { watchPage, type PageProblems } from './diagnostics';
export {
  EMBED_ORIGIN,
  FOREIGN_ORIGIN,
  PROFILE_FACTS,
  SCREEN_COLORS,
  TEST_HOOKS_KEY,
  installUiInit,
  newUiContext,
  openTimecodeTab,
  profileOptions,
  serveFakeOrigin,
  type DeviceProfile,
  type FakeScreenOptions,
  type FakeSourceOptions,
  type NewUiContextOptions,
  type UiInitOptions,
} from './init';
export {
  OutputPage,
  latencyStats,
  outputPath,
  type EmbedOptions,
  type LatencySample,
  type LatencyStats,
  type OutputFlags,
  type OutputTarget,
} from './output';
export { pairLaptopViaKnock, pairPhoneViaQr, pairViaApi, type UiPairedDevice } from './pairing';
export {
  PixelImage,
  colorsClose,
  decodeQr,
  luma,
  parseHex,
  upscale,
  type Rect,
  type Rgba,
} from './pixels';
export { RegiePage, escapeRegExp, type PairingTab, type StudioHooks } from './regie';
export {
  LaptopSender,
  PhoneSender,
  SenderPage,
  describeDevice,
  type SenderConnection,
  type SenderHooks,
  type SlotState,
  type StoredDevice,
  type Tally,
} from './sender';
export {
  describeLatency,
  installStampCamera,
  stampCameraInit,
  type StampCameraOptions,
} from './stamp-camera';
export {
  expectVideoFrozen,
  expectVideoPlaying,
  measureVideo,
  type VideoMeasurement,
} from './video';
