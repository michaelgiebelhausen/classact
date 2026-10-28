/** Only course-local routes survive the switch; never carry instructor query parameters. */
export function studentViewPath(path: string, source: string, target: string, ids: Record<string, string> = {}) {
  const prefix = `/course/${source}`;
  const clean = path.split(/[?#]/)[0];
  if (clean !== prefix && !clean.startsWith(`${prefix}/`)) return `/course/${target}`;
  const parts = clean.slice(prefix.length).split('/').filter(Boolean);
  if (!parts.length) return `/course/${target}`;
  if (!['checkin','games','follow','notes','ta','participate','shoutouts','projects','assignments','metrics'].includes(parts[0])) return `/course/${target}`;
  if (parts.length > 1) {
    if (!['assignments','projects'].includes(parts[0]) || parts.length !== 2 || !ids[parts[1]]) return `/course/${target}/${parts[0]}`;
    parts[1] = ids[parts[1]];
  }
  return `/course/${target}/${parts.join('/')}`;
}

export type PracticeCourse = { id: string; practice_source_id: string; practice_routes: Record<string, string> };
