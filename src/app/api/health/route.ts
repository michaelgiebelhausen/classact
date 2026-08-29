import { healthReport } from "@/lib/healthreport"
import { checkSchema } from "@/server/schemaguard"

export const dynamic = "force-dynamic"
// The guard needs the service role key and the Supabase admin client, neither
// of which belongs in an edge bundle — the same constraint instrumentation.ts
// states for the boot check.
export const runtime = "nodejs"

/**
 * Is this deployment actually able to do its job?
 *
 * Reachability was never the interesting question — Vercel answering at all
 * proves that. The question this endpoint exists to answer is whether the
 * database has the columns this build reads, because migrations here are
 * applied by hand and a deploy can arrive ahead of its migration. When it
 * does, the queries return empty rather than failing, and the app reads as
 * "nobody has checked in" instead of "this is broken".
 *
 * Cost: none in the ordinary case. checkSchema() keeps a healthy answer for
 * the life of the server instance and caps its own probes at 3s, so this
 * stays a cheap endpoint that a monitor may hit on a short interval.
 *
 * Public on purpose — src/proxy.ts excludes it from the session matcher, and
 * the gap details name tables and columns that PostgREST already publishes
 * to anyone holding the anon key, which ships in the client bundle. There is
 * nothing here a reader could not already ask the database directly.
 */
export async function GET() {
  const { status, body } = healthReport(await checkSchema())
  return Response.json(body, {
    status,
    // A cached health check is not a health check.
    headers: { "cache-control": "no-store" },
  })
}
