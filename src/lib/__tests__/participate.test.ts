import { describe, expect, it } from "vitest";
import {
  assignGroups,
  assignPairs,
  firstVoteGuidance,
  pairKey,
  summarizeParticipation,
  tallyVotes,
  type GroupingParticipant,
  type PairingParticipant,
} from "@/lib/participate";

const NO_HISTORY = new Set<string>();

function seatAt(row: number, col: number) {
  // Seat-unit geometry: columns are 1 apart, rows 1.25 apart (ROW_GAP).
  return { x: col, y: row * 1.25 };
}

describe("assignGroups", () => {
  function inRow(count: number, targetSize: number) {
    const participants: GroupingParticipant[] = Array.from(
      { length: count },
      (_, c) => ({ enrollmentId: `s${c}`, seat: seatAt(0, c) })
    );
    return assignGroups(participants, targetSize);
  }

  it("returns empty for no participants", () => {
    expect(assignGroups([], 4)).toEqual([]);
  });

  it("groups adjacent seats together", () => {
    const groups = inRow(6, 3);
    expect(groups).toHaveLength(2);
    expect(new Set(groups[0])).toEqual(new Set(["s0", "s1", "s2"]));
    expect(new Set(groups[1])).toEqual(new Set(["s3", "s4", "s5"]));
  });

  it("keeps every student in exactly one group", () => {
    const groups = inRow(10, 4);
    const all = groups.flat();
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
  });

  it("folds a trailing singleton into a neighbouring group", () => {
    // 4 in a row, target 3 => would be [3] + [1]; the lone one merges.
    const groups = inRow(4, 3);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
  });

  it("is deterministic for the same input", () => {
    expect(inRow(9, 3)).toEqual(inRow(9, 3));
  });

  it("still groups students who never checked in (no seats)", () => {
    const participants: GroupingParticipant[] = [
      { enrollmentId: "a" },
      { enrollmentId: "b" },
      { enrollmentId: "c" },
    ];
    const groups = assignGroups(participants, 2);
    expect(groups.flat().sort()).toEqual(["a", "b", "c"]);
  });

  it("clamps a nonsensical target size up to 2", () => {
    const groups = inRow(4, 1);
    expect(groups.every((g) => g.length >= 2)).toBe(true);
  });
});

describe("assignPairs", () => {
  it("returns empty for no participants and a singleton for one", () => {
    expect(assignPairs([], NO_HISTORY)).toEqual([]);
    expect(
      assignPairs([{ enrollmentId: "s1", choice: 0 }], NO_HISTORY)
    ).toEqual([["s1"]]);
  });

  it("prefers partners who answered differently", () => {
    // s1/s2 agree; s3/s4 agree; cross pairs disagree. No seats.
    const participants: PairingParticipant[] = [
      { enrollmentId: "s1", choice: 0 },
      { enrollmentId: "s2", choice: 0 },
      { enrollmentId: "s3", choice: 1 },
      { enrollmentId: "s4", choice: 1 },
    ];
    const groups = assignPairs(participants, NO_HISTORY);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      const choices = group.map(
        (id) => participants.find((p) => p.enrollmentId === id)!.choice
      );
      expect(new Set(choices).size).toBe(2);
    }
  });

  it("prefers adjacent seats when answers tie", () => {
    // Everyone disagrees with everyone; adjacency should decide.
    const participants: PairingParticipant[] = [
      { enrollmentId: "s1", choice: 0, seat: seatAt(0, 0) },
      { enrollmentId: "s2", choice: 1, seat: seatAt(0, 1) },
      { enrollmentId: "s3", choice: 2, seat: seatAt(5, 5) },
      { enrollmentId: "s4", choice: 3, seat: seatAt(5, 6) },
    ];
    const groups = assignPairs(participants, NO_HISTORY).map((g) =>
      [...g].sort()
    );
    expect(groups).toContainEqual(["s1", "s2"]);
    expect(groups).toContainEqual(["s3", "s4"]);
  });

  it("avoids repeating a previous pairing when an alternative exists", () => {
    const participants: PairingParticipant[] = [
      { enrollmentId: "s1", choice: 0 },
      { enrollmentId: "s2", choice: 1 },
      { enrollmentId: "s3", choice: 0 },
      { enrollmentId: "s4", choice: 1 },
    ];
    const history = new Set([pairKey("s1", "s2"), pairKey("s3", "s4")]);
    const groups = assignPairs(participants, history).map((g) => [...g].sort());
    expect(groups).toContainEqual(["s1", "s4"]);
    expect(groups).toContainEqual(["s2", "s3"]);
  });

  it("folds an odd participant into a trio", () => {
    const participants: PairingParticipant[] = [
      { enrollmentId: "s1", choice: 0 },
      { enrollmentId: "s2", choice: 1 },
      { enrollmentId: "s3", choice: 0 },
    ];
    const groups = assignPairs(participants, NO_HISTORY);
    expect(groups).toHaveLength(1);
    expect([...groups[0]].sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("is deterministic for the same input", () => {
    const participants: PairingParticipant[] = [
      { enrollmentId: "s1", choice: 0, seat: seatAt(1, 1) },
      { enrollmentId: "s2", choice: 1, seat: seatAt(1, 2) },
      { enrollmentId: "s3", choice: 0, seat: seatAt(2, 1) },
      { enrollmentId: "s4", choice: 1, seat: seatAt(2, 2) },
      { enrollmentId: "s5", choice: 2, seat: seatAt(3, 1) },
      { enrollmentId: "s6", choice: 2, seat: seatAt(3, 2) },
    ];
    const first = assignPairs(participants, NO_HISTORY);
    const second = assignPairs(participants, NO_HISTORY);
    expect(second).toEqual(first);
  });
});

describe("tallyVotes", () => {
  it("counts per option per phase and drops out-of-range choices", () => {
    const results = tallyVotes(
      [
        { phase: "think", choice: 0 },
        { phase: "think", choice: 2 },
        { phase: "think", choice: 2 },
        { phase: "revote", choice: 2 },
        { phase: "think", choice: 9 },
        { phase: "revote", choice: -1 },
      ],
      3
    );
    expect(results).toEqual({ think: [1, 0, 2], revote: [0, 0, 1] });
  });
});

describe("summarizeParticipation", () => {
  it("counts answered, first-vote correct, and changed-to-correct", () => {
    const rounds = [
      { id: "r1", correct_indices: [1] }, // think wrong, revote right → changed
      { id: "r2", correct_indices: [0] }, // right both times
      { id: "r3", correct_indices: [2] }, // never answered
      { id: "r4", correct_indices: null }, // answered, no key marked
    ];
    const answers = [
      { round_id: "r1", phase: "think" as const, choice: 0 },
      { round_id: "r1", phase: "revote" as const, choice: 1 },
      { round_id: "r2", phase: "think" as const, choice: 0 },
      { round_id: "r2", phase: "revote" as const, choice: 0 },
      { round_id: "r4", phase: "think" as const, choice: 3 },
    ];
    expect(summarizeParticipation(rounds, answers)).toEqual({
      answered: 3,
      firstCorrect: 1,
      changedToCorrect: 1,
    });
  });
});

describe("firstVoteGuidance", () => {
  it("returns null with no votes", () => {
    expect(firstVoteGuidance(0, 0)).toBeNull();
  });

  it("maps counts onto the Mazur bands", () => {
    expect(firstVoteGuidance(1, 10)?.message).toMatch(/reteach/);
    expect(firstVoteGuidance(5, 10)?.message).toMatch(/sweet spot/);
    expect(firstVoteGuidance(9, 10)?.message).toMatch(/adds little/);
  });
});
