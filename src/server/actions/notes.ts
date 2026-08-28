"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/ratelimit";
import { sendNotesExport } from "@/lib/email";
import {
  buildNotesMarkdown,
  notesFilename,
  type ExportLecture,
} from "@/lib/notesmd";
import type { ActionResult } from "@/server/actions/auth";

/**
 * A single thought, not a semester. Generous for a paragraph typed in class,
 * small enough that a runaway paste is caught here rather than in the export.
 */
const MAX_ENTRY_CHARS = 10_000;

/** Resolve the caller's active enrollment in a course, or fail. */
async function requireEnrollment(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      supabase,
      error: "Sign in first." as string,
      enrollmentId: null,
      userId: null,
    };
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return {
      supabase,
      error: "You're not on this course's active roster." as string,
      enrollmentId: null,
      userId: null,
    };
  }
  return {
    supabase,
    error: null,
    enrollmentId: enrollment.id,
    userId: user.id,
  };
}

export interface SavedEntry {
  id: string;
  page: number | null;
  content: string;
  createdAt: string;
}

/**
 * Student: add one note, stamped with the slide they were looking at.
 *
 * The page comes from the client because only the client knows which slide was
 * on screen when they started typing — the professor may well have moved on by
 * the time this arrives, and the note belongs to the slide that prompted it.
 * It is bounded, not trusted: a nonsense page number is stored as unstamped
 * rather than rejected, because losing a student's sentence over a bad integer
 * is the worse failure.
 */
export async function addNoteEntry(
  courseId: string,
  lectureId: string,
  page: number | null,
  content: string
): Promise<ActionResult<SavedEntry>> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const text = content.trim();
  if (!text) return { ok: false, error: "There's nothing to save yet." };
  if (text.length > MAX_ENTRY_CHARS) {
    return {
      ok: false,
      error: `That note is too long — keep it under ${MAX_ENTRY_CHARS.toLocaleString()} characters.`,
    };
  }

  const stampedPage =
    typeof page === "number" && Number.isInteger(page) && page >= 1
      ? page
      : null;

  const { data, error: insertError } = await supabase
    .from("lecture_note_entries")
    .insert({
      lecture_id: lectureId,
      enrollment_id: enrollmentId,
      page: stampedPage,
      content: text,
    })
    .select("id, page, content, created_at")
    .single();

  if (insertError || !data)
    return { ok: false, error: "Couldn't save that note." };

  return {
    ok: true,
    data: {
      id: data.id,
      page: data.page,
      content: data.content,
      createdAt: data.created_at,
    },
  };
}

/** Student: reword a note they already saved. */
export async function updateNoteEntry(
  courseId: string,
  entryId: string,
  content: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const text = content.trim();
  if (!text) return { ok: false, error: "A note can't be empty." };
  if (text.length > MAX_ENTRY_CHARS) {
    return {
      ok: false,
      error: `That note is too long — keep it under ${MAX_ENTRY_CHARS.toLocaleString()} characters.`,
    };
  }

  // RLS already scopes this to the author; the enrollment filter says so out
  // loud, and means a wrong id fails as "not found" rather than silently.
  const { error: updateError } = await supabase
    .from("lecture_note_entries")
    .update({ content: text, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("enrollment_id", enrollmentId);

  if (updateError) return { ok: false, error: "Couldn't save that change." };
  revalidatePath(`/course/${courseId}/notes`);
  return { ok: true };
}

/** Student: delete one of their notes. */
export async function deleteNoteEntry(
  courseId: string,
  entryId: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const { error: deleteError } = await supabase
    .from("lecture_note_entries")
    .delete()
    .eq("id", entryId)
    .eq("enrollment_id", enrollmentId);

  if (deleteError) return { ok: false, error: "Couldn't delete that note." };
  revalidatePath(`/course/${courseId}/notes`);
  return { ok: true };
}

/**
 * Read a student's notes back out of the database, grouped for export.
 *
 * Deliberately re-read here rather than accepting Markdown from the browser:
 * the client is telling us *which* notes to send, never what they say.
 */
async function collectForExport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
  enrollmentId: string,
  lectureId?: string
): Promise<{ courseName: string; lectures: ExportLecture[] } | null> {
  const { data: course } = await supabase
    .from("courses")
    .select("name")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;

  let entryQuery = supabase
    .from("lecture_note_entries")
    .select("lecture_id, page, content, created_at")
    .eq("enrollment_id", enrollmentId)
    .order("created_at", { ascending: true });
  if (lectureId) entryQuery = entryQuery.eq("lecture_id", lectureId);
  const { data: entries } = await entryQuery;

  const { data: lectures } = await supabase
    .from("lectures")
    .select("id, deck_id, started_at")
    .eq("course_id", courseId);

  const { data: decks } = await supabase
    .from("lecture_decks")
    .select("id, title")
    .eq("course_id", courseId);
  const deckTitleById = new Map((decks ?? []).map((d) => [d.id, d.title]));

  const lectureById = new Map(
    (lectures ?? []).map((l) => [
      l.id,
      {
        startedAt: l.started_at,
        deckTitle: deckTitleById.get(l.deck_id) ?? "",
      },
    ])
  );

  const grouped = new Map<string, ExportLecture>();
  for (const entry of entries ?? []) {
    const meta = lectureById.get(entry.lecture_id);
    if (!meta) continue;
    const bucket = grouped.get(entry.lecture_id) ?? {
      startedAt: meta.startedAt,
      deckTitle: meta.deckTitle,
      entries: [],
    };
    bucket.entries.push({
      page: entry.page,
      content: entry.content,
      createdAt: entry.created_at,
    });
    grouped.set(entry.lecture_id, bucket);
  }

  return { courseName: course.name, lectures: [...grouped.values()] };
}

const emailSchema = z.string().trim().email();

/**
 * Student: email their own notes wherever they keep things.
 *
 * The recipient is free-form on purpose — the point is that notes can leave
 * for a personal address, or an agent's inbox, or whatever a Second Brain
 * reads. It is the student's own writing going where they say, so the limit is
 * volume rather than destination.
 */
export async function emailNotesExport(input: {
  courseId: string;
  lectureId?: string;
  to: string;
  timeZone?: string;
}): Promise<ActionResult> {
  const { supabase, error, enrollmentId, userId } = await requireEnrollment(
    input.courseId
  );
  if (error || !enrollmentId || !userId)
    return { ok: false, error: error ?? "No enrollment." };

  const parsed = emailSchema.safeParse(input.to);
  if (!parsed.success)
    return { ok: false, error: "That doesn't look like an email address." };

  const { allowed } = rateLimit(`notes-email:${userId}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!allowed) {
    return {
      ok: false,
      error: "That's plenty of emails for now — try again in an hour.",
    };
  }

  const collected = await collectForExport(
    supabase,
    input.courseId,
    enrollmentId,
    input.lectureId
  );
  if (!collected) return { ok: false, error: "Couldn't find that course." };
  if (collected.lectures.length === 0)
    return { ok: false, error: "There are no notes to send yet." };

  const markdown = buildNotesMarkdown({
    courseName: collected.courseName,
    exportedAt: new Date().toISOString(),
    timeZone: input.timeZone,
    lectures: collected.lectures,
  });

  const dateSlug = input.lectureId
    ? collected.lectures[0]?.startedAt.slice(0, 10)
    : undefined;

  const result = await sendNotesExport({
    to: parsed.data,
    courseName: collected.courseName,
    filename: notesFilename(collected.courseName, dateSlug),
    markdown,
  });

  if (!result.sent)
    return { ok: false, error: result.error ?? "Couldn't send that email." };
  return { ok: true };
}
