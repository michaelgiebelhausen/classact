/**
 * LinkedIn profile-URL normalization. People paste anything — a bare
 * handle, a share link, a URL trailing tracking params — so accept
 * generously and store one canonical https form. Returns null for
 * anything that isn't plausibly a LinkedIn profile.
 */
export function normalizeLinkedInUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A bare handle or "in/handle" — the most common paste.
  const bare = trimmed.replace(/^@/, "");
  if (/^[\w-]{3,100}$/.test(bare)) {
    return `https://www.linkedin.com/in/${bare}`;
  }
  const inPath = /^in\/([\w-]{3,100})\/?$/.exec(bare);
  if (inPath) return `https://www.linkedin.com/in/${inPath[1]}`;

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  // linkedin.com or a country/locale subdomain (uk., www., …).
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!/^\/(in|pub)\/[\w%-]{3,100}$/.test(path)) return null;
  return `https://www.linkedin.com${path}`;
}
