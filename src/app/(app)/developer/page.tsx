import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { FeedbackStatusPicker } from "@/components/features/feedback/FeedbackForm";
import type { FeedbackRow, FeedbackStatus } from "@/types/db";

/**
 * The developer queue: every report from every user across every class, in
 * work order — new first, closed last. Founder-only; everyone else is sent
 * to /feedback, where they file reports and see their own. Reports carry the
 * page they were filed from, so bugs resolve to the class they happened in.
 */

const KIND_LABEL: Record<string, string> = {
  bug: "Bug",
  improvement: "Improvement",
  feature: "Feature idea",
};

const STATUS_ORDER: FeedbackStatus[] = ["new", "planned", "done", "closed"];

const STATUS_HEADING: Record<FeedbackStatus, string> = {
  new: "New — untriaged",
  planned: "Planned",
  done: "Done",
  closed: "Closed",
};

interface DeveloperItem extends FeedbackRow {
  submitterName: string | null;
  submitterRole: string | null;
  courseName: string | null;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "new" ? "default" : status === "planned" ? "secondary" : "outline"
      }
      className="capitalize"
    >
      {status}
    </Badge>
  );
}

/** "/course/<uuid>/checkin" → the course uuid; null for non-course pages. */
function courseIdFromPath(path: string | null): string | null {
  const m = path?.match(/^\/course\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

export default async function DeveloperPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.founder || !isConfigured.supabaseAdmin) redirect("/feedback");

  const admin = createAdminClient();
  const [{ data: rows }, { data: profiles }, { data: courses }] =
    await Promise.all([
      admin
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      admin.from("profiles").select("id, full_name"),
      admin.from("courses").select("id, name, professor_id"),
    ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const courseById = new Map((courses ?? []).map((c) => [c.id, c.name]));
  // "Professor" is derived — whoever owns a course is one. This used to read
  // profiles.role, which since 0035 is inert and would label whatever a
  // student happened to tap at sign-up.
  const owners = new Set((courses ?? []).map((c) => c.professor_id));
  const items: DeveloperItem[] = (rows ?? []).map((r) => {
    const courseId = courseIdFromPath(r.page_path);
    return {
      ...r,
      submitterName: profileById.get(r.profile_id)?.full_name ?? null,
      submitterRole: owners.has(r.profile_id) ? "professor" : "student",
      courseName: courseId ? (courseById.get(courseId) ?? null) : null,
    };
  });

  const byStatus = new Map<FeedbackStatus, DeveloperItem[]>(
    STATUS_ORDER.map((s) => [s, items.filter((i) => i.status === s)])
  );
  const kindCount = (kind: string) =>
    items.filter((i) => i.kind === kind).length;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Developer</h1>
        <p className="text-sm text-muted-foreground">
          Every report from every user, across all classes. Users see status
          changes on their own <Link href="/feedback" className="underline">/feedback</Link>{" "}
          view, so triaging here closes the loop with whoever filed it.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="rounded-lg border px-4 py-2">
            <p className="text-xl font-semibold">{byStatus.get(s)?.length ?? 0}</p>
            <p className="text-xs capitalize text-muted-foreground">{s}</p>
          </div>
        ))}
        <div className="rounded-lg border border-dashed px-4 py-2">
          <p className="text-xl font-semibold">
            {kindCount("bug")}/{kindCount("improvement")}/{kindCount("feature")}
          </p>
          <p className="text-xs text-muted-foreground">bugs / improvements / ideas</p>
        </div>
      </div>

      {items.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No reports yet. When users file feedback, it lands here.
        </p>
      )}

      {STATUS_ORDER.map((status) => {
        const group = byStatus.get(status) ?? [];
        if (group.length === 0) return null;
        return (
          <div key={status} className="grid gap-3">
            <h2 className="text-lg font-semibold">{STATUS_HEADING[status]}</h2>
            {group.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {KIND_LABEL[item.kind] ?? item.kind}
                    </Badge>
                    <StatusBadge status={item.status} />
                    {item.courseName && (
                      <Badge variant="secondary">{item.courseName}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {item.submitterName
                        ? ` · ${item.submitterName}${
                            item.submitterRole ? ` (${item.submitterRole})` : ""
                          }`
                        : ""}
                      {item.page_path ? ` · ${item.page_path}` : ""}
                    </span>
                  </div>
                  <FeedbackStatusPicker id={item.id} status={item.status} />
                </div>
                <p className="whitespace-pre-wrap text-sm">{item.body}</p>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
