import type { Translation } from '../../types';
import type { senderNotices as en } from '../en/sender-notices';

export const senderNotices: Translation<typeof en> = {
  'sender.notices.deviceRemoved':
    'Die Regie hat dieses Gerät entfernt. Du kannst es hier neu koppeln.',
};
