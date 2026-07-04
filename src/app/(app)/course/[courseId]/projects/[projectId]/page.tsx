import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { CONTRACT_TASK_TITLE } from "@/lib/projects";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TeamBoard,
  type BoardMember,
  type BoardTask,
} from "@/components/features/projects/TeamBoard";

export default async function ProjectBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; projectId: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { courseId, projectId } = await params;
  const { team: teamParam } = await searchParams;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, professor_id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  // RLS: students only see open projects, so drafts 404 for them.
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, due_date")
    .eq("id", projectId)
    .eq("course_id", courseId)
    .single();
  if (!project) notFound();

  const { data: teamRows } = await supabase
    .from("project_teams")
    .select("id, name")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  const teams = teamRows ?? [];

  const { data: memberRows } = await supabase
    .from("project_team_members")
    .select("team_id, enrollment_id, role, enrollments(roster_name)")
    .in("team_id", teams.map((t) => t.id));

  // Which board? Student: their own team. Professor: ?team= or the first.
  let myEnrollmentId: string | null = null;
  let activeTeamId: string | null = null;
  if (isProfessor) {
    activeTeamId =
      (teamParam && teams.some((t) => t.id === teamParam) ? teamParam : null) ??
      teams[0]?.id ??
      null;
  } else {
    const { data: myEnrollment } = await supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", courseId)
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .maybeSingle();
    myEnrollmentId = myEnrollment?.id ?? null;
    activeTeamId =
      (memberRows ?? []).find((m) => m.enrollment_id === myEnrollmentId)
        ?.team_id ?? null;
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <Link
          href={`/course/${courseId}/projects`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> All projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {project.title}
        </h1>
        <p className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{course.name}</span>
          {project.due_date && (
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3.5" />
              Due{" "}
              {new Date(`${project.due_date}T00:00:00`).toLocaleDateString(
                undefined,
                { month: "short", day: "numeric", year: "numeric" }
              )}
            </span>
          )}
        </p>
      </div>
      {isProfessor && teams.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {teams.map((t) => (
            <Link
              key={t.id}
              href={`/course/${courseId}/projects/${projectId}?team=${t.id}`}
              className={
                t.id === activeTeamId
                  ? "rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background"
                  : "rounded-full border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              }
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  if (!activeTeam) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>
              {isProfessor ? "No teams yet" : "You're not on a team yet"}
            </CardTitle>
            <CardDescription>
              {isProfessor
                ? "Boards appear here as students form teams."
                : "Head back to Projects to join or create a team — then your board lives here."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const members: BoardMember[] = (memberRows ?? [])
    .filter((m) => m.team_id === activeTeam.id)
    .map((m) => ({
      enrollmentId: m.enrollment_id,
      name:
        (m.enrollments as unknown as { roster_name: string } | null)
          ?.roster_name ?? "Unknown",
      role: m.role,
    }));

  const { data: taskRows } = await supabase
    .from("team_tasks")
    .select(
      "id, title, description, estimated_minutes, actual_minutes, status, assigned_enrollment_id, position"
    )
    .eq("team_id", activeTeam.id);

  // Unresolved flags on this board (RLS: visible to the team + professor).
  const { data: flagRows } = await supabase
    .from("task_flags")
    .select("id, team_task_id, flagged_by_enrollment_id, reason")
    .in("team_task_id", (taskRows ?? []).map((t) => t.id))
    .is("resolved_at", null);
  const flagsByTask = new Map<
    string,
    { id: string; reason: string; flaggedByEnrollmentId: string }[]
  >();
  for (const f of flagRows ?? []) {
    const list = flagsByTask.get(f.team_task_id) ?? [];
    list.push({
      id: f.id,
      reason: f.reason,
      flaggedByEnrollmentId: f.flagged_by_enrollment_id,
    });
    flagsByTask.set(f.team_task_id, list);
  }

  const tasks: BoardTask[] = (taskRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    estimatedMinutes: t.estimated_minutes,
    actualMinutes: t.actual_minutes,
    status: t.status,
    assignedEnrollmentId: t.assigned_enrollment_id,
    isContract: t.title === CONTRACT_TASK_TITLE,
    position: t.position,
    flags: flagsByTask.get(t.id) ?? [],
  }));

  return (
    <div className="grid gap-6">
      {header}
      <TeamBoard
        courseId={courseId}
        teamId={activeTeam.id}
        teamName={activeTeam.name}
        members={members}
        tasks={tasks}
        myEnrollmentId={myEnrollmentId}
      />
    </div>
  );
}
