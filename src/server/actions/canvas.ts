"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_BUCKET } from "@/lib/storage";
import { env, isConfigured } from "@/lib/env";
import type { ActionResult } from "@/server/actions/auth";

interface CanvasUser {
  id: number;
  name: string;
  sortable_name?: string;
  email?: string | null;
  avatar_url?: string | null;
}

export interface CanvasStudent {
  name: string;
  email: string;
  avatarUrl: string | null; // null when Canvas returns a generic default
}

/** Parse the `next` URL from a Canvas Link header for pagination. */
function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
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
async function fetchCanvasRoster(canvasCourseId: string): Promise<{
  students: CanvasStudent[];
  noEmail: number;
  withPhoto: number;
}> {
  const base = env.canvasBaseUrl!.replace(/\/+$/, "");
  let url:
    | string
    | null = `${base}/api/v1/courses/${encodeURIComponent(canvasCourseId)}/users?enrollment_type[]=student&include[]=email&include[]=avatar_url&per_page=100`;

  const students: CanvasStudent[] = [];
  let noEmail = 0;
  let withPhoto = 0;
  let pages = 0;

  while (url && pages < 20) {
    pages++;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.canvasToken}`,
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
    url = nextLink(res.headers.get("link"));
  }

  return { students, noEmail, withPhoto };
}

const inputSchema = z.object({
  courseId: z.string().uuid(),
  canvasCourseId: z
    .string()
    .trim()
    .regex(/^\d+$/, "The Canvas course ID is the number in your course's URL."),
});

/** Sync a ClassAct course's roster from a Canvas course (FR-003 alternative). */
export async function syncCanvasRoster(input: {
  courseId: string;
  canvasCourseId: string;
}): Promise<
  ActionResult<{
    imported: number;
    skipped: number;
    noEmail: number;
    withPhoto: number;
    photosStored: number;
    total: number;
  }>
> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.canvas) {
    return {
      ok: false,
      error:
        "Canvas isn't connected yet. Add CANVAS_BASE_URL and CANVAS_API_TOKEN to .env.local (see HANDOFF.md).",
    };
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

  let roster: {
    students: CanvasStudent[];
    noEmail: number;
    withPhoto: number;
  };
  try {
    roster = await fetchCanvasRoster(parsed.data.canvasCourseId);
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
    .select("roster_email")
    .eq("course_id", course.id);
  const existingEmails = new Set((existing ?? []).map((e) => e.roster_email));
  const fresh = roster.students.filter((s) => !existingEmails.has(s.email));

  if (fresh.length > 0) {
    const { error } = await supabase.from("enrollments").insert(
      fresh.map((s) => ({
        course_id: course.id,
        roster_name: s.name,
        roster_email: s.email,
        status: "invited" as const,
      }))
    );
    if (error) return { ok: false, error: "Import failed — try again." };
  }

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
    },
  };
}
