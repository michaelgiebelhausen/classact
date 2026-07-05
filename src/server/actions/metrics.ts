import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { CONTRACT_TASK_TITLE } from "@/lib/projects";
import {
  computeMemberStats,
  type MemberProjectStats,
  type ProjectTaskInput,
} from "@/lib/projectstats";

export interface StudentMetrics {
  sessionsAttended: number;
  verifiedAttendances: number;
  seatsVisited: number;
  peopleMet: number;
  networkingScore: number;
  bestMemoryTiles: number | null;
  bestFlashCards: number | null;
  bestMatching: number | null;
  gamesPlayed: number;
}

export interface CourseStudentRow {
  enrollmentId: string;
  name: string;
  checkIns: number;
  verified: number;
  gamesPlayed: number;
  networkingScore: number;
}

export interface CourseMetrics {
  sessionCount: number;
  totalCheckIns: number;
  verificationRate: number; // 0..1
  students: CourseStudentRow[];
}

/** Metrics for the signed-in student in a course (FR-015). */
export async function getStudentMetrics(
  courseId: string
): Promise<StudentMetrics | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) return null;

  const [{ data: checkins }, { data: verifs }, { data: scores }] =
    await Promise.all([
      supabase
        .from("check_ins")
        .select("seat_id, verified, is_new_seat")
        .eq("enrollment_id", enrollment.id),
      supabase
        .from("seat_verifications")
        .select("subject_enrollment_id, verifier_enrollment_id")
        .or(
          `verifier_enrollment_id.eq.${enrollment.id},subject_enrollment_id.eq.${enrollment.id}`
        ),
      supabase
        .from("name_game_scores")
        .select("game_type, score")
        .eq("enrollment_id", enrollment.id),
    ]);

  const met = new Set<string>();
  for (const v of verifs ?? []) {
    met.add(
      v.verifier_enrollment_id === enrollment.id
        ? v.subject_enrollment_id
        : v.verifier_enrollment_id
    );
  }
  met.delete(enrollment.id);

  const memory = (scores ?? []).filter((s) => s.game_type === "memory_tiles");
  const flash = (scores ?? []).filter((s) => s.game_type === "flash_cards");
  const matching = (scores ?? []).filter((s) => s.game_type === "matching");

  return {
    sessionsAttended: (checkins ?? []).length,
    verifiedAttendances: (checkins ?? []).filter((c) => c.verified).length,
    seatsVisited: new Set((checkins ?? []).map((c) => c.seat_id)).size,
    peopleMet: met.size,
    networkingScore: (checkins ?? []).filter((c) => c.is_new_seat).length,
    bestMemoryTiles:
      memory.length > 0 ? Math.max(...memory.map((s) => s.score)) : null,
    bestFlashCards:
      flash.length > 0 ? Math.max(...flash.map((s) => s.score)) : null,
    bestMatching:
      matching.length > 0 ? Math.max(...matching.map((s) => s.score)) : null,
    gamesPlayed: (scores ?? []).length,
  };
}

/** Participation overview for the owning professor (FR-016). */
export async function getCourseMetrics(
  courseId: string
): Promise<CourseMetrics | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) return null;

  // Professor passes RLS for these tables; admin only as fallback safety.
  const client =
    isConfigured.supabaseAdmin ? createAdminClient() : supabase;

  const [{ data: sessions }, { data: enrollments }] = await Promise.all([
    client.from("class_sessions").select("id").eq("course_id", courseId),
    client
      .from("enrollments")
      .select("id, roster_name")
      .eq("course_id", courseId)
      .eq("status", "active")
      .order("roster_name"),
  ]);

  const enrollmentIds = (enrollments ?? []).map((e) => e.id);
  const [{ data: checkins }, { data: scores }] = await Promise.all([
    enrollmentIds.length > 0
      ? client
          .from("check_ins")
          .select("enrollment_id, verified, is_new_seat")
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] as { enrollment_id: string; verified: boolean; is_new_seat: boolean }[] }),
    enrollmentIds.length > 0
      ? client
          .from("name_game_scores")
          .select("enrollment_id")
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] as { enrollment_id: string }[] }),
  ]);

  const byEnrollment = new Map<
    string,
    { checkIns: number; verified: number; games: number; networking: number }
  >();
  for (const id of enrollmentIds) {
    byEnrollment.set(id, { checkIns: 0, verified: 0, games: 0, networking: 0 });
  }
  for (const c of checkins ?? []) {
    const agg = byEnrollment.get(c.enrollment_id);
    if (!agg) continue;
    agg.checkIns++;
    if (c.verified) agg.verified++;
    if (c.is_new_seat) agg.networking++;
  }
  for (const s of scores ?? []) {
    const agg = byEnrollment.get(s.enrollment_id);
    if (agg) agg.games++;
  }

  const totalCheckIns = (checkins ?? []).length;
  const totalVerified = (checkins ?? []).filter((c) => c.verified).length;

  return {
    sessionCount: (sessions ?? []).length,
    totalCheckIns,
    verificationRate: totalCheckIns > 0 ? totalVerified / totalCheckIns : 0,
    students: (enrollments ?? []).map((e) => {
      const agg = byEnrollment.get(e.id)!;
      return {
        enrollmentId: e.id,
        name: e.roster_name,
        checkIns: agg.checkIns,
        verified: agg.verified,
        gamesPlayed: agg.games,
        networkingScore: agg.networking,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Team projects — one stats engine (lib/projectstats) for both audiences:
// whatever the professor sees about a student, that student sees about
// themselves (students own their data).
// ---------------------------------------------------------------------------

export interface ProjectMemberStatsRow {
  enrollmentId: string;
  name: string;
  role: "lead" | "member";
  signedContract: boolean;
  stats: MemberProjectStats;
}

export interface ProjectTeamStats {
  teamId: string;
  teamName: string;
  teamDoneMinutes: number;
  members: ProjectMemberStatsRow[]; // sorted by credited minutes, descending
}

export interface CourseProjectStats {
  projectId: string;
  projectTitle: string;
  teams: ProjectTeamStats[];
}

export interface MyProjectStats {
  projectId: string;
  projectTitle: string;
  teamName: string;
  signedContract: boolean;
  teamDoneMinutes: number;
  stats: MemberProjectStats;
}

type TeamTaskStatsRow = {
  id: string;
  team_id: string;
  title: string;
  status: "unassigned" | "assigned" | "done";
  estimated_minutes: number;
  actual_minutes: number | null;
  assigned_enrollment_id: string | null;
  assigned_by_enrollment_id: string | null;
};

function toTaskInputs(
  rows: TeamTaskStatsRow[],
  flaggedTaskIds: Set<string>
): ProjectTaskInput[] {
  return rows.map((t) => ({
    teamId: t.team_id,
    assignedEnrollmentId: t.assigned_enrollment_id,
    assignedByEnrollmentId: t.assigned_by_enrollment_id,
    status: t.status,
    estimatedMinutes: t.estimated_minutes,
    actualMinutes: t.actual_minutes,
    isContract: t.title === CONTRACT_TASK_TITLE,
    hasOpenFlag: flaggedTaskIds.has(t.id),
  }));
}

/** Professor: per-project, per-team, per-member contribution stats. */
export async function getCourseProjectStats(
  courseId: string
): Promise<CourseProjectStats[] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) return null;

  const [{ data: projects }, { data: teams }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_teams")
      .select("id, project_id, name")
      .eq("course_id", courseId)
      .order("created_at", { ascending: true }),
  ]);
  const teamIds = (teams ?? []).map((t) => t.id);
  if (teamIds.length === 0) return [];

  const [
    { data: memberRows },
    { data: taskRows },
    { data: flagRows },
    { data: sigRows },
  ] = await Promise.all([
    supabase
      .from("project_team_members")
      .select("team_id, project_id, enrollment_id, role, enrollments(roster_name)")
      .in("team_id", teamIds),
    supabase
      .from("team_tasks")
      .select(
        "id, team_id, project_id, title, status, estimated_minutes, actual_minutes, assigned_enrollment_id, assigned_by_enrollment_id"
      )
      .in("team_id", teamIds),
    supabase
      .from("task_flags")
      .select("team_task_id")
      .eq("course_id", courseId)
      .is("resolved_at", null),
    supabase
      .from("team_contract_signatures")
      .select("team_id, enrollment_id")
      .in("team_id", teamIds),
  ]);

  const flaggedIds = new Set((flagRows ?? []).map((f) => f.team_task_id));
  const signedSet = new Set(
    (sigRows ?? []).map((s) => `${s.team_id}:${s.enrollment_id}`)
  );

  return (projects ?? [])
    .map((project) => {
      const projectTeams = (teams ?? []).filter(
        (t) => t.project_id === project.id
      );
      const teamStats: ProjectTeamStats[] = projectTeams.map((team) => {
        const members = (memberRows ?? []).filter(
          (m) => m.team_id === team.id
        );
        const tasks = toTaskInputs(
          ((taskRows ?? []) as (TeamTaskStatsRow & { project_id: string })[])
            .filter((t) => t.team_id === team.id),
          flaggedIds
        );
        const statsByMember = new Map(
          computeMemberStats(
            members.map((m) => ({
              enrollmentId: m.enrollment_id,
              teamId: m.team_id,
            })),
            tasks
          ).map((s) => [s.enrollmentId, s])
        );
        const rows: ProjectMemberStatsRow[] = members
          .map((m) => ({
            enrollmentId: m.enrollment_id,
            name:
              (m.enrollments as unknown as { roster_name: string } | null)
                ?.roster_name ?? "Unknown",
            role: m.role,
            signedContract: signedSet.has(`${team.id}:${m.enrollment_id}`),
            stats: statsByMember.get(m.enrollment_id)!,
          }))
          .sort(
            (a, b) =>
              b.stats.doneMinutes - a.stats.doneMinutes ||
              a.name.localeCompare(b.name)
          );
        return {
          teamId: team.id,
          teamName: team.name,
          teamDoneMinutes: rows.reduce(
            (sum, r) => sum + r.stats.doneMinutes,
            0
          ),
          members: rows,
        };
      });
      return {
        projectId: project.id,
        projectTitle: project.title,
        teams: teamStats,
      };
    })
    .filter((p) => p.teams.length > 0);
}

/** Student: the same numbers the professor sees — about yourself. */
export async function getMyProjectStats(
  courseId: string
): Promise<MyProjectStats[] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) return null;

  const { data: myMemberships } = await supabase
    .from("project_team_members")
    .select("team_id")
    .eq("enrollment_id", enrollment.id);
  const teamIds = (myMemberships ?? []).map((m) => m.team_id);
  if (teamIds.length === 0) return [];

  const [
    { data: teams },
    { data: memberRows },
    { data: taskRows },
    { data: flagRows },
    { data: sigRows },
  ] = await Promise.all([
    supabase
      .from("project_teams")
      .select("id, project_id, name, projects(title)")
      .in("id", teamIds),
    supabase
      .from("project_team_members")
      .select("team_id, enrollment_id")
      .in("team_id", teamIds),
    supabase
      .from("team_tasks")
      .select(
        "id, team_id, title, status, estimated_minutes, actual_minutes, assigned_enrollment_id, assigned_by_enrollment_id"
      )
      .in("team_id", teamIds),
    supabase
      .from("task_flags")
      .select("team_task_id")
      .eq("course_id", courseId)
      .is("resolved_at", null),
    supabase
      .from("team_contract_signatures")
      .select("team_id, enrollment_id")
      .in("team_id", teamIds),
  ]);

  const flaggedIds = new Set((flagRows ?? []).map((f) => f.team_task_id));
  const signedSet = new Set(
    (sigRows ?? []).map((s) => `${s.team_id}:${s.enrollment_id}`)
  );

  const out: MyProjectStats[] = [];
  for (const team of teams ?? []) {
    const members = (memberRows ?? [])
      .filter((m) => m.team_id === team.id)
      .map((m) => ({ enrollmentId: m.enrollment_id, teamId: m.team_id }));
    const tasks = toTaskInputs(
      ((taskRows ?? []) as TeamTaskStatsRow[]).filter(
        (t) => t.team_id === team.id
      ),
      flaggedIds
    );
    const stats = computeMemberStats(members, tasks);
    const mine = stats.find((s) => s.enrollmentId === enrollment.id);
    if (!mine) continue;
    out.push({
      projectId: team.project_id,
      projectTitle:
        (team.projects as unknown as { title: string } | null)?.title ??
        "Project",
      teamName: team.name,
      signedContract: signedSet.has(`${team.id}:${enrollment.id}`),
      teamDoneMinutes: stats.reduce((sum, s) => sum + s.doneMinutes, 0),
      stats: mine,
    });
  }
  return out;
}
