import { describe, expect, it } from "vitest";
import {
  computeWorkReadiness,
  type WorkReadinessInput,
} from "@/lib/employability";

const EMPTY: WorkReadinessInput = {
  sessionsHeld: 0,
  sessionsAttended: 0,
  verifiedAttendances: 0,
  newSeats: 0,
  peopleMet: 0,
  neighborsVerified: 0,
  exercisesJoined: 0,
  answered: 0,
  changedToCorrect: 0,
  teams: 0,
  contractsSigned: 0,
  leadRoles: 0,
  doneMinutes: 0,
  doneTasks: 0,
  biggestTaskMinutes: 0,
  distributedTasks: 0,
  selfAssignedTasks: 0,
  flaggedTasks: 0,
  avgShareOfTeam: 0,
};

function get(w: ReturnType<typeof computeWorkReadiness>, key: string) {
  const c = w.competencies.find((x) => x.key === key);
  if (!c) throw new Error(`no competency ${key}`);
  return c;
}

describe("computeWorkReadiness", () => {
  it("reports no signal and all getting-started for an empty record", () => {
    const w = computeWorkReadiness(EMPTY);
    expect(w.hasSignal).toBe(false);
    expect(w.competencies).toHaveLength(6);
    expect(w.competencies.every((c) => c.level === "getting-started")).toBe(true);
    expect(w.strengths).toEqual([]);
  });

  it("always returns evidence for every competency, even when empty", () => {
    const w = computeWorkReadiness(EMPTY);
    expect(w.competencies.every((c) => c.evidence.length > 0)).toBe(true);
  });

  it("rewards strong attendance + verification + contracts as dependability", () => {
    const w = computeWorkReadiness({
      ...EMPTY,
      sessionsHeld: 14,
      sessionsAttended: 14,
      verifiedAttendances: 13,
      teams: 2,
      contractsSigned: 2,
    });
    const dep = get(w, "dependability");
    expect(dep.level).toBe("standout");
    expect(dep.evidence[0]).toContain("14 of 14");
  });

  it("docks dependability for flagged work", () => {
    const base = {
      ...EMPTY,
      sessionsHeld: 10,
      sessionsAttended: 10,
      verifiedAttendances: 10,
    };
    const clean = get(computeWorkReadiness(base), "dependability").score;
    const flagged = get(
      computeWorkReadiness({ ...base, flaggedTasks: 3 }),
      "dependability"
    ).score;
    expect(flagged).toBeLessThan(clean);
  });

  it("credits finished work and team share as work ethic", () => {
    const w = computeWorkReadiness({
      ...EMPTY,
      doneTasks: 6,
      doneMinutes: 480,
      biggestTaskMinutes: 120,
      avgShareOfTeam: 0.4,
    });
    const we = get(w, "work-ethic");
    expect(we.level === "strong" || we.level === "standout").toBe(true);
    expect(we.evidence.some((e) => e.includes("Carried 40%"))).toBe(true);
  });

  it("separates leadership (handing out work) from initiative (claiming it)", () => {
    const w = computeWorkReadiness({
      ...EMPTY,
      distributedTasks: 6,
      selfAssignedTasks: 5,
      leadRoles: 1,
      newSeats: 3,
    });
    expect(get(w, "leadership").score).toBeGreaterThanOrEqual(55);
    expect(get(w, "initiative").score).toBeGreaterThanOrEqual(55);
  });

  it("reads changed-to-correct votes as coachability", () => {
    const w = computeWorkReadiness({
      ...EMPTY,
      answered: 10,
      changedToCorrect: 3,
    });
    const c = get(w, "coachability");
    expect(c.evidence.some((e) => e.includes("Switched to the right answer"))).toBe(
      true
    );
    expect(c.score).toBeGreaterThan(50);
  });

  it("names top strengths and lowest growth areas", () => {
    const w = computeWorkReadiness({
      ...EMPTY,
      sessionsHeld: 10,
      sessionsAttended: 10,
      verifiedAttendances: 10,
      teams: 1,
      contractsSigned: 1,
      peopleMet: 20,
      neighborsVerified: 8,
    });
    expect(w.strengths.length).toBeGreaterThan(0);
    // Nothing done on projects/discussion -> those surface as growth.
    expect(w.growth.length).toBeGreaterThan(0);
    expect(w.strengths).not.toEqual(w.growth);
  });
});
