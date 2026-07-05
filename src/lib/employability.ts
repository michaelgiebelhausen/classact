/**
 * Work-readiness signals: ClassAct behaviour translated into the competencies
 * employers actually screen for. Shown to the STUDENT (not ranked against
 * classmates) as a growth mirror — "here's what your habits say to a future
 * boss, and where to push." Consistent with students owning their data and
 * with jobs being the point.
 *
 * Deliberately not a single "hireability score": these are proxies, so each
 * competency is evidence-forward and the copy stays constructive. Pure and
 * testable — no I/O.
 */

import { formatMinutes } from "@/lib/projects";

export interface WorkReadinessInput {
  // Attendance & presence
  sessionsHeld: number;
  sessionsAttended: number;
  verifiedAttendances: number;
  newSeats: number;
  // Networking
  peopleMet: number;
  neighborsVerified: number;
  exercisesJoined: number;
  // Think-pair-share
  answered: number;
  changedToCorrect: number;
  // Projects (summed across the student's teams in this course)
  teams: number;
  contractsSigned: number;
  leadRoles: number;
  doneMinutes: number;
  doneTasks: number;
  biggestTaskMinutes: number;
  distributedTasks: number;
  selfAssignedTasks: number;
  flaggedTasks: number;
  /** Mean share of team credited work, 0..1, across teams that have any. */
  avgShareOfTeam: number;
}

export type SignalLevel =
  | "getting-started"
  | "building"
  | "strong"
  | "standout";

export interface CompetencySignal {
  key: string;
  label: string;
  /** What an employer reads into this. */
  blurb: string;
  level: SignalLevel;
  score: number; // 0..100, internal
  evidence: string[];
}

export interface WorkReadiness {
  competencies: CompetencySignal[];
  /** Labels of the strongest competencies. */
  strengths: string[];
  /** Labels of the competencies with the most room to grow. */
  growth: string[];
  /** False when there's essentially no activity to read yet. */
  hasSignal: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const pct = (rate: number) => Math.round(rate * 100);

function levelFor(score: number): SignalLevel {
  if (score >= 80) return "standout";
  if (score >= 55) return "strong";
  if (score >= 25) return "building";
  return "getting-started";
}

function signal(
  key: string,
  label: string,
  blurb: string,
  score: number,
  evidence: string[]
): CompetencySignal {
  return {
    key,
    label,
    blurb,
    level: levelFor(clamp(score)),
    score: clamp(score),
    evidence,
  };
}

export function computeWorkReadiness(input: WorkReadinessInput): WorkReadiness {
  const attendanceRate =
    input.sessionsHeld > 0 ? input.sessionsAttended / input.sessionsHeld : 0;
  const verifiedRate =
    input.sessionsAttended > 0
      ? input.verifiedAttendances / input.sessionsAttended
      : 0;
  const contractRate =
    input.teams > 0 ? input.contractsSigned / input.teams : null;

  // ---- Dependability ----
  const depBase =
    contractRate === null
      ? 62 * attendanceRate + 38 * verifiedRate
      : 46 * attendanceRate + 24 * verifiedRate + 30 * contractRate;
  const depEvidence: string[] = [];
  if (input.sessionsHeld > 0) {
    depEvidence.push(
      `Attended ${input.sessionsAttended} of ${input.sessionsHeld} classes (${pct(attendanceRate)}%)`
    );
  } else {
    depEvidence.push("No classes held yet — attendance starts your track record");
  }
  if (input.verifiedAttendances > 0) {
    depEvidence.push(
      `A neighbour vouched you were there ${input.verifiedAttendances} time(s)`
    );
  }
  if (contractRate !== null) {
    depEvidence.push(
      input.contractsSigned === input.teams
        ? "Signed every team contract you were part of"
        : `Signed ${input.contractsSigned} of ${input.teams} team contracts`
    );
  }
  if (input.flaggedTasks > 0) {
    depEvidence.push(
      `${input.flaggedTasks} finished task(s) were flagged by a teammate — clearing those rebuilds trust`
    );
  }
  const dependability = signal(
    "dependability",
    "Dependability",
    "Shows up, gets counted, keeps commitments.",
    depBase - 12 * input.flaggedTasks,
    depEvidence
  );

  // ---- Work ethic ----
  const outputScore = Math.min(80, input.doneMinutes / 7.5);
  const shareBonus =
    input.avgShareOfTeam > 0 ? 20 * Math.min(1, input.avgShareOfTeam / 0.33) : 0;
  const workEvidence: string[] = [];
  if (input.doneTasks > 0) {
    workEvidence.push(
      `Finished ${input.doneTasks} task(s) — ${formatMinutes(input.doneMinutes)} of work`
    );
  } else {
    workEvidence.push("No finished project tasks yet");
  }
  if (input.avgShareOfTeam > 0) {
    workEvidence.push(
      `Carried ${pct(input.avgShareOfTeam)}% of your team's finished work`
    );
  }
  if (input.biggestTaskMinutes > 0) {
    workEvidence.push(
      `Your biggest single task ran ${formatMinutes(input.biggestTaskMinutes)} — you take on real chunks`
    );
  }
  const workEthic = signal(
    "work-ethic",
    "Work ethic",
    "Does real work, not just the easy bits.",
    outputScore + shareBonus,
    workEvidence
  );

  // ---- Initiative ----
  const initEvidence: string[] = [];
  if (input.selfAssignedTasks > 0) {
    initEvidence.push(`Claimed ${input.selfAssignedTasks} task(s) yourself`);
  }
  if (input.newSeats > 0) {
    initEvidence.push(
      `Tried ${input.newSeats} different seat(s) — you don't wait to be seated`
    );
  }
  if (input.selfAssignedTasks === 0 && input.newSeats === 0) {
    initEvidence.push(
      "Claiming work before you're asked is how initiative shows — grab a task off your team board"
    );
  }
  const initiative = signal(
    "initiative",
    "Initiative",
    "Acts without being told.",
    15 * input.selfAssignedTasks + 8 * input.newSeats,
    initEvidence
  );

  // ---- Leadership ----
  const leadEvidence: string[] = [];
  if (input.distributedTasks > 0) {
    leadEvidence.push(`Handed out ${input.distributedTasks} task(s) to teammates`);
  }
  if (input.leadRoles > 0) {
    leadEvidence.push(`Started or led ${input.leadRoles} team(s)`);
  }
  if (input.distributedTasks === 0 && input.leadRoles === 0) {
    leadEvidence.push(
      "Organising the work — distributing tasks, starting a team — is where leadership shows"
    );
  }
  const leadership = signal(
    "leadership",
    "Leadership",
    "Organises the work and brings people along.",
    12 * input.distributedTasks + 30 * input.leadRoles,
    leadEvidence
  );

  // ---- Collaboration & network ----
  const collabEvidence: string[] = [];
  if (input.peopleMet > 0) {
    collabEvidence.push(`Met ${input.peopleMet} classmate(s) so far`);
  }
  if (input.neighborsVerified > 0) {
    collabEvidence.push(
      `Vouched for ${input.neighborsVerified} neighbour(s) at check-in`
    );
  }
  if (input.exercisesJoined > 0) {
    collabEvidence.push(`Joined ${input.exercisesJoined} small-group exercise(s)`);
  }
  if (
    input.peopleMet === 0 &&
    input.neighborsVerified === 0 &&
    input.exercisesJoined === 0
  ) {
    collabEvidence.push(
      "A real network is career capital — meet a few classmates and vouch for your neighbours"
    );
  }
  const collaboration = signal(
    "collaboration",
    "Collaboration & network",
    "Builds a real network and works well with others.",
    3 * input.peopleMet + 6 * input.neighborsVerified + 10 * input.exercisesJoined,
    collabEvidence
  );

  // ---- Coachability ----
  const coachEvidence: string[] = [];
  if (input.answered > 0) {
    coachEvidence.push(`Answered ${input.answered} think-pair-share question(s)`);
  }
  if (input.changedToCorrect > 0) {
    coachEvidence.push(
      `Switched to the right answer after discussion ${input.changedToCorrect} time(s) — you listen and update`
    );
  } else if (input.answered > 0) {
    coachEvidence.push(
      "You rarely change your first answer — being swayed by a better argument is a strength, not a weakness"
    );
  } else {
    coachEvidence.push("Jump into think-pair-share during lectures to build this");
  }
  const coachability = signal(
    "coachability",
    "Coachability",
    "Updates their thinking when the argument is better.",
    Math.min(50, input.answered * 5) + Math.min(50, input.changedToCorrect * 17),
    coachEvidence
  );

  const competencies = [
    dependability,
    workEthic,
    initiative,
    leadership,
    collaboration,
    coachability,
  ];

  const hasSignal =
    input.sessionsAttended > 0 ||
    input.answered > 0 ||
    input.doneTasks > 0 ||
    input.peopleMet > 0 ||
    input.exercisesJoined > 0 ||
    input.selfAssignedTasks > 0 ||
    input.distributedTasks > 0;

  const ranked = [...competencies].sort((a, b) => b.score - a.score);
  const strengths = ranked
    .filter((c) => c.score >= 55)
    .slice(0, 2)
    .map((c) => c.label);
  const growth = ranked
    .filter((c) => c.score < 40)
    .slice(-2)
    .map((c) => c.label);

  return { competencies, strengths, growth, hasSignal };
}
