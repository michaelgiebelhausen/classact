import { notFound, redirect } from "next/navigation";
import { CalendarDays, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { formatMinutes } from "@/lib/projects";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ProjectManager,
  type ProjectListItem,
} from "@/components/features/projects/ProjectManager";
import type { TaskItem } from "@/components/features/projects/ProjectTasks";
import {
  TeamPanel,
  type TeamInfo,
} from "@/components/features/projects/TeamPanel";

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // RLS membership gate — non-members get null.
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, professor_id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <p className="text-sm text-muted-foreground">{course.name}</p>
    </div>
  );

  // RLS scopes this: professors see drafts too, students only open projects.
  const { data: projectRows } = await supabase
    .from("projects")
    .select(
      "id, title, page_count, due_date, target_team_size, contract_text, status"
    )
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  const { data: taskRows } = await supabase
    .from("project_tasks")
    .select("id, project_id, title, description, estimated_minutes, source")
    .eq("course_id", courseId)
    .order("position", { ascending: true });
  const tasksByProject = new Map<string, TaskItem[]>();
  for (const t of taskRows ?? []) {
    const list = tasksByProject.get(t.project_id) ?? [];
    list.push({
      id: t.id,
      title: t.title,
      description: t.description,
      estimatedMinutes: t.estimated_minutes,
      source: t.source,
    });
    tasksByProject.set(t.project_id, list);
  }

  // Teams + members + contract signatures. RLS trims what each viewer gets
  // (students only see signatures for their own team; that's fine — the UI
  // only shows signed-status inside your own team card).
  const { data: teamRows } = await supabase
    .from("project_teams")
    .select("id, project_id, name, contract_text")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  const { data: memberRows } = await supabase
    .from("project_team_members")
    .select("team_id, enrollment_id, role, enrollments(roster_name)")
    .in("team_id", (teamRows ?? []).map((t) => t.id));
  const { data: signatureRows } = await supabase
    .from("team_contract_signatures")
    .select("team_id, enrollment_id")
    .in("team_id", (teamRows ?? []).map((t) => t.id));
  const signedSet = new Set(
    (signatureRows ?? []).map((s) => `${s.team_id}:${s.enrollment_id}`)
  );

  // Unresolved flag counts per team (professor sees all; students, RLS-trimmed
  // to their own team's).
  const { data: openFlagRows } = await supabase
    .from("task_flags")
    .select("id, team_tasks(team_id)")
    .eq("course_id", courseId)
    .is("resolved_at", null);
  const flagCountByTeam = new Map<string, number>();
  for (const f of openFlagRows ?? []) {
    const teamId = (f.team_tasks as unknown as { team_id: string } | null)
      ?.team_id;
    if (!teamId) continue;
    flagCountByTeam.set(teamId, (flagCountByTeam.get(teamId) ?? 0) + 1);
  }
  const teamsByProject = new Map<string, TeamInfo[]>();
  for (const team of teamRows ?? []) {
    const members = (memberRows ?? [])
      .filter((m) => m.team_id === team.id)
      .map((m) => ({
        enrollmentId: m.enrollment_id,
        name:
          (m.enrollments as unknown as { roster_name: string } | null)
            ?.roster_name ?? "Unknown",
        role: m.role,
        signed: signedSet.has(`${team.id}:${m.enrollment_id}`),
      }));
    const list = teamsByProject.get(team.project_id) ?? [];
    list.push({
      id: team.id,
      name: team.name,
      contractText: team.contract_text,
      members,
    });
    teamsByProject.set(team.project_id, list);
  }

  // ---------- Professor ----------
  if (isProfessor) {
    const projects: ProjectListItem[] = (projectRows ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      pageCount: p.page_count,
      dueDate: p.due_date,
      targetTeamSize: p.target_team_size,
      contractText: p.contract_text,
      status: p.status,
      tasks: tasksByProject.get(p.id) ?? [],
      teams: (teamsByProject.get(p.id) ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        memberCount: t.members.length,
        signedCount: t.members.filter((m) => m.signed).length,
        flagCount: flagCountByTeam.get(t.id) ?? 0,
      })),
    }));
    return (
      <div className="grid gap-6">
        {header}
        <ProjectManager courseId={courseId} projects={projects} />
      </div>
    );
  }

  // ---------- Student ----------
  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();

  if (!projectRows || projectRows.length === 0) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              When your professor posts a group project, it shows up here with
              its task list and due date.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {header}
      {projectRows.map((p) => {
        const tasks = tasksByProject.get(p.id) ?? [];
        const totalMinutes = tasks.reduce(
          (sum, t) => sum + t.estimatedMinutes,
          0
        );
        return (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>{p.title}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-4">
                {p.due_date && (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5" />
                    Due{" "}
                    {new Date(`${p.due_date}T00:00:00`).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" }
                    )}
                  </span>
                )}
                {p.target_team_size && (
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    Teams of ~{p.target_team_size}
                  </span>
                )}
                {tasks.length > 0 && (
                  <span>
                    {tasks.length} tasks · ~{formatMinutes(totalMinutes)} of
                    work
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {tasks.length > 0 && (
                <ul className="grid gap-1.5">
                  {tasks.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm">{t.title}</p>
                        {t.description && (
                          <p className="break-words text-xs text-muted-foreground">
                            {t.description}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatMinutes(t.estimatedMinutes)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {myEnrollment ? (
                <TeamPanel
                  courseId={courseId}
                  projectId={p.id}
                  targetTeamSize={p.target_team_size}
                  myEnrollmentId={myEnrollment.id}
                  teams={teamsByProject.get(p.id) ?? []}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Activate your enrollment to join a team.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
