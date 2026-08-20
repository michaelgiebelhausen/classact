/**
 * Telling "no such row" apart from "that query was broken".
 *
 * PostgREST reports both as an absent `data`, so the common shape
 *
 *   const { data: course } = await supabase.from("courses").select(...)
 *   if (!course || course.professor_id !== user.id) return { error: "Only the owner…" }
 *
 * blames the caller for a failure that is really the server's. It has cost
 * two debugging sessions: once as a 404 on a course the dashboard listed
 * fine (fixed in 90667a6 for the Setup and Check-In pages), and again as
 * "Only the course owner can copy it" on a course the professor plainly
 * owned — an unapplied migration meant `courses.participation_weights` did
 * not exist, so the whole select 400'd.
 *
 * A select naming a column the database doesn't have is the failure mode to
 * design for: it appears the moment a migration lags behind a deploy, and it
 * looks exactly like a permissions problem from the outside.
 */

/** PostgREST's "no row matched" — the only genuinely absent-row code. */
export const NO_ROW = "PGRST116";

/** The shape of a PostgrestError, minus the import. */
export type QueryError = {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
} | null;

/**
 * Describe a query failure, or return null when there wasn't one.
 *
 * Null covers both "no error" and PGRST116, so a caller can keep treating an
 * absent row as an absent row and handle only what's left:
 *
 *   const failure = describeQueryFailure("duplicateCourse", error);
 *   if (failure) return { ok: false, error: failure };
 *
 * The server log carries the code and hint; the returned string is what a
 * professor sees, so it says what to do about the likeliest cause rather
 * than only naming the error.
 */
export function describeQueryFailure(scope: string, error: QueryError): string | null {
  if (!error) return null;
  if (error.code === NO_ROW) return null;

  console.error(`[${scope}] query failed:`, {
    code: error.code,
    message: error.message,
    hint: error.hint,
  });

  const detail = error.message || error.code || "unknown database error";
  return `${detail}. If that names a missing column, a migration hasn't been applied to this database yet — run the pending files from supabase/migrations in the Supabase SQL editor.`;
}
