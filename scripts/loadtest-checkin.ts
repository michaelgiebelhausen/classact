/**
 * Simulate a classroom arriving at once, and measure what it costs.
 *
 * Usage (requires .env.local with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY, and a server running at --base):
 *
 *   npx tsx --env-file=.env.local scripts/loadtest-checkin.ts \
 *     --course <course-uuid> --students 40 --base http://localhost:3000
 *
 * What it drives, and why those two things:
 *
 *   1. A check-in insert per student, through that student's OWN authenticated
 *      client. This is the real contention path — same RLS policies, same
 *      unique constraints on (session_id, seat_id) and (session_id,
 *      enrollment_id). Seat collisions are induced deliberately (two students
 *      aim at one seat) so the race shows up rather than being assumed away.
 *   2. A full GET of the check-in page per student, repeated. This is what
 *      `router.refresh()` costs, and the freeze hypothesis says a degraded
 *      room does this every five seconds per device.
 *
 * KNOWN LIMIT, stated because it changes how you read the output: this does
 * NOT invoke the `checkIn` server action. Next's server-action protocol is not
 * an addressable endpoint, so an external script cannot call it. The action's
 * own overhead is therefore not measured here — only the queries and renders
 * that dominate it. The `[loadmetrics]` lines from a real class remain the
 * authority on the action itself.
 *
 * Safe by construction: refuses to run against a non-localhost --base unless
 * --i-know-this-is-not-local is passed. Creating forty accounts and forty
 * check-ins in a real class's session would corrupt somebody's attendance.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { aggregateLines, formatSampleLine } from "../src/lib/loadmetrics";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Latency budget, in ms, at p95. Above this the room feels broken. */
const BUDGET_MS = 2_000;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface Student {
  email: string;
  password: string;
  client: SupabaseClient;
  enrollmentId: string;
  accessToken: string;
}

/**
 * Create (or reuse) N confirmed auth users enrolled active in the course.
 *
 * Passwords are used only because a load test needs a non-interactive sign-in;
 * these accounts exist solely in a local database.
 */
async function provision(
  admin: SupabaseClient,
  courseId: string,
  count: number
): Promise<Student[]> {
  const students: Student[] = [];

  for (let i = 0; i < count; i++) {
    const email = `loadtest${i + 1}@loadtest.invalid`;
    const password = `loadtest-${i + 1}-pw`;

    let userId: string | undefined;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    userId = created?.user?.id;
    if (error) {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      userId = list?.users.find(
        (u) => u.email?.toLowerCase() === email
      )?.id;
    }
    if (!userId) throw new Error(`could not provision ${email}`);

    await admin
      .from("profiles")
      .upsert({ id: userId, role: "student", full_name: `Load Test ${i + 1}`, onboarding_complete: true });

    const { data: enrollment, error: enrollErr } = await admin
      .from("enrollments")
      .upsert(
        {
          course_id: courseId,
          profile_id: userId,
          roster_name: `Load Test ${i + 1}`,
          roster_email: email,
          status: "active",
        },
        { onConflict: "course_id,profile_id" }
      )
      .select("id")
      .single();
    if (enrollErr || !enrollment) {
      throw new Error(`enrollment failed for ${email}: ${enrollErr?.message}`);
    }

    const client = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data: session, error: signInErr } =
      await client.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) {
      throw new Error(`sign-in failed for ${email}: ${signInErr?.message}`);
    }

    students.push({
      email,
      password,
      client,
      enrollmentId: enrollment.id,
      accessToken: session.session.access_token,
    });
  }

  return students;
}

async function main() {
  const courseId = arg("course");
  const base = arg("base", "http://localhost:3000")!;
  const count = Number(arg("students", "40"));

  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (students sign in as themselves).");
    process.exit(1);
  }
  if (!courseId) {
    console.error("Usage: --course <uuid> [--students 40] [--base http://localhost:3000]");
    process.exit(1);
  }
  // Two independent targets, and BOTH have to be local. The app URL is the
  // obvious one; the Supabase URL is the dangerous one, because provisioning
  // writes accounts, enrollments and check-ins to whatever project
  // .env.local points at — even when --base is localhost. A localhost app
  // pointed at the production database is exactly the accident worth
  // refusing.
  const local = (u: string) =>
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);
  const unsafe = [
    local(base) ? null : `app ${base}`,
    local(url) ? null : `database ${new URL(url).host}`,
  ].filter(Boolean);

  if (unsafe.length > 0 && !flag("i-know-this-is-not-local")) {
    console.error(
      `Refusing to run: ${unsafe.join(" and ")} ${unsafe.length > 1 ? "are" : "is"} not local.\n` +
        `This provisions ${count} accounts and writes ${count} check-ins into today's open session.\n` +
        "Against a real course that corrupts real students' attendance records.\n" +
        "Pass --i-know-this-is-not-local only if you are certain that is what you want."
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: session } = await admin
    .from("class_sessions")
    .select("id")
    .eq("course_id", courseId)
    .eq("session_date", new Date().toISOString().slice(0, 10))
    .is("closed_at", null)
    .maybeSingle();
  if (!session) {
    console.error("No open session for this course today. Open one first.");
    process.exit(1);
  }

  const { data: seats } = await admin
    .from("seats")
    .select("id")
    .eq("course_id", courseId);
  if (!seats || seats.length === 0) {
    console.error("This course has no seats.");
    process.exit(1);
  }

  console.log(`Provisioning ${count} students…`);
  const students = await provision(admin, courseId, count);

  // Clear prior check-ins for these students so the run is repeatable.
  await admin
    .from("check_ins")
    .delete()
    .eq("session_id", session.id)
    .in("enrollment_id", students.map((s) => s.enrollmentId));

  const lines: string[] = [];

  // ---- Burst 1: everyone claims a seat at once. -------------------------
  // Every other pair aims at the same seat, so the unique-constraint race is
  // exercised rather than assumed away.
  console.log(`Bursting ${count} concurrent check-ins…`);
  await Promise.all(
    students.map(async (student, i) => {
      const seatId = seats[Math.floor(i / 2) % seats.length].id;
      const started = Date.now();
      const { error } = await student.client.from("check_ins").insert({
        session_id: session.id,
        enrollment_id: student.enrollmentId,
        seat_id: seatId,
        is_new_seat: true,
      });
      lines.push(
        formatSampleLine(
          "checkin",
          {
            ms: Date.now() - started,
            ok: !error,
            code: error?.code ?? undefined,
          },
          { sessionId: session.id }
        )
      );
    })
  );

  // ---- Burst 2: the refresh storm the fallback would produce. -----------
  // One full page render per student, concurrently — a single 5-second tick
  // of a fully degraded room.
  console.log(`Bursting ${count} concurrent page renders…`);
  const pageUrl = `${base}/course/${courseId}/checkin`;
  await Promise.all(
    students.map(async (student) => {
      const started = Date.now();
      let ok = false;
      let code: string | undefined;
      try {
        const res = await fetch(pageUrl, {
          headers: { Authorization: `Bearer ${student.accessToken}` },
        });
        ok = res.ok;
        if (!res.ok) code = String(res.status);
      } catch (err) {
        code = err instanceof Error ? err.name : "fetch_failed";
      }
      lines.push(
        formatSampleLine(
          "checkin_page",
          { ms: Date.now() - started, ok, code },
          { sessionId: session.id }
        )
      );
    })
  );

  // ---- Report ------------------------------------------------------------
  const stats = aggregateLines(lines);
  console.log("");
  for (const [op, s] of Object.entries(stats)) {
    console.log(
      `${op.padEnd(14)} n=${String(s.count).padStart(3)}  ` +
        `p50=${s.p50}ms  p95=${s.p95}ms  p99=${s.p99}ms  max=${s.max}ms  ` +
        `err=${(s.errorRate * 100).toFixed(0)}%  rate=${s.ratePerSec?.toFixed(1) ?? "-"}/s`
    );
    if (Object.keys(s.codes).length > 0) {
      console.log(`${" ".repeat(14)} codes: ${JSON.stringify(s.codes)}`);
    }
  }

  const over = Object.entries(stats).filter(
    ([, s]) => (s.p95 ?? 0) > BUDGET_MS
  );
  console.log("");
  if (over.length > 0) {
    console.log(
      `FAIL — p95 over the ${BUDGET_MS}ms budget: ${over.map(([op]) => op).join(", ")}`
    );
    process.exitCode = 1;
  } else {
    console.log(`PASS — every operation's p95 is within the ${BUDGET_MS}ms budget.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
