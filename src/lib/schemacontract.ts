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
    columns: ["school_email", "school_email_verified_at"],
    migration: "0032_school_email.sql",
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
    columns: ["body"],
    migration: "0037_speed_grader.sql",
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
