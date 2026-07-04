import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { env } from "@/lib/env";
import { CourseSetupTabs } from "@/components/features/setup/CourseSetupTabs";

export default async function CourseSetupPage({
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
    .select("id, name, join_code, icebreaker_fields, professor_id")
    .eq("id", courseId)
    .single();

  if (!course) notFound();
  if (course.professor_id !== profile.id) redirect(`/course/${courseId}`);

  const [{ data: seats }, { data: enrollments }] = await Promise.all([
    supabase
      .from("seats")
      .select("row_index, col_index")
      .eq("course_id", courseId),
    supabase
      .from("enrollments")
      .select("id, roster_name, roster_email, status")
      .eq("course_id", courseId)
      .order("roster_name"),
  ]);

  const seatDims =
    seats && seats.length > 0
      ? {
          rows: Math.max(...seats.map((s) => s.row_index)) + 1,
          cols: Math.max(...seats.map((s) => s.col_index)) + 1,
        }
      : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{course.name}</h1>
        <p className="text-sm text-muted-foreground">
          Course setup — room, roster, icebreakers, invites.
        </p>
      </div>
      <CourseSetupTabs
        course={{
          id: course.id,
          name: course.name,
          join_code: course.join_code,
          icebreaker_fields: (course.icebreaker_fields as string[]) ?? [],
        }}
        seatDims={seatDims}
        enrollments={enrollments ?? []}
        siteUrl={env.siteUrl}
      />
    </div>
  );
}
