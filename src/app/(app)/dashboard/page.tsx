import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BecomeProfessorButton } from "@/components/features/profile/BecomeProfessorButton";
import { CourseList } from "@/components/features/dashboard/CourseList";
import { formatSchedule } from "@/lib/schedule";

export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();

  if (profile.role === "professor") {
    const { data: courses } = await supabase
      .from("courses")
      .select(
        "id, name, term, join_code, meeting_days, meeting_start, meeting_end, timezone"
      )
      .eq("professor_id", profile.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });

    return (
      <div className="grid gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">My courses</h1>
          <Button asChild>
            <Link href="/course/new">Create course</Link>
          </Button>
        </div>
        {!courses || courses.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No courses yet. Create one and you&apos;ll have a room set up in
              about five minutes.
            </CardContent>
          </Card>
        ) : (
          <CourseList
            courses={courses.map((c) => ({
              id: c.id,
              name: c.name,
              term: c.term,
              joinCode: c.join_code,
              scheduleLabel:
                (c.meeting_days as number[])?.length &&
                c.meeting_start &&
                c.meeting_end
                  ? formatSchedule({
                      days: c.meeting_days as number[],
                      start: c.meeting_start,
                      end: c.meeting_end,
                      timezone: c.timezone ?? "UTC",
                    })
                  : "",
            }))}
          />
        )}
      </div>
    );
  }

  // Student view
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, status, course_id, courses(id, name, term)")
    .eq("profile_id", profile.id)
    .neq("status", "dropped");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">My classes</h1>
        <div className="flex gap-2">
          <BecomeProfessorButton />
          <Button asChild variant="outline">
            <Link href="/join">Join a class</Link>
          </Button>
        </div>
      </div>
      {!enrollments || enrollments.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            You&apos;re not in any classes yet. Got a join code from your
            professor? Use it above.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {enrollments.map((e) => {
            const course = e.courses as unknown as {
              id: string;
              name: string;
              term: string | null;
            } | null;
            if (!course) return null;
            return (
              <Card key={e.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{course.name}</CardTitle>
                  <CardDescription>
                    {course.term ?? ""}
                    {e.status === "invited" && (
                      <Badge variant="secondary" className="ml-2">
                        Pending approval
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild size="sm">
                    <Link href={`/course/${course.id}`}>Open</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
