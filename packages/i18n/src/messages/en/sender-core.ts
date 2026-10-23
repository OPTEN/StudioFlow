import type { Namespace } from '../../types';

/** Texts of the sender's shared services: the suggested name of a new device. */
export const senderCore = {
  'sender.core.deviceName.laptop': 'Laptop',
  'sender.core.deviceName.phone': 'Phone',
} as const satisfies Namespace<'sender.core'>;
