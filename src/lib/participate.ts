import type { PollPhase, PollResults } from "@/types/db";

/**
 * Pure think-pair-share helpers (no I/O) — pairing, tallies, and the
 * first-vote guidance bands from Peer Instruction research
 * (Crouch & Mazur 2001: discussion pays off when 35–70% answer correctly
 * on the first vote, peaking near 50%).
 */

export interface PairingParticipant {
  enrollmentId: string;
  /** Think-phase answer (option index). */
  choice: number;
  /** Seat position from today's check-in, when the student has one. */
  seat?: { row: number; col: number };
}

/** Canonical key for "these two have discussed before" history. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function proximityScore(
  a: { seat?: { row: number; col: number } },
  b: { seat?: { row: number; col: number } }
): number {
  if (!a.seat || !b.seat) return 0;
  const distance =
    Math.abs(a.seat.row - b.seat.row) + Math.abs(a.seat.col - b.seat.col);
  // Adjacent seats score highest; beyond ~4 seats apart proximity is moot.
  return Math.max(0, 60 - 20 * (distance - 1));
}

function pairScore(
  a: PairingParticipant,
  b: PairingParticipant,
  previous: ReadonlySet<string>
): number {
  let score = proximityScore(a, b);
  // Disagreement is the whole point of the discussion — dominant weight.
  if (a.choice !== b.choice) score += 100;
  // Variety: avoid re-running last time's conversation.
  if (previous.has(pairKey(a.enrollmentId, b.enrollmentId))) score -= 80;
  return score;
}

/**
 * Group participants for the pair stage: prefer neighbors who answered
 * differently and haven't been paired recently. Greedy max-score matching —
 * deterministic for a given input. An odd participant joins the best-fitting
 * pair as a trio; a lone participant gets a singleton group.
 */
export function assignPairs(
  participants: PairingParticipant[],
  previousPairKeys: ReadonlySet<string>
): string[][] {
  if (participants.length === 0) return [];
  if (participants.length === 1) return [[participants[0].enrollmentId]];

  const candidates: Array<{ a: number; b: number; score: number }> = [];
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      candidates.push({
        a: i,
        b: j,
        score: pairScore(participants[i], participants[j], previousPairKeys),
      });
    }
  }
  candidates.sort(
    (x, y) =>
      y.score - x.score ||
      pairKey(
        participants[x.a].enrollmentId,
        participants[x.b].enrollmentId
      ).localeCompare(
        pairKey(participants[y.a].enrollmentId, participants[y.b].enrollmentId)
      )
  );

  const matched = new Set<number>();
  const groups: number[][] = [];
  for (const c of candidates) {
    if (matched.has(c.a) || matched.has(c.b)) continue;
    matched.add(c.a);
    matched.add(c.b);
    groups.push([c.a, c.b]);
  }

  // Odd participant left over: fold into the best-fitting existing pair.
  const leftover = participants.findIndex((_, i) => !matched.has(i));
  if (leftover >= 0 && groups.length > 0) {
    let bestGroup = 0;
    let bestScore = -Infinity;
    groups.forEach((group, gi) => {
      const score = group.reduce(
        (sum, m) =>
          sum +
          pairScore(participants[leftover], participants[m], previousPairKeys),
        0
      );
      if (score > bestScore) {
        bestScore = score;
        bestGroup = gi;
      }
    });
    groups[bestGroup].push(leftover);
  } else if (leftover >= 0) {
    groups.push([leftover]);
  }

  return groups.map((group) => group.map((i) => participants[i].enrollmentId));
}

// ---------------------------------------------------------------------------
// Small-group exercises (one-minute papers): seat-based groups, no votes.
// ---------------------------------------------------------------------------

export interface GroupingParticipant {
  enrollmentId: string;
  /** Seat position from today's check-in, when the student has one. */
  seat?: { row: number; col: number };
}

/** Deterministic order: seated students first (reading order), then seatless. */
function groupingOrder(
  a: GroupingParticipant,
  b: GroupingParticipant
): number {
  if (a.seat && b.seat) {
    return (
      a.seat.row - b.seat.row ||
      a.seat.col - b.seat.col ||
      a.enrollmentId.localeCompare(b.enrollmentId)
    );
  }
  if (a.seat) return -1;
  if (b.seat) return 1;
  return a.enrollmentId.localeCompare(b.enrollmentId);
}

/**
 * Cluster students into small groups by where they're sitting — the
 * assigned-groups counterpart to think-pair-share pairing, for one-minute
 * papers and other small-group exercises. Greedy nearest-neighbour growth
 * from a seed, so each group is a seat neighbourhood. Deterministic for a
 * given input. A trailing lone student is folded into the nearest group
 * rather than left alone.
 */
export function assignGroups(
  participants: GroupingParticipant[],
  targetSize: number
): string[][] {
  if (participants.length === 0) return [];
  const size = Math.max(2, Math.floor(targetSize));

  const ordered = [...participants].sort(groupingOrder);
  const remaining = new Set(ordered.map((_, i) => i));
  const groups: number[][] = [];

  while (remaining.size > 0) {
    // Seed = first still-unused participant in deterministic order.
    const seed = ordered.findIndex((_, i) => remaining.has(i));
    remaining.delete(seed);
    const group = [seed];

    while (group.length < size && remaining.size > 0) {
      let best = -1;
      let bestScore = -Infinity;
      for (const i of remaining) {
        // Closeness to the nearest current group member.
        const score = Math.max(
          ...group.map((m) => proximityScore(ordered[i], ordered[m]))
        );
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      remaining.delete(best);
      group.push(best);
    }
    groups.push(group);
  }

  // A trailing singleton joins the nearest existing group.
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    if (last.length === 1) {
      groups.pop();
      const lone = last[0];
      let bestGroup = 0;
      let bestScore = -Infinity;
      groups.forEach((g, gi) => {
        const score = Math.max(
          ...g.map((m) => proximityScore(ordered[lone], ordered[m]))
        );
        if (score > bestScore) {
          bestScore = score;
          bestGroup = gi;
        }
      });
      groups[bestGroup].push(lone);
    }
  }

  return groups.map((g) => g.map((i) => ordered[i].enrollmentId));
}

/** Count votes per option index for each phase; out-of-range choices dropped. */
export function tallyVotes(
  answers: Array<{ phase: PollPhase; choice: number }>,
  optionCount: number
): PollResults {
  const think = new Array<number>(optionCount).fill(0);
  const revote = new Array<number>(optionCount).fill(0);
  for (const a of answers) {
    if (a.choice < 0 || a.choice >= optionCount) continue;
    if (a.phase === "think") think[a.choice] += 1;
    else revote[a.choice] += 1;
  }
  return { think, revote };
}

/**
 * A student's own participation record: answered rounds, first-vote
 * correctness, and — the metric Peer Instruction cares most about — votes
 * changed from wrong to right after discussing.
 */
export function summarizeParticipation(
  rounds: Array<{ id: string; correct_indices: number[] | null }>,
  answers: Array<{ round_id: string; phase: PollPhase; choice: number }>
): { answered: number; firstCorrect: number; changedToCorrect: number } {
  const byRound = new Map<string, { think?: number; revote?: number }>();
  for (const a of answers) {
    const entry = byRound.get(a.round_id) ?? {};
    entry[a.phase] = a.choice;
    byRound.set(a.round_id, entry);
  }
  let answered = 0;
  let firstCorrect = 0;
  let changedToCorrect = 0;
  for (const round of rounds) {
    const mine = byRound.get(round.id);
    if (!mine || (mine.think === undefined && mine.revote === undefined)) {
      continue;
    }
    answered += 1;
    const key = round.correct_indices;
    if (!key || key.length === 0) continue;
    const thinkRight = mine.think !== undefined && key.includes(mine.think);
    const revoteRight = mine.revote !== undefined && key.includes(mine.revote);
    if (thinkRight) firstCorrect += 1;
    if (!thinkRight && mine.think !== undefined && revoteRight) {
      changedToCorrect += 1;
    }
  }
  return { answered, firstCorrect, changedToCorrect };
}

/**
 * Mazur's first-vote bands, shown privately to the professor after the
 * think stage so they can decide whether discussion is worth it.
 */
export function firstVoteGuidance(
  correctCount: number,
  totalCount: number
): { pct: number; message: string } | null {
  if (totalCount === 0) return null;
  const pct = Math.round((correctCount / totalCount) * 100);
  if (pct < 35) {
    return {
      pct,
      message:
        "Under 35% correct — consider a quick reteach before pairing, or guide the discussion.",
    };
  }
  if (pct <= 70) {
    return {
      pct,
      message: "In the 35–70% sweet spot — pair discussion pays off most here.",
    };
  }
  return {
    pct,
    message:
      "Over 70% already correct — discussion adds little; consider revealing and moving on.",
  };
}
