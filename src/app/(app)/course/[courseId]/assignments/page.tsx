import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LocalTime } from "@/components/ui/localtime";
import { getProfile } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AssignmentCreate,
  type AssignmentCopyFrom,
} from "@/components/features/assignments/AssignmentCreate";
import { DeleteAssignmentButton } from "@/components/features/assignments/DeleteAssignmentButton";
import { resolveGradingAxes, type TasteRequirement } from "@/lib/tastegrading";
import type { DeliverableType } from "@/lib/submissionfile";
import {
  STATUS_ROW_CLASS,
  submissionStatus,
  type SubmissionStatus,
} from "@/lib/submissionstatus";
import { CheckCircle2Icon, CircleAlertIcon, ClockIcon } from "lucide-react";

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

/**
 * The student's own line under the due date: a check with the date they
 * turned it in, an alert that it's past due with nothing in, or a clock
 * while it's still open. Color-coded to match the row border, but the icon
 * and words carry the meaning on their own.
 */
function StatusLine({ status }: { status: SubmissionStatus }) {
  if (status.kind === "submitted" && status.submittedAt) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
        <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
        <span>
          Submitted <LocalTime iso={status.submittedAt} variant="short" />
          {status.late && (
            <span className="ml-1.5 font-normal text-amber-700 dark:text-amber-400">
              (late)
            </span>
          )}
        </span>
      </p>
    );
  }
  if (status.kind === "missing") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
        <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
        Not submitted — past due
      </p>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
      <ClockIcon className="size-4 shrink-0" aria-hidden />
      Not submitted yet
    </p>
  );
}

export default async function AssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ copy?: string }>;
}) {
  const { courseId } = await params;
  const { copy: copyId } = await searchParams;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, professor_id, meeting_start")
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  const { data: assignments } = await supabase
    .from("assignments")
    .select("id, title, deadline, peer_close_at, state, published_at")
    .eq("course_id", courseId)
    // Oldest due date first; ties broken alphabetically by title (a number or
    // "A" near the top, "Z" at the bottom).
    .order("deadline", { ascending: true })
    .order("title", { ascending: true });
  const now = new Date();

  // Student: which of these have *I* turned in? One row per assignment for
  // my enrollment. The list colors each assignment by that answer, so a
  // student never has to open one to remember whether it's done.
  const submittedAtByAssignment = new Map<string, string>();
  if (!isProfessor && (assignments ?? []).length > 0) {
    const { data: myEnrollment } = await supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", courseId)
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (myEnrollment) {
      const { data: mine } = await supabase
        .from("submissions")
        .select("assignment_id, submitted_at")
        .eq("enrollment_id", myEnrollment.id)
        .in(
          "assignment_id",
          (assignments ?? []).map((a) => a.id)
        );
      for (const s of mine ?? []) {
        submittedAtByAssignment.set(s.assignment_id, s.submitted_at);
      }
    }
  }

  // "Copy" link → ?copy=<id>: pull the source assignment's fields (professor
  // only, same course) and seed the create form. Everything but the deadline
  // comes over, including the brief file (reused by reference).
  let copyFrom: AssignmentCopyFrom | null = null;
  if (isProfessor && copyId) {
    const { data: src } = await supabase
      .from("assignments")
      .select("id, title, instructions, points, storage_path, settings")
      .eq("id", copyId)
      .eq("course_id", courseId)
      .maybeSingle();
    if (src) {
      const axes = resolveGradingAxes(src.settings);
      const s = (src.settings ?? {}) as Record<string, unknown>;
      const { data: profTaste } = await supabase
        .from("taste_files")
        .select("body")
        .eq("assignment_id", copyId)
        .is("enrollment_id", null)
        .maybeSingle();
      const briefPath = (src.storage_path as string | null) ?? null;
      copyFrom = {
        fromTitle: src.title,
        title: `${src.title} (copy)`,
        instructions: src.instructions ?? "",
        points: src.points != null ? String(src.points) : "",
        peerReview: axes.peerReview,
        tasteSource: axes.tasteSource,
        tasteRequirement:
          s.tasteRequirement === "required" ||
          s.tasteRequirement === "off" ||
          s.tasteRequirement === "optional"
            ? (s.tasteRequirement as TasteRequirement)
            : "optional",
        gradingCriteria: profTaste?.body ?? "",
        deliverableType:
          s.deliverableType === "pdf" ||
          s.deliverableType === "md" ||
          s.deliverableType === "image"
            ? (s.deliverableType as DeliverableType)
            : "any",
        briefPath,
        briefKind: briefPath ? (briefPath.endsWith(".md") ? "md" : "pdf") : null,
      };
    }
  }

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

      {isProfessor && (
        <AssignmentCreate
          // Re-key on the copy source so the form re-seeds cleanly (including
          // copy → blank after publishing).
          key={`create-${copyId ?? "blank"}`}
          courseId={courseId}
          // Postgres hands back "09:30:00"; the time input wants "09:30".
          classStart={course.meeting_start?.slice(0, 5) ?? null}
          copyFrom={copyFrom}
        />
      )}

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
            const status: SubmissionStatus | null = isProfessor
              ? null
              : submissionStatus({
                  deadline: a.deadline,
                  submittedAt: submittedAtByAssignment.get(a.id),
                  now,
                });
            return (
              <div
                key={a.id}
                data-submission-status={status?.kind}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 transition-colors hover:border-primary",
                  status && STATUS_ROW_CLASS[status.kind]
                )}
              >
                <Link
                  href={`/course/${courseId}/assignments/${a.id}`}
                  className="min-w-0 flex-1"
                >
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Due <LocalTime iso={a.deadline} />
                  </p>
                  {status && <StatusLine status={status} />}
                </Link>
                <div className="flex items-center gap-3">
                  <Badge variant={a.state === "published" ? "default" : "secondary"}>
                    {stateLabel}
                  </Badge>
                  {isProfessor && (
                    <Link
                      href={`/course/${courseId}/assignments?copy=${a.id}`}
                      className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Copy
                    </Link>
                  )}
                  {isProfessor && (
                    <DeleteAssignmentButton assignmentId={a.id} title={a.title} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
