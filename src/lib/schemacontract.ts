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
];

/**
 * The two SQLSTATEs that mean "the schema really is behind", as opposed to
 * "the database was briefly unreachable".
 *
 * The distinction is the whole safety story. A missing column (42703) or
 * missing table (42P01) is a definitive, reproducible answer from Postgres.
 * Anything else — a timeout, a connection reset, an auth hiccup — proves
 * nothing about the schema, and treating it as a gap would let a blip take a
 * working seat map off the screen during a class. So the guard only ever
 * reports a gap on these two, and stays silent on everything else.
 */
export const SCHEMA_GAP_CODES = ["42703", "42P01"] as const;

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
