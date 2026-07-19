import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoutOutForm } from "@/components/features/shoutouts/ShoutOutForm";

/**
 * Shout-outs: give one, see the ones you've received. Private to the
 * recipient; the professor sees the whole feed (a read on class culture).
 * Peer-review shout-outs display without a giver — the work was anonymous
 * when it was praised.
 */

const CONTEXT_LABELS: Record<string, string> = {
  general: "Just because",
  exercise: "Group exercise",
  project: "Project work",
  peer_review: "Peer grading — someone admired your work",
};

export default async function ShoutOutsPage({
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

  // Roster names via admin (same directory pattern as check-in).
  const names = new Map<string, string>();
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("id, roster_name")
      .eq("course_id", courseId)
      .eq("status", "active");
    for (const e of enrollments ?? []) names.set(e.id, e.roster_name);
  }

  if (isProfessor) {
    const { data: all } = await supabase
      .from("shout_outs")
      .select(
        "giver_enrollment_id, recipient_enrollment_id, context, message, created_at"
      )
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(100);
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shout-outs</h1>
          <p className="text-sm text-muted-foreground">
            {course.name} — who&apos;s lifting whom. Students see only their own.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {(all ?? []).length} shout-out(s)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(all ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                None yet — they start flowing once students hit group work
                and peer grading.
              </p>
            )}
            {(all ?? []).map((s, i) => (
              <div key={i} className="rounded-lg border p-3 text-sm">
                <p>
                  <span className="font-medium">
                    {names.get(s.giver_enrollment_id) ?? "A student"}
                  </span>{" "}
                  →{" "}
                  <span className="font-medium">
                    {names.get(s.recipient_enrollment_id) ?? "a classmate"}
                  </span>{" "}
                  <Badge variant="outline">
                    {CONTEXT_LABELS[s.context] ?? s.context}
                  </Badge>
                </p>
                {s.message && (
                  <p className="mt-1 text-muted-foreground">{s.message}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Student view.
  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  if (!myEnrollment) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Shout-outs</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            You&apos;re not on this course&apos;s active roster.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [{ data: received }, { data: given }] = await Promise.all([
    supabase
      .from("shout_outs")
      .select("giver_enrollment_id, context, message, created_at")
      .eq("course_id", courseId)
      .eq("recipient_enrollment_id", myEnrollment.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("shout_outs")
      .select("recipient_enrollment_id, context, message, created_at")
      .eq("course_id", courseId)
      .eq("giver_enrollment_id", myEnrollment.id)
      .order("created_at", { ascending: false }),
  ]);

  const classmates = [...names.entries()]
    .filter(([id]) => id !== myEnrollment.id)
    .map(([enrollmentId, name]) => ({ enrollmentId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shout-outs</h1>
        <p className="text-sm text-muted-foreground">
          {course.name} — call out good work; collect the credit for spotting it.
        </p>
      </div>

      <ShoutOutForm courseId={courseId} classmates={classmates} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            You&apos;ve received {(received ?? []).length}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(received ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing yet — do work worth noticing and this fills itself.
            </p>
          )}
          {(received ?? []).map((s, i) => (
            <div key={i} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {s.context === "peer_review"
                  ? "Someone admired your work in peer grading"
                  : `${names.get(s.giver_enrollment_id) ?? "A classmate"} shouted you out`}{" "}
                <Badge variant="outline">
                  {CONTEXT_LABELS[s.context] ?? s.context}
                </Badge>
              </p>
              {s.message && (
                <p className="mt-1 text-muted-foreground">{s.message}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            You&apos;ve given {(given ?? []).length}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(given ?? []).map((s, i) => (
            <div key={i} className="rounded-lg border p-3 text-sm">
              <p>
                To{" "}
                <span className="font-medium">
                  {names.get(s.recipient_enrollment_id) ?? "a classmate"}
                </span>{" "}
                <Badge variant="outline">
                  {CONTEXT_LABELS[s.context] ?? s.context}
                </Badge>
              </p>
              {s.message && (
                <p className="mt-1 text-muted-foreground">{s.message}</p>
              )}
            </div>
          ))}
          {(given ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Generosity is a statistic here — give one above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
