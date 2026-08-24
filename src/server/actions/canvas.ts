"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_BUCKET } from "@/lib/storage";
import { isConfigured } from "@/lib/env";
import { resolveCanvasCreds, type CanvasCreds } from "@/server/canvascreds";
import { phoneticsForNames } from "@/server/phonetics";
import type { ActionResult } from "@/server/actions/auth";
import { invalidateCourseDirectory } from "@/lib/coursedirectory";

interface CanvasUser {
  id: number;
  name: string;
  sortable_name?: string;
  email?: string | null;
  avatar_url?: string | null;
  /** Present when the roster fetch asks for include[]=enrollments. */
  enrollments?: Array<{ course_section_id?: number | null }> | null;
}

export interface CanvasStudent {
  name: string;
  email: string;
  avatarUrl: string | null; // null when Canvas returns a generic default
}

/**
 * Parse the `next` URL from a Canvas Link header for pagination. Only a URL
 * on the same origin as `base` is followed — Canvas's own pagination always
 * is, and refusing anything else stops a hostile Canvas host from steering
 * our token-bearing server fetch at an internal address (SSRF).
 */
function nextLink(header: string | null, base: string): string | null {
  if (!header) return null;
  let baseOrigin: string;
  try {
    baseOrigin = new URL(base).origin;
  } catch {
    return null;
  }
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (!m) continue;
    try {
      if (new URL(m[1]).origin === baseOrigin) return m[1];
    } catch {
      // ignore an unparseable Link target
    }
    return null;
  }
  return null;
}

/** Heuristic: a real uploaded/ID photo, not Canvas's generic gray default. */
function isRealAvatar(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes("avatar-50") || u.includes("/messages/avatar")) return false;
  if (
    u.includes("gravatar.com") &&
    /[?&]d=(identicon|mp|mm|retro|robohash|wavatar|blank)/.test(u)
  )
    return false;
  return true;
}

/** Download an image URL to bytes, with a timeout and size/type guards. */
async function downloadImage(
  url: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const data = await res.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > 8 * 1024 * 1024) return null;
    return { data, contentType };
  } catch {
    return null;
  }
}

/**
 * Fetch a Canvas course's roster (name + email + avatar) via the server-side
 * token. Follows pagination. `withPhoto` counts students whose Canvas avatar
 * looks like a real photo rather than the generic default.
 */
async function fetchCanvasRoster(
  canvasCourseId: string,
  creds: CanvasCreds,
  sectionIds?: string[]
): Promise<{
  students: CanvasStudent[];
  noEmail: number;
  withPhoto: number;
}> {
  const base = creds.baseUrl.replace(/\/+$/, "");
  // Cross-listed shells: keep only students in the chosen sections. We scope
  // the request server-side with section_ids[] (so a small section pulled
  // from a huge merged shell only pages its own students, well under the cap)
  // AND filter by enrollment client-side, so we stay correct even if a Canvas
  // instance ignores the param.
  const wanted =
    sectionIds && sectionIds.length > 0 ? new Set(sectionIds) : null;
  const sectionParam = wanted
    ? [...wanted]
        .map((id) => `&section_ids[]=${encodeURIComponent(id)}`)
        .join("")
    : "";
  let url:
    | string
    | null = `${base}/api/v1/courses/${encodeURIComponent(canvasCourseId)}/users?enrollment_type[]=student&include[]=email&include[]=avatar_url&include[]=enrollments&per_page=100${sectionParam}`;

  const students: CanvasStudent[] = [];
  let noEmail = 0;
  let withPhoto = 0;
  let pages = 0;
  const MAX_PAGES = 40;

  while (url && pages < MAX_PAGES) {
    pages++;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Canvas rejected the token (check it hasn't expired or lacks course access).");
    }
    if (res.status === 404) {
      throw new Error("Canvas course not found — double-check the course ID.");
    }
    if (!res.ok) {
      throw new Error(`Canvas returned ${res.status}.`);
    }
    const batch = (await res.json()) as CanvasUser[];
    for (const u of batch) {
      if (
        wanted &&
        !(u.enrollments ?? []).some(
          (e) =>
            e.course_section_id != null && wanted.has(String(e.course_section_id))
        )
      ) {
        continue; // enrolled in a section the professor didn't pick
      }
      const email = (u.email ?? "").trim().toLowerCase();
      if (!email) {
        noEmail++;
        continue;
      }
      const real = isRealAvatar(u.avatar_url);
      if (real) withPhoto++;
      students.push({
        name: u.name?.trim() || email,
        email,
        avatarUrl: real ? (u.avatar_url as string) : null,
      });
    }
    url = nextLink(res.headers.get("link"), base);
  }

  // Loudly refuse to report a partial roster as a success. With section
  // scoping this only trips on a genuinely enormous single import.
  if (url) {
    throw new Error(
      "This Canvas course has more students than we can import at once. Sync one section at a time, or import a CSV."
    );
  }

  return { students, noEmail, withPhoto };
}

const inputSchema = z.object({
  courseId: z.string().uuid(),
  canvasCourseId: z
    .string()
    .trim()
    .regex(/^\d+$/, "The Canvas course ID is the number in your course's URL."),
  /** Canvas section ids to import; empty/absent = the whole course. */
  sectionIds: z.array(z.string().regex(/^\d+$/)).max(50).optional(),
});

/** A roster row that's here but no longer in Canvas — a likely drop. */
export interface DropCandidate {
  enrollmentId: string;
  name: string;
  email: string;
}

/**
 * Sync a ClassAct course's roster from a Canvas course (FR-003 alternative).
 * Idempotent, so it doubles as add/drop-season resync: new Canvas students
 * are imported, previously-dropped students who re-added are reactivated,
 * and roster rows missing from Canvas come back as `dropCandidates` — never
 * dropped automatically (a token hiccup or section change must not silently
 * bench real students). The professor confirms via `markDropped`.
 */
export async function syncCanvasRoster(input: {
  courseId: string;
  canvasCourseId: string;
  /** Canvas section ids to import; empty/absent = the whole course. */
  sectionIds?: string[];
}): Promise<
  ActionResult<{
    imported: number;
    skipped: number;
    noEmail: number;
    withPhoto: number;
    photosStored: number;
    total: number;
    reactivated: number;
    dropCandidates: DropCandidate[];
  }>
> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Ownership check (RLS also enforces).
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", parsed.data.courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can sync the roster." };
  }

  // The professor's own vaulted Canvas token (env pair = founder fallback).
  const creds = await resolveCanvasCreds(user.id);
  if (!creds) {
    return {
      ok: false,
      error: "Connect your Canvas account first — the Connect Canvas card above walks you through it.",
    };
  }

  let roster: {
    students: CanvasStudent[];
    noEmail: number;
    withPhoto: number;
  };
  try {
    roster = await fetchCanvasRoster(
      parsed.data.canvasCourseId,
      creds,
      parsed.data.sectionIds
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Canvas sync failed." };
  }

  if (roster.students.length === 0) {
    return {
      ok: false,
      error:
        roster.noEmail > 0
          ? "Found students, but Canvas didn't share their emails for this token. Use CSV export instead."
          : "No students found in that Canvas course.",
    };
  }

  // Import new roster rows (dupes skipped, same rule as CSV import).
  const { data: existing } = await supabase
    .from("enrollments")
    .select("id, roster_name, roster_email, status, profile_id")
    .eq("course_id", course.id);
  const existingEmails = new Set((existing ?? []).map((e) => e.roster_email));
  const canvasEmails = new Set(roster.students.map((s) => s.email));
  const fresh = roster.students.filter((s) => !existingEmails.has(s.email));

  if (fresh.length > 0) {
    // Best-effort AI pronunciation defaults (never blocks the sync).
    const phonetics = await phoneticsForNames(fresh.map((s) => s.name));
    const { error } = await supabase.from("enrollments").insert(
      fresh.map((s) => ({
        course_id: course.id,
        roster_name: s.name,
        roster_email: s.email,
        status: "invited" as const,
        roster_name_phonetic: phonetics.get(s.name.trim()) ?? null,
      }))
    );
    if (error) return { ok: false, error: "Import failed — try again." };
    invalidateCourseDirectory(course.id);
  }

  // A dropped student who's back in Canvas re-added the class: reactivate
  // with history intact. Straight to 'active' if they'd already linked an
  // account; otherwise back to 'invited' like any roster row.
  const returning = (existing ?? []).filter(
    (e) => e.status === "dropped" && canvasEmails.has(e.roster_email)
  );
  for (const e of returning) {
    await supabase
      .from("enrollments")
      .update({
        status: e.profile_id ? ("active" as const) : ("invited" as const),
        dropped_at: null,
      })
      .eq("id", e.id);
  }

  // Roster rows Canvas no longer lists — surfaced for the professor to
  // confirm, never dropped here. CSV-only additions and students in
  // unsynced sections show up too, which is exactly why it's a preview.
  const dropCandidates: DropCandidate[] = (existing ?? [])
    .filter((e) => e.status !== "dropped" && !canvasEmails.has(e.roster_email))
    .map((e) => ({ enrollmentId: e.id, name: e.roster_name, email: e.roster_email }));

  // Remember the linkage so the next resync is one click.
  await supabase
    .from("courses")
    .update({
      canvas_course_id: parsed.data.canvasCourseId,
      canvas_section_ids: parsed.data.sectionIds ?? null,
      canvas_synced_at: new Date().toISOString(),
    })
    .eq("id", course.id);

  // Port Canvas photos: for every synced student who has a Canvas photo but no
  // stored roster photo yet, download it and stash it in Supabase storage.
  let photosStored = 0;
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: allEnroll } = await admin
      .from("enrollments")
      .select("id, roster_email, roster_photo_path")
      .eq("course_id", course.id);
    const byEmail = new Map((allEnroll ?? []).map((e) => [e.roster_email, e]));

    const toFetch = roster.students
      .map((s) => ({ student: s, enrollment: byEmail.get(s.email) }))
      .filter(
        (x) => x.student.avatarUrl && x.enrollment && !x.enrollment.roster_photo_path
      );

    const CONCURRENCY = 6;
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const chunk = toFetch.slice(i, i + CONCURRENCY);
      const stored = await Promise.all(
        chunk.map(async ({ student, enrollment }) => {
          const img = await downloadImage(student.avatarUrl!);
          if (!img || !enrollment) return null;
          const path = `${course.id}/roster/${enrollment.id}`;
          const up = await admin.storage
            .from(PHOTO_BUCKET)
            .upload(path, img.data, {
              contentType: img.contentType,
              upsert: true,
            });
          return up.error ? null : { id: enrollment.id, path };
        })
      );
      for (const r of stored) {
        if (!r) continue;
        await admin
          .from("enrollments")
          .update({ roster_photo_path: r.path })
          .eq("id", r.id);
        photosStored++;
      }
    }
  }

  revalidatePath(`/course/${course.id}/setup`);
  return {
    ok: true,
    data: {
      imported: fresh.length,
      skipped: roster.students.length - fresh.length,
      noEmail: roster.noEmail,
      withPhoto: roster.withPhoto,
      photosStored,
      total: roster.students.length,
      reactivated: returning.length,
      dropCandidates,
    },
  };
}

const markDroppedSchema = z.object({
  courseId: z.string().uuid(),
  enrollmentIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Confirm drops surfaced by a resync: mark the enrollments 'dropped'. A
 * status change, never a delete — attendance, participation, and seat
 * history survive, and check-in/seat-map/games queries already filter to
 * status = 'active', so dropped students simply stop appearing. Rejoining
 * (via Canvas re-add + resync, or the course join code) reactivates them.
 */
export async function markDropped(input: {
  courseId: string;
  enrollmentIds: string[];
}): Promise<ActionResult<{ dropped: number }>> {
  const parsed = markDroppedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid drop request." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Ownership check (RLS also enforces).
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", parsed.data.courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can update the roster." };
  }

  const { data: updated, error } = await supabase
    .from("enrollments")
    .update({ status: "dropped", dropped_at: new Date().toISOString() })
    .eq("course_id", course.id)
    .in("id", parsed.data.enrollmentIds)
    .neq("status", "dropped")
    .select("id");
  if (error) {
    return { ok: false, error: "Couldn't update the roster — try again." };
  }

  revalidatePath(`/course/${course.id}/setup`);
  return { ok: true, data: { dropped: (updated ?? []).length } };
}
