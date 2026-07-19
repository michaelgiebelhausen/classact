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

  // --- Metrics v2 signals (optional: absent = feature not used yet) ---
  // Focus (Follow-Along lectures)
  lecturesFollowed?: number;
  /** 0..1 share of followed lecture time on task; null/undefined = no data. */
  onTaskRate?: number | null;
  // Active learning extras
  firstCorrect?: number;
  /** Group exercise answers this student personally wrote/edited. */
  groupAnswersWritten?: number;
  // Assignments (Tasty Grading)
  assignmentsSubmitted?: number;
  /** Of those, how many taste files were edited beyond the AI default. */
  tastesSharpened?: number;
  /** Mean "met your own bar" 0..10; null = none graded yet. */
  avgOwnBar?: number | null;
  /** Mean Distinctive↔Generic 0..10; null = none graded yet. */
  avgDistinctiveness?: number | null;
  /** Mean taste-agreement 0..100 across published assignments; null = none. */
  avgTasteAgreement?: number | null;
  /** Mean self-honesty 0..100; null = no self pairs decided. */
  avgSelfHonesty?: number | null;
  peerPairsAssigned?: number;
  peerPairsDone?: number;
  rubricMinutes?: number;
  // Shout-outs
  shoutOutsReceived?: number;
  shoutOutsGiven?: number;
}

/**
 * The attribute set the professor's participation cockpit weighs —
 * exactly the competency keys/labels computeWorkReadiness emits.
 */
export const PARTICIPATION_ATTRIBUTES: Array<{ key: string; label: string }> = [
  { key: "dependability", label: "Dependability" },
  { key: "work-ethic", label: "Work ethic" },
  { key: "initiative", label: "Initiative" },
  { key: "leadership", label: "Leadership" },
  { key: "collaboration", label: "Collaboration & network" },
  { key: "coachability", label: "Coachability" },
  { key: "focus", label: "Focus" },
  { key: "judgment", label: "Taste & judgment" },
];

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
  const shoutOutsGiven = input.shoutOutsGiven ?? 0;
  if (shoutOutsGiven > 0) {
    initEvidence.push(
      `Gave ${shoutOutsGiven} shout-out(s) — you call out good work unprompted`
    );
  }
  const initiative = signal(
    "initiative",
    "Initiative",
    "Acts without being told.",
    15 * input.selfAssignedTasks + 8 * input.newSeats + 5 * shoutOutsGiven,
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
  const shoutOutsReceived = input.shoutOutsReceived ?? 0;
  const groupAnswersWritten = input.groupAnswersWritten ?? 0;
  if (shoutOutsReceived > 0) {
    collabEvidence.push(
      `Classmates shouted you out ${shoutOutsReceived} time(s)`
    );
  }
  if (groupAnswersWritten > 0) {
    collabEvidence.push(
      `Carried the pen on ${groupAnswersWritten} group answer(s)`
    );
  }
  const collaboration = signal(
    "collaboration",
    "Collaboration & network",
    "Builds a real network and works well with others.",
    3 * input.peopleMet +
      6 * input.neighborsVerified +
      10 * input.exercisesJoined +
      6 * shoutOutsReceived +
      4 * groupAnswersWritten,
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
  const firstCorrect = input.firstCorrect ?? 0;
  if (firstCorrect > 0) {
    coachEvidence.push(
      `Got ${firstCorrect} first vote(s) right before any discussion`
    );
  }
  const coachability = signal(
    "coachability",
    "Coachability",
    "Updates their thinking when the argument is better.",
    Math.min(45, input.answered * 5) +
      Math.min(45, input.changedToCorrect * 17) +
      Math.min(10, firstCorrect * 2),
    coachEvidence
  );

  // ---- Focus (Follow-Along lectures) ----
  const lecturesFollowed = input.lecturesFollowed ?? 0;
  const onTaskRate = input.onTaskRate ?? null;
  const focusEvidence: string[] = [];
  let focusScore = 0;
  if (lecturesFollowed > 0 && onTaskRate !== null) {
    focusScore = 100 * onTaskRate;
    focusEvidence.push(
      `Stayed with the room ${pct(onTaskRate)}% of the time across ${lecturesFollowed} lecture(s)`
    );
    if (onTaskRate < 0.8) {
      focusEvidence.push(
        "Every drift is visible to you here first — closing the other tabs is the cheapest stat boost in the app"
      );
    }
  } else {
    focusEvidence.push(
      "Follow a lecture on your laptop to start this signal — staying on task is a hiring signal employers ask about"
    );
  }
  const focus = signal(
    "focus",
    "Focus",
    "Stays on task when the screen is full of alternatives.",
    focusScore,
    focusEvidence
  );

  // ---- Taste & judgment (Tasty Grading) ----
  const assignmentsSubmitted = input.assignmentsSubmitted ?? 0;
  const tastesSharpened = input.tastesSharpened ?? 0;
  const judgmentEvidence: string[] = [];
  let judgmentScore = 0;
  if (assignmentsSubmitted > 0) {
    const agreement = input.avgTasteAgreement ?? null;
    const honesty = input.avgSelfHonesty ?? null;
    const ownBar = input.avgOwnBar ?? null;
    const sharpenRate = tastesSharpened / assignmentsSubmitted;
    judgmentScore =
      (agreement !== null ? 0.4 * agreement : 0) +
      (honesty !== null ? 0.2 * honesty : 0) +
      12 * sharpenRate +
      (ownBar !== null ? 1.2 * ownBar : 0) +
      Math.min(8, input.rubricMinutes ?? 0);
    if (tastesSharpened > 0) {
      judgmentEvidence.push(
        `Sharpened your own standard on ${tastesSharpened} of ${assignmentsSubmitted} assignment(s)`
      );
    } else {
      judgmentEvidence.push(
        "You've been shipping the AI's default taste file — rewriting it is how you show your own standard"
      );
    }
    if (agreement !== null) {
      judgmentEvidence.push(
        `Your judging calls matched the settled ranking ${Math.round(agreement)}% of the time`
      );
    }
    if (honesty !== null) {
      judgmentEvidence.push(
        `Placed your own work honestly ${Math.round(honesty)}% of the time`
      );
    }
    if (ownBar !== null) {
      judgmentEvidence.push(`Met your own bar at ${ownBar.toFixed(1)}/10`);
    }
  } else {
    judgmentEvidence.push(
      "Taste is a skill: submit an assignment, sharpen your taste file, and judge your pairs to build this"
    );
  }
  const judgment = signal(
    "judgment",
    "Taste & judgment",
    "Knows what good looks like — and holds themselves to it.",
    judgmentScore,
    judgmentEvidence
  );

  const competencies = [
    dependability,
    workEthic,
    initiative,
    leadership,
    collaboration,
    coachability,
    focus,
    judgment,
  ];

  const hasSignal =
    input.sessionsAttended > 0 ||
    input.answered > 0 ||
    input.doneTasks > 0 ||
    input.peopleMet > 0 ||
    input.exercisesJoined > 0 ||
    input.selfAssignedTasks > 0 ||
    input.distributedTasks > 0 ||
    lecturesFollowed > 0 ||
    assignmentsSubmitted > 0 ||
    (input.shoutOutsGiven ?? 0) > 0 ||
    (input.shoutOutsReceived ?? 0) > 0;

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
