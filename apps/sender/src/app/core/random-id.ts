const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random lowercase id of `length` characters from `crypto.getRandomValues` (falls back to Math.random). */
export function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let id = '';
  for (const byte of bytes) {
    id += ALPHABET[byte % ALPHABET.length];
  }
  return id;
}

/** Client id for idempotent invite redemption (`RedeemInviteRequest.clientId`, ASCII, ≤ 128 characters). */
export function createClientId(): string {
  return `cli_${randomId(24)}`;
}

/** Id of this browser tab for the device hub `Hello` (a newer session replaces an older one). */
export function createSessionId(): string {
  return `ses_${randomId(20)}`;
}
