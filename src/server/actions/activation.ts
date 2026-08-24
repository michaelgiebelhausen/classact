"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, isConfigured } from "@/lib/env";
import { sendRecoveryEmails, type RecoveryRecipient } from "@/lib/email";
import { firstName } from "@/lib/invitetemplate";
import {
  activationState,
  type AccountFacts,
  type ActivationState,
} from "@/lib/activation";
import type { ActionResult } from "@/server/actions/auth";

export type ActivationRow = {
  enrollmentId: string;
  name: string;
  email: string;
  state: ActivationState;
  invitedAt: string | null;
  inviteError: string | null;
};

type OwnedCourse =
  | { ok: false; error: string }
  | { ok: true; course: { id: string; name: string; join_code: string } };

/**
 * Guard: only the course owner may see or act on a roster's activation state.
 * Explicitly typed — an inferred union collapses the two branches into
 * optional properties, which loses the narrowing at every call site.
 */
async function ownedCourse(courseId: string): Promise<OwnedCourse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: course } = await supabase
    .from("courses")
    .select("id, name, join_code, professor_id")
    .eq("id", courseId)
    .single();

  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Not course owner." };
  }
  return {
    ok: true,
    course: { id: course.id, name: course.name, join_code: course.join_code },
  };
}

/**
 * Build the activation picture for a roster.
 *
 * Whether a student ever obtained a session lives in `auth.users`, which
 * PostgREST does not expose, so this needs the admin client. Everything it
 * reads is reduced to two booleans per address before it leaves the server —
 * the browser never receives auth records.
 */
export async function getActivationRoster(
  courseId: string
): Promise<ActionResult<{ rows: ActivationRow[] }>> {
  const owned = await ownedCourse(courseId);
  if (!owned.ok) return { ok: false, error: owned.error };

  const supabase = await createClient();
  const { data: enrollments, error } = await supabase
    .from("enrollments")
    .select("id, roster_name, roster_email, status, profile_id, invited_at, invite_error")
    .eq("course_id", courseId)
    .neq("status", "dropped")
    .order("roster_name");

  if (error) return { ok: false, error: "Couldn't load the roster." };

  // Without the service role we can still classify on enrollment data alone;
  // the account-derived states just collapse into the receipt-derived ones.
  const accounts = new Map<string, AccountFacts>();
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users ?? []) {
      if (!u.email) continue;
      accounts.set(u.email.toLowerCase(), {
        emailConfirmed: Boolean(u.email_confirmed_at),
        everSignedIn: Boolean(u.last_sign_in_at),
      });
    }
  }

  const rows: ActivationRow[] = (enrollments ?? []).map((e) => ({
    enrollmentId: e.id,
    name: e.roster_name,
    email: e.roster_email,
    invitedAt: e.invited_at,
    inviteError: e.invite_error,
    state: activationState(
      {
        status: e.status,
        profileId: e.profile_id,
        invitedAt: e.invited_at,
        inviteError: e.invite_error,
      },
      accounts.get(String(e.roster_email).toLowerCase()) ?? null
    ),
  }));

  return { ok: true, data: { rows } };
}

const sendSchema = z.object({
  courseId: z.string().uuid(),
  enrollmentIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Email set-a-password links to students who are locked out.
 *
 * The link is built from `generateLink`'s `hashed_token` rather than its
 * `action_link`. `action_link` routes through Supabase's `/auth/v1/verify`,
 * which hands back a PKCE `code` — the device-bound path that stranded these
 * students. A `token_hash` link is verified by `verifyOtp`, which reads no
 * local storage, so it opens on any phone.
 */
export async function sendSetPasswordLinks(input: {
  courseId: string;
  enrollmentIds: string[];
}): Promise<ActionResult<{ sent: number; failed: number }>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const owned = await ownedCourse(parsed.data.courseId);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "The server isn't configured to issue recovery links." };
  }
  if (!isConfigured.email) {
    return { ok: false, error: "Email isn't configured yet (RESEND_API_KEY)." };
  }

  const supabase = await createClient();
  const { data: targets } = await supabase
    .from("enrollments")
    .select("id, roster_name, roster_email")
    .eq("course_id", parsed.data.courseId)
    .neq("status", "dropped")
    .in("id", parsed.data.enrollmentIds);

  if (!targets || targets.length === 0) {
    return { ok: false, error: "No matching students on this roster." };
  }

  const admin = createAdminClient();
  const recipients: RecoveryRecipient[] = [];
  let failed = 0;

  for (const t of targets) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: t.roster_email,
    });
    const hashed = data?.properties?.hashed_token;
    if (error || !hashed) {
      // No account for that address yet — an invite, not a rescue, is what
      // they need. Counted rather than surfaced per-student.
      failed += 1;
      continue;
    }

    const url = new URL("/auth/callback", env.siteUrl);
    url.searchParams.set("token_hash", hashed);
    url.searchParams.set("type", "recovery");
    url.searchParams.set("next", "/update-password");

    recipients.push({
      enrollmentId: t.id,
      to: t.roster_email,
      firstName: firstName(t.roster_name),
      courseName: owned.course.name,
      link: url.toString(),
    });
  }

  if (recipients.length === 0) {
    return { ok: false, error: "None of those students have an account to recover." };
  }

  const results = await sendRecoveryEmails(recipients, owned.course.name);
  const sent = results.filter((r) => r.sent).length;
  failed += results.length - sent;

  revalidatePath(`/course/${parsed.data.courseId}/setup`);
  return { ok: true, data: { sent, failed } };
}
