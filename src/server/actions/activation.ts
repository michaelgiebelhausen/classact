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
import { canResetAccount } from "@/lib/accountreset";
import { canApproveJoiner } from "@/lib/approvejoiner";
import { canResolveDuplicate } from "@/lib/duplicateresolve";
import { emailAliasOf } from "@/lib/emailalias";
import { invalidateCourseDirectory } from "@/lib/coursedirectory";
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

const resetSchema = z.object({
  courseId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
});

/**
 * Clear a stuck student's dead account so they can register again on the spot.
 *
 * The in-room remedy. A set-password link is gentler and is the right call
 * away from a classroom, but it is an email round trip — useless to a student
 * standing at the front of the room while the class waits. With email
 * confirmation off, re-registering takes a password and a join code and is
 * instant.
 *
 * Refuses any account that has ever been signed into: that account works, and
 * deleting it is the one action here with no undo. Attendance is unaffected
 * either way — `enrollments.profile_id` is ON DELETE SET NULL, so the roster
 * row and every check-in on it survive.
 */
export async function resetStuckAccount(input: {
  courseId: string;
  enrollmentId: string;
}): Promise<ActionResult<{ email: string }>> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const owned = await ownedCourse(parsed.data.courseId);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "The server isn't configured to reset accounts." };
  }

  const supabase = await createClient();
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, roster_email, roster_name")
    .eq("course_id", parsed.data.courseId)
    .eq("id", parsed.data.enrollmentId)
    .maybeSingle();
  if (!enrollment) {
    return { ok: false, error: "That student isn't on this roster." };
  }

  const admin = createAdminClient();
  const email = enrollment.roster_email.toLowerCase();

  // Find the auth user by address rather than trusting profile_id: the whole
  // point is that this account may never have linked itself to the row.
  const { data: list } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const user = (list?.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === email
  );

  const verdict = canResetAccount({
    hasAccount: Boolean(user),
    everSignedIn: Boolean(user?.last_sign_in_at),
  });
  if (!verdict.allowed) return { ok: false, error: verdict.reason };

  const { error } = await admin.auth.admin.deleteUser(user!.id);
  if (error) {
    return { ok: false, error: "Couldn't reset that account. Try again." };
  }

  // The cascade nulls profile_id but leaves the status where it was. Put the
  // row back to 'invited' so it reads as awaiting a student rather than as an
  // active enrollment with nobody in it.
  await supabase
    .from("enrollments")
    .update({ status: "invited" as const })
    .eq("id", enrollment.id);

  invalidateCourseDirectory(parsed.data.courseId);
  revalidatePath(`/course/${parsed.data.courseId}`);
  revalidatePath(`/course/${parsed.data.courseId}/setup`);
  return { ok: true, data: { email: enrollment.roster_email } };
}

const approveSchema = z.object({
  courseId: z.string().uuid(),
  enrollmentIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Let students who joined with the course code actually attend.
 *
 * `/auth/join` parks off-roster joiners in a pending row, and `checkIn`
 * requires `status = 'active'` — so until now they signed up, joined, and were
 * turned away at the seat map with "You're not on this course's active roster
 * yet." They had no idea anything was wrong, which makes it worse than being
 * plainly locked out.
 *
 * Only rows an account actually owns are touched. The filter is applied in the
 * query as well as the guard, so a stale id from the client can't activate a
 * roster row nobody has claimed.
 */
export async function approveJoiners(input: {
  courseId: string;
  enrollmentIds: string[];
}): Promise<ActionResult<{ approved: number }>> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const owned = await ownedCourse(parsed.data.courseId);
  if (!owned.ok) return { ok: false, error: owned.error };

  const supabase = await createClient();
  const { data: targets } = await supabase
    .from("enrollments")
    .select("id, status, profile_id")
    .eq("course_id", parsed.data.courseId)
    .in("id", parsed.data.enrollmentIds);

  const eligible = (targets ?? [])
    .filter((e) =>
      canApproveJoiner({ status: e.status, hasProfile: Boolean(e.profile_id) })
    )
    .map((e) => e.id);

  if (eligible.length === 0) {
    return { ok: false, error: "Nobody there needs approving." };
  }

  const { data: updated, error } = await supabase
    .from("enrollments")
    .update({ status: "active" as const })
    .eq("course_id", parsed.data.courseId)
    .in("id", eligible)
    .eq("status", "invited")
    .not("profile_id", "is", null)
    .select("id");
  if (error) {
    return { ok: false, error: "Couldn't approve them — try again." };
  }

  invalidateCourseDirectory(parsed.data.courseId);
  revalidatePath(`/course/${parsed.data.courseId}`);
  revalidatePath(`/course/${parsed.data.courseId}/setup`);
  return { ok: true, data: { approved: (updated ?? []).length } };
}

const duplicateSchema = z.object({
  courseId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
});

/**
 * Remove the shadow row when a student is on the roster twice.
 *
 * The pattern, seen four times by hand and identical every time: the student
 * signed in with their university Google account, which created a second auth
 * user and a second enrolment; later they reached their real Clemson account
 * and did everything there. The shadow holds a handful of icebreaker answers
 * and no attendance.
 *
 * The orphaned login goes too, but only once it owns nothing anywhere —
 * otherwise the student would be signing in to an account that can no longer
 * reach any class, and the next time they used the course code it would build
 * the same shadow again.
 *
 * Refuses anything that isn't demonstrably a duplicate: no surviving twin, or
 * any check-in on the row being removed.
 */
export async function resolveDuplicate(input: {
  courseId: string;
  enrollmentId: string;
}): Promise<ActionResult<{ removed: string; accountDeleted: boolean }>> {
  const parsed = duplicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const owned = await ownedCourse(parsed.data.courseId);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "The server isn't configured for this." };
  }

  const supabase = await createClient();
  const { data: shadow } = await supabase
    .from("enrollments")
    .select("id, roster_email, profile_id")
    .eq("course_id", parsed.data.courseId)
    .eq("id", parsed.data.enrollmentId)
    .maybeSingle();
  if (!shadow) return { ok: false, error: "That row isn't on this roster." };

  // The twin is found by address alias, the same rule the sync uses, rather
  // than by name — the shadow's name is usually just its own address.
  const alias = emailAliasOf(shadow.roster_email.toLowerCase());
  const { data: twin } = alias
    ? await supabase
        .from("enrollments")
        .select("id, roster_name")
        .eq("course_id", parsed.data.courseId)
        .ilike("roster_email", alias)
        .neq("id", shadow.id)
        .maybeSingle()
    : { data: null };

  const { count } = await supabase
    .from("check_ins")
    .select("id", { count: "exact", head: true })
    .eq("enrollment_id", shadow.id);

  const verdict = canResolveDuplicate({
    hasTwin: Boolean(twin),
    shadowCheckIns: count ?? 0,
  });
  if (!verdict.allowed) return { ok: false, error: verdict.reason };

  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", shadow.id);
  if (error) return { ok: false, error: "Couldn't remove that row. Try again." };

  // Clean up the login behind it, but only when it now owns nothing at all.
  let accountDeleted = false;
  if (shadow.profile_id) {
    const admin = createAdminClient();
    const { data: stillOwns } = await admin
      .from("enrollments")
      .select("id")
      .eq("profile_id", shadow.profile_id)
      .limit(1);
    if ((stillOwns ?? []).length === 0) {
      const { error: delErr } = await admin.auth.admin.deleteUser(
        shadow.profile_id
      );
      accountDeleted = !delErr;
    }
  }

  invalidateCourseDirectory(parsed.data.courseId);
  revalidatePath(`/course/${parsed.data.courseId}`);
  return {
    ok: true,
    data: { removed: shadow.roster_email, accountDeleted },
  };
}
