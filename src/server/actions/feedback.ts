"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { sendFeedbackNotification } from "@/lib/email";
import type { FeedbackKind, FeedbackStatus } from "@/types/db";
import type { ActionResult } from "@/server/actions/auth";

/**
 * In-app feedback: any signed-in user files bugs/improvements/features;
 * founders triage. Insert rides the user's own RLS; the founder email
 * notification is best-effort and never blocks the save.
 */

const KINDS: FeedbackKind[] = ["bug", "improvement", "feature"];
const STATUSES: FeedbackStatus[] = ["new", "planned", "done", "closed"];

export async function submitFeedback(input: {
  kind: string;
  body: string;
  pagePath?: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const kind = KINDS.find((k) => k === input.kind);
  if (!kind) return { ok: false, error: "Pick bug, improvement, or feature." };
  const body = input.body.trim();
  if (body.length < 4) {
    return { ok: false, error: "Say a little more — even one sentence helps." };
  }
  if (body.length > 5000) {
    return { ok: false, error: "Keep it under 5,000 characters." };
  }
  const pagePath = (input.pagePath ?? "").trim().slice(0, 200) || null;

  const { error } = await supabase.from("feedback").insert({
    profile_id: user.id,
    kind,
    body,
    page_path: pagePath,
  });
  if (error) return { ok: false, error: "Couldn't save your feedback — try again." };

  // Best-effort founder notification — the row is already stored.
  if (isConfigured.supabaseAdmin) {
    try {
      const admin = createAdminClient();
      const [{ data: me }, { data: founders }] = await Promise.all([
        admin.from("profiles").select("full_name").eq("id", user.id).single(),
        admin.from("profiles").select("id").eq("founder", true),
      ]);
      const emails: string[] = [];
      for (const f of founders ?? []) {
        const { data } = await admin.auth.admin.getUserById(f.id);
        if (data.user?.email) emails.push(data.user.email);
      }
      await sendFeedbackNotification({
        to: emails,
        kind,
        body,
        submitterName: me?.full_name?.trim() || "A ClassAct user",
      });
    } catch {
      // Courtesy only.
    }
  }

  revalidatePath("/feedback");
  return { ok: true };
}

/** Founder-only triage: move a report through new → planned → done/closed. */
export async function setFeedbackStatus(
  id: string,
  status: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("founder")
    .eq("id", user.id)
    .single();
  if (!profile?.founder || !isConfigured.supabaseAdmin) {
    return { ok: false, error: "Only the ClassAct team can triage feedback." };
  }
  const next = STATUSES.find((s) => s === status);
  if (!next) return { ok: false, error: "Invalid status." };
  const admin = createAdminClient();
  const { error } = await admin.from("feedback").update({ status: next }).eq("id", id);
  if (error) return { ok: false, error: "Couldn't update the status." };
  revalidatePath("/feedback");
  return { ok: true };
}
