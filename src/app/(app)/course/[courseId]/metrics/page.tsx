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
import {
  getCourseMetrics,
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
      </div>
    );
  }

  const metrics = await getStudentMetrics(courseId);
  if (!metrics) notFound();
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
    </div>
  );
}
