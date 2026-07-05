import { notFound, redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { formatMinutes } from "@/lib/projects";
import {
  getCourseMetrics,
  getCourseProjectStats,
  getMyProjectStats,
  getStudentMetrics,
} from "@/server/actions/metrics";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default async function MetricsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
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

  if (isProfessor) {
    const metrics = await getCourseMetrics(courseId);
    if (!metrics) notFound();
    const projectStats = (await getCourseProjectStats(courseId)) ?? [];
    const hasActivity = metrics.totalCheckIns > 0;
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Participation
          </h1>
          <p className="text-sm text-muted-foreground">{course.name}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric label="Sessions held" value={metrics.sessionCount} />
          <Metric label="Total check-ins" value={metrics.totalCheckIns} />
          <Metric
            label="Verification rate"
            value={
              hasActivity
                ? `${Math.round(metrics.verificationRate * 100)}%`
                : "—"
            }
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Per student</CardTitle>
            <CardDescription>
              Verified means a neighbor confirmed they were in the room.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.students.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activated students yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Check-ins</TableHead>
                    <TableHead className="text-right">Verified</TableHead>
                    <TableHead className="text-right">Games</TableHead>
                    <TableHead className="text-right">Networking</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.students.map((s) => (
                    <TableRow key={s.enrollmentId}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell className="text-right">{s.checkIns}</TableCell>
                      <TableCell className="text-right">{s.verified}</TableCell>
                      <TableCell className="text-right">
                        {s.gamesPlayed}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.networkingScore}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {projectStats.map((project) => (
          <Card key={project.projectId}>
            <CardHeader>
              <CardTitle>Project: {project.projectTitle}</CardTitle>
              <CardDescription>
                Done counts actual minutes when logged (estimate otherwise);
                flagged work earns nothing until you settle the flag. Students
                see these same numbers about themselves.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              {project.teams.map((team) => (
                <div key={team.teamId}>
                  <p className="mb-2 text-sm font-medium">
                    {team.teamName}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      team total {formatMinutes(team.teamDoneMinutes)}
                    </span>
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead className="text-right">Done</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead className="text-right">
                          Biggest task
                        </TableHead>
                        <TableHead className="text-right">Handed out</TableHead>
                        <TableHead className="text-right">Queued</TableHead>
                        <TableHead className="text-right">Flagged</TableHead>
                        <TableHead className="text-right">Contract</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {team.members.map((m) => (
                        <TableRow key={m.enrollmentId}>
                          <TableCell>
                            {m.name}
                            {m.role === "lead" && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                (lead)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMinutes(m.stats.doneMinutes)}
                          </TableCell>
                          <TableCell className="text-right">
                            {team.teamDoneMinutes > 0
                              ? `${Math.round(m.stats.shareOfTeamDone * 100)}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.stats.biggestTaskMinutes > 0
                              ? formatMinutes(m.stats.biggestTaskMinutes)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.stats.distributedTasks}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.stats.queuedMinutes > 0
                              ? formatMinutes(m.stats.queuedMinutes)
                              : "—"}
                          </TableCell>
                          <TableCell
                            className={
                              m.stats.flaggedTasks > 0
                                ? "text-right font-medium text-red-600"
                                : "text-right"
                            }
                          >
                            {m.stats.flaggedTasks > 0
                              ? formatMinutes(m.stats.flaggedMinutes)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.signedContract ? "Signed" : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const metrics = await getStudentMetrics(courseId);
  if (!metrics) notFound();
  const myProjects = (await getMyProjectStats(courseId)) ?? [];
  const noActivity =
    metrics.sessionsAttended === 0 && metrics.gamesPlayed === 0;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My metrics</h1>
        <p className="text-sm text-muted-foreground">{course.name}</p>
      </div>
      {noActivity ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nothing yet — check in at your next class and your numbers start
            here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Classes attended" value={metrics.sessionsAttended} />
          <Metric label="Verified by a neighbor" value={metrics.verifiedAttendances} />
          <Metric label="Seats tried" value={metrics.seatsVisited} />
          <Metric label="People met" value={metrics.peopleMet} />
          <Metric label="Networking score" value={metrics.networkingScore} />
          <Metric label="Games played" value={metrics.gamesPlayed} />
          <Metric
            label="Best memory tiles"
            value={metrics.bestMemoryTiles ?? "—"}
          />
          <Metric
            label="Best flash cards"
            value={metrics.bestFlashCards ?? "—"}
          />
          <Metric label="Best matching" value={metrics.bestMatching ?? "—"} />
        </div>
      )}
      {myProjects.map((p) => (
        <Card key={`${p.projectId}-team`}>
          <CardHeader>
            <CardTitle>Project: {p.projectTitle}</CardTitle>
            <CardDescription>
              {p.teamName} ·{" "}
              {p.signedContract
                ? "contract signed"
                : "contract not signed yet"}{" "}
              · team total {formatMinutes(p.teamDoneMinutes)}. These are the
              same numbers your professor sees — your work, your data.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <p className="text-xs text-muted-foreground">Done work</p>
              <p className="text-xl font-semibold">
                {formatMinutes(p.stats.doneMinutes)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Share of team</p>
              <p className="text-xl font-semibold">
                {p.teamDoneMinutes > 0
                  ? `${Math.round(p.stats.shareOfTeamDone * 100)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Biggest task</p>
              <p className="text-xl font-semibold">
                {p.stats.biggestTaskMinutes > 0
                  ? formatMinutes(p.stats.biggestTaskMinutes)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Tasks handed out
              </p>
              <p className="text-xl font-semibold">
                {p.stats.distributedTasks}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">On my plate</p>
              <p className="text-xl font-semibold">
                {p.stats.queuedMinutes > 0
                  ? formatMinutes(p.stats.queuedMinutes)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Flagged work</p>
              <p
                className={
                  p.stats.flaggedTasks > 0
                    ? "text-xl font-semibold text-red-600"
                    : "text-xl font-semibold"
                }
              >
                {p.stats.flaggedTasks > 0
                  ? formatMinutes(p.stats.flaggedMinutes)
                  : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
