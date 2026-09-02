import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import {
  activationState,
  ACTIVATION_META,
  type AccountFacts,
} from "@/lib/activation";
import { emailAliasOf } from "@/lib/emailalias";
import { isEmailAddress, rosterDisplayName } from "@/lib/names";
import { rankCanvasCandidates } from "@/lib/canvasmatch";
import {
  rosterStage,
  ROSTER_STAGE_ORDER,
  type RosterStage,
} from "@/lib/rosterstage";
import type {
  StagedPerson,
  MatchCandidate,
} from "@/components/features/roster/StagedRoster";

/**
 * The auth-user facts stageRoster needs, cached per process for a minute
 * with in-flight de-duplication. listUsers is the GoTrue admin endpoint
 * returning EVERY account in the project (hundreds of full records) and it
 * ran on every open of the course home page. The facts it yields (has this
 * address ever signed in, which address does a profile use) change on the
 * order of minutes, not requests.
 */
interface AuthFacts {
  facts: Map<string, AccountFacts>;
  emailByProfile: Map<string, string>;
}
const AUTH_FACTS_TTL_MS = 60_000;
let authFactsCache: { expires: number; value: AuthFacts } | null = null;
let authFactsInFlight: Promise<AuthFacts> | null = null;

async function loadAuthFacts(admin: SupabaseClient<Database>): Promise<AuthFacts> {
  const now = Date.now();
  if (authFactsCache && authFactsCache.expires > now) return authFactsCache.value;
  if (authFactsInFlight) return authFactsInFlight;
  authFactsInFlight = (async () => {
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
    const value = { facts, emailByProfile };
    authFactsCache = { expires: Date.now() + AUTH_FACTS_TTL_MS, value };
    return value;
  })().finally(() => {
    authFactsInFlight = null;
  });
  return authFactsInFlight;
}

/** Forget cached auth facts. Call after anything that changes an account. */
export function invalidateAuthFacts(): void {
  authFactsCache = null;
}

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
  const schoolEmailByProfile = new Map<string, string>();
  const fullNameByProfile = new Map<string, string>();

  // The school address a student claims, which is what identifies them on the
  // Canvas roster when they sign in with something else entirely. Fetched
  // alongside the auth facts, not after them.
  const linked = [
    ...new Set(
      enrollments
        .map((e) => e.profile_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const [{ facts, emailByProfile }, { data: profiles }] = await Promise.all([
    loadAuthFacts(admin),
    linked.length > 0
      ? admin.from("profiles").select("id, school_email, full_name").in("id", linked)
      : Promise.resolve({
          data: [] as Array<{ id: string; school_email: string | null; full_name: string | null }>,
        }),
  ]);
  for (const p of profiles ?? []) {
    if (p.school_email) schoolEmailByProfile.set(p.id, p.school_email);
    if (p.full_name) fullNameByProfile.set(p.id, p.full_name);
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
      schoolEmail: e.profile_id
        ? schoolEmailByProfile.get(e.profile_id) ?? null
        : null,
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

  // Candidates for the students who still need matching to a Canvas row.
  // Second pass, because it needs to know which rows ended up unclaimed.
  const unclaimed: MatchCandidate[] = enrollments
    .filter((e) => !e.profile_id && e.canvas_seen_at)
    .map((e) => ({
      id: e.id,
      name: e.roster_name,
      email: e.roster_email,
      photoUrl: photoMap.get(e.id)?.[0] ?? null,
      confident: false,
    }));

  if (unclaimed.length > 0) {
    for (const person of groups.self_joined) {
      const enrollment = enrollments.find((e) => e.id === person.id);
      if (!enrollment || enrollment.canvas_seen_at) continue;
      // A course-code row is named after its address, so the account's own
      // name is the only real name signal available.
      const display = rosterDisplayName(
        enrollment.roster_name,
        enrollment.profile_id
          ? fullNameByProfile.get(enrollment.profile_id) ?? null
          : null
      );
      const ranked = rankCanvasCandidates(
        { name: display, email: enrollment.roster_email },
        unclaimed
      )
        .filter((r) => r.score >= 40)
        .slice(0, 3);
      if (ranked.length > 0) {
        person.candidates = ranked.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          photoUrl: unclaimed.find((u) => u.id === r.id)?.photoUrl ?? null,
          confident: r.confident,
        }));
      }
    }
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
