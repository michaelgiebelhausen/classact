import Link from "next/link";
import { redirect } from "next/navigation";
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
import { CourseList } from "@/components/features/dashboard/CourseList";
import { WhichAreYou } from "@/components/features/dashboard/WhichAreYou";
import { formatSchedule } from "@/lib/schedule";

/**
 * One dashboard, both halves.
 *
 * This used to fork on `profile.role`: professors saw a course list, students
 * saw a class list, and nobody saw both — so the professor sitting in someone
 * else's class had to pick which of the two true things about him the app
 * would acknowledge. Now it asks the database what he belongs to and renders
 * whatever comes back. Teach two and attend one and you get both sections.
 * Belong to nothing and you get the chooser.
 */
export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();

  const [{ data: courses, error: coursesError }, { data: enrollments, error: enrollError }] =
    await Promise.all([
      supabase
        .from("courses")
        .select(
          "id, name, term, join_code, meeting_days, meeting_start, meeting_end, timezone"
        )
        .eq("professor_id", profile.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("enrollments")
        .select("id, status, course_id, courses(id, name, term)")
        .eq("profile_id", profile.id)
        .neq("status", "dropped"),
    ]);

  // A failed query must never render as "nothing here" — most likely a
  // migration hasn't run (42703, undefined column) and the professor would
  // read it as their courses being gone. Worse now than it was: an empty
  // result is also what puts the which-are-you chooser on screen, so a
  // hiccup would greet a professor of three courses as a brand-new account.
  const failure = coursesError ?? enrollError;
  if (failure) {
    console.error("[dashboard] query failed:", {
      code: failure.code,
      message: failure.message,
    });
    throw new Error(
      `Your dashboard couldn't load: ${failure.message}. If that names a missing column, run the latest migrations in the Supabase SQL editor (see HANDOFF.md — currently through 0035_membership_is_the_role.sql).`
    );
  }

  const taught = courses ?? [];
  const joined = enrollments ?? [];

  // Belongs to nothing yet: no lists to draw, and no basis for guessing which
  // half of the product they came for. Ask, rather than assume.
  if (taught.length === 0 && joined.length === 0) {
    return <WhichAreYou />;
  }

  return (
    <div className="grid gap-10">
      {taught.length > 0 && (
        <div className="grid gap-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">
              Courses I teach
            </h1>
            <Button asChild>
              <Link href="/course/new">Create course</Link>
            </Button>
          </div>
          <CourseList
            courses={taught.map((c) => ({
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
        </div>
      )}

      {joined.length > 0 && (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Classes I&apos;m in
            </h1>
            <Button asChild variant="outline">
              <Link href="/join">Join a class</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {joined.map((e) => {
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
        </div>
      )}

      {/* The other door stays visible once you're through one of them. A
          professor may well be a student somewhere too, and a student who
          starts teaching shouldn't have to find a new account to do it. */}
      <div className="text-sm text-muted-foreground">
        {taught.length === 0 ? (
          <p>
            Teaching a course too?{" "}
            <Link href="/course/new" className="underline underline-offset-4">
              Create one
            </Link>{" "}
            — $4.99/month, and your classes here stay exactly as they are.
          </p>
        ) : joined.length === 0 ? (
          <p>
            Attending a class as well?{" "}
            <Link href="/join" className="underline underline-offset-4">
              Join with a code
            </Link>{" "}
            — same account, and your courses stay exactly as they are.
          </p>
        ) : null}
      </div>
    </div>
  );
}
