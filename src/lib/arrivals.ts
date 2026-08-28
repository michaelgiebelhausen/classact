/**
 * Whether a newcomer's check-in should tap the seated student on the shoulder.
 *
 * The confirm card only helps someone already looking at the check-in page,
 * and the post-check-in CTA sends people to the name games — so the one
 * moment the whole feature depends on ("someone just sat down next to you")
 * used to pass silently. The arrival listener watches check-ins course-wide
 * and toasts the seated student wherever they are in the app.
 *
 * This module is the listener's brain, kept pure so every rule is testable:
 *
 *   - social window only: after the scheduled start the room has settled and
 *     an introduction prompt would be a disruption, so late arrivals are
 *     confirmed silently from the card instead (no toast at all);
 *   - adjacency from seats.neighbors — the same persisted links the server
 *     validates against, so a toast can never invite a confirmation the
 *     server would refuse;
 *   - first meetings only: someone you've confirmed in ANY past session gets
 *     the quiet one-tap row on the card, not a "say hi!";
 *   - once per neighbor per mount: realtime redelivers on reconnect, and a
 *     student moving away and back is not two arrivals.
 */

import type { SeatRelation } from "@/types/db";

export interface ArrivalSeat {
  id: string;
  label: string;
  neighbors: Partial<Record<SeatRelation, string>>;
}

export interface ArrivalContext {
  myEnrollmentId: string;
  /** My current seat, or null when I haven't checked in yet. */
  mySeatId: string | null;
  seats: ArrivalSeat[];
  /** People I've confirmed (either direction) in any session, ever. */
  metBeforeIds: ReadonlySet<string>;
  /** People I've confirmed this session (locally tracked). */
  confirmedIds: ReadonlySet<string>;
  /** Neighbors already toasted since this listener mounted. */
  toastedIds: ReadonlySet<string>;
  social: boolean;
}

export interface Arrival {
  enrollmentId: string;
  seatId: string;
}

export type ArrivalDecision =
  | { toast: true; enrollmentId: string; relation: SeatRelation }
  | { toast: false; reason: ArrivalSkipReason };

export type ArrivalSkipReason =
  | "quiet_mode"
  | "not_seated"
  | "own_checkin"
  | "not_adjacent"
  | "met_before"
  | "already_confirmed"
  | "already_toasted";

/**
 * The relation is read from MY seat's neighbor links ("their seat is the one
 * to my left"), because that is the relation verifyNeighbor will validate.
 */
export function adjacentRelation(
  mySeat: ArrivalSeat | undefined,
  theirSeat: ArrivalSeat | undefined
): SeatRelation | null {
  if (!mySeat || !theirSeat) return null;
  for (const relation of ["front", "back", "left", "right"] as const) {
    if (mySeat.neighbors?.[relation] === theirSeat.label) return relation;
  }
  return null;
}

export function decideArrivalToast(
  ctx: ArrivalContext,
  arrival: Arrival
): ArrivalDecision {
  if (!ctx.social) return { toast: false, reason: "quiet_mode" };
  if (!ctx.mySeatId) return { toast: false, reason: "not_seated" };
  if (arrival.enrollmentId === ctx.myEnrollmentId)
    return { toast: false, reason: "own_checkin" };
  if (ctx.toastedIds.has(arrival.enrollmentId))
    return { toast: false, reason: "already_toasted" };
  if (ctx.confirmedIds.has(arrival.enrollmentId))
    return { toast: false, reason: "already_confirmed" };
  if (ctx.metBeforeIds.has(arrival.enrollmentId))
    return { toast: false, reason: "met_before" };

  const byId = new Map(ctx.seats.map((s) => [s.id, s]));
  const relation = adjacentRelation(byId.get(ctx.mySeatId), byId.get(arrival.seatId));
  if (!relation) return { toast: false, reason: "not_adjacent" };

  return { toast: true, enrollmentId: arrival.enrollmentId, relation };
}

/**
 * The social window is a hard boundary, not a mood: before the scheduled
 * start, introductions are the point; from the scheduled minute onward the
 * room belongs to the lecture. No schedule means no boundary to compute, so
 * the caller supplies the session's opened_at and we allow a short arrival
 * window after it — bounded, so a professor who opens the session mid-class
 * doesn't trigger toasts twenty minutes into a lecture.
 */
export const NO_SCHEDULE_SOCIAL_WINDOW_MS = 15 * 60 * 1000;

export function socialModeEndsAt(
  scheduledStartAt: string | null,
  sessionOpenedAt: string | null
): Date | null {
  if (scheduledStartAt) {
    const t = new Date(scheduledStartAt);
    return Number.isNaN(t.getTime()) ? null : t;
  }
  if (sessionOpenedAt) {
    const t = new Date(sessionOpenedAt);
    if (Number.isNaN(t.getTime())) return null;
    return new Date(t.getTime() + NO_SCHEDULE_SOCIAL_WINDOW_MS);
  }
  return null;
}

/** No boundary at all is treated as quiet: never toast into an unknown room. */
export function isSocialMode(endsAt: Date | null, now: Date): boolean {
  return endsAt !== null && now.getTime() < endsAt.getTime();
}
