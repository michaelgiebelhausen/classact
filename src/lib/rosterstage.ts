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

export const ROSTER_STAGE_ORDER = [
  "needs_password",
  "needs_class",
  "invite_failed",
  "duplicate",
  "self_joined",
  "canvas_confirmed",
  "canvas_pending",
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
}

const sameAddress = (a: string | null, b: string | null): boolean =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

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

  // Claimed, but not through the address Canvas holds — the g.clemson twin,
  // or anyone who signed up with a personal address and reached the row by
  // course code. Worth showing separately: Canvas has not been confirmed.
  if (facts.accountEmail && !sameAddress(facts.accountEmail, facts.rosterEmail)) {
    return "self_joined";
  }

  // Claimed and still pending: no Canvas row existed, so /auth/join created
  // one for them. Waiting on the professor, not lost.
  if (facts.status !== "active") return "self_joined";

  // Being active is not evidence of having come from Canvas. A course-code
  // joiner whose login happens to equal their roster address looks identical
  // to a confirmed import from every angle except this one — which is why
  // `wgt567654@gmail.com`, a Gmail address that was never on a Clemson Canvas
  // roster, was filed under "Confirmed from Canvas" on the live page.
  // Provenance is recorded now, so stop inferring it.
  if (!facts.canvasSeenAt) return "self_joined";

  return "canvas_confirmed";
}

export const ROSTER_STAGE_META: Record<
  RosterStage,
  { title: string; blurb: string; tone: "destructive" | "secondary" | "default" | "outline" }
> = {
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
    title: "Joined, but not through Canvas",
    blurb:
      "In the class, signed in with an address Canvas doesn't have — or they joined with the course code and aren't on the Canvas roster at all.",
    tone: "secondary",
  },
  canvas_confirmed: {
    title: "Confirmed from Canvas",
    blurb: "Imported from Canvas and signed in with their Canvas address. Nothing to do.",
    tone: "default",
  },
  canvas_pending: {
    title: "From Canvas, not yet signed in",
    blurb: "On the Canvas roster. They haven't claimed their account yet.",
    tone: "outline",
  },
  no_longer_on_canvas: {
    title: "No longer on Canvas",
    blurb:
      "Canvas listed these students once and the last sync didn't find them — usually a drop. Students who joined with the course code and were never in Canvas are not shown here. Someone in a section you don't sync can still appear, so check before dropping.",
    tone: "outline",
  },
};
