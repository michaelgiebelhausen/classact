import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { resolveEnrollmentPhotos } from "@/lib/storage";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function CourseHomePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // RLS: only members (professor or active student) can read the course row.
  // A non-member gets null -> 404, which also gates the directory below.
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, term, professor_id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const isProfessor = course.professor_id === profile.id;

  // Classmate directory (names + one photo, never emails). Students can't
  // list classmates' enrollment rows under RLS (email privacy), so after the
  // RLS-verified membership check above we read the directory via admin.
  const directory = isConfigured.supabaseAdmin ? createAdminClient() : supabase;

  const { data: enrollments } = await directory
    .from("enrollments")
    .select("id, roster_name, profile_id, status, roster_photo_path")
    .eq("course_id", courseId)
    .order("roster_name");

  const photoMap = await resolveEnrollmentPhotos(directory, enrollments ?? []);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {course.name}
          </h1>
          <p className="text-sm text-muted-foreground">{course.term ?? ""}</p>
        </div>
        <div className="flex gap-2">
          {isProfessor ? (
            <>
              <Button asChild>
                <Link href={`/course/${courseId}/checkin`}>Today&apos;s session</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/course/${courseId}/setup`}>Setup</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/course/${courseId}/metrics`}>Metrics</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild>
                <Link href={`/course/${courseId}/checkin`}>Check in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/course/${courseId}/games`}>Name games</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/course/${courseId}/metrics`}>My metrics</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Who&apos;s in this class</CardTitle>
          <CardDescription>
            {enrollments?.length ?? 0} students on the roster.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!enrollments || enrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No students yet — import your roster from Canvas or CSV in Setup.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-5 md:grid-cols-6">
              {enrollments.map((e) => {
                const url = photoMap.get(e.id)?.[0];
                return (
                  <div
                    key={e.id}
                    className="flex flex-col items-center gap-1 text-center"
                  >
                    <Avatar className="h-14 w-14">
                      {url && <AvatarImage src={url} alt={e.roster_name} />}
                      <AvatarFallback>{initials(e.roster_name)}</AvatarFallback>
                    </Avatar>
                    <span className="text-xs">{e.roster_name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
