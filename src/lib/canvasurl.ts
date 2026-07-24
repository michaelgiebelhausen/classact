/**
 * Canvas base-URL normalization. Professors type anything from
 * "clemson.instructure.com" to a full course URL with a path; we keep just
 * the https origin. Returns null for anything unusable — and refuses
 * localhost/IP-literal hosts so a stored URL can never point our server-side
 * fetches at internal addresses.
 */
export function normalizeCanvasBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return null; // bare names incl. "localhost"
  if (host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4 literal
  if (host.includes(":") || host.startsWith("[")) return null; // IPv6 literal
  return `https://${host}`;
}
