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
import { stageRoster } from "@/server/stageroster";
import { isFounder } from "@/server/founder";
import { StagedRoster } from "@/components/features/roster/StagedRoster";
import { resolveDisplayName, initialsOf } from "@/lib/names";

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
    .select(
      "id, name, term, professor_id, join_code, canvas_course_id, canvas_section_ids, canvas_synced_at"
    )
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const isProfessor = course.professor_id === profile.id;

  // Classmate directory (names + one photo, never emails). Students can't
  // list classmates' enrollment rows under RLS (email privacy), so after the
  // RLS-verified membership check above we read the directory via admin.
  const directory = isConfigured.supabaseAdmin ? createAdminClient() : supabase;

  // `dropped` is excluded: this card answers "who's in this class", and a
  // student the professor already confirmed had left is not. The setup panel
  // has always filtered them; this card had not.
  const { data: enrollments } = await directory
    .from("enrollments")
    .select(
      "id, roster_name, roster_email, profile_id, status, roster_photo_path, invited_at, invite_error, canvas_missing_since, canvas_seen_at"
    )
    .eq("course_id", courseId)
    .neq("status", "dropped")
    .order("roster_name");

  // First names for the "who's in this class" grid. roster_name is the raw
  // registrar/email value (for a code-joiner it IS their email) so resolve a
  // safe display name and reduce it to a first name, preferring the given name
  // the student set on their profile. Read via the admin `directory` client
  // for the same reason the enrollments are: a student can't read classmates'
  // profile rows under RLS.
  //
  // Photos, names and the founder flag don't depend on each other: one round
  // trip. This is the page behind "Open" on the dashboard.
  const linkedProfileIds = [
    ...new Set(
      (enrollments ?? [])
        .map((e) => e.profile_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const [photoMap, { data: profiles }, founder] = await Promise.all([
    resolveEnrollmentPhotos(directory, enrollments ?? []),
    linkedProfileIds.length > 0
      ? directory
          .from("profiles")
          .select("id, first_name, full_name")
          .in("id", linkedProfileIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; first_name: string | null; full_name: string | null }>,
        }),
    // Account-destroying tools are hidden from ordinary professors, not
    // merely refused: a button that exists and says no is worse than none.
    isProfessor ? isFounder() : Promise.resolve(false),
  ]);
  const profileNames = new Map<string, { firstName: string | null; fullName: string | null }>();
  for (const p of profiles ?? []) {
    profileNames.set(p.id, { firstName: p.first_name, fullName: p.full_name });
  }

  function displayFirstName(e: {
    roster_name: string;
    profile_id: string | null;
  }): string {
    return resolveDisplayName(
      e.roster_name,
      e.profile_id ? profileNames.get(e.profile_id) : null
    ).firstName;
  }

  // Registration stages are for the professor alone. Which classmate hasn't
  // claimed an account, or signed in with a personal address, is nobody
  // else's business — and this is a page that gets projected.
  const staged =
    isProfessor && isConfigured.supabaseAdmin
      ? await stageRoster(createAdminClient(), enrollments ?? [], photoMap)
      : null;

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

      {staged ? (
        <StagedRoster
          groups={staged.groups}
          total={staged.total}
          courseId={courseId}
          canvasCourseId={course.canvas_course_id}
          sectionIds={course.canvas_section_ids}
          syncedAt={course.canvas_synced_at}
          joinCode={course.join_code}
          founder={founder}
        />
      ) : (
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
                const firstName = displayFirstName(e);
                return (
                  <div
                    key={e.id}
                    className="flex flex-col items-center gap-1 text-center"
                  >
                    <Avatar className="h-14 w-14">
                      {url && <AvatarImage src={url} alt={firstName} />}
                      <AvatarFallback>{initialsOf(firstName)}</AvatarFallback>
                    </Avatar>
                    <span className="text-xs">{firstName}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
