import { tm, type MessageKey } from '@studioflow/i18n';
import type { LogCode, LogEntryDto } from './contracts';
import { formatDowntime } from './format';

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
} as const satisfies Record<LogCode, MessageKey>;

/**
 * The text of a log entry in the active language: the message of its code with the parameters the API sent. The
 * downtime of a recovered source is formatted here from `downSeconds`. An entry whose code this client does not know
 * (the API is newer) falls back to the English text the API sent.
 */
export function logEntryText(entry: LogEntryDto): string {
  const key = (LOG_MESSAGE_KEYS as Readonly<Record<string, MessageKey | undefined>>)[entry.code];
  if (key === undefined) {
    return entry.text;
  }
  const params: Record<string, string> = { ...entry.params };
  if (entry.code === 'sourceRecovered') {
    params['downtime'] = formatDowntime(Number(entry.params['downSeconds']));
  }
  return tm({ key, params });
}
