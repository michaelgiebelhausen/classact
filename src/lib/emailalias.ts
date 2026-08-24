/**
 * Google Workspace subdomain aliasing: many universities issue students an
 * official address (jblind@clemson.edu) whose Google account lives at a
 * g.-prefixed twin (jblind@g.clemson.edu). Canvas reports the official one;
 * Google sign-in supplies the twin — so the same student can look like two
 * people to an exact-match roster.
 *
 * The equivalence here is deliberately narrow: identical local part, and one
 * domain is exactly `g.` + the other, .edu only. Nothing looser — jsmith@
 * gmail.com and jsmith@clemson.edu can be different people, and matching them
 * would hand one student another's enrollment.
 */

/**
 * The g.-twin of an email address, or null when the rule doesn't apply.
 * Never returns the input itself.
 */
export function emailAliasOf(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 1 || at === normalized.length - 1) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!domain.endsWith(".edu")) return null;
  if (domain.startsWith("g.")) {
    const stripped = domain.slice(2);
    // "g.edu" would strip to a bare TLD — no such school.
    return stripped.includes(".") ? `${local}@${stripped}` : null;
  }
  return `${local}@g.${domain}`;
}
