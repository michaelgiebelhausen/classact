/**
 * What a presenter keypress should actually do.
 *
 * A live class went sideways because this decision lived inline in the
 * presenter's `goTo`: crossing a slide with a queued question silently
 * launched a poll instead of advancing, and every subsequent arrow press was
 * swallowed by an early return. Nothing on screen said so. The professor
 * ended the whole lecture to escape.
 *
 * The rules are small but every one of them is load-bearing, so they live
 * here as pure functions — no React, no Supabase, no PDF — where each can be
 * pinned by a test. The presenter keeps only the side effects.
 */

import type { PollStage } from "@/types/db";

/** A question the professor could be offered, reduced to what routing needs. */
export interface NavQuestion {
  id: string;
  positionAfterPage: number | null;
}

export type NavDecision =
  /** Slides stay put; the caller says why. */
  | { kind: "blocked"; reason: "poll" | "busy" }
  /** Queued question(s) sit at this boundary — ask before running them. */
  | { kind: "offer"; position: number; questionIds: string[] }
  /**
   * Move. `crossedPosition` is the boundary the professor just chose to walk
   * past, so the caller can stop offering it again.
   */
  | { kind: "advance"; page: number; crossedPosition: number | null }
  /** Nothing to do — already there, or clamped onto the current page. */
  | { kind: "none" };

export interface NavInput {
  /** Page the professor asked for (may be out of bounds). */
  requested: number;
  current: number;
  totalPages: number | null;
  /** A poll is on screen — it owns the room until it closes. */
  pollOpen: boolean;
  /** A launch is in flight; don't let a keypress race it. */
  busy: boolean;
  /** Boundary an offer is already showing for, if any. */
  offerArmedAt: number | null;
  /** Boundaries the professor has already chosen to walk past. */
  skipped: ReadonlySet<number>;
  /** Question ids already launched this lecture. */
  ran: ReadonlySet<string>;
  questions: readonly NavQuestion[];
}

/**
 * Decide what a navigation intent means.
 *
 * The one rule worth stating out loud: a queued question is *offered* on the
 * first press and *walked past* on the second. That second press is the
 * escape valve — a professor who reflexively hammers the arrow key always
 * ends up on the next slide rather than trapped behind a question they
 * didn't ask for.
 */
export function decideNavigation(input: NavInput): NavDecision {
  const {
    requested,
    current,
    totalPages,
    pollOpen,
    busy,
    offerArmedAt,
    skipped,
    ran,
    questions,
  } = input;

  // A poll on the projector owns the room. Slides wait — but the caller is
  // expected to say so out loud, which is exactly what went missing in class.
  if (pollOpen) return { kind: "blocked", reason: "poll" };
  if (busy) return { kind: "blocked", reason: "busy" };

  const upper = totalPages ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(Math.max(1, requested), upper);
  if (clamped === current) return { kind: "none" };

  // Only a single step forward can cross a question boundary; jumping or
  // going back never triggers one.
  if (clamped === current + 1) {
    const waiting = questions
      .filter(
        (q) =>
          q.positionAfterPage === current &&
          !ran.has(q.id) &&
          !skipped.has(current)
      )
      .map((q) => q.id);

    if (waiting.length > 0 && offerArmedAt !== current) {
      return { kind: "offer", position: current, questionIds: waiting };
    }
    if (waiting.length > 0) {
      // Second press on an armed offer: they've seen it and pressed on.
      return { kind: "advance", page: clamped, crossedPosition: current };
    }
  }

  return { kind: "advance", page: clamped, crossedPosition: null };
}

/** The primary move available from a stage, and what to call it. */
export interface StageAction {
  kind: "stage" | "reveal" | "resume";
  /** Target stage, when `kind` is "stage". */
  stage?: Extract<PollStage, "pair" | "revote">;
  label: string;
}

/**
 * The one description of the think-pair-share choreography.
 *
 * Both the always-visible command strip and the detail card below it read
 * from this, so they can never offer the professor two different "next"
 * buttons for the same round.
 */
export function nextStageAction(stage: PollStage): StageAction | null {
  switch (stage) {
    case "think":
      return { kind: "stage", stage: "pair", label: "Pair & discuss" };
    case "pair":
      return { kind: "stage", stage: "revote", label: "Open re-vote" };
    case "revote":
      return { kind: "reveal", label: "Reveal results" };
    case "reveal":
      return { kind: "resume", label: "Resume lecture" };
    case "closed":
      return null;
  }
}

/** Short stage name for the command strip's chip. */
export const STAGE_CHIP: Record<PollStage, string> = {
  think: "Think",
  pair: "Pair",
  revote: "Re-vote",
  reveal: "Results",
  closed: "",
};
