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
import type { SignalLevel } from "@/lib/employability";
import {
  getCourseMetrics,
  getCourseProjectStats,
  getMyProjectStats,
  getStudentMetrics,
  getStudentWorkReadiness,
} from "@/server/actions/metrics";
import {
  getMyMetricsV2,
  getParticipationCockpit,
} from "@/server/actions/participation";
import { ParticipationCockpit } from "@/components/features/metrics/ParticipationCockpit";

const LEVEL_META: Record<
  SignalLevel,
  { label: string; badge: string }
> = {
  "getting-started": {
    label: "Getting started",
    badge: "bg-muted text-muted-foreground",
  },
  building: { label: "Building", badge: "bg-amber-100 text-amber-800" },
  strong: { label: "Strong", badge: "bg-sky-100 text-sky-800" },
  standout: { label: "Standout", badge: "bg-green-100 text-green-800" },
};

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
    const cockpit = await getParticipationCockpit(courseId);
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
        {cockpit && cockpit.participants.length > 0 && (
          <ParticipationCockpit courseId={courseId} data={cockpit} />
        )}
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
  // v2 (all signals + 8 competencies) with graceful fallback to v1.
  const v2 = await getMyMetricsV2(courseId);
  const readiness = v2?.workReadiness ?? (await getStudentWorkReadiness(courseId));
  const extras = v2?.extras ?? null;
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
      {readiness && (
        <Card>
          <CardHeader>
            <CardTitle>Work readiness</CardTitle>
            <CardDescription>
              The habits employers actually screen for, read from your own
              ClassAct activity. These are the same signals your professor can
              see — it&apos;s your data. Use it to spot where you&apos;re strong
              and where to push before you hit the job market.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {readiness.hasSignal &&
              (readiness.strengths.length > 0 ||
                readiness.growth.length > 0) && (
                <div className="flex flex-wrap gap-4 text-sm">
                  {readiness.strengths.length > 0 && (
                    <p>
                      <span className="font-medium text-green-700">
                        Your standout strengths:
                      </span>{" "}
                      {readiness.strengths.join(", ")}
                    </p>
                  )}
                  {readiness.growth.length > 0 && (
                    <p>
                      <span className="font-medium text-amber-700">
                        Where to grow:
                      </span>{" "}
                      {readiness.growth.join(", ")}
                    </p>
                  )}
                </div>
              )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {readiness.competencies.map((c) => (
                <div key={c.key} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{c.label}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${LEVEL_META[c.level].badge}`}
                    >
                      {LEVEL_META[c.level].label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.blurb}
                  </p>
                  <ul className="mt-2 grid gap-1">
                    {c.evidence.map((e, i) => (
                      <li
                        key={i}
                        className="text-xs leading-snug text-muted-foreground"
                      >
                        • {e}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              These are honest proxies, not a grade — a nudge toward the
              behaviours that make someone worth hiring, and eventually the
              basis for Job Offers.
            </p>
          </CardContent>
        </Card>
      )}

      {extras && (extras.answered > 0 || extras.lecturesFollowed > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>In class</CardTitle>
            <CardDescription>
              Active learning and staying on task — the habits the room can feel.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Questions answered" value={extras.answered} />
            <Metric label="First vote right" value={extras.firstCorrect} />
            <Metric
              label="Changed to correct"
              value={extras.changedToCorrect}
            />
            <Metric
              label="Group answers you wrote"
              value={extras.groupAnswersWritten}
            />
            <Metric
              label="On-task rate"
              value={
                extras.onTaskRate !== null
                  ? `${Math.round(extras.onTaskRate * 100)}%`
                  : "—"
              }
            />
            <Metric label="Lectures followed" value={extras.lecturesFollowed} />
            <Metric label="Drifts off task" value={extras.driftCount} />
            <Metric label="Groups joined" value={extras.groupsJoined} />
          </CardContent>
        </Card>
      )}

      {extras && extras.assignmentsSubmitted > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Taste &amp; judgment</CardTitle>
            <CardDescription>
              From your assignments: the standard you set, whether you met
              it, and how well you judge other people&apos;s work.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Assignments submitted"
              value={extras.assignmentsSubmitted}
            />
            <Metric
              label="Met your own bar"
              value={
                extras.avgOwnBar !== null
                  ? `${extras.avgOwnBar.toFixed(1)}/10`
                  : "—"
              }
            />
            <Metric
              label="Distinctive ↔ generic"
              value={
                extras.avgDistinctiveness !== null
                  ? `${extras.avgDistinctiveness.toFixed(1)}/10`
                  : "—"
              }
            />
            <Metric
              label="Recognizes good work"
              value={
                extras.avgTasteAgreement !== null
                  ? `${Math.round(extras.avgTasteAgreement)}%`
                  : "—"
              }
            />
            <Metric
              label="Self-honesty"
              value={
                extras.avgSelfHonesty !== null
                  ? `${Math.round(extras.avgSelfHonesty)}%`
                  : "—"
              }
            />
            <Metric
              label="Turned in early by"
              value={
                extras.medianHoursBeforeDeadline !== null
                  ? `${Math.max(0, Math.round(extras.medianHoursBeforeDeadline))}h`
                  : "—"
              }
            />
            <Metric label="Rubric study time" value={`${extras.rubricMinutes}m`} />
            <Metric
              label="Spots excellence"
              value={
                extras.spotsExcellence.given > 0
                  ? `${extras.spotsExcellence.hits}/${extras.spotsExcellence.given}`
                  : "—"
              }
            />
          </CardContent>
        </Card>
      )}

      {v2 && (v2.shoutOutsReceived.length > 0 || (extras?.shoutOutsGiven ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Shout-outs</CardTitle>
            <CardDescription>
              Received {extras?.shoutOutsReceived ?? 0} · given{" "}
              {extras?.shoutOutsGiven ?? 0} — noticing good work counts too.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {v2.shoutOutsReceived.slice(0, 6).map((s, i) => (
              <div key={i} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {s.context === "peer_review"
                    ? "Someone admired your work in peer grading"
                    : "A classmate shouted you out"}
                </p>
                {s.message && (
                  <p className="text-muted-foreground">{s.message}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
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
