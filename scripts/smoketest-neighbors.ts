/**
 * End-to-end smoke test for neighbor confirmations (0036).
 *
 * Usage (requires .env.local with NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY):
 *   npx tsx --env-file=.env.local scripts/smoketest-neighbors.ts
 *
 * WHAT THIS COVERS: the database half of the HANDOFF smoke test — the
 * triggers, the deny/confirm invariant the ring precedence depends on, the
 * professor RPC's authorization boundary, and the RLS policies 0036 added.
 * It is also the half a human cannot check by looking at a screen.
 *
 * WHAT THIS DOES NOT COVER: the browser. Toasts, ring colours, the hover
 * card and realtime latency need two signed-in students and a pair of eyes.
 *
 * WHAT A GREEN RUN DOES NOT PROVE: nothing in 0036 validates `relation`
 * against the room's geometry — adjacency is enforced only by the server
 * action (denyNeighbor/verifyNeighbor), never by the database. Every check
 * here would still pass if a student could POST a denial naming a classmate
 * across the room, so do not read this as proof that they cannot.
 *
 * SAFETY. Everything lives in one throwaway course owned by a synthetic
 * professor, so it never appears on a real dashboard, and every statement is
 * scoped to ids created by this run. Cleanup runs from a finally block AND
 * from SIGINT/SIGTERM, and a sweep at startup reclaims anything a previously
 * killed run stranded. Deleting the synthetic professor is on its own
 * sufficient: courses.professor_id cascades from profiles, which cascades
 * from auth.users.
 *
 * TESTING DISCIPLINE. Every write asserts its own error. A check that reads
 * a failed query as a pass is worse than no check, because it will be
 * believed — so each assertion below either has a positive control or reads
 * the row back with the service-role client to prove the pre-state.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PREFIX = "smoketest-";
const STAMP = `${PREFIX}${Date.now()}`;
const MAIL = (who: string) => `${STAMP}-${who}@example.invalid`;

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Every fixture write goes through this: a broken fixture must abort, not
 *  masquerade as a failed invariant. */
function mustNotError(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

/** A signed-in client for a synthetic user, via magic link — no passwords.
 *  The identity is asserted, because an anon client would also be refused by
 *  the RPC (0036 revokes EXECUTE from public), which would make the
 *  "student is refused" check pass for entirely the wrong reason. */
async function sessionFor(
  admin: SupabaseClient,
  email: string
): Promise<SupabaseClient> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`could not mint a session for ${email}: ${error?.message}`);
  }
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: otpErr } = await client.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr || !session?.session) {
    throw new Error(`verifyOtp failed for ${email}: ${otpErr?.message}`);
  }
  const { data: who } = await client.auth.getUser();
  if (who.user?.email?.toLowerCase() !== email.toLowerCase()) {
    throw new Error(`session identity mismatch: expected ${email}, got ${who.user?.email}`);
  }
  return client;
}

async function main() {
  if (!url || !serviceKey || !anonKey) {
    console.error("Missing Supabase env vars (URL, SERVICE_ROLE, ANON).");
    process.exit(1);
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let courseId: string | null = null;
  const userIds: string[] = [];
  let cleanedUp = false;

  async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    console.log("\n--- Cleanup ---");
    if (courseId) {
      const { error } = await admin.from("courses").delete().eq("id", courseId);
      console.log(error ? `  course delete FAILED: ${error.message}` : "  course deleted (cascades everything under it)");
    }
    for (const id of userIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log(`  user ${id} delete FAILED: ${error.message}`);
    }
    if (userIds.length) console.log(`  ${userIds.length} synthetic users deleted`);
  }

  // Ctrl-C, a dropped connection or an OS kill terminates Node without
  // unwinding the finally, which would strand a course and three users in
  // production. Registered before the first row exists.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      void cleanup().then(() => process.exit(130));
    });
  }

  // Reclaim residue from any previously killed run before adding more.
  const { data: strandedUsers } = await admin.auth.admin.listUsers();
  const stale = (strandedUsers?.users ?? []).filter((u) =>
    u.email?.startsWith(PREFIX) && u.email.endsWith("@example.invalid")
  );
  if (stale.length) {
    console.log(`Sweeping ${stale.length} leftover user(s) from an earlier aborted run…`);
    for (const u of stale) await admin.auth.admin.deleteUser(u.id);
  }
  const { data: staleCourses } = await admin
    .from("courses").select("id, name").like("name", `${PREFIX}%`);
  for (const c of staleCourses ?? []) {
    await admin.from("courses").delete().eq("id", c.id);
    console.log(`Swept leftover course ${c.name}`);
  }

  try {
    // ---------- Setup: professor, two students, a 4-seat row ----------
    const profEmail = MAIL("prof");
    const aliceEmail = MAIL("alice");
    const bobEmail = MAIL("bob");

    for (const email of [profEmail, aliceEmail, bobEmail]) {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
      userIds.push(data.user.id);
    }
    const [profId, aliceId, bobId] = userIds;

    const { data: course, error: courseErr } = await admin
      .from("courses")
      .insert({
        professor_id: profId,
        name: `${STAMP} course`,
        join_code: `SMK-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      })
      .select("id").single();
    mustNotError("course", courseErr);
    courseId = course!.id;

    // A1 — A2 — A3 — A4, left/right adjacency only.
    const labels = ["A1", "A2", "A3", "A4"];
    const { data: seats, error: seatErr } = await admin
      .from("seats")
      .insert(labels.map((label, i) => ({
        course_id: courseId, label, row_index: 0, col_index: i, x: i, y: 0, section: "main",
        neighbors: {
          ...(i > 0 ? { left: labels[i - 1] } : {}),
          ...(i < labels.length - 1 ? { right: labels[i + 1] } : {}),
        },
      })))
      .select("id, label");
    mustNotError("seats", seatErr);
    const seatId = (label: string) => seats!.find((s) => s.label === label)!.id;

    const { data: enrollments, error: enrErr } = await admin
      .from("enrollments")
      .insert([
        { course_id: courseId, roster_name: "Alice Smoke", roster_email: aliceEmail, profile_id: aliceId, status: "active" },
        { course_id: courseId, roster_name: "Bob Smoke", roster_email: bobEmail, profile_id: bobId, status: "active" },
      ])
      .select("id, roster_name");
    mustNotError("enrollments", enrErr);
    const alice = enrollments!.find((e) => e.roster_name === "Alice Smoke")!.id;
    const bob = enrollments!.find((e) => e.roster_name === "Bob Smoke")!.id;

    const { data: session, error: sessErr } = await admin
      .from("class_sessions")
      .insert({ course_id: courseId, session_date: new Date().toISOString().slice(0, 10) })
      .select("id").single();
    mustNotError("class_session", sessErr);
    const sid = session!.id;

    const { error: seedErr } = await admin.from("check_ins").insert([
      { session_id: sid, enrollment_id: alice, seat_id: seatId("A1") },
      { session_id: sid, enrollment_id: bob, seat_id: seatId("A2") },
    ]);
    mustNotError("seed check_ins", seedErr);

    // ---------- helpers that refuse to lie ----------
    const readCheckIn = async (enrollmentId: string) => {
      const { data, error } = await admin
        .from("check_ins")
        .select("id, verified, denied_count, professor_confirmed_at, seat_id")
        .eq("session_id", sid).eq("enrollment_id", enrollmentId).maybeSingle();
      mustNotError("readCheckIn", error);
      if (!data) throw new Error(`no check-in row for enrollment ${enrollmentId}`);
      return data;
    };
    const denialsFor = async (subject: string) => {
      const { data, error } = await admin
        .from("seat_denials")
        .select("id, resolved_at, resolved_by")
        .eq("session_id", sid).eq("subject_enrollment_id", subject);
      mustNotError("denialsFor", error);
      return data!;
    };
    const deny = async (verifier: string, subject: string, relation: string) => {
      const { data, error } = await admin
        .from("seat_denials")
        .insert({ session_id: sid, verifier_enrollment_id: verifier, subject_enrollment_id: subject, relation })
        .select("id").single();
      mustNotError("deny", error);
      return data!.id;
    };
    const confirm = async (verifier: string, subject: string, relation: string) => {
      const { error } = await admin.from("seat_verifications").upsert(
        { session_id: sid, verifier_enrollment_id: verifier, subject_enrollment_id: subject, relation },
        { onConflict: "session_id,verifier_enrollment_id,subject_enrollment_id" }
      );
      mustNotError("confirm", error);
    };

    console.log("\n--- Triggers and the deny/confirm invariant ---");

    // T1 — a denial recounts onto the subject's carrier column.
    await deny(bob, alice, "left");
    check("a denial raises the subject's denied_count",
      (await readCheckIn(alice)).denied_count === 1,
      `denied_count=${(await readCheckIn(alice)).denied_count}`);

    // T2 — the partial unique index allows one ACTIVE denial per pair.
    const { error: dupErr } = await admin.from("seat_denials").insert({
      session_id: sid, verifier_enrollment_id: bob, subject_enrollment_id: alice, relation: "left",
    });
    check("a second active denial from the same neighbor is rejected",
      dupErr?.code === "23505", `code=${dupErr?.code ?? "none"}`);

    // T3 — a confirmation resolves the denial and verifies the subject.
    await confirm(bob, alice, "left");
    let a = await readCheckIn(alice);
    let denials = await denialsFor(alice);
    check("a confirmation clears the denial and verifies the subject",
      a.verified === true && a.denied_count === 0 &&
      denials.length > 0 && denials.every((d) => d.resolved_at),
      `verified=${a.verified} denied=${a.denied_count} unresolved=${denials.filter((d) => !d.resolved_at).length}`);
    check("the denial is resolved with a reason, not deleted",
      denials.some((d) => d.resolved_by === "peer_confirm"),
      `reasons=${denials.map((d) => d.resolved_by).join(",")}`);

    // T4 — THE R1 SCENARIO: confirm, mis-tap deny, re-confirm. The re-confirm
    // takes the upsert's UPDATE path; if the trigger did not fire on UPDATE
    // the subject would pulse "denied" forever with no way for anyone to
    // clear it. This is the single most important check in the file.
    await deny(bob, alice, "left");
    const midDenied = (await readCheckIn(alice)).denied_count;
    await confirm(bob, alice, "left");
    check("re-confirming after a mis-tapped denial clears it (upsert UPDATE path)",
      midDenied === 1 && (await readCheckIn(alice)).denied_count === 0,
      `after deny=${midDenied}, after re-confirm=${(await readCheckIn(alice)).denied_count}`);

    // T5 — a seat change moots a denial that was about the old seat.
    await deny(bob, alice, "left");
    const beforeMove = (await readCheckIn(alice)).denied_count;
    await admin.from("check_ins").update({ seat_id: seatId("A4") }).eq("id", (await readCheckIn(alice)).id);
    a = await readCheckIn(alice);
    denials = await denialsFor(alice);
    check("moving seats resolves the denial about the old seat",
      beforeMove === 1 && a.denied_count === 0 && denials.some((d) => d.resolved_by === "seat_change"),
      `before=${beforeMove} after=${a.denied_count}`);

    // T6 — removing a check-in resolves the denials pointing at it.
    await deny(bob, alice, "left");
    const aliceRow = await readCheckIn(alice);
    const { error: delErr } = await admin.from("check_ins").delete().eq("id", aliceRow.id);
    mustNotError("delete alice check-in", delErr);
    denials = await denialsFor(alice);
    check("removing a check-in resolves its denials",
      denials.length > 0 && denials.every((d) => d.resolved_at) &&
      denials.some((d) => d.resolved_by === "checkin_removed"),
      `unresolved=${denials.filter((d) => !d.resolved_at).length}`);

    // T7 — the seeding trigger, BOTH branches. A denial lands while Alice has
    // no check-in at all (seat_denials has no FK to check_ins), so the count
    // can only come from handle_checkin_seeded recomputing it on insert.
    await deny(bob, alice, "left");
    const { error: reErr } = await admin
      .from("check_ins").insert({ session_id: sid, enrollment_id: alice, seat_id: seatId("A1") });
    mustNotError("re-check-in", reErr);
    a = await readCheckIn(alice);
    check("a re-check-in inherits the verification it already had",
      a.verified === true, `verified=${a.verified}`);
    check("a re-check-in picks up a denial filed while they were away",
      a.denied_count === 1, `denied_count=${a.denied_count}`);
    await confirm(bob, alice, "left"); // settle Alice for later checks

    console.log("\n--- The professor's confirm, and who may call it ---");

    const profClient = await sessionFor(admin, profEmail);
    const aliceClient = await sessionFor(admin, aliceEmail);

    // A1 — a student is refused by the function body, not merely by the
    // EXECUTE grant. The message discriminates the two.
    const { error: notProf } = await aliceClient.rpc("professor_confirm_attendance", {
      p_session: sid, p_enrollment: bob,
    });
    check("a student cannot confirm attendance (refused by is_course_professor)",
      notProf?.code === "42501" && /not the course professor/i.test(notProf?.message ?? ""),
      `code=${notProf?.code ?? "none"} msg=${notProf?.message ?? ""}`);

    // A2 — the professor can, and it resolves the standing denial.
    const bobDenialId = await deny(alice, bob, "right");
    const bobBefore = await readCheckIn(bob);
    const { error: confErr } = await profClient.rpc("professor_confirm_attendance", {
      p_session: sid, p_enrollment: bob,
    });
    mustNotError("professor confirm", confErr);
    const bobAfter = await readCheckIn(bob);
    const bobDenial = (await denialsFor(bob)).find((d) => d.id === bobDenialId)!;
    check("the professor's confirm sets professor_confirmed_at and clears denials",
      bobBefore.denied_count === 1 && bobAfter.professor_confirmed_at !== null &&
      bobAfter.denied_count === 0 && bobDenial.resolved_by === "professor_confirm",
      `before=${bobBefore.denied_count} after=${bobAfter.denied_count} resolved_by=${bobDenial.resolved_by}`);

    // A3 — it must never count as social credit. Positive control included,
    // so a broken counting query cannot read as success.
    const countVerifs = async (subject: string) => {
      const { count, error } = await admin
        .from("seat_verifications")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sid).eq("subject_enrollment_id", subject);
      mustNotError("count verifications", error);
      return count ?? -1;
    };
    const bobVerifs = await countVerifs(bob);
    const aliceVerifs = await countVerifs(alice);
    check("a professor confirm never counts as 'people met'",
      bobVerifs === 0 && aliceVerifs > 0,
      `bob=${bobVerifs} (expect 0), alice=${aliceVerifs} (positive control, expect >0)`);

    // A4 — confirming someone who never checked in.
    const { data: ghost, error: ghostErr } = await admin
      .from("enrollments")
      .insert({ course_id: courseId, roster_name: "Ghost Smoke", roster_email: MAIL("ghost"), status: "active" })
      .select("id").single();
    mustNotError("ghost enrollment", ghostErr);
    const { error: absentErr } = await profClient.rpc("professor_confirm_attendance", {
      p_session: sid, p_enrollment: ghost!.id,
    });
    check("confirming an absent student is refused (P0007)",
      absentErr?.code === "P0007", `code=${absentErr?.code ?? "none"}`);

    console.log("\n--- RLS: what a student may and may not do ---");

    // A5 — a student cannot resolve a denial. Row count alone cannot tell
    // "RLS blocked it" from "matched nothing", so the row is read back.
    const openDenialId = await deny(alice, bob, "right");
    await aliceClient.from("seat_denials")
      .update({ resolved_at: new Date().toISOString(), resolved_by: "peer_confirm" })
      .eq("id", openDenialId);
    const stillOpen = (await denialsFor(bob)).find((d) => d.id === openDenialId)!;
    check("a student cannot clear a denial themselves",
      stillOpen.resolved_at === null && stillOpen.resolved_by === null,
      `resolved_at=${stillOpen.resolved_at ?? "null"}`);

    // A6 — THE RELEASE-SEAT BUG. Before 0036 there was no DELETE policy on
    // check_ins, so "free this seat" silently deleted zero rows. The
    // professor deleting the SAME row is the positive control that proves
    // the student's empty result meant "blocked", not "nothing matched".
    const bobRow = await readCheckIn(bob);
    const { data: studentDeleted } = await aliceClient
      .from("check_ins").delete().eq("id", bobRow.id).select("id");
    const survived = await readCheckIn(bob);
    const { data: profDeleted } = await profClient
      .from("check_ins").delete().eq("id", bobRow.id).select("id");
    check("a student cannot delete a classmate's check-in",
      (studentDeleted ?? []).length === 0 && survived.id === bobRow.id,
      `rows=${(studentDeleted ?? []).length}, row survived=${survived.id === bobRow.id}`);
    check("the professor CAN free a seat (the bug 0036 fixed)",
      (profDeleted ?? []).length === 1, `rows=${(profDeleted ?? []).length}`);

    console.log("\n--- reassign_seat keeps a professor's confirmation ---");

    // Bob back in A2 and professor-confirmed; Alice is in A1. Swapping them
    // must exercise the delete-and-reinsert branch — the only code 0036
    // changed in reassign_seat — so the swap itself is asserted, not just
    // the column surviving.
    const { error: backErr } = await admin
      .from("check_ins").insert({ session_id: sid, enrollment_id: bob, seat_id: seatId("A2") });
    mustNotError("bob re-check-in", backErr);
    await profClient.rpc("professor_confirm_attendance", { p_session: sid, p_enrollment: bob });
    const swapBefore = await readCheckIn(bob);
    const { error: swapErr } = await profClient.rpc("reassign_seat", {
      p_session: sid, p_enrollment: alice, p_seat: seatId("A2"),
    });
    mustNotError("reassign_seat", swapErr);
    const bobSwapped = await readCheckIn(bob);
    const aliceSwapped = await readCheckIn(alice);
    check("the swap actually happened (delete-and-reinsert branch ran)",
      aliceSwapped.seat_id === seatId("A2") && bobSwapped.seat_id === seatId("A1"),
      `alice=${aliceSwapped.seat_id === seatId("A2") ? "A2" : "?"} bob=${bobSwapped.seat_id === seatId("A1") ? "A1" : "?"}`);
    check("a seat swap preserves the displaced student's confirmation",
      swapBefore.professor_confirmed_at !== null && bobSwapped.professor_confirmed_at !== null,
      `before=${swapBefore.professor_confirmed_at ? "set" : "null"} after=${bobSwapped.professor_confirmed_at ? "set" : "null"}`);

    await profClient.auth.signOut();
    await aliceClient.auth.signOut();
  } finally {
    await cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nSmoke test aborted:", e.message);
  process.exit(1);
});
