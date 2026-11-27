/**
 * A link the API built (invite, phone QR, output link), moved to the address this Regie is open at: scheme, host and
 * port of the page replace those of the server's base URL; path, query and fragment stay. Devices then open the server
 * the same way the operator does: through a tunnel or reverse proxy (`https://studioflow.example.com`) or directly
 * (`https://172.25.99.187:9443`), whatever the server settings say. A URL that cannot be parsed, or a page that is not
 * served over http(s), leaves the link as it is.
 */
export function onThisOrigin(
  url: string,
  origin: string | undefined = globalThis.location?.origin,
): string {
  if (!origin || !/^https?:\/\//i.test(origin)) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return url;
  }
  return `${origin.replace(/\/+$/, '')}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
