import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import {
  activationState,
  ACTIVATION_META,
  type AccountFacts,
} from "@/lib/activation";
import { emailAliasOf } from "@/lib/emailalias";
import { isEmailAddress } from "@/lib/names";
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

  // Shadow rows: the same human twice, because they signed in with their
  // university Google account (name@g.clemson.edu) while Canvas holds
  // name@clemson.edu. The sync's alias matcher marks both as seen, so without
  // this the shadow reads as "confirmed from Canvas" — nameless, faceless and
  // apparently fully set up.
  //
  // The shadow is the one carrying no real name: /auth/join names a row after
  // the address when it has nothing better, while a Canvas import always
  // carries the name Canvas holds. Identifying it by that rather than by which
  // spelling looks official means the row with the student's actual name and
  // photo is always the one kept.
  const byAddress = new Map<string, StageableEnrollment>();
  for (const e of enrollments) byAddress.set(e.roster_email.toLowerCase(), e);
  const shadows = new Set<string>();
  for (const e of enrollments) {
    if (!isEmailAddress(e.roster_name)) continue;
    const alias = emailAliasOf(e.roster_email.toLowerCase());
    if (alias && byAddress.has(alias)) shadows.add(e.id);
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
      isDuplicateShadow: shadows.has(e.id),
    });

    groups[stage].push({
      id: e.id,
      name: e.roster_name,
      email: e.roster_email,
      photoUrl: photoMap.get(e.id)?.[0] ?? null,
      note: noteFor(stage, e, accountEmail),
      remedy: ACTIVATION_META[activation].remedy,
    });
  }

  return { groups, total: enrollments.length };
}

/**
 * The one detail that makes a row actionable, where the section heading isn't
 * already enough. Kept short — this renders under a face at 10px.
 */
/**
 * The detail a section heading can't carry.
 *
 * For anyone signing in as something other than the address Canvas holds, that
 * is the login address itself. The card shows `roster_email` — what Canvas
 * says — and a sync rewrites it to the official spelling, so a student can be
 * displayed under an address they have never typed while being judged on one
 * that was never shown. Printing it removes the guesswork.
 */
function noteFor(
  stage: RosterStage,
  enrollment: StageableEnrollment,
  accountEmail: string | null
): string | undefined {
  const differs =
    accountEmail &&
    accountEmail.toLowerCase() !== enrollment.roster_email.toLowerCase();

  if (stage === "self_joined") {
    return differs ? `signs in as ${accountEmail}` : "not on Canvas roster";
  }
  if (stage === "duplicate" || stage === "canvas_confirmed") {
    return differs ? `signs in as ${accountEmail}` : undefined;
  }
  return undefined;
}
