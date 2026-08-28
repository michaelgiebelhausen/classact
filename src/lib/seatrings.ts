/**
 * Ring state for a checked-in student on the seat map.
 *
 * The map is projected during arrival, and the ring is the public answer to
 * one question per student: has anyone vouched that this person is really in
 * that seat? Green says yes (a neighbor, or the professor). Red says not yet,
 * and is deliberately visible — the mild social pressure is what motivates
 * students to actually turn to each other. Amber says "nobody around them to
 * ask", so an early arriver in an empty row isn't shamed for a confirmation
 * that is physically impossible. Denied pulses: a neighbor looked at the seat
 * and said the claimed person is not in it, which is the actual signature of
 * a proxy check-in.
 *
 * Precedence leans on a database invariant rather than timestamps: every
 * confirmation path (peer confirm, professor confirm, seat change) resolves
 * all active denials in the same transaction, so an active denial is always
 * NEWER than the last confirmation. That is why `denied` may safely outrank
 * `confirmed` here.
 */

import type { SeatRelation } from "@/types/db";

export type SeatRing = "denied" | "confirmed" | "unconfirmed" | "unconfirmable";

export interface SeatRingInputs {
  /** A neighbor confirmed them this session (check_ins.verified). */
  verified: boolean;
  /** The professor confirmed them from the map (professor_confirmed_at set). */
  professorConfirmed: boolean;
  /** Active "not in that seat" reports (check_ins.denied_count). */
  deniedCount: number;
  /** Any adjacent seat is occupied by someone else — so a peer COULD vouch. */
  hasOccupiedAdjacentSeat: boolean;
}

export function deriveSeatRing(inputs: SeatRingInputs): SeatRing {
  if (inputs.deniedCount > 0) return "denied";
  if (inputs.verified || inputs.professorConfirmed) return "confirmed";
  return inputs.hasOccupiedAdjacentSeat ? "unconfirmed" : "unconfirmable";
}

/**
 * The relation words, from both sides of the sentence.
 *
 * "theirs" describes the neighbor from the viewer's seat ("Alex, to your
 * left"). "mine" is the first person of the deny sentence, which quotes the
 * viewer ("Alex is not in the seat to my left") — the exact wording the
 * professor reads on a flagged seat, so it must sound like a person said it.
 */
export function relationPhrase(
  relation: SeatRelation,
  voice: "mine" | "theirs"
): string {
  switch (relation) {
    case "front":
      return voice === "mine" ? "in front of me" : "in front of you";
    case "back":
      return voice === "mine" ? "behind me" : "behind you";
    case "left":
      return voice === "mine" ? "to my left" : "to your left";
    case "right":
      return voice === "mine" ? "to my right" : "to your right";
  }
}

/** The deny sentence, verbatim — shown before reporting and to the professor. */
export function denySentence(firstName: string, relation: SeatRelation): string {
  return `${firstName} is not in the seat ${relationPhrase(relation, "mine")}.`;
}
