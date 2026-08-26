/**
 * How far along the registration path each person on a roster actually is.
 *
 * A flat grid of faces answered "who is on the roster" but not the question a
 * professor opening a class actually has, which is "who still needs something
 * from me". This groups the roster into five stages, ordered so that problems
 * are at the top, the large passive block of unclaimed Canvas rows sits low,
 * and people who have left the course sit lower still.
 *
 * Orthogonal to `activationState` rather than a replacement for it. That
 * machine answers *what is blocking this student*; this one answers *how did
 * they get here and are they through*. Both are needed: "confirmed their email
 * but never got a session" is a blocking reason, "arrived from Canvas" is a
 * provenance, and the sections need one of each.
 *
 * Provenance is READ, not inferred. `enrollments.canvas_seen_at` (0031) is
 * stamped whenever a sync matches or imports someone, and both Canvas-facing
 * verdicts — confirmed, and departed — require it. Two rounds of bugs came
 * from guessing instead: course-code joiners were offered as Canvas drops
 * because they were absent from Canvas, and then filed as confirmed imports
 * because their row happened to be active. Neither absence nor status says
 * anything about where a student came from.
 */
import type { ActivationState } from "@/lib/activation";
import { emailAliasOf } from "@/lib/emailalias";

/**
 * Sections in the order a professor should work them: everything with
 * something owed first, settled groups after, departures last.
 *
 * "From Canvas, not yet signed in" belongs in the first group — a student who
 * hasn't claimed an account is not in the class yet, and that needs an invite.
 * "In the class, but not through Canvas" belongs in the second: an auditor or
 * a student on their own address is settled, however unusual the row looks.
 */
export const ROSTER_STAGE_ORDER = [
  "awaiting_approval",
  "needs_password",
  "needs_class",
  "invite_failed",
  "canvas_pending",
  "duplicate",
  "self_joined",
  "canvas_confirmed",
  "no_longer_on_canvas",
] as const;

export type RosterStage = (typeof ROSTER_STAGE_ORDER)[number];

export interface RosterStageFacts {
  /** enrollments.profile_id is set — somebody's account owns this row. */
  hasProfile: boolean;
  status: string;
  /** The address the roster carries, i.e. what Canvas said. */
  rosterEmail: string;
  /** The address the linked account actually signs in with, if resolvable. */
  accountEmail: string | null;
  activation: ActivationState;
  /** Set when a sync stopped finding them in Canvas; cleared when it does. */
  canvasMissingSince: string | null;
  /** Set when a Canvas sync has actually matched or imported them. Null means
   *  Canvas has never listed this person, however settled the row looks. */
  canvasSeenAt: string | null;
  /** This row is the auto-created shadow of another row for the same human —
   *  the g.clemson twin of a Canvas import, carrying no name and no photo. */
  isDuplicateShadow: boolean;
  /** The official school address this account claims (0032), which may differ
   *  from the address it signs in with. */
  schoolEmail: string | null;
}

/**
 * The same university identity, not merely the same string.
 *
 * Clemson issues both `x@clemson.edu` and `x@g.clemson.edu` to one person:
 * Canvas reports the first, Google sign-in supplies the second. Exact matching
 * filed seven fully-confirmed students under "not through Canvas" in one
 * section. `emailAliasOf` is deliberately narrow — identical local part, one
 * domain exactly `g.` + the other, .edu only — so a personal address is still
 * a different person.
 */
const sameAddress = (a: string | null, b: string | null): boolean => {
  if (!a || !b) return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || emailAliasOf(x) === y || emailAliasOf(y) === x;
};

export function rosterStage(facts: RosterStageFacts): RosterStage {
  // Checked before everything else. Someone Canvas has stopped listing may
  // have left the course, and a student who left is not a support queue:
  // leaving them under "needs you" sends the professor chasing somebody who
  // dropped. Their real state is preserved on the row, so if Canvas lists
  // them again the next sync clears this and they return to it.
  if (facts.canvasMissingSince) return "no_longer_on_canvas";

  // A shadow row is the same human a second time. Filed as "confirmed from
  // Canvas" it inflates the roster and reads as a nameless, faceless student
  // who is somehow fully set up — which is what made the label untrustworthy.
  if (facts.isDuplicateShadow) return "duplicate";

  if (!facts.hasProfile) {
    // One situation per section, named for the situation rather than lumped
    // under "stuck", because the remedies have nothing in common.
    if (facts.activation === "send_failed") return "invite_failed";
    if (facts.activation === "stuck_no_session") return "needs_password";
    if (facts.activation === "signed_in_not_joined") return "needs_class";
    return "canvas_pending";
  }

  // Confirmed means two recorded things: Canvas has listed this student, and
  // the account holding the row is their university identity. Row status is
  // not part of it — a row still sitting at 'invited' means nobody approved
  // it, which is surfaced on its own rather than by calling the student
  // unconfirmed.
  // The login is a credential; the school address is who they are on the
  // roster. A student signing in as tpallotta17@gmail.com is still
  // tpallot@clemson.edu to Canvas, and either address proving the identity is
  // enough — the claimed one is still matched against *this* row, so claiming
  // an address cannot hand anyone somebody else's place.
  const identityMatches =
    sameAddress(facts.accountEmail, facts.rosterEmail) ||
    sameAddress(facts.schoolEmail, facts.rosterEmail);

  if (facts.canvasSeenAt && identityMatches) return "canvas_confirmed";

  // Joined with the course code and never approved. /auth/join parks them at
  // 'invited', and checkIn requires 'active', so they are turned away at the
  // seat map believing they are set up. Its own section, because it is a
  // one-click fix that is invisible when mixed in with students who are
  // already through.
  if (facts.status !== "active") return "awaiting_approval";

  // Everything else: in the class, signed in with an address that isn't the
  // Canvas identity, or never on the Canvas roster at all — an auditor, or
  // someone added by hand. Settled: nothing is owed to them.
  return "self_joined";
}

export const ROSTER_STAGE_META: Record<
  RosterStage,
  { title: string; blurb: string; tone: "destructive" | "secondary" | "default" | "outline" }
> = {
  awaiting_approval: {
    title: "Joined with the code, waiting on you",
    blurb:
      "They have working accounts and think they're set — but check-in turns them away until you approve them, and nothing tells them so. One click each.",
    tone: "destructive",
  },
  needs_password: {
    title: "Confirmed their email, never got signed in",
    blurb:
      "Their sign-up link only worked in the browser that asked for it, and theirs didn't. They have no password they've ever used. Another invite can't help — the invite isn't what failed.",
    tone: "destructive",
  },
  needs_class: {
    title: "Have a ClassAct account, haven't added the class",
    blurb:
      "They can sign in perfectly well. They've just never joined this course, so nothing here belongs to them yet.",
    tone: "secondary",
  },
  invite_failed: {
    title: "Their invite bounced",
    blurb:
      "The address rejected our mail. Nothing will reach them until it's corrected in Setup.",
    tone: "destructive",
  },
  duplicate: {
    title: "The same person, twice",
    blurb:
      "A second row for someone already on the roster — created when they signed in with their university Google account (name@g.clemson.edu) instead of the address Canvas holds. Their real row has their name and photo; this one has neither.",
    tone: "secondary",
  },
  self_joined: {
    title: "In the class, but not through Canvas",
    blurb:
      "Approved and able to check in. Either they sign in with an address Canvas doesn't hold, or they were never on the Canvas roster — an auditor, or someone you added by hand. Nothing owed.",
    tone: "secondary",
  },
  canvas_confirmed: {
    title: "Imported from Canvas, confirmed with Canvas email",
    blurb:
      "On the Canvas roster and signed in with their university address. Nothing to do.",
    tone: "default",
  },
  canvas_pending: {
    title: "From Canvas, not yet signed in",
    blurb:
      "On the Canvas roster with no account behind them yet. Until they claim one they can't check in, and nothing has told them so — send them an invite.",
    tone: "secondary",
  },
  no_longer_on_canvas: {
    title: "No longer on the Canvas roster",
    blurb:
      "Canvas listed these students once and the last sync didn't find them — usually a drop. Students who joined with the course code and were never in Canvas are not shown here. Someone in a section you don't sync can still appear, so check before dropping.",
    tone: "outline",
  },
};
