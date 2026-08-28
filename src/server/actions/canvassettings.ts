"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured, missingVaultEnv } from "@/lib/env";
import { encryptSecret } from "@/lib/aicrypto";
import { normalizeCanvasBaseUrl } from "@/lib/canvasurl";
import {
  fetchCourseSections,
  fetchTeacherCourses,
  resolveCanvasCreds,
  validateCanvasToken,
  type CanvasSection,
  type CanvasTeacherCourse,
} from "@/server/canvascreds";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Canvas connection settings — each professor connects their own Canvas
 * access token (the env token only saw the founder's courses). Tokens are
 * validated live, encrypted at rest, and only their last 4 characters ever
 * return to a client.
 */

/**
 * Gated on owning a course, not on an account flag.
 *
 * A Canvas token here syncs the rosters of courses you run, so having a
 * course to run is the thing that matters — and it's a fact about the roster, not a word
 * somebody picked at sign-up. Read through RLS: `courses` is scoped to
 * `professor_id = auth.uid()`, so this counts only their own.
 */
async function requireProfessor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null };
  const { count, error } = await supabase
    .from("courses")
    .select("id", { count: "exact", head: true })
    .eq("professor_id", user.id);
  if (error || !count) return { user: null };
  return { user };
}

export interface CanvasConnectionView {
  connected: boolean;
  /** "professor" = own vaulted token; "env" = server fallback (founder). */
  source: "professor" | "env" | null;
  baseUrl: string;
  tokenLast4: string;
  connectedName: string | null;
}

/** Current connection state for the signed-in professor (never the token). */
export async function getCanvasConnection(): Promise<CanvasConnectionView> {
  const empty: CanvasConnectionView = {
    connected: false,
    source: null,
    baseUrl: "",
    tokenLast4: "",
    connectedName: null,
  };
  const { user } = await requireProfessor();
  if (!user) return empty;
  if (isConfigured.supabaseAdmin && isConfigured.keyVault) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("professor_canvas")
      .select("base_url, token_last4, connected_name")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (data) {
      return {
        connected: true,
        source: "professor",
        baseUrl: data.base_url,
        tokenLast4: data.token_last4,
        connectedName: data.connected_name,
      };
    }
  }
  if (isConfigured.canvas) {
    const creds = await resolveCanvasCreds(user.id);
    if (creds?.source === "env") {
      return {
        connected: true,
        source: "env",
        baseUrl: creds.baseUrl,
        tokenLast4: "",
        connectedName: null,
      };
    }
  }
  return empty;
}

/** Connect (or replace) a Canvas token. Validates against Canvas first. */
export async function saveCanvasConnection(input: {
  baseUrl: string;
  token: string;
}): Promise<ActionResult<{ name: string }>> {
  const { user } = await requireProfessor();
  if (!user) return { ok: false, error: "Professors only." };
  const missingVault = missingVaultEnv();
  if (missingVault.length > 0) {
    console.error("[saveCanvasConnection] vault not configured:", missingVault);
    return {
      ok: false,
      error: `This server can't store secrets yet — missing ${missingVault.join(
        " and "
      )}. Add it in the hosting environment settings and redeploy.`,
    };
  }
  const baseUrl = normalizeCanvasBaseUrl(input.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      error:
        'That web address doesn\'t look right — it\'s usually "yourschool.instructure.com".',
    };
  }
  const token = input.token.trim();
  if (token.length < 10 || /\s/.test(token)) {
    return { ok: false, error: "That doesn't look like a Canvas access token." };
  }
  const check = await validateCanvasToken(baseUrl, token);
  if (!check.ok) return { ok: false, error: check.error };

  const admin = createAdminClient();
  const { error } = await admin.from("professor_canvas").upsert(
    {
      profile_id: user.id,
      base_url: baseUrl,
      token_ciphertext: encryptSecret(token),
      token_last4: token.slice(-4),
      connected_name: check.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" }
  );
  if (error) return { ok: false, error: "Couldn't save the connection — try again." };
  return { ok: true, data: { name: check.name } };
}

/** Remove the stored Canvas token. */
export async function disconnectCanvas(): Promise<ActionResult> {
  const { user } = await requireProfessor();
  if (!user || !isConfigured.supabaseAdmin) {
    return { ok: false, error: "Professors only." };
  }
  const admin = createAdminClient();
  await admin.from("professor_canvas").delete().eq("profile_id", user.id);
  return { ok: true };
}

/**
 * Sections of one Canvas course. More than one usually means a cross-listed
 * shell (several meeting times merged in Canvas) — the sync UI offers a
 * section picker so each ClassAct course gets the students who actually
 * meet together.
 */
export async function listCanvasSections(
  canvasCourseId: string
): Promise<ActionResult<{ sections: CanvasSection[] }>> {
  const { user } = await requireProfessor();
  if (!user) return { ok: false, error: "Professors only." };
  const id = canvasCourseId.trim();
  if (!/^\d+$/.test(id)) {
    return { ok: false, error: "That doesn't look like a Canvas course ID." };
  }
  const creds = await resolveCanvasCreds(user.id);
  if (!creds) {
    return { ok: false, error: "Connect your Canvas account first." };
  }
  try {
    const sections = await fetchCourseSections(creds, id);
    return { ok: true, data: { sections } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't list that course's sections.",
    };
  }
}

/** Courses the professor teaches, for the pick-a-course sync list. */
export async function listCanvasCourses(): Promise<
  ActionResult<{ courses: CanvasTeacherCourse[] }>
> {
  const { user } = await requireProfessor();
  if (!user) return { ok: false, error: "Professors only." };
  const creds = await resolveCanvasCreds(user.id);
  if (!creds) {
    return { ok: false, error: "Connect your Canvas account first." };
  }
  try {
    const courses = await fetchTeacherCourses(creds);
    return { ok: true, data: { courses } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't list your Canvas courses.",
    };
  }
}
