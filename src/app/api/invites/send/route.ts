import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/email";
import { rateLimit } from "@/lib/ratelimit";

const bodySchema = z.object({
  courseId: z.string().uuid(),
  enrollmentIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimit(`invites:${user.id}`, { limit: 5, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, name, join_code, professor_id")
    .eq("id", parsed.data.courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return NextResponse.json({ error: "Not course owner" }, { status: 403 });
  }

  let query = supabase
    .from("enrollments")
    .select("id, roster_name, roster_email")
    .eq("course_id", course.id)
    .eq("status", "invited");
  if (parsed.data.enrollmentIds && parsed.data.enrollmentIds.length > 0) {
    query = query.in("id", parsed.data.enrollmentIds);
  }
  const { data: targets } = await query;

  if (!targets || targets.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (const t of targets) {
    const result = await sendInviteEmail({
      to: t.roster_email,
      studentName: t.roster_name,
      courseName: course.name,
      joinCode: course.join_code,
    });
    if (result.sent) sent++;
    else {
      failed++;
      lastError = result.error;
    }
  }

  return NextResponse.json({ sent, failed, error: lastError });
}
