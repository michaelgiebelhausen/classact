import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import {
  FeedbackForm,
  FeedbackStatusPicker,
} from "@/components/features/feedback/FeedbackForm";
import type { FeedbackRow } from "@/types/db";

/**
 * Feedback: form up top, submissions below. Regular users see their own
 * reports (with status, so nothing feels swallowed); founders see everyone's
 * with triage controls.
 */

interface FeedbackItem extends FeedbackRow {
  submitterName: string | null;
  submitterRole: string | null;
}

const KIND_LABEL: Record<string, string> = {
  bug: "Bug",
  improvement: "Improvement",
  feature: "Feature idea",
};

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

export default async function FeedbackPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const isFounder = Boolean(profile.founder);

  let items: FeedbackItem[] = [];
  if (isFounder && isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const [{ data: rows }, { data: profiles }, { data: courses }] = await Promise.all([
      admin
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      admin.from("profiles").select("id, full_name"),
      admin.from("courses").select("professor_id"),
    ]);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    // Derived from course ownership, not from profiles.role, which since 0035
    // is inert and would label whatever was tapped at sign-up.
    const owners = new Set((courses ?? []).map((c) => c.professor_id));
    items = (rows ?? []).map((r) => ({
      ...r,
      submitterName: byId.get(r.profile_id)?.full_name ?? null,
      submitterRole: owners.has(r.profile_id) ? "professor" : "student",
    }));
  } else {
    const supabase = await createClient();
    const { data: rows } = await supabase
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false });
    items = (rows ?? []).map((r) => ({
      ...r,
      submitterName: null,
      submitterRole: null,
    }));
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
        <p className="text-sm text-muted-foreground">
          Spotted a bug? Wish something worked differently? This is the fast
          lane to the people building ClassAct.
        </p>
      </div>

      <FeedbackForm />

      {items.length > 0 && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {isFounder ? "All reports" : "Your reports"}
            </h2>
            {isFounder && (
              <Link
                href="/developer"
                className="text-sm text-muted-foreground underline"
              >
                Open the developer queue →
              </Link>
            )}
          </div>
          {items.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {isFounder && item.submitterName
                      ? ` · ${item.submitterName}${
                          item.submitterRole ? ` (${item.submitterRole})` : ""
                        }`
                      : ""}
                  </span>
                </div>
                {isFounder && (
                  <FeedbackStatusPicker id={item.id} status={item.status} />
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{item.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
