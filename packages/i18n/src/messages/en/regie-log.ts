import type { Namespace } from '../../types';

/**
 * "Recent events". One message per `LogCode` of the API (`regie.log.<code>`); the parameters are the ones the API sends
 * in `LogEntryDto.params`, except `{downtime}` of `sourceRecovered`, which the client formats from `downSeconds`.
 */
export const regieLog = {
  'regie.log.assetDeleted': '{code} “{name}” deleted',
  'regie.log.assetUploaded': '{code} “{name}” uploaded',
  'regie.log.broadcastEnded': 'Broadcast ended',
  'regie.log.broadcastStarted': 'Broadcast started',
  'regie.log.cameraEnded': '{code} camera stopped',
  'regie.log.deviceBlocked': '{subject} blocked',
  'regie.log.devicePaired': '{subject} paired',
  'regie.log.deviceRemoved': '{subject} removed',
  'regie.log.deviceUnblocked': '{subject} unblocked',
  'regie.log.inviteLinkCreated': 'Invite link created',
  'regie.log.inviteLinkRevoked': 'Invite link revoked',
  'regie.log.outputAccessChanged': 'Output access changed',
  'regie.log.outputLinkRegenerated': 'Output link regenerated',
  'regie.log.pairingDenied': 'Request from {name} denied',
  'regie.log.sceneCreated': 'Scene “{scene}” created',
  'regie.log.sceneDeleted': 'Scene “{scene}” deleted',
  'regie.log.sceneLive': 'Scene “{scene}” is live',
  'regie.log.screenEnded': '{code} sharing stopped',
  'regie.log.sourceLost': '{code} no picture',
  'regie.log.sourceReconnecting': '{code} reconnecting',
  'regie.log.sourceRecovered': '{code} is back, was gone for {downtime}',
} as const satisfies Namespace<'regie.log'>;
