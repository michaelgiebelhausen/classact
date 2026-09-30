import { timingSafeEqual } from "node:crypto"
import { after } from "next/server"
import { env, isConfigured } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import { runGradingTick } from "@/server/gradingengine"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// The tick answers at once and grades in after(), which runs for this long.
export const maxDuration = 300

/**
 * The grading tick. pg_cron (migration 0048) posts here every minute; each
 * tick starts grading on any assignment whose deadline has passed, resumes
 * any that stalled, and scores late submissions as they arrive. Grading used
 * to run only while the professor kept the assignment page open.
 *
 * Answers 202 immediately and works in after(): pg_net doesn't wait around,
 * and a tick that outlives the next one is fine — the engine's per-assignment
 * lock keeps two ticks from grading the same work.
 *
 * Authenticated by CRON_SECRET (the same value lives in Supabase Vault as
 * grading_tick_secret). Without it the endpoint refuses rather than running
 * open: every chunk spends the professor's AI credits.
 */
async function tick(request: Request) {
  if (!env.cronSecret) {
    return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 })
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${env.cronSecret}`)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 })
  }
  if (!isConfigured.supabaseAdmin) {
    return Response.json({ error: "Service role missing." }, { status: 503 })
  }
  after(async () => {
    try {
      const result = await runGradingTick(createAdminClient())
      if (result.chunks > 0) console.log("[grading-tick]", result)
    } catch (e) {
      console.error("[grading-tick] failed:", e)
    }
  })
  return Response.json({ ok: true }, { status: 202, headers: { "cache-control": "no-store" } })
}

export const GET = tick
export const POST = tick
