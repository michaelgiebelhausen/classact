import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseRosterCsv } from "@/lib/csv";
import { rateLimit } from "@/lib/ratelimit";

const bodySchema = z.object({
  courseId: z.string().uuid(),
  csv: z.string().min(1).max(3 * 1024 * 1024),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimit(`roster:${user.id}`, { limit: 10, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Course-owner check (RLS would also block, but return a clear 403).
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", parsed.data.courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return NextResponse.json({ error: "Not course owner" }, { status: 403 });
  }

  const { rows, errors } = parseRosterCsv(parsed.data.csv);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found", details: errors },
      { status: 400 }
    );
  }

  // Skip emails already on this course's roster.
  const { data: existing } = await supabase
    .from("enrollments")
    .select("roster_email")
    .eq("course_id", course.id);
  const existingEmails = new Set((existing ?? []).map((e) => e.roster_email));

  const fresh = rows.filter((r) => !existingEmails.has(r.email));
  const dupes = rows.length - fresh.length;

  if (fresh.length > 0) {
    const { error } = await supabase.from("enrollments").insert(
      fresh.map((r) => ({
        course_id: course.id,
        roster_name: r.name,
        roster_email: r.email,
        status: "invited" as const,
      }))
    );
    if (error) {
      return NextResponse.json(
        { error: "Import failed — try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    imported: fresh.length,
    skipped: dupes + errors.length,
    details: errors,
  });
}
