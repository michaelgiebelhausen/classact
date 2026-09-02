"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DECK_BUCKET } from "@/lib/storage";
import { PRESENCE_DISCONNECT_MS } from "@/lib/focus";
import { broadcastLectureState } from "@/server/lecturebroadcast";
import type { ActionResult } from "@/server/actions/auth";
import type { LecturePause } from "@/types/db";

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

/**
 * Professor: set the deck order for a course. Takes the full ordered list
 * of deck ids and writes their index as the position.
 */
export async function reorderDecks(
  courseId: string,
  deckIds: string[]
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  if (deckIds.length === 0) return { ok: true };
  if (deckIds.length > 500) return { ok: false, error: "Too many decks." };

  const results = await Promise.all(
    deckIds.map((id, index) =>
      supabase
        .from("lecture_decks")
        .update({ position: index })
        .eq("id", id)
        .eq("course_id", courseId)
    )
  );
  if (results.some((r) => r.error)) {
    return { ok: false, error: "Couldn't save the new order." };
  }
  revalidatePath(`/course/${courseId}/follow`);
  revalidatePath(`/course/${courseId}/setup`);
  return { ok: true };
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
  // Returning the row from the same write is what the broadcast carries:
  // followers apply the whole state, so a page message must not arrive with
  // stale pauses and wipe an open pause off every student's screen.
  const { data: row, error: updateError } = await supabase
    .from("lectures")
    .update({ current_page: page })
    .eq("id", lectureId)
    .eq("course_id", courseId)
    .is("ended_at", null)
    .select("current_page, ended_at, pauses")
    .maybeSingle();
  if (updateError) return { ok: false, error: "Couldn't change the slide." };
  if (row) await broadcastLectureState(lectureId, row);
  return { ok: true };
}

/**
 * Professor: pause the live lecture — an official "go look it up" window.
 * Student tab-aways that overlap a pause are excluded from focus scoring.
 */
export async function pauseLecture(
  courseId: string,
  lectureId: string
): Promise<ActionResult<{ pauses: LecturePause[] }>> {
  return setPauseState(courseId, lectureId, "pause");
}

/** Professor: resume from a pause — tab-aways count again. */
export async function resumeLecture(
  courseId: string,
  lectureId: string
): Promise<ActionResult<{ pauses: LecturePause[] }>> {
  return setPauseState(courseId, lectureId, "resume");
}

async function setPauseState(
  courseId: string,
  lectureId: string,
  action: "pause" | "resume"
): Promise<ActionResult<{ pauses: LecturePause[] }>> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: lecture } = await supabase
    .from("lectures")
    .select("id, pauses")
    .eq("id", lectureId)
    .eq("course_id", courseId)
    .is("ended_at", null)
    .maybeSingle();
  if (!lecture) return { ok: false, error: "No live lecture to pause." };

  const pauses: LecturePause[] = lecture.pauses ?? [];
  const open = pauses.length > 0 && pauses[pauses.length - 1].end === null;
  // Idempotent: pausing while paused (or resuming while live) is a no-op.
  if ((action === "pause") === open) return { ok: true, data: { pauses } };

  const next: LecturePause[] =
    action === "pause"
      ? [...pauses, { start: new Date().toISOString(), end: null }]
      : [
          ...pauses.slice(0, -1),
          { ...pauses[pauses.length - 1], end: new Date().toISOString() },
        ];
  const { data: row, error: updateError } = await supabase
    .from("lectures")
    .update({ pauses: next })
    .eq("id", lectureId)
    .eq("course_id", courseId)
    .is("ended_at", null)
    .select("current_page, ended_at, pauses")
    .maybeSingle();
  if (updateError) {
    return {
      ok: false,
      error: action === "pause" ? "Couldn't pause." : "Couldn't resume.",
    };
  }
  if (row) await broadcastLectureState(lectureId, row);
  return { ok: true, data: { pauses: next } };
}

/** Professor: end the live lecture (closing any open pause with it). */
export async function endLecture(
  courseId: string,
  lectureId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const now = new Date().toISOString();
  const { data: lecture } = await supabase
    .from("lectures")
    .select("id, pauses")
    .eq("id", lectureId)
    .eq("course_id", courseId)
    .maybeSingle();
  const pauses: LecturePause[] = lecture?.pauses ?? [];
  const closed =
    pauses.length > 0 && pauses[pauses.length - 1].end === null
      ? [...pauses.slice(0, -1), { ...pauses[pauses.length - 1], end: now }]
      : pauses;
  const { data: row, error: updateError } = await supabase
    .from("lectures")
    .update({ ended_at: now, pauses: closed })
    .eq("id", lectureId)
    .eq("course_id", courseId)
    .select("current_page, ended_at, pauses")
    .maybeSingle();
  if (updateError) return { ok: false, error: "Couldn't end the lecture." };
  if (row) await broadcastLectureState(lectureId, row);
  revalidatePath(`/course/${courseId}/follow`);
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

  // One clock for the event and its presence echo. An 'away' written as the
  // lid closes must share its exact timestamp with last_seen_at, so a spell
  // the sleep ate truncates to exactly zero — length 0 is what keeps it out
  // of the drift count, and a DB-default now() would land a few ms later.
  const nowIso = new Date().toISOString();

  // A 'back' after the heartbeat went silent means the machine was asleep or
  // shut, not browsing — close the away spell at the last proof of life so
  // the silent stretch isn't charged as drift.
  let occurredAt: string | null = null;
  if (eventType === "back") {
    const { data: presence } = await supabase
      .from("lecture_presence")
      .select("last_seen_at")
      .eq("lecture_id", lectureId)
      .eq("enrollment_id", enrollmentId)
      .maybeSingle();
    if (
      presence &&
      Date.now() - Date.parse(presence.last_seen_at) > PRESENCE_DISCONNECT_MS
    ) {
      occurredAt = presence.last_seen_at;
    }
  }

  const { error: insertError } = await supabase.from("focus_events").insert({
    lecture_id: lectureId,
    enrollment_id: enrollmentId,
    event_type: eventType,
    occurred_at: occurredAt ?? nowIso,
  });
  if (insertError) return { ok: false, error: "Couldn't record the event." };
  // Any transition proves the machine is awake — refresh presence with it so
  // liveness never hinges on a throttled heartbeat timer.
  await supabase.from("lecture_presence").upsert(
    {
      lecture_id: lectureId,
      enrollment_id: enrollmentId,
      last_seen_at: nowIso,
    },
    { onConflict: "lecture_id,enrollment_id" }
  );
  return { ok: true };
}

/**
 * Student: presence heartbeat while following a live lecture. Fire-and-forget
 * from the client; RLS silently rejects beats after the lecture ends. The
 * explicit timestamp matters — the column default doesn't fire on the
 * conflict-update half of an upsert.
 */
export async function recordPresenceHeartbeat(
  courseId: string,
  lectureId: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId) return { ok: false, error: error ?? "No enrollment." };
  const { error: upsertError } = await supabase.from("lecture_presence").upsert(
    {
      lecture_id: lectureId,
      enrollment_id: enrollmentId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "lecture_id,enrollment_id" }
  );
  if (upsertError) return { ok: false, error: "Couldn't record presence." };
  return { ok: true };
}
