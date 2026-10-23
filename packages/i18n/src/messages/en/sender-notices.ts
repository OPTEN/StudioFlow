import type { Namespace } from '../../types';

/** One-time notices that one screen of the sender hands to the next (shown above the pairing form). */
export const senderNotices = {
  'sender.notices.deviceRemoved':
    'The control room has removed this device. You can pair it again here.',
} as const satisfies Namespace<'sender.notices'>;
