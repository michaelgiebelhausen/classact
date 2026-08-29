import { migrationsToRun, type SchemaGap } from "@/lib/schemacontract";

/**
 * What /api/health says, and what code it says it with.
 *
 * Split out from the route so the decision can be tested without a database.
 * The route's own job is then only to ask the guard and serialise this.
 *
 * BACKGROUND. Until now the endpoint returned a hardcoded `{ ok: true }`. On
 * 2026-08-28 a deploy carried the notes feature to production hours before
 * 0038 was applied by hand, and health answered ok the entire time — while
 * the queries behind it returned empty rows rather than failing. An endpoint
 * that cannot be wrong is not a health check; it is a decoration.
 */

/** The shape src/server/schemaguard.ts's SchemaStatus already has. */
export interface SchemaProbe {
  healthy: boolean;
  gaps: SchemaGap[];
  /** True when the schema could not be checked at all (no service role key). */
  skipped: boolean;
}

export interface HealthBody {
  ok: boolean;
  schema: {
    /**
     * `ok`      — the database has every column this build reads.
     * `behind`  — it does not; the named migrations have not been run.
     * `unknown` — we could not ask. Not a failure; see below.
     */
    status: "ok" | "behind" | "unknown";
    /** Present only when behind. */
    gaps?: SchemaGap[];
    /** Present only when behind: the files to run, de-duplicated. */
    migrations?: string[];
  };
}

export interface HealthReport {
  status: number;
  body: HealthBody;
}

export function healthReport(probe: SchemaProbe): HealthReport {
  // A healthy verdict that still carries gaps is a contradiction, and the
  // only safe way to read a contradiction in a health check is as unhealthy.
  // Trusting `healthy` alone would let a future refactor turn a real gap
  // into a green light — the exact failure mode this file exists to end.
  const behind = !probe.healthy || probe.gaps.length > 0;

  if (behind) {
    return {
      // 503, not 500: the service is up and the database is reachable. What
      // is missing is a migration, and it will be missing until a human runs
      // it — "unavailable" describes that better than "error".
      status: 503,
      body: {
        ok: false,
        schema: {
          status: "behind",
          gaps: probe.gaps,
          // So whoever is reading this at 8am does not have to go find out
          // which file to paste into the SQL editor.
          migrations: migrationsToRun(probe.gaps),
        },
      },
    };
  }

  // `skipped` is a local developer with no SUPABASE_SERVICE_ROLE_KEY, not a
  // broken deployment. Reporting an unaskable question as a failure would
  // make a red health check normal, and a health check everyone ignores is
  // worth less than none.
  return {
    status: 200,
    body: { ok: true, schema: { status: probe.skipped ? "unknown" : "ok" } },
  };
}
