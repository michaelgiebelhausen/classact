/**
 * How far along the registration path each person on a roster actually is.
 *
 * A flat grid of faces answered "who is on the roster" but not the question a
 * professor opening a class actually has, which is "who still needs something
 * from me". This groups the roster into four stages, ordered so that problems
 * are at the top and the large passive block of unclaimed Canvas rows sits at
 * the bottom.
 *
 * Orthogonal to `activationState` rather than a replacement for it. That
 * machine answers *what is blocking this student*; this one answers *how did
 * they get here and are they through*. Both are needed: "confirmed their email
 * but never got a session" is a blocking reason, "arrived from Canvas" is a
 * provenance, and the sections need one of each.
 *
 * There is no per-enrollment Canvas flag in the schema — the `canvas_*`
 * columns live on `courses` — so provenance is inferred from two facts that
 * are recorded: whether a profile has claimed the row, and whether the address
 * they signed in with is the address Canvas put on it.
 */
import type { ActivationState } from "@/lib/activation";

export const ROSTER_STAGE_ORDER = [
  "limbo",
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
}

/**
 * States where the student cannot get themselves any further.
 *
 * `signed_in_not_joined` is in here only for rows nobody has claimed: it means
 * an account exists for the roster address and has been used, yet this row is
 * still unlinked. On a row that *is* claimed the same state just means an
 * off-roster joiner waiting to be approved, which is not a problem.
 */
const BLOCKED: ActivationState[] = [
  "stuck_no_session",
  "send_failed",
  "signed_in_not_joined",
];

const sameAddress = (a: string | null, b: string | null): boolean =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

export function rosterStage(facts: RosterStageFacts): RosterStage {
  // Checked before everything else. Someone Canvas has stopped listing may
  // have left the course, and a student who left is not a support queue:
  // leaving them under "needs you" sends the professor chasing somebody who
  // dropped. Their real state is preserved on the row, so if Canvas lists
  // them again the next sync clears this and they return to it.
  if (facts.canvasMissingSince) return "no_longer_on_canvas";

  if (!facts.hasProfile) {
    return BLOCKED.includes(facts.activation) ? "limbo" : "canvas_pending";
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

  return "canvas_confirmed";
}

export const ROSTER_STAGE_META: Record<
  RosterStage,
  { title: string; blurb: string; tone: "destructive" | "secondary" | "default" | "outline" }
> = {
  limbo: {
    title: "Stuck — needs you",
    blurb:
      "These students can't get themselves any further. A bounced invite, or an account that confirmed its email but never got signed in.",
    tone: "destructive",
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
