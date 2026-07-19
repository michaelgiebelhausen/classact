import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AssignmentCreate } from "@/components/features/assignments/AssignmentCreate";

/**
 * Tasty Grading — assignment list. Professor sees the create form;
 * everyone sees the assignments with their state at a glance.
 */

const STATE_LABELS: Record<string, string> = {
  open: "Open for submissions",
  analyzing: "AI analyzing",
  peer_review: "Peer grading",
  finalizing: "Awaiting professor",
  published: "Graded",
};

export default async function AssignmentsPage({
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

  const { data: assignments } = await supabase
    .from("assignments")
    .select("id, title, deadline, peer_close_at, state, published_at")
    .eq("course_id", courseId)
    .order("deadline", { ascending: false });
  const now = new Date();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="text-sm text-muted-foreground">
          {isProfessor
            ? `${course.name} — Tasty Grading: your class co-writes the standard, AI drafts the ranking, you publish.`
            : `${course.name} — set your standard, do the work, judge like a pro.`}
        </p>
      </div>

      {isProfessor && <AssignmentCreate courseId={courseId} />}

      {(assignments ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {isProfessor
              ? "No assignments yet — publish the first one above."
              : "No assignments yet. When your professor posts one, your taste file starts here."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {(assignments ?? []).map((a) => {
            const deadlinePassed = new Date(a.deadline) < now;
            const stateLabel =
              a.state === "open" && deadlinePassed
                ? "AI analyzing"
                : (STATE_LABELS[a.state] ?? a.state);
            return (
              <Link
                key={a.id}
                href={`/course/${courseId}/assignments/${a.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 transition-colors hover:border-primary"
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Due {new Date(a.deadline).toLocaleString()}
                  </p>
                </div>
                <Badge variant={a.state === "published" ? "default" : "secondary"}>
                  {stateLabel}
                </Badge>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
