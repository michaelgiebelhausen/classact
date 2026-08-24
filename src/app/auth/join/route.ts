import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, isConfigured } from "@/lib/env";
import { normalizeJoinCode } from "@/lib/joincode";

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

  const { data: existing } = await admin
    .from("enrollments")
    .select("id, profile_id, status")
    .eq("course_id", course.id)
    .eq("roster_email", email)
    .maybeSingle();

  if (existing) {
    if (existing.profile_id !== user.id || existing.status !== "active") {
      await admin
        .from("enrollments")
        .update({ profile_id: user.id, status: "active" })
        .eq("id", existing.id);
    }
  } else {
    // Off-roster joiner: pending row the professor can approve (Open Q6).
    await admin.from("enrollments").insert({
      course_id: course.id,
      profile_id: user.id,
      roster_name: (user.user_metadata?.full_name as string) ?? email,
      roster_email: email,
      status: "invited",
    });
  }

  return NextResponse.redirect(new URL("/onboarding", env.siteUrl));
}
