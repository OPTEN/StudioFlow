import { msg, type Msg } from '@studioflow/i18n';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';

/**
 * What the forms of the server settings check before they ask the server (the server checks the same again and has
 * the last word; its field errors are shown next to the fields). Mirrors `ServerSettingsRules` in the C# core.
 */

/** Most origins that may embed the output. */
export const MAX_ORIGINS = 20;
/** Most public age keys. */
export const MAX_AGE_KEYS = 10;
/** Most daily and weekly backups that can be kept. */
export const MAX_KEEP_DAILY = 365;
export const MAX_KEEP_WEEKLY = 104;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const CHALLENGE_DOMAIN =
  /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const ORIGIN =
  /^https?:\/\/(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[0-9]{1,5})?$/;
const AGE_KEY = /^age1[02-9ac-hj-np-z]{58}$/;

/** Names of the DNS providers (proper names, the same in every language). */
const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  'dns-cloudflare': 'Cloudflare',
  'dns-infomaniak': 'Infomaniak',
  'dns-hetzner': 'Hetzner',
  'dns-desec': 'deSEC',
  'dns-route53': 'Amazon Route 53',
  'dns-gandi': 'Gandi',
  'dns-ovh': 'OVH',
};

/** The name of a provider for the pick list; a provider this version of the Regie does not know shows its id. */
export function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id.replace(/^dns-/, '');
}

/** An IPv4 address a device can reach: four numbers, not 0.x.x.x and not multicast or reserved (224 and above). */
export function isMediaAddress(value: string): boolean {
  const address = value.trim();
  if (!IPV4.test(address)) {
    return false;
  }
  const first = Number(address.split('.')[0]);
  return first !== 0 && first < 224;
}

/** A host name in the form the server stores: trimmed, without the final dot, lower case. */
export function normalizeDomain(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

/** A host name: labels of letters, digits and hyphens; a public name needs a dot; an IP address is no name. */
export function isDomain(value: string, needsDot: boolean): boolean {
  const domain = normalizeDomain(value);
  return (
    domain.length > 0 &&
    domain.length <= 253 &&
    DOMAIN.test(domain) &&
    !IPV4.test(domain) &&
    (!needsDot || domain.includes('.'))
  );
}

/** The target of a delegated `_acme-challenge` record: a host name whose labels may start with an underscore. */
export function isChallengeDomain(value: string): boolean {
  const domain = normalizeDomain(value);
  return domain.length > 0 && domain.length <= 253 && CHALLENGE_DOMAIN.test(domain);
}

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** The lines of a text field, without line-break characters; empty lines stay, so that line numbers stay true. */
export function textLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** An allowed origin: https://host, https://*.host, optionally with a port (case and a final slash do not matter). */
export function isOrigin(line: string): boolean {
  const origin = line.trim().replace(/\/$/, '').toLowerCase();
  return origin.length <= 255 && ORIGIN.test(origin);
}

/** A public age key (`age1…`). */
export function isAgeKey(line: string): boolean {
  return AGE_KEY.test(line.trim());
}

/** The 1-based number of the first line that has text and fails `valid`, or null. */
export function firstInvalidLine(
  lines: readonly string[],
  valid: (line: string) => boolean,
): number | null {
  const index = lines.findIndex((line) => line.trim().length > 0 && !valid(line));
  return index < 0 ? null : index + 1;
}

/** The number of lines that have text. */
export function filledLines(lines: readonly string[]): number {
  return lines.filter((line) => line.trim().length > 0).length;
}

/** `origins[3]` → 3 (the 0-based index in the list the client sent), or null for a message about the list itself. */
export function fieldIndex(key: string): number | null {
  const match = /\[(\d+)\]$/.exec(key);
  return match ? Number(match[1]) : null;
}

/** The text for a certificate or key problem the server reported. */
export function certificateErrorMsg(code: string): Msg | null {
  switch (code) {
    case CODES.certificateRequired:
      return msg('regie.server.address.errorCertificateRequired');
    case CODES.certificateInvalid:
      return msg('regie.server.address.errorCertificateInvalid');
    case CODES.privateKeyInvalid:
      return msg('regie.server.address.errorPrivateKeyInvalid');
    case CODES.privateKeyEncrypted:
      return msg('regie.server.address.errorPrivateKeyEncrypted');
    case CODES.certificateKeyMismatch:
      return msg('regie.server.address.errorKeyMismatch');
    case CODES.certificateExpired:
      return msg('regie.server.address.errorExpired');
    case CODES.certificateNotYetValid:
      return msg('regie.server.address.errorNotYetValid');
    case CODES.certificateNameMismatch:
      return msg('regie.server.address.errorNameMismatch');
    default:
      return null;
  }
}
