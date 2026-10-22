/** Parsers for header values the tests assert on. */

export interface ParsedCookie {
  name: string;
  value: string;
  attributes: Record<string, string | true>;
  raw: string;
}

export function parseSetCookie(raw: string): ParsedCookie {
  const [pair, ...rest] = raw.split(';').map((part) => part.trim());
  const eq = pair!.indexOf('=');
  const attributes: Record<string, string | true> = {};
  for (const part of rest) {
    const index = part.indexOf('=');
    if (index < 0) attributes[part.toLowerCase()] = true;
    else attributes[part.slice(0, index).toLowerCase()] = part.slice(index + 1);
  }
  return { name: pair!.slice(0, eq), value: pair!.slice(eq + 1), attributes, raw };
}

/** `default-src 'none'; script-src 'self'` -> { 'default-src': ["'none'"], 'script-src': ["'self'"] } */
export function parseCsp(csp: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const directive of csp.split(';')) {
    const parts = directive.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    result[parts[0]!.toLowerCase()] = parts.slice(1);
  }
  return result;
}
