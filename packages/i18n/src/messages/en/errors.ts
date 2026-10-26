import type { Namespace } from '../../types';

/**
 * What the user reads when a call to the API fails. The API sends a stable `code` (and English texts for diagnostics
 * only); the clients show these messages instead. `errors.code.*` is keyed by the code, `errors.status.*` by the
 * HTTP status when the body has no known code, `errors.device.*` is the wording for phones and laptops (sender).
 */
export const errors = {
  'errors.code.validation_failed': 'The input is not valid.',
  'errors.code.not_found': 'That no longer exists. It may have been deleted in the meantime.',
  'errors.code.broadcast_live':
    'That is not possible while the broadcast is live. End the broadcast first.',
  'errors.code.transition_running': 'A fade is still running. Please wait a moment.',
  'errors.code.scene_is_live': 'The live scene cannot be deleted.',
  'errors.code.asset_in_use': 'The file is still in use and cannot be deleted.',
  'errors.code.unsupported_media':
    'This file type is not allowed. Allowed are PNG, JPEG, WebP, MP4 and WebM.',
  'errors.code.pairing_expired': 'The request has expired or was already answered.',
  'errors.code.rate_limited': 'Too many attempts. Please try again later.',
  'errors.code.device_blocked': 'The device is blocked.',
  'errors.code.conflict': 'That is not possible right now because the state has changed.',
  'errors.code.limit_reached': 'The limit has been reached.',
  'errors.code.unauthorized': 'Your session has expired. Please sign in again.',
  'errors.code.forbidden': 'You do not have permission for that.',
  'errors.code.request_timeout': 'The server did not respond in time. Please try again.',
  'errors.code.internal_error': 'A server error occurred. Please try again.',
  'errors.code.service_unavailable':
    'The server is not reachable right now. Please try again shortly.',
  'errors.code.setup_code_invalid':
    'The setup code is not correct. After a restart the server shows a new one.',
  'errors.code.setup_closed': 'The first-run setup is already complete. Please sign in.',
  'errors.code.password_incorrect': 'The current password is not correct.',
  'errors.code.invalid_archive':
    'This file is not a valid StudioFlow export, or it is damaged. Nothing was imported.',
  'errors.code.unsupported_format':
    'This file was exported by a newer version of StudioFlow. Update this installation first. Nothing was imported.',
  'errors.code.archive_too_large':
    'This file is larger than this installation accepts. Nothing was imported.',
  'errors.code.network': 'No connection to the server. Please try again.',
  'errors.code.aborted': 'Cancelled.',

  'errors.status.413': 'The file is too large. Images may be at most 25 MB, videos at most 1 GB.',
  'errors.status.unknown': 'That did not work (error {status}).',

  'errors.rateLimited.wait': {
    one: 'Too many attempts. Please try again in {count} minute.',
    other: 'Too many attempts. Please try again in {count} minutes.',
  },

  'errors.device.network': 'The server is not reachable. Please check the Wi-Fi.',
  'errors.device.timeout': 'The server is not answering. Please check the Wi-Fi.',
  'errors.device.unauthorized': 'This device is no longer paired.',
  'errors.device.blocked': 'This device is blocked. The control room can unblock it.',
  'errors.device.forbidden': 'No access.',
  'errors.device.notFound': 'Not found.',
  'errors.device.expired': 'This invite has expired or was already used.',
  'errors.device.conflict': 'That is not possible right now.',
  'errors.device.limit': 'The limit has been reached.',
  'errors.device.invalid': 'The input is not valid.',
  'errors.device.tooLarge': 'The data is too large.',
  'errors.device.server': 'The server reported an error. Please try again in a moment.',
  'errors.device.unavailable':
    'The server is not reachable right now. Please try again in a moment.',
  'errors.device.rateLimitedLater': 'Too many attempts. Please try again later.',
  'errors.device.rateLimitedSeconds': {
    one: 'Too many attempts. Please try again in {count} second.',
    other: 'Too many attempts. Please try again in {count} seconds.',
  },
  'errors.device.rateLimitedMinutes': {
    one: 'Too many attempts. Please try again in {count} minute.',
    other: 'Too many attempts. Please try again in {count} minutes.',
  },
} as const satisfies Namespace<'errors'>;
