import { describe, expect, it } from "vitest";
import {
  computeMemberStats,
  type ProjectTaskInput,
} from "@/lib/projectstats";

const TEAM = "team-1";

function task(overrides: Partial<ProjectTaskInput>): ProjectTaskInput {
  return {
    teamId: TEAM,
    assignedEnrollmentId: null,
    assignedByEnrollmentId: null,
    status: "unassigned",
    estimatedMinutes: 30,
    actualMinutes: null,
    isContract: false,
    hasOpenFlag: false,
    ...overrides,
  };
}

const members = [
  { enrollmentId: "a", teamId: TEAM },
  { enrollmentId: "b", teamId: TEAM },
];

function statsFor(
  tasks: ProjectTaskInput[],
  enrollmentId: string
) {
  const all = computeMemberStats(members, tasks);
  const s = all.find((m) => m.enrollmentId === enrollmentId);
  if (!s) throw new Error(`no stats for ${enrollmentId}`);
  return s;
}

describe("computeMemberStats", () => {
  it("credits actual minutes over the estimate for done work", () => {
    const s = statsFor(
      [
        task({
          assignedEnrollmentId: "a",
          status: "done",
          estimatedMinutes: 30,
          actualMinutes: 90,
        }),
      ],
      "a"
    );
    expect(s.doneMinutes).toBe(90);
    expect(s.doneTasks).toBe(1);
    expect(s.biggestTaskMinutes).toBe(90);
  });

  it("falls back to the estimate when no actual was logged", () => {
    const s = statsFor(
      [task({ assignedEnrollmentId: "a", status: "done" })],
      "a"
    );
    expect(s.doneMinutes).toBe(30);
  });

  it("routes flagged done work out of credit until settled", () => {
    const s = statsFor(
      [
        task({
          assignedEnrollmentId: "a",
          status: "done",
          actualMinutes: 120,
          hasOpenFlag: true,
        }),
        task({ assignedEnrollmentId: "a", status: "done", actualMinutes: 60 }),
      ],
      "a"
    );
    expect(s.doneMinutes).toBe(60);
    expect(s.flaggedMinutes).toBe(120);
    expect(s.flaggedTasks).toBe(1);
    // Flagged work also doesn't set the difficulty proxy.
    expect(s.biggestTaskMinutes).toBe(60);
  });

  it("counts queued (assigned, not done) minutes separately", () => {
    const s = statsFor(
      [task({ assignedEnrollmentId: "a", status: "assigned" })],
      "a"
    );
    expect(s.queuedMinutes).toBe(30);
    expect(s.doneMinutes).toBe(0);
  });

  it("separates distributing to others from self-assigning", () => {
    const tasks = [
      task({
        assignedEnrollmentId: "b",
        assignedByEnrollmentId: "a",
        status: "assigned",
      }),
      task({
        assignedEnrollmentId: "a",
        assignedByEnrollmentId: "a",
        status: "assigned",
      }),
    ];
    const a = statsFor(tasks, "a");
    expect(a.distributedTasks).toBe(1);
    expect(a.selfAssignedTasks).toBe(1);
  });

  it("ignores contract cards for the leadership signal", () => {
    const s = statsFor(
      [
        task({
          assignedEnrollmentId: "a",
          assignedByEnrollmentId: "a",
          isContract: true,
          status: "assigned",
        }),
      ],
      "a"
    );
    expect(s.selfAssignedTasks).toBe(0);
    expect(s.distributedTasks).toBe(0);
  });

  it("computes share of the team's credited total", () => {
    const tasks = [
      task({ assignedEnrollmentId: "a", status: "done", actualMinutes: 75 }),
      task({ assignedEnrollmentId: "b", status: "done", actualMinutes: 25 }),
    ];
    expect(statsFor(tasks, "a").shareOfTeamDone).toBeCloseTo(0.75);
    expect(statsFor(tasks, "b").shareOfTeamDone).toBeCloseTo(0.25);
  });

  it("gives zero share when the team has no credited work", () => {
    const s = statsFor(
      [task({ assignedEnrollmentId: "a", status: "assigned" })],
      "a"
    );
    expect(s.shareOfTeamDone).toBe(0);
  });

  it("ignores tasks assigned to people who left the team", () => {
    const s = computeMemberStats(members, [
      task({ assignedEnrollmentId: "ghost", status: "done" }),
    ]);
    expect(s.every((m) => m.doneMinutes === 0)).toBe(true);
  });
});
