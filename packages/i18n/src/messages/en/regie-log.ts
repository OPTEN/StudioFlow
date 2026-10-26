import type { Namespace } from '../../types';

/**
 * "Recent events" and the audit log. One message per `LogCode` of the API (`regie.log.<code>`); the parameters are the
 * ones the API sends in `LogEntryDto.params`, except `{downtime}` of `sourceRecovered`, which the client formats from
 * `downSeconds`, and `{lens}` of `cameraLensSwitched`, which the client names from the lens kind.
 */
export const regieLog = {
  'regie.log.accountReset': 'Account reset',
  'regie.log.accountSetUp': 'Account set up',
  'regie.log.assetDeleted': '{code} “{name}” deleted',
  'regie.log.assetUploaded': '{code} “{name}” uploaded',
  'regie.log.auditExported': 'Audit log exported as {format}, {rows} rows',
  'regie.log.auditRetention':
    'Audit retention ({days} days): entries deleted {deleted}, IP addresses removed {anonymised}',
  'regie.log.broadcastEnded': 'Broadcast ended',
  'regie.log.broadcastReset': 'Broadcast reset',
  'regie.log.broadcastStarted': 'Broadcast started',
  'regie.log.cameraEnded': '{code} camera stopped',
  'regie.log.cameraLensSwitched': '{subject}: lens switched to {lens}',
  'regie.log.deviceBlocked': '{subject} blocked',
  'regie.log.devicePaired': '{subject} paired',
  'regie.log.deviceRemoved': '{subject} removed',
  'regie.log.deviceRenamed': '{subject} renamed to “{name}”',
  'regie.log.deviceUnblocked': '{subject} unblocked',
  'regie.log.endSlateChanged': 'Slate after the broadcast changed',
  'regie.log.incidentAcknowledged': '{code} message marked as seen',
  'regie.log.inviteLinkCreated': 'Invite link created',
  'regie.log.inviteLinkRevoked': 'Invite link revoked',
  'regie.log.lensOther': 'Other',
  'regie.log.loggedOut': '“{username}” signed out',
  'regie.log.loginFailed': 'Sign-in failed for “{username}”',
  'regie.log.loginLocked': 'Sign-in locked after too many failed attempts',
  'regie.log.loginSucceeded': '“{username}” signed in',
  'regie.log.outputAccessChanged': 'Output access changed',
  'regie.log.outputLinkRegenerated': 'Output link regenerated',
  'regie.log.pairingDenied': 'Request from {name} denied',
  'regie.log.passwordChanged': 'Password changed',
  'regie.log.productionActivated': 'Production “{name}” activated',
  'regie.log.productionCreated': 'Production “{name}” created',
  'regie.log.productionRenamed': 'Production “{from}” renamed to “{name}”',
  'regie.log.sceneCreated': 'Scene “{scene}” created',
  'regie.log.sceneDeleted': 'Scene “{scene}” deleted',
  'regie.log.sceneLive': 'Scene “{scene}” is live',
  'regie.log.screenEnded': '{code} sharing stopped',
  'regie.log.sourceLost': '{code} no picture',
  'regie.log.sourceReconnecting': '{code} reconnecting',
  'regie.log.sourceRecovered': '{code} is back, was gone for {downtime}',
  'regie.log.standbySlateChanged': 'Slate before the broadcast changed',
  'regie.log.textCreated': '{code} “{name}” created',
  'regie.log.textDeleted': '{code} “{name}” deleted',
  'regie.log.textHidden': '{code} hidden',
  'regie.log.textShown': '{code} shown',
} as const satisfies Namespace<'regie.log'>;
