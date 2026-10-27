import crypto from 'node:crypto';

/**
 * A self-signed certificate made with node:crypto only (no openssl on the machine, so the same on Linux, macOS and
 * Windows): a minimal X.509 v3 builder with an ECDSA P-256 key. The tests upload it as "my own certificate"
 * (Server settings, mode custom) and look for it on the TLS port. Never used for anything but tests.
 */

const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const length = body.length < 128 ? Buffer.from([body.length]) : body.length < 256 ? Buffer.from([0x81, body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const sequence = (...parts: Buffer[]) => der(0x30, ...parts);
const set = (...parts: Buffer[]) => der(0x31, ...parts);
const oid = (value: string): Buffer => {
  const numbers = value.split('.').map(Number);
  const bytes = [numbers[0]! * 40 + numbers[1]!];
  for (const number of numbers.slice(2)) {
    const group = [number & 0x7f];
    for (let rest = number >> 7; rest > 0; rest >>= 7) group.unshift((rest & 0x7f) | 0x80);
    bytes.push(...group);
  }
  return der(0x06, Buffer.from(bytes));
};
const utf8 = (text: string) => der(0x0c, Buffer.from(text, 'utf8'));
const octets = (data: Buffer) => der(0x04, data);
const bitString = (data: Buffer) => der(0x03, Buffer.concat([Buffer.from([0]), data]));
const integer = (data: Buffer) => der(0x02, data[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), data]) : data);
const utcTime = (date: Date) => der(0x17, Buffer.from(`${date.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));

const ECDSA_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));

export interface SelfSigned {
  /** PEM certificate. */
  certificate: string;
  /** PEM private key (PKCS#8, no password). */
  privateKey: string;
  /** The same key protected by a password (for the "encrypted key" case). */
  encryptedPrivateKey: string;
  /** SHA-256 fingerprint as the TLS socket reports it (`AB:CD:...`). */
  fingerprint: string;
}

export interface SelfSignedOptions {
  /** DNS names in the subject alternative name (the first is also the common name). */
  names: string[];
  /** Days from now until the certificate expires (negative: expired already). Default 90. */
  validDays?: number;
  /** Days ago the certificate became valid (negative: valid only from the future). Default 1. */
  startedDaysAgo?: number;
}

export function selfSigned(options: SelfSignedOptions): SelfSigned {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const day = 86_400_000;
  const notBefore = new Date(Date.now() - (options.startedDaysAgo ?? 1) * day);
  const notAfter = new Date(Date.now() + (options.validDays ?? 90) * day);
  const name = sequence(set(sequence(oid('2.5.4.3'), utf8(options.names[0]!))));
  const altNames = sequence(...options.names.map((entry) => der(0x82, Buffer.from(entry, 'ascii'))));
  const extensions = der(0xa3, sequence(sequence(oid('2.5.29.17'), octets(altNames)), sequence(oid('2.5.29.19'), octets(sequence()))));
  const toBeSigned = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(Buffer.from(crypto.randomBytes(8).map((byte, index) => (index === 0 ? byte & 0x7f : byte)))),
    ECDSA_SHA256,
    name,
    sequence(utcTime(notBefore), utcTime(notAfter)),
    name,
    Buffer.from(publicKey.export({ type: 'spki', format: 'der' })),
    extensions,
  );
  const signature = crypto.sign('sha256', toBeSigned, privateKey);
  const certificate = sequence(toBeSigned, ECDSA_SHA256, bitString(signature));
  const pem = `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----\n`;
  return {
    certificate: pem,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    encryptedPrivateKey: privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'e2e-secret' }) as string,
    fingerprint: new crypto.X509Certificate(pem).fingerprint256,
  };
}
