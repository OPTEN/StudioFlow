/**
 * Wire contracts shared by the Regie, the sender and the output page.
 *
 * All types come from `./generated/api.ts`, which is generated from the OpenAPI document of the ASP.NET Core API
 * (`npm run gen:contracts`). Never edit the generated file by hand; change the C# contracts in
 * `apps/api/src/Opten.StudioFlow.Core/Contracts` instead and regenerate.
 */
import type * as Api from './generated/api';

export type { components, operations, paths } from './generated/api';

export type {
  AddSceneItemRequest,
  AllocateSlotRequest,
  AssetDto,
  AssetKind,
  AssignPlaceholderRequest,
  AuditCategory,
  AuditEntryDto,
  AuditPageDto,
  BandwidthTestResultDto,
  BorderDto,
  BroadcastState,
  CameraCapabilitiesDto,
  CameraControlDto,
  CameraFocusMode,
  CameraLensDto,
  CameraLensKind,
  CameraRangeDto,
  CameraSettingsDto,
  CameraStateDto,
  CanvasDto,
  CanvasFormat,
  CanvasResolution,
  ChangeCanvasRequest,
  ChangePasswordRequest,
  CreateInviteRequest,
  CreatePairingRequest,
  CreateProductionRequest,
  CreateSceneRequest,
  CreateTextSourceRequest,
  CropDto,
  DeviceCommandDto,
  DeviceCommandKind,
  DeviceCommandRequest,
  DeviceConnection,
  DeviceCredentialsDto,
  DeviceDto,
  DeviceHelloDto,
  DeviceKind,
  DeviceReportDto,
  DeviceSelfDto,
  DeviceSessionDto,
  DeviceSlotDto,
  DeviceState,
  DeviceTelemetryDto,
  DeviceTelemetryMessage,
  DuplicateProductionRequest,
  HttpValidationProblemDetails,
  ImportPlaceholderDto,
  ImportPreviewDto,
  ImportWarningCode,
  ImportWarningDto,
  IncidentDto,
  IncidentKind,
  InviteDto,
  InviteKind,
  ItemFit,
  LiveKitTokenDto,
  LogCode,
  LogEntryDto,
  LoginRequest,
  LostBehaviorDto,
  OutputChangesDto,
  OutputLinkDto,
  OutputLinkStatusDto,
  OutputReport,
  OutputSettingsDto,
  OutputSnapshot,
  OutputState,
  OutputStatusDto,
  PairingMethod,
  PlaceholderChangeDto,
  PairingRequestCreatedDto,
  PairingRequestDto,
  PairingRequestStatus,
  PairingRequestStatusDto,
  ProblemDetails,
  ProductionChangesDto,
  ProductionDto,
  ProductionEvent,
  ProductionSnapshot,
  ProductionSummaryDto,
  RedeemInviteRequest,
  RenameAssetRequest,
  RenameDeviceRequest,
  ReorderScenesRequest,
  ReplaceSceneItemsRequest,
  RtcState,
  SceneBackgroundDto,
  SceneDto,
  SceneItemDto,
  SceneLayoutMode,
  SessionDto,
  SetPreviewRequest,
  SetupRequest,
  SetupStatusDto,
  SlateDto,
  SlotState,
  SlotTelemetryDto,
  SourcePlaceholderDto,
  SourceDto,
  SourceKind,
  SourceStatus,
  SwitchProgramRequest,
  SystemInfoDto,
  TakeRequest,
  TallyDto,
  TallyState,
  TechCheckDto,
  TechCheckLevel,
  TextAlign,
  TextSourceDto,
  TextStyle,
  TextThemeDto,
  TransitionDto,
  TransitionKind,
  UpdateOutputAccessRequest,
  UpdateProductionRequest,
  UpdateSceneRequest,
  UpdateTextSourceRequest,
} from './generated/api';

/** Event subtypes under their short names (the generator prefixes them with `ProductionEvent`). */
export type ProductionChangedEvent = Api.ProductionEventProductionChangedEvent;
export type ProductionCanvasChangedEvent = Api.ProductionEventProductionCanvasChangedEvent;
export type ProgramSwitchedEvent = Api.ProductionEventProgramSwitchedEvent;
export type SceneUpsertedEvent = Api.ProductionEventSceneUpsertedEvent;
export type SceneRemovedEvent = Api.ProductionEventSceneRemovedEvent;
export type ScenesReorderedEvent = Api.ProductionEventScenesReorderedEvent;
export type SourceUpsertedEvent = Api.ProductionEventSourceUpsertedEvent;
export type SourceRemovedEvent = Api.ProductionEventSourceRemovedEvent;
export type PlaceholderRemovedEvent = Api.ProductionEventPlaceholderRemovedEvent;
export type DeviceUpsertedEvent = Api.ProductionEventDeviceUpsertedEvent;
export type DeviceRemovedEvent = Api.ProductionEventDeviceRemovedEvent;
export type AssetUpsertedEvent = Api.ProductionEventAssetUpsertedEvent;
export type AssetRemovedEvent = Api.ProductionEventAssetRemovedEvent;
export type PairingRequestUpsertedEvent = Api.ProductionEventPairingRequestUpsertedEvent;
export type PairingRequestRemovedEvent = Api.ProductionEventPairingRequestRemovedEvent;
export type InviteUpsertedEvent = Api.ProductionEventInviteUpsertedEvent;
export type InviteRemovedEvent = Api.ProductionEventInviteRemovedEvent;
export type IncidentUpsertedEvent = Api.ProductionEventIncidentUpsertedEvent;
export type IncidentRemovedEvent = Api.ProductionEventIncidentRemovedEvent;
export type OutputStatusChangedEvent = Api.ProductionEventOutputStatusChangedEvent;
export type LogAppendedEvent = Api.ProductionEventLogAppendedEvent;
export type RevisionOnlyEvent = Api.ProductionEventRevisionOnlyEvent;

/** Discriminator values of {@link Api.ProductionEvent}. */
export type ProductionEventType = Api.ProductionEvent['type'];

/** Narrows the event union to one discriminator value. */
export type EventOfType<T extends ProductionEventType> = Extract<Api.ProductionEvent, { type: T }>;

/**
 * SignalR hub paths and method names. Mirrors `HubMethods` in
 * `apps/api/src/Opten.StudioFlow.Core/Contracts/HubContracts.cs`.
 */
export const HUB = {
  studioPath: '/hubs/studio',
  devicePath: '/hubs/device',
  outputPath: '/hubs/output',
  /** server → client */
  resync: 'resync',
  event: 'event',
  telemetry: 'telemetry',
  presence: 'presence',
  tally: 'tally',
  command: 'command',
  self: 'self',
  sessionReplaced: 'sessionReplaced',
  /** client → server */
  subscribe: 'Subscribe',
  subscribeOutput: 'SubscribeOutput',
  hello: 'Hello',
  report: 'Report',
} as const;

/** Machine readable error codes in `ProblemDetails.code`. Mirrors `ErrorCodes` in the C# contracts. */
export const ERROR_CODES = {
  validationFailed: 'validation_failed',
  notFound: 'not_found',
  broadcastLive: 'broadcast_live',
  transitionRunning: 'transition_running',
  sceneIsLive: 'scene_is_live',
  assetInUse: 'asset_in_use',
  unsupportedMedia: 'unsupported_media',
  pairingExpired: 'pairing_expired',
  rateLimited: 'rate_limited',
  deviceBlocked: 'device_blocked',
  conflict: 'conflict',
  limitReached: 'limit_reached',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  requestTimeout: 'request_timeout',
  internalError: 'internal_error',
  serviceUnavailable: 'service_unavailable',
  setupCodeInvalid: 'setup_code_invalid',
  setupClosed: 'setup_closed',
  passwordIncorrect: 'password_incorrect',
  invalidArchive: 'invalid_archive',
  unsupportedFormat: 'unsupported_format',
  archiveTooLarge: 'archive_too_large',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Reasons in the field errors (`errors`) of a `validation_failed` answer to the first-run setup and the password change.
 * Mirrors `FieldErrorCodes` in the C# contracts.
 */
export const FIELD_ERROR_CODES = {
  usernameInvalid: 'username_invalid',
  passwordTooShort: 'password_too_short',
  passwordTooLong: 'password_too_long',
  passwordEqualsUsername: 'password_equals_username',
  passwordTooCommon: 'password_too_common',
} as const;

export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[keyof typeof FIELD_ERROR_CODES];
