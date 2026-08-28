import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import {
  SCHEMA_CONTRACT,
  describeSchemaGap,
  isSchemaGapCode,
  type SchemaGap,
} from "@/lib/schemacontract";

/**
 * Does the database have what this build reads?
 *
 * One cheap probe per table in the contract: select the expected columns with
 * `limit(0)`, which asks Postgres to plan the query and return nothing. A
 * missing column answers 42703 and a missing table 42P01; anything else is
 * treated as "can't tell" and reported healthy on purpose — see
 * SCHEMA_GAP_CODES for why a network blip must never blank a working page.
 */

export interface SchemaStatus {
  healthy: boolean;
  gaps: SchemaGap[];
  /** True when we couldn't check at all (no service role key configured). */
  skipped: boolean;
}

const HEALTHY: SchemaStatus = { healthy: true, gaps: [], skipped: false };
const SKIPPED: SchemaStatus = { healthy: true, gaps: [], skipped: true };

/**
 * Cached per server instance, but asymmetrically: a healthy answer is kept
 * for the life of the instance (schemas don't un-apply), while an unhealthy
 * one is re-checked every minute — so the moment the migration is run, the
 * banner clears on its own instead of waiting for instances to recycle.
 */
const UNHEALTHY_RECHECK_MS = 60_000;
let cached: { at: number; status: SchemaStatus } | null = null;
let inFlight: Promise<SchemaStatus> | null = null;

/**
 * The probe must never outlast the thing it is protecting. Supabase being
 * slow or unreachable is not evidence about the schema, and a boot path that
 * waits indefinitely on it would turn someone else's outage into ours.
 */
const PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS);
    work
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function probe(): Promise<SchemaStatus> {
  if (!isConfigured.supabaseAdmin) return SKIPPED;
  const admin = createAdminClient();
  const gaps: SchemaGap[] = [];

  await Promise.all(
    SCHEMA_CONTRACT.map(async (expect) => {
      const { error } = await admin
        // The contract is data, so the table name is a runtime string the
        // generated Database types can't narrow.
        .from(expect.table as never)
        .select(expect.columns.length > 0 ? expect.columns.join(", ") : "*")
        // Plan it, return nothing: no rows cross the wire and no RLS-exempt
        // data is read, which matters because this runs with the service role.
        .limit(0);
      if (!error) return;
      if (!isSchemaGapCode(error.code)) return; // can't tell — stay quiet
      gaps.push({
        table: expect.table,
        migration: expect.migration,
        detail: error.message,
      });
    })
  );

  if (gaps.length === 0) return HEALTHY;
  // Contract order, so the alert reads the same way every time.
  const order = new Map(SCHEMA_CONTRACT.map((e, i) => [e.table, i]));
  gaps.sort((a, b) => (order.get(a.table) ?? 0) - (order.get(b.table) ?? 0));
  return { healthy: false, gaps, skipped: false };
}

export async function checkSchema(): Promise<SchemaStatus> {
  const now = Date.now();
  if (cached && (cached.status.healthy || now - cached.at < UNHEALTHY_RECHECK_MS)) {
    return cached.status;
  }
  // Collapse a burst of simultaneous requests into one round of probes.
  if (!inFlight) {
    inFlight = withTimeout(probe(), SKIPPED) // never let the guard itself break or stall a page
      .then((status) => {
        cached = { at: Date.now(), status };
        inFlight = null;
        return status;
      });
  }
  return inFlight;
}

/**
 * Boot check. Logs once per server instance and, in development, throws —
 * a developer who just pulled a migration should be stopped immediately,
 * while production must keep serving: a deploy that refuses to boot turns a
 * broken check-in page into a broken everything, and Vercel won't roll back
 * on its own. Production gets the log plus the in-app banner instead.
 */
export async function assertSchemaAtBoot(): Promise<void> {
  const status = await checkSchema();
  if (status.healthy) return;
  const message = describeSchemaGap(status.gaps);
  console.error(message);
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      "Database is behind this build — see the schema gap logged above."
    );
  }
}
