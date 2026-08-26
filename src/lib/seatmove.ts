/**
 * Moving to a different seat after checking in.
 *
 * Until this existed there was nothing to do at all: a student who tapped the
 * wrong seat could neither leave it nor pick another, so the person whose seat
 * it actually was had to move instead — one mis-tap displacing two people,
 * with no way for the instructor to sort it out from the front of the room.
 *
 * Modelled as a move rather than a release-then-reselect on purpose. A release
 * would delete the check-in row, and a student who released their seat and got
 * distracted would quietly lose their attendance for the day. An update cannot
 * cost anyone credit: the row — and the attendance and verification on it —
 * survives, only its seat changes.
 */

export type SeatMoveError =
  | "no_session"
  | "not_checked_in"
  | "same_seat"
  | "seat_taken";

export interface SeatMoveInputs {
  sessionOpen: boolean;
  hasCheckIn: boolean;
  targetIsCurrentSeat: boolean;
  targetOccupied: boolean;
}

export type SeatMoveVerdict =
  | { allowed: true }
  | { allowed: false; code: SeatMoveError };

/**
 * Order matters where more than one thing is wrong.
 *
 * The session is checked first because "that seat's taken — pick another" sends
 * someone hunting the room for a free seat when the real answer is that class
 * is over and no seat will work.
 */
export function seatMoveOutcome(inputs: SeatMoveInputs): SeatMoveVerdict {
  if (!inputs.sessionOpen) return { allowed: false, code: "no_session" };
  if (!inputs.hasCheckIn) return { allowed: false, code: "not_checked_in" };
  if (inputs.targetIsCurrentSeat) return { allowed: false, code: "same_seat" };
  if (inputs.targetOccupied) return { allowed: false, code: "seat_taken" };
  return { allowed: true };
}

/** What the student reads for each refusal. */
export const SEAT_MOVE_MESSAGES: Record<SeatMoveError, string> = {
  no_session: "Class has ended — seats are locked for today.",
  not_checked_in: "Check in first, then you can move.",
  same_seat: "You're already in that seat.",
  seat_taken: "Someone just took that seat — pick another.",
};
