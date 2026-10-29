/**
 * What this deployment needs the database to already have.
 *
 * Migrations here are applied by hand, so code and schema can move
 * independently — and on 2026-08-28 they did: a deploy carried code that
 * selected two columns migration 0036 hadn't created yet. It did not crash.
 * Every one of these queries destructures `{ data }` and drops `error`, so
 * PostgREST's "column does not exist" became `data: null`, which became an
 * empty occupants list, which became a seat map showing an empty room in a
 * class where students were sitting. Nothing reached Sentry, because nothing
 * threw.
 *
 * That is the failure this contract exists to make impossible to miss: a
 * schema gap should announce itself at boot, not impersonate an empty room.
 *
 * ADD AN ENTRY whenever a migration adds a column or table that code reads.
 * The cost of a stale entry is one wrong log line; the cost of a missing one
 * is the silent failure above.
 */

export interface SchemaExpectation {
  table: string;
  /** Columns the code selects. Empty means "the table itself must exist". */
  columns: string[];
  /** The migration file that creates them — quoted verbatim in the alert. */
  migration: string;
}

export const SCHEMA_CONTRACT: SchemaExpectation[] = [
  { table: "attendance_exclusions", columns: ["course_id", "session_date", "reason"], migration: "0055_attendance_recovery.sql" },
  { table: "class_sessions", columns: ["attendance_required"], migration: "0055_attendance_recovery.sql" },
  { table: "absences", columns: ["assessment_pending"], migration: "0055_attendance_recovery.sql" },
  {
    table: "projects",
    columns: ["mode", "brief"],
    migration: "0053_project_contributions.sql",
  },
  {
    table: "contribution_agreements",
    columns: ["team_id", "course_id", "roster", "shares", "confirmations", "confirmed_at", "note"],
    migration: "0053_project_contributions.sql",
  },
  {
    table: "contribution_checkpoints",
    columns: ["team_id", "course_id", "title", "deadline", "roster", "agreement_id", "deadline_history"],
    migration: "0053_project_contributions.sql",
  },
  {
    table: "contribution_responses",
    columns: ["checkpoint_id", "respondent_id", "respondent_profile_id", "course_id", "actual", "credit", "declined", "explanation", "help_requested", "submitted_at", "revision"],
    migration: "0053_project_contributions.sql",
  },
  {
    table: "late_checkin_requests",
    columns: ["session_id", "enrollment_id", "seat_id", "status", "confirmed_at", "pledged_at", "pledge_text"],
    migration: "0052_late_checkins.sql / 0055_attendance_recovery.sql",
  },
  {
    table: "late_checkin_witnesses",
    columns: ["request_id", "enrollment_id", "response", "emailed_at", "email_claimed_at", "pledge_text"],
    migration: "0052_late_checkins.sql / 0055_attendance_recovery.sql",
  },
  {
    table: "check_ins",
    columns: ["denied_count", "professor_confirmed_at"],
    migration: "0036_neighbor_denials.sql",
  },
  {
    table: "seat_denials",
    columns: [],
    migration: "0036_neighbor_denials.sql",
  },
  {
    table: "enrollments",
    columns: ["canvas_missing_since", "canvas_seen_at", "canvas_user_id"],
    migration: "0030_canvas_missing.sql / 0031_canvas_seen.sql / 0033_assignment_fields.sql",
  },
  {
    table: "profiles",
    columns: [
      "school_email",
      "school_email_verified_at",
      "first_name",
      "last_name",
      "first_name_phonetic",
      "last_name_phonetic",
    ],
    migration:
      "0032_school_email.sql / 0042_profile_name_parts.sql / 0043_profile_phonetic_parts.sql",
  },
  {
    table: "assignments",
    columns: [
      "instructions",
      "points",
      "canvas_assignment_id",
      "canvas_exported_at",
    ],
    migration: "0033_assignment_fields.sql",
  },
  {
    table: "profile_documents",
    columns: [],
    migration: "0034_profile_documents.sql",
  },
  {
    table: "rankings",
    columns: ["final_rank", "points_awarded"],
    migration: "0037_speed_grader.sql",
  },
  {
    table: "taste_files",
    columns: ["body", "locked_at"],
    migration: "0037_speed_grader.sql / 0045_taste_lock_standards.sql",
  },
  {
    table: "ai_scores",
    columns: ["standards_score", "standards_note"],
    migration: "0045_taste_lock_standards.sql",
  },
  {
    table: "lecture_note_entries",
    columns: [],
    migration: "0038_note_entries.sql",
  },
  {
    table: "lecture_decks",
    columns: ["transcript_path", "transcript_title", "deck_text"],
    migration: "0040_course_materials.sql",
  },
  {
    table: "courses",
    columns: ["transcripts_downloadable", "syllabus_path", "ta_enabled", "practice_source_id", "practice_instructor_id", "practice_routes"],
    migration: "0040_course_materials.sql / 0041_ta_toggle.sql / 0054_student_view.sql",
  },
  {
    table: "ta_messages",
    columns: [],
    migration: "0040_course_materials.sql",
  },
  {
    table: "lecture_presence",
    columns: [],
    migration: "0044_lecture_presence.sql",
  },
  {
    table: "submission_views",
    columns: [],
    migration: "0050_submission_views.sql",
  },
  {
    table: "rubric_themes",
    columns: ["weight"],
    migration: "0051_rubric_library.sql",
  },
  {
    table: "saved_rubrics",
    columns: [],
    migration: "0051_rubric_library.sql",
  },
];

/**
 * The codes that mean "the schema really is behind", as opposed to "the
 * database was briefly unreachable".
 *
 * The distinction is the whole safety story. Anything else — a timeout, a
 * connection reset, an auth hiccup — proves nothing about the schema, and
 * treating it as a gap would let a blip take a working seat map off the
 * screen during a class. So the guard only reports a gap on these, and stays
 * silent on everything else.
 *
 * `PGRST205` is here because a missing TABLE never reaches Postgres at all:
 * PostgREST resolves table names against its own schema cache first and
 * answers 404 "Could not find the table" on its own authority. Watching only
 * for Postgres's 42P01 meant every table-level entry in the contract —
 * exactly the ones with no columns to probe — was silently undetectable.
 * (42P01 is kept for the direct-SQL paths that do surface it.)
 */
export const SCHEMA_GAP_CODES = ["42703", "42P01", "PGRST205"] as const;

export function isSchemaGapCode(code: string | undefined): boolean {
  return Boolean(code) && (SCHEMA_GAP_CODES as readonly string[]).includes(code!);
}

export interface SchemaGap {
  table: string;
  migration: string;
  /** Postgres's own words — names the specific column when it's a 42703. */
  detail: string;
}

/** The migrations behind the gaps, de-duplicated, in contract order. */
export function migrationsToRun(gaps: SchemaGap[]): string[] {
  return [...new Set(gaps.map((g) => g.migration))];
}

/**
 * The contract tables the check-in page actually reads.
 *
 * A page must only ever be blocked by ITS OWN missing schema. The first
 * version of this guard blocked check-in on the whole contract, which meant
 * an unapplied migration touching assignments or profile_documents — tables
 * the seat map never looks at — would have taken attendance offline for
 * every course. A guard that can cause a worse outage than the bug it
 * watches for is not worth having.
 */
export const CHECKIN_TABLES = ["check_ins", "seat_denials"] as const;

/** Narrow a whole-database result to the gaps one surface actually cares about. */
export function gapsForTables(
  gaps: SchemaGap[],
  tables: readonly string[]
): SchemaGap[] {
  return gaps.filter((g) => tables.includes(g.table));
}

/**
 * The boot alert. Written to be understood at 8am by someone whose class is
 * about to start: what broke, what it looks like from the room, what to run.
 */
export function describeSchemaGap(gaps: SchemaGap[]): string {
  if (gaps.length === 0) return "";
  const lines = [
    "",
    "  ┌───────────────────────────────────────────────────────────────┐",
    "  │  DATABASE IS BEHIND THIS DEPLOYMENT                           │",
    "  └───────────────────────────────────────────────────────────────┘",
    "",
    "  This build reads columns the database doesn't have. Queries that",
    "  hit them return no rows rather than failing, so pages render as if",
    "  the data were simply empty — a seat map with nobody in it, metrics",
    "  reading zero.",
    "",
    "  Missing:",
    ...gaps.map((g) => `    - ${g.table}: ${g.detail}`),
    "",
    "  Run in the Supabase SQL editor, then reload — no redeploy needed:",
    ...migrationsToRun(gaps).map((m) => `    supabase/migrations/${m}`),
    "",
  ];
  return lines.join("\n");
}
