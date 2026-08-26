import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import {
  activationState,
  ACTIVATION_META,
  type AccountFacts,
  type ActivationState,
} from "@/lib/activation";
import {
  rosterStage,
  ROSTER_STAGE_ORDER,
  type RosterStage,
} from "@/lib/rosterstage";
import type { StagedPerson } from "@/components/features/roster/StagedRoster";

/** The enrollment columns this needs; a superset is fine. */
export interface StageableEnrollment {
  id: string;
  roster_name: string;
  roster_email: string;
  profile_id: string | null;
  status: string;
  invited_at: string | null;
  invite_error: string | null;
  canvas_missing_since: string | null;
  canvas_seen_at: string | null;
}

/**
 * Group a roster by registration stage.
 *
 * Needs the ADMIN client: whether an address ever obtained a session, and
 * which address a linked profile actually signs in with, both live in
 * `auth.users`, which PostgREST does not expose. Everything read is reduced to
 * a stage and an optional note before it leaves the server — no auth record
 * reaches the browser.
 *
 * Caller must already have established that the viewer owns this course. This
 * performs no authorization of its own.
 */
export async function stageRoster(
  admin: SupabaseClient<Database>,
  enrollments: StageableEnrollment[],
  photoMap: Map<string, string[]>
): Promise<{ groups: Record<RosterStage, StagedPerson[]>; total: number }> {
  const facts = new Map<string, AccountFacts>();
  const emailByProfile = new Map<string, string>();

  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of data?.users ?? []) {
    if (!u.email) continue;
    facts.set(u.email.toLowerCase(), {
      emailConfirmed: Boolean(u.email_confirmed_at),
      everSignedIn: Boolean(u.last_sign_in_at),
    });
    emailByProfile.set(u.id, u.email);
  }

  const groups = Object.fromEntries(
    ROSTER_STAGE_ORDER.map((s) => [s, [] as StagedPerson[]])
  ) as Record<RosterStage, StagedPerson[]>;

  for (const e of enrollments) {
    const accountEmail = e.profile_id
      ? emailByProfile.get(e.profile_id) ?? null
      : null;

    const activation = activationState(
      {
        status: e.status,
        profileId: e.profile_id,
        invitedAt: e.invited_at,
        inviteError: e.invite_error,
      },
      facts.get(e.roster_email.toLowerCase()) ?? null
    );

    const stage = rosterStage({
      hasProfile: Boolean(e.profile_id),
      status: e.status,
      rosterEmail: e.roster_email,
      accountEmail,
      activation,
      canvasMissingSince: e.canvas_missing_since,
      canvasSeenAt: e.canvas_seen_at,
    });

    groups[stage].push({
      id: e.id,
      name: e.roster_name,
      email: e.roster_email,
      photoUrl: photoMap.get(e.id)?.[0] ?? null,
      note: noteFor(stage, e, accountEmail, activation),
      remedy: ACTIVATION_META[activation].remedy,
      pendingApproval: e.status === "invited" && Boolean(e.profile_id),
    });
  }

  return { groups, total: enrollments.length };
}

/**
 * The one detail that makes a row actionable, where the section heading isn't
 * already enough. Kept short — this renders under a face at 10px.
 */
function noteFor(
  stage: RosterStage,
  enrollment: StageableEnrollment,
  accountEmail: string | null,
  activation: ActivationState
): string | undefined {
  if (stage === "limbo") {
    // Three different problems wear the same badge otherwise, and only one of
    // them is fixed by a password link.
    if (activation === "send_failed") return "invite bounced";
    if (activation === "signed_in_not_joined") return "needs an invite";
    return "needs a password";
  }
  if (stage === "self_joined") {
    // The address they actually use is the whole point of this section: it is
    // what a professor needs to reconcile against Canvas.
    if (accountEmail && accountEmail.toLowerCase() !== enrollment.roster_email.toLowerCase()) {
      return accountEmail;
    }
    return "not on Canvas roster";
  }
  return undefined;
}
