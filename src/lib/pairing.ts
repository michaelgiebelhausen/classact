import { seededRandom, type PairMix } from "@/lib/tastegrading";
import type { PairType } from "@/types/db";

/**
 * Peer pair assignment (pure, deterministic given a seed).
 * Spec: docs/tasty-grading-plan.md § Peer grading.
 *
 * Three pair types per judge (professor-adjustable mix):
 *  - exceptional: an AI-judged excellent submission vs an ordinary one —
 *    shows what great looks like, doubles as a calibration probe.
 *  - self: the judge's own submission vs a near-rank other — disclosed, and
 *    scored later as the self-honesty statistic.
 *  - refine: two adjacent-ranked submissions — where a vote moves the
 *    Bradley–Terry needle most.
 *
 * Guards: never judge a pair containing your own work (except the self
 * pair), avoid teammates and reciprocal judging when the class is big
 * enough to allow it, randomize pair order and left/right position.
 */

export interface PairingSubmission {
  submissionId: string;
  enrollmentId: string;
  /** Draft rank, 1 = best. */
  rank: number;
}

export interface PeerPairAssignment {
  judgeEnrollmentId: string;
  leftSubmissionId: string;
  rightSubmissionId: string;
  pairType: PairType;
  position: number;
}

/** Top ~10% (at least 1) by draft rank. */
export function exceptionalPool(subs: PairingSubmission[]): PairingSubmission[] {
  const sorted = [...subs].sort((a, b) => a.rank - b.rank);
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.1)));
}

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

export function assignPeerPairs(input: {
  submissions: PairingSubmission[];
  mix: PairMix;
  /** "judgeEnrollmentId|ownerEnrollmentId" pairs to avoid (teammates). */
  excludedJudgeOwner?: ReadonlySet<string>;
  seed: string;
}): PeerPairAssignment[] {
  const subs = [...input.submissions].sort((a, b) => a.rank - b.rank);
  if (subs.length < 2) return [];
  const rand = seededRandom(input.seed);
  const excluded = input.excludedJudgeOwner ?? new Set<string>();
  const byEnrollment = new Map(subs.map((s) => [s.enrollmentId, s]));
  const exceptional = new Set(exceptionalPool(subs).map((s) => s.submissionId));

  // Reciprocity guard: owner → judges already assigned a pair with their work.
  const judgedBy = new Map<string, Set<string>>();
  const noteJudged = (judge: string, sub: PairingSubmission) => {
    const set = judgedBy.get(sub.enrollmentId) ?? new Set<string>();
    set.add(judge);
    judgedBy.set(sub.enrollmentId, set);
  };
  const allowed = (judge: string, sub: PairingSubmission) => {
    if (sub.enrollmentId === judge) return false;
    if (excluded.has(`${judge}|${sub.enrollmentId}`)) return false;
    // Avoid A judging B while B judges A (soft guard; relaxed when needed).
    if (judgedBy.get(judge)?.has(sub.enrollmentId)) return false;
    return true;
  };
  const candidates = (
    judge: string,
    filter: (s: PairingSubmission) => boolean,
    relax = false
  ) =>
    subs.filter(
      (s) =>
        filter(s) && (relax ? s.enrollmentId !== judge : allowed(judge, s))
    );

  const assignments: PeerPairAssignment[] = [];
  // Refine coverage: walk adjacent pairs round-robin so votes spread evenly.
  let refineCursor = Math.floor(rand() * Math.max(1, subs.length - 1));

  for (const judgeSub of subs) {
    const judge = judgeSub.enrollmentId;
    const pairs: Array<{ a: PairingSubmission; b: PairingSubmission; type: PairType }> = [];

    // Exceptional probes.
    for (let k = 0; k < input.mix.exceptional; k++) {
      let stars = candidates(judge, (s) => exceptional.has(s.submissionId));
      if (stars.length === 0)
        stars = candidates(judge, (s) => exceptional.has(s.submissionId), true);
      let ordinary = candidates(judge, (s) => !exceptional.has(s.submissionId));
      if (ordinary.length === 0)
        ordinary = candidates(judge, (s) => !exceptional.has(s.submissionId), true);
      if (stars.length === 0 || ordinary.length === 0) break;
      const star = pick(stars, rand);
      const rest = ordinary.filter((s) => s.submissionId !== star.submissionId);
      if (rest.length === 0) break;
      const other = pick(rest, rand);
      pairs.push({ a: star, b: other, type: "exceptional" });
      noteJudged(judge, star);
      noteJudged(judge, other);
    }

    // Self vs other (disclosed): own work against a near-rank classmate.
    if (input.mix.self > 0) {
      const mine = byEnrollment.get(judge);
      if (mine) {
        let near = candidates(
          judge,
          (s) =>
            Math.abs(s.rank - mine.rank) <= 3 &&
            s.submissionId !== mine.submissionId
        );
        if (near.length === 0)
          near = candidates(judge, (s) => s.submissionId !== mine.submissionId, true);
        if (near.length > 0) {
          const other = pick(near, rand);
          pairs.push({ a: mine, b: other, type: "self" });
          noteJudged(judge, other);
        }
      }
    }

    // Near-tie refinement pairs.
    for (let k = 0; k < input.mix.refine; k++) {
      let found = false;
      for (let tries = 0; tries < subs.length - 1 && !found; tries++) {
        const i = (refineCursor + tries) % (subs.length - 1);
        const a = subs[i];
        const b = subs[i + 1];
        if (allowed(judge, a) && allowed(judge, b)) {
          pairs.push({ a, b, type: "refine" });
          noteJudged(judge, a);
          noteJudged(judge, b);
          refineCursor = (i + 1) % (subs.length - 1);
          found = true;
        }
      }
    }

    // Randomize pair order (exceptional must not always sit in one slot)
    // and left/right within each pair.
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    pairs.forEach((p, position) => {
      const flip = rand() < 0.5;
      assignments.push({
        judgeEnrollmentId: judge,
        leftSubmissionId: flip ? p.b.submissionId : p.a.submissionId,
        rightSubmissionId: flip ? p.a.submissionId : p.b.submissionId,
        pairType: p.type,
        position,
      });
    });
  }
  return assignments;
}
