/**
 * Pure per-member contribution math for team projects. One engine, two
 * audiences: the professor's course-wide view and each student's own view
 * show numbers computed HERE, so faculty and students always see the same
 * thing (students own their data — no secret instructor math).
 *
 * The four questions this answers:
 *  - who's doing the most work        -> doneMinutes (credited, unflagged)
 *  - who takes the harder tasks       -> biggestTaskMinutes
 *  - who's organizing the team        -> distributedTasks (assigned others)
 *  - who's coasting                   -> low doneMinutes + flaggedTasks +
 *                                        unsigned contract (joined upstream)
 */

export interface ProjectTaskInput {
  teamId: string;
  assignedEnrollmentId: string | null;
  assignedByEnrollmentId: string | null;
  status: "unassigned" | "assigned" | "done";
  estimatedMinutes: number;
  actualMinutes: number | null;
  isContract: boolean;
  hasOpenFlag: boolean;
}

export interface MemberProjectStats {
  enrollmentId: string;
  teamId: string;
  /** Credited done minutes (actual when logged, else estimate; flagged excluded). */
  doneMinutes: number;
  doneTasks: number;
  /** Done-but-flagged minutes — earn nothing until the professor settles them. */
  flaggedMinutes: number;
  flaggedTasks: number;
  /** Assigned, not done yet. */
  queuedMinutes: number;
  /** Largest single credited task — a difficulty proxy. */
  biggestTaskMinutes: number;
  /** Tasks this member handed to SOMEONE ELSE — the leadership signal. */
  distributedTasks: number;
  /** Tasks this member put on their own plate — initiative. */
  selfAssignedTasks: number;
  /** doneMinutes / team's total doneMinutes (0 when the team has none). */
  shareOfTeamDone: number;
}

/** Done work counts actual minutes when logged, the estimate otherwise. */
function credited(t: ProjectTaskInput): number {
  return t.actualMinutes ?? t.estimatedMinutes;
}

export function computeMemberStats(
  members: { enrollmentId: string; teamId: string }[],
  tasks: ProjectTaskInput[]
): MemberProjectStats[] {
  const byMember = new Map<string, MemberProjectStats>();
  for (const m of members) {
    byMember.set(m.enrollmentId, {
      enrollmentId: m.enrollmentId,
      teamId: m.teamId,
      doneMinutes: 0,
      doneTasks: 0,
      flaggedMinutes: 0,
      flaggedTasks: 0,
      queuedMinutes: 0,
      biggestTaskMinutes: 0,
      distributedTasks: 0,
      selfAssignedTasks: 0,
      shareOfTeamDone: 0,
    });
  }

  for (const t of tasks) {
    if (t.assignedEnrollmentId) {
      const assignee = byMember.get(t.assignedEnrollmentId);
      if (assignee && assignee.teamId === t.teamId) {
        if (t.status === "done") {
          if (t.hasOpenFlag) {
            assignee.flaggedMinutes += credited(t);
            assignee.flaggedTasks++;
          } else {
            assignee.doneMinutes += credited(t);
            assignee.doneTasks++;
            assignee.biggestTaskMinutes = Math.max(
              assignee.biggestTaskMinutes,
              credited(t)
            );
          }
        } else if (t.status === "assigned") {
          assignee.queuedMinutes += credited(t);
        }
      }
    }

    // Who moved the card matters even after the assignee changes teams.
    // Contract cards are auto-assigned by the system, not a person's call.
    if (t.assignedByEnrollmentId && !t.isContract) {
      const assigner = byMember.get(t.assignedByEnrollmentId);
      if (assigner && assigner.teamId === t.teamId) {
        if (t.assignedByEnrollmentId === t.assignedEnrollmentId) {
          assigner.selfAssignedTasks++;
        } else {
          assigner.distributedTasks++;
        }
      }
    }
  }

  // Share of each team's credited total.
  const teamDone = new Map<string, number>();
  for (const s of byMember.values()) {
    teamDone.set(s.teamId, (teamDone.get(s.teamId) ?? 0) + s.doneMinutes);
  }
  for (const s of byMember.values()) {
    const total = teamDone.get(s.teamId) ?? 0;
    s.shareOfTeamDone = total > 0 ? s.doneMinutes / total : 0;
  }

  return Array.from(byMember.values());
}
