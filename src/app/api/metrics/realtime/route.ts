import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/ratelimit";
import { recordSample } from "@/server/loadmetrics";

/**
 * Clients report when the seat map's realtime subscription drops and when it
 * comes back.
 *
 * This is the measurement that decides what caused the room to freeze. Losing
 * the subscription is not itself the outage — the fallback is. Each client
 * that drops starts refreshing the whole check-in page every five seconds, so
 * thirty simultaneous drops turn into a sustained flood of full page renders
 * against the same database realtime is already struggling with. If the logs
 * show a cluster of `realtime_down` at the moment the room seized, that is the
 * cause. If they show none, the freeze is somewhere else and this rules out a
 * whole branch of the search.
 *
 * Nothing here trusts the client beyond "a signed-in user says their socket
 * dropped" — it records an observation, reads nothing, and changes nothing.
 */
const bodySchema = z.object({
  sessionId: z.string().uuid(),
  state: z.enum(["down", "up"]),
  /** How long the client had been degraded, on the way back up. */
  degradedMs: z.number().int().min(0).max(86_400_000).optional(),
  /** The transport status the client saw, e.g. CHANNEL_ERROR / TIMED_OUT. */
  reason: z.string().max(40).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A client stuck in a reconnect loop must not be able to turn its own
  // instability into a second flood. Generous enough for real flapping,
  // bounded enough that a wedged tab cannot amplify.
  const limited = rateLimit(`rtmetrics:${user.id}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { sessionId, state, degradedMs, reason } = parsed.data;
  recordSample(
    state === "down" ? "realtime_down" : "realtime_up",
    { ms: degradedMs ?? 0, ok: state === "up", code: reason },
    { sessionId }
  );

  return NextResponse.json({ ok: true });
}
