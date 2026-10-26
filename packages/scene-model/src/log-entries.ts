import { tm, type MessageKey } from '@studioflow/i18n';
import type { AudioMode, CameraLensKind, LogCode, LogEntryDto } from './contracts';
import { formatDb, formatDowntime } from './format';

/**
 * The message of each log code (`regie.log.<code>`). The `satisfies` makes the compiler demand a message for every
 * code the API knows, so a new `LogCode` cannot reach the Regie without a text.
 */
export const LOG_MESSAGE_KEYS = {
  sceneLive: 'regie.log.sceneLive',
  sceneCreated: 'regie.log.sceneCreated',
  sceneDeleted: 'regie.log.sceneDeleted',
  broadcastStarted: 'regie.log.broadcastStarted',
  broadcastEnded: 'regie.log.broadcastEnded',
  devicePaired: 'regie.log.devicePaired',
  deviceBlocked: 'regie.log.deviceBlocked',
  deviceUnblocked: 'regie.log.deviceUnblocked',
  deviceRemoved: 'regie.log.deviceRemoved',
  pairingDenied: 'regie.log.pairingDenied',
  inviteLinkCreated: 'regie.log.inviteLinkCreated',
  inviteLinkRevoked: 'regie.log.inviteLinkRevoked',
  outputLinkCreated: 'regie.log.outputLinkCreated',
  outputLinkRenamed: 'regie.log.outputLinkRenamed',
  outputLinkRevoked: 'regie.log.outputLinkRevoked',
  outputLinkRegenerated: 'regie.log.outputLinkRegenerated',
  outputAccessChanged: 'regie.log.outputAccessChanged',
  assetUploaded: 'regie.log.assetUploaded',
  assetDeleted: 'regie.log.assetDeleted',
  sourceReconnecting: 'regie.log.sourceReconnecting',
  cameraEnded: 'regie.log.cameraEnded',
  screenEnded: 'regie.log.screenEnded',
  sourceLost: 'regie.log.sourceLost',
  sourceRecovered: 'regie.log.sourceRecovered',
  accountSetUp: 'regie.log.accountSetUp',
  passwordChanged: 'regie.log.passwordChanged',
  accountReset: 'regie.log.accountReset',
  textCreated: 'regie.log.textCreated',
  textDeleted: 'regie.log.textDeleted',
  textShown: 'regie.log.textShown',
  textHidden: 'regie.log.textHidden',
  loginSucceeded: 'regie.log.loginSucceeded',
  loginFailed: 'regie.log.loginFailed',
  loginLocked: 'regie.log.loginLocked',
  loggedOut: 'regie.log.loggedOut',
  productionCreated: 'regie.log.productionCreated',
  productionRenamed: 'regie.log.productionRenamed',
  canvasChanged: 'regie.log.canvasChanged',
  productionDuplicated: 'regie.log.productionDuplicated',
  productionExported: 'regie.log.productionExported',
  productionImported: 'regie.log.productionImported',
  placeholderAssigned: 'regie.log.placeholderAssigned',
  placeholderRemoved: 'regie.log.placeholderRemoved',
  productionActivated: 'regie.log.productionActivated',
  broadcastReset: 'regie.log.broadcastReset',
  standbySlateChanged: 'regie.log.standbySlateChanged',
  endSlateChanged: 'regie.log.endSlateChanged',
  incidentAcknowledged: 'regie.log.incidentAcknowledged',
  deviceRenamed: 'regie.log.deviceRenamed',
  cameraLensSwitched: 'regie.log.cameraLensSwitched',
  auditExported: 'regie.log.auditExported',
  auditRetention: 'regie.log.auditRetention',
  settingsMediaChanged: 'regie.log.settingsMediaChanged',
  settingsAddressChanged: 'regie.log.settingsAddressChanged',
  settingsEmbeddingChanged: 'regie.log.settingsEmbeddingChanged',
  settingsBackupChanged: 'regie.log.settingsBackupChanged',
  backupRequested: 'regie.log.backupRequested',
  audioEnded: 'regie.log.audioEnded',
  audioLost: 'regie.log.audioLost',
  audioMuted: 'regie.log.audioMuted',
  audioUnmuted: 'regie.log.audioUnmuted',
  audioGainChanged: 'regie.log.audioGainChanged',
  audioModeChanged: 'regie.log.audioModeChanged',
  audioSyncOffsetChanged: 'regie.log.audioSyncOffsetChanged',
} as const satisfies Record<LogCode, MessageKey>;

/** The name of a mode in `audioModeChanged`, by the mode the API sends in `value`. */
const AUDIO_MODE_NAME_KEYS = {
  always: 'regie.log.audioModeAlways',
  follow: 'regie.log.audioModeFollow',
  off: 'regie.log.audioModeOff',
} as const satisfies Record<AudioMode, MessageKey>;

/** The name of a lens in `cameraLensSwitched`, by the kind the API sends in `lens` (the names of the camera panel). */
const LENS_NAME_KEYS = {
  front: 'regie.camera.lens.front',
  ultraWide: 'regie.camera.lens.ultraWide',
  standard: 'regie.camera.lens.standard',
  tele: 'regie.camera.lens.tele',
  other: 'regie.log.lensOther',
} as const satisfies Record<CameraLensKind, MessageKey>;

/** What {@link logEntryText} needs of an entry: "Recent events" and the audit log both have it. */
export type LogText = Pick<LogEntryDto, 'params' | 'text'> & { readonly code: LogCode | null };

/**
 * The text of a log entry in the active language: the message of its code with the parameters the API sent. The
 * downtime of a recovered source is formatted here from `downSeconds`, the lens of a lens switch is named here. An
 * entry whose code this client does not know (the API is newer) or that has none falls back to the English text the
 * API sent.
 */
export function logEntryText(entry: LogText): string {
  const key = (LOG_MESSAGE_KEYS as Readonly<Record<string, MessageKey | undefined>>)[
    entry.code ?? ''
  ];
  if (key === undefined) {
    return entry.text;
  }
  const params: Record<string, string> = { ...entry.params };
  if (entry.code === 'sourceRecovered') {
    params['downtime'] = formatDowntime(Number(entry.params['downSeconds']));
  }
  if (entry.code === 'audioGainChanged') {
    params['value'] = formatDb(Number(entry.params['value']));
  }
  if (entry.code === 'audioModeChanged') {
    const modeKey = (AUDIO_MODE_NAME_KEYS as Readonly<Record<string, MessageKey | undefined>>)[
      entry.params['value'] ?? ''
    ];
    params['value'] = modeKey === undefined ? (entry.params['value'] ?? '') : tm({ key: modeKey });
  }
  if (entry.code === 'cameraLensSwitched') {
    const lensKey = (LENS_NAME_KEYS as Readonly<Record<string, MessageKey | undefined>>)[
      entry.params['lens'] ?? ''
    ];
    params['lens'] = lensKey === undefined ? (entry.params['lens'] ?? '') : tm({ key: lensKey });
  }
  return tm({ key, params });
}
