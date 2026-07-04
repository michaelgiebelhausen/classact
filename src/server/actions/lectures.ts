"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DECK_BUCKET } from "@/lib/storage";
import type { ActionResult } from "@/server/actions/auth";

const MAX_NOTE_CHARS = 100_000;

/** Only published Google Slides embed links are accepted. */
function isGoogleSlidesUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "docs.google.com" &&
      u.pathname.startsWith("/presentation/")
    );
  } catch {
    return false;
  }
}

/** Resolve the caller's professor-ship of a course, or fail. */
async function requireProfessor(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "Sign in first." as string, user: null };
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return {
      supabase,
      error: "Only the course owner can do that." as string,
      user: null,
    };
  }
  return { supabase, error: null, user };
}

/** Resolve the caller's active enrollment in a course, or fail. */
async function requireEnrollment(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { supabase, error: "Sign in first." as string, enrollmentId: null };
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
    };
  }
  return { supabase, error: null, enrollmentId: enrollment.id };
}

/**
 * Professor: register a deck. For PDFs the browser has already uploaded the
 * file to `{courseId}/{uuid}.pdf` in the lecture-decks bucket (storage RLS
 * limits that to the course professor); this records the row.
 */
export async function createDeck(input: {
  courseId: string;
  title: string;
  kind: "pdf" | "google_slides";
  storagePath?: string;
  embedUrl?: string;
  pageCount?: number;
}): Promise<ActionResult<{ deckId: string }>> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };

  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the deck a title." };

  if (input.kind === "pdf") {
    if (!input.storagePath?.startsWith(`${input.courseId}/`)) {
      return { ok: false, error: "Upload didn't complete — try again." };
    }
  } else if (!input.embedUrl || !isGoogleSlidesUrl(input.embedUrl)) {
    return { ok: false, error: "That doesn't look like a Google Slides link." };
  }

  const { data: created, error: insertError } = await supabase
    .from("lecture_decks")
    .insert({
      course_id: input.courseId,
      title,
      kind: input.kind,
      storage_path: input.kind === "pdf" ? input.storagePath : null,
      embed_url: input.kind === "google_slides" ? input.embedUrl : null,
      page_count: input.pageCount ?? null,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    return { ok: false, error: "Couldn't save the deck. Try again." };
  }
  revalidatePath(`/course/${input.courseId}/follow`);
  return { ok: true, data: { deckId: created.id } };
}

/** Professor: delete a deck (and its stored PDF). */
export async function deleteDeck(
  courseId: string,
  deckId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: deck } = await supabase
    .from("lecture_decks")
    .select("id, storage_path")
    .eq("id", deckId)
    .eq("course_id", courseId)
    .single();
  if (!deck) return { ok: false, error: "Deck not found." };

  if (deck.storage_path) {
    await supabase.storage.from(DECK_BUCKET).remove([deck.storage_path]);
  }
  const { error: deleteError } = await supabase
    .from("lecture_decks")
    .delete()
    .eq("id", deckId);
  if (deleteError) return { ok: false, error: "Couldn't delete the deck." };
  revalidatePath(`/course/${courseId}/follow`);
  return { ok: true };
}

/** Professor: go live with a deck. Reuses a live lecture on the same deck. */
export async function startLecture(
  courseId: string,
  deckId: string
): Promise<ActionResult<{ lectureId: string }>> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: live } = await supabase
    .from("lectures")
    .select("id, deck_id")
    .eq("course_id", courseId)
    .is("ended_at", null)
    .maybeSingle();
  if (live) {
    if (live.deck_id === deckId) {
      return { ok: true, data: { lectureId: live.id } };
    }
    // Switching decks: close the old run first.
    await supabase
      .from("lectures")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", live.id);
  }

  const { data: created, error: insertError } = await supabase
    .from("lectures")
    .insert({ course_id: courseId, deck_id: deckId })
    .select("id")
    .single();
  if (insertError || !created) {
    return { ok: false, error: "Couldn't start the lecture. Try again." };
  }
  revalidatePath(`/course/${courseId}/follow`);
  return { ok: true, data: { lectureId: created.id } };
}

/** Professor: advance/rewind the live slide. Students sync via realtime. */
export async function setLecturePage(
  courseId: string,
  lectureId: string,
  page: number
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  if (!Number.isInteger(page) || page < 1 || page > 2000) {
    return { ok: false, error: "Invalid page." };
  }
  const { error: updateError } = await supabase
    .from("lectures")
    .update({ current_page: page })
    .eq("id", lectureId)
    .eq("course_id", courseId)
    .is("ended_at", null);
  if (updateError) return { ok: false, error: "Couldn't change the slide." };
  return { ok: true };
}

/** Professor: end the live lecture. */
export async function endLecture(
  courseId: string,
  lectureId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { error: updateError } = await supabase
    .from("lectures")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", lectureId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't end the lecture." };
  revalidatePath(`/course/${courseId}/follow`);
  return { ok: true };
}

/** Student: autosave private lecture notes (upsert per lecture). */
export async function saveLectureNotes(
  courseId: string,
  lectureId: string,
  content: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId) return { ok: false, error: error ?? "No enrollment." };

  const { error: upsertError } = await supabase.from("lecture_notes").upsert(
    {
      lecture_id: lectureId,
      enrollment_id: enrollmentId,
      content: content.slice(0, MAX_NOTE_CHARS),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lecture_id,enrollment_id" }
  );
  if (upsertError) return { ok: false, error: "Couldn't save your notes." };
  return { ok: true };
}

/**
 * Student: log leaving/returning to the lecture tab. RLS only accepts events
 * for the caller's own enrollment while the lecture is live.
 */
export async function recordFocusEvent(
  courseId: string,
  lectureId: string,
  eventType: "away" | "back"
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId) return { ok: false, error: error ?? "No enrollment." };

  const { error: insertError } = await supabase.from("focus_events").insert({
    lecture_id: lectureId,
    enrollment_id: enrollmentId,
    event_type: eventType,
  });
  if (insertError) return { ok: false, error: "Couldn't record the event." };
  return { ok: true };
}
