/**
 * Safe URL policy for any URL supplied by users or suppliers. URLs are stored
 * and displayed as links; the platform never fetches them server-side from a
 * request path (SSRF). If a future importer fetches URLs it must additionally
 * resolve DNS and apply the private-address checks at connect time.
 */
const PRIVATE_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
  /^metadata\.google\.internal$/i,
];

export type UrlCheck =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

export const checkExternalUrl = (raw: string): UrlCheck => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid absolute URL' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'only https URLs are allowed' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'credentials in URLs are not allowed' };
  const host = parsed.hostname;
  if (/^\d+$/.test(host)) return { ok: false, reason: 'numeric hosts are not allowed' };
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    return { ok: false, reason: 'private or internal hosts are not allowed' };
  }
  if (raw.length > 2048) return { ok: false, reason: 'URL too long' };
  return { ok: true, url: parsed.toString() };
};
