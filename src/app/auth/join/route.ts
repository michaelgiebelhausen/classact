import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, isConfigured } from "@/lib/env";
import { normalizeJoinCode } from "@/lib/joincode";
import { invalidateCourseDirectory } from "@/lib/coursedirectory";
import { emailAliasOf } from "@/lib/emailalias";

/**
 * Post-auth landing for students joining by code:
 * 1. Look up the course by join code.
 * 2. Match the authed email to a roster row -> link + activate.
 *    Off-roster -> create a pending ('invited') enrollment the professor can see.
 * 3. Send the student to onboarding.
 * Uses the admin client (join codes are pre-membership), but every write is
 * bound to the authed user's own email/profile id.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = normalizeJoinCode(searchParams.get("code") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    // No session yet. That isn't an expired link — it's a student who hasn't
    // signed up. Send them to the join form for this code (which is where the
    // invite email pointed) rather than to a login page claiming their link
    // died. Without a code there is nothing to join, so /login is honest.
    return NextResponse.redirect(
      new URL(
        code ? `/join/${encodeURIComponent(code)}` : "/login",
        env.siteUrl
      )
    );
  }
  if (!code || !isConfigured.supabaseAdmin) {
    return NextResponse.redirect(new URL("/dashboard", env.siteUrl));
  }

  const admin = createAdminClient();

  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("join_code", code)
    .single();
  if (!course) {
    return NextResponse.redirect(new URL("/join?error=badcode", env.siteUrl));
  }

  const email = user.email.toLowerCase();

  // A university Google sign-in can carry the g.-twin of the address Canvas
  // put on the roster (jblind@g.clemson.edu vs jblind@clemson.edu). Match
  // either, exact first, so the student lands on their imported roster row
  // instead of spawning a duplicate the professor later mistakes for a drop.
  const alias = emailAliasOf(email);
  const { data: matches } = await admin
    .from("enrollments")
    .select("id, profile_id, status, roster_email")
    .eq("course_id", course.id)
    .in("roster_email", alias ? [email, alias] : [email]);
  const existing =
    (matches ?? []).find((m) => m.roster_email === email) ??
    (matches ?? [])[0] ??
    null;

  if (existing) {
    if (existing.profile_id !== user.id || existing.status !== "active") {
      // Covers 'dropped' too: a dropped student using the course code is
      // re-adding themselves, same as re-appearing in a Canvas resync —
      // reactivate with history intact.
      await admin
        .from("enrollments")
        .update({ profile_id: user.id, status: "active", dropped_at: null })
        .eq("id", existing.id);
    }
  } else {
    // Off-roster joiner: pending row the professor can approve (Open Q6).
    //
    // Unless they are already in this course under another address. The match
    // above is by roster_email, so a student whose row carries their Canvas
    // address while they sign in with a personal one finds nothing — and used
    // to get a SECOND row, pending approval, sitting beside the one holding
    // their attendance. That happened to a real student the day after her two
    // rows were merged by hand: she used the join code again and the merge
    // undid itself.
    //
    // Anyone who already has a row here has already joined, whatever it is
    // named. Re-using the code is then a no-op rather than a duplicate.
    const { data: alreadyIn } = await admin
      .from("enrollments")
      .select("id")
      .eq("course_id", course.id)
      .eq("profile_id", user.id)
      .neq("status", "dropped")
      .maybeSingle();

    if (!alreadyIn) {
      await admin.from("enrollments").insert({
        course_id: course.id,
        profile_id: user.id,
        roster_name: (user.user_metadata?.full_name as string) ?? email,
        roster_email: email,
        status: "invited",
      });
    }
  }

  // The roster just changed — without this a student who joins mid-class
  // renders nameless on everyone else's seat map until the cache expires.
  invalidateCourseDirectory(course.id);

  return NextResponse.redirect(new URL("/onboarding", env.siteUrl));
}
