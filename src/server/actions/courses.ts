"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { generateJoinCode } from "@/lib/joincode";
import {
  createCourseSchema,
  icebreakerFieldsSchema,
} from "@/lib/validators";
import { DEFAULT_ICEBREAKER_KEYS, ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { isScheduleComplete } from "@/lib/schedule";
import { DECK_BUCKET } from "@/lib/storage";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Create a course (FR-001). Self-serve professor provisioning (Open Q3):
 * creating a course promotes the creator's profile to 'professor'.
 */
export async function createCourse(input: {
  name: string;
  term?: string;
}): Promise<ActionResult<{ id: string; joinCode: string }>> {
  const parsed = createCourseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to create a course." };

  // Billing gate ($5/mo, BILLING_ENABLED): founders and comped accounts
  // pass free; students are never gated (they don't create courses).
  if (env.billingEnabled) {
    const { data: gateProfile } = await supabase
      .from("profiles")
      .select("founder, comp, subscription_status")
      .eq("id", user.id)
      .single();
    const allowed =
      gateProfile?.founder ||
      gateProfile?.comp ||
      gateProfile?.subscription_status === "active";
    if (!allowed) {
      return { ok: false, error: "billing_required" };
    }
  }

  // Promote to professor (idempotent).
  await supabase
    .from("profiles")
    .update({ role: "professor" })
    .eq("id", user.id);

  // Insert with join-code retry on the (rare) unique collision.
  //
  // The id is generated here rather than read back with .select(): a RETURNING
  // clause makes Postgres apply the SELECT policy to the new row, and
  // courses_select routes through is_course_member() — a STABLE function that
  // subqueries `courses` and so cannot see the row its own statement is
  // inserting. The insert lands, RETURNING comes back empty, and the caller
  // reports failure for a course that actually exists. Skipping RETURNING
  // sidesteps that entirely.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID();
    const joinCode = generateJoinCode(parsed.data.name);
    const { error } = await supabase.from("courses").insert({
      id,
      professor_id: user.id,
      name: parsed.data.name,
      term: parsed.data.term || null,
      join_code: joinCode,
      icebreaker_fields: DEFAULT_ICEBREAKER_KEYS,
    });

    if (!error) {
      revalidatePath("/dashboard");
      return { ok: true, data: { id, joinCode } };
    }
    // 23505 = unique_violation on join_code -> retry; anything else -> fail
    if (error.code !== "23505") {
      console.error("[createCourse] insert failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return { ok: false, error: "Couldn't create the course. Try again." };
    }
  }
  return { ok: false, error: "Couldn't generate a unique join code. Try again." };
}

/**
 * Copy a course into a new one — the same class taught at another hour.
 * Everything describing *how* the course runs comes across (room and seat
 * map, schedule, icebreakers, grading defaults, optionally the slide decks
 * and their questions); nothing about *who* is in it does. Roster, sessions,
 * check-ins, and recorded work stay with the original.
 */
export async function duplicateCourse(input: {
  courseId: string;
  name: string;
  term?: string;
  copyDecks: boolean;
}): Promise<
  ActionResult<{ id: string; joinCode: string; seats: number; decks: number }>
> {
  const parsed = createCourseSchema.safeParse({
    name: input.name,
    term: input.term,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: source } = await supabase
    .from("courses")
    .select(
      "id, professor_id, term, room_id, icebreaker_fields, meeting_days, meeting_start, meeting_end, timezone, auto_open, term_start, term_end, grading_defaults, participation_weights"
    )
    .eq("id", input.courseId)
    .single();
  if (!source || source.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can copy it." };
  }

  // A copy is a new course, so it passes the same gate as creating one.
  if (env.billingEnabled) {
    const { data: gateProfile } = await supabase
      .from("profiles")
      .select("founder, comp, subscription_status")
      .eq("id", user.id)
      .single();
    const allowed =
      gateProfile?.founder ||
      gateProfile?.comp ||
      gateProfile?.subscription_status === "active";
    if (!allowed) return { ok: false, error: "billing_required" };
  }

  let newId = "";
  let joinCode = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID();
    const code = generateJoinCode(parsed.data.name);
    const { error } = await supabase.from("courses").insert({
      id,
      professor_id: user.id,
      name: parsed.data.name,
      term: parsed.data.term || source.term,
      join_code: code,
      room_id: source.room_id,
      icebreaker_fields: source.icebreaker_fields,
      meeting_days: source.meeting_days,
      meeting_start: source.meeting_start,
      meeting_end: source.meeting_end,
      timezone: source.timezone,
      auto_open: source.auto_open,
      term_start: source.term_start,
      term_end: source.term_end,
      grading_defaults: source.grading_defaults,
      participation_weights: source.participation_weights,
    });
    if (!error) {
      newId = id;
      joinCode = code;
      break;
    }
    if (error.code !== "23505") {
      console.error("[duplicateCourse] insert failed:", {
        code: error.code,
        message: error.message,
      });
      return { ok: false, error: "Couldn't copy the course. Try again." };
    }
  }
  if (!newId) {
    return { ok: false, error: "Couldn't generate a unique join code. Try again." };
  }

  // Seats copy verbatim: `neighbors` holds seat *labels*, so the map and the
  // check-in verification links it encodes survive untouched.
  let seatCount = 0;
  const { data: sourceSeats } = await supabase
    .from("seats")
    .select("label, row_index, col_index, x, y, section, table_id, neighbors")
    .eq("course_id", input.courseId);
  if (sourceSeats && sourceSeats.length > 0) {
    const { error: seatError } = await supabase.from("seats").insert(
      sourceSeats.map((s) => ({
        course_id: newId,
        label: s.label,
        row_index: s.row_index,
        col_index: s.col_index,
        x: s.x,
        y: s.y,
        section: s.section,
        table_id: s.table_id,
        neighbors: s.neighbors,
      }))
    );
    if (seatError) {
      console.error("[duplicateCourse] seat copy failed:", seatError.message);
    } else {
      seatCount = sourceSeats.length;
    }
  }

  // Decks are the point of copying a course you teach three times. Stored
  // files live under the course id, so each is duplicated in storage too —
  // a deck whose file won't copy is skipped rather than left pointing at a
  // file the new course's students can't read.
  let deckCount = 0;
  if (input.copyDecks) {
    const { data: decks } = await supabase
      .from("lecture_decks")
      .select(
        "id, title, kind, storage_path, embed_url, page_count, reading_path, reading_title, position"
      )
      .eq("course_id", input.courseId)
      .order("position", { ascending: true });

    const copyFile = async (path: string | null): Promise<string | null> => {
      if (!path) return null;
      const name = path.split("/").slice(1).join("/");
      const target = `${newId}/${name || `${crypto.randomUUID()}.pdf`}`;
      const { error } = await supabase.storage.from(DECK_BUCKET).copy(path, target);
      return error ? null : target;
    };

    for (const deck of decks ?? []) {
      let storagePath: string | null = null;
      if (deck.kind === "pdf") {
        storagePath = await copyFile(deck.storage_path);
        if (!storagePath) continue; // no file, no usable deck
      }
      const readingPath = await copyFile(deck.reading_path);

      const newDeckId = crypto.randomUUID();
      const { error: deckError } = await supabase.from("lecture_decks").insert({
        id: newDeckId,
        course_id: newId,
        title: deck.title,
        kind: deck.kind,
        storage_path: storagePath,
        embed_url: deck.embed_url,
        page_count: deck.page_count,
        reading_path: readingPath,
        reading_title: readingPath ? deck.reading_title : null,
        position: deck.position,
      });
      if (deckError) continue;
      deckCount++;

      const { data: questions } = await supabase
        .from("deck_questions")
        .select(
          "prompt, options, correct_indices, rationale, position_after_page, approved, source"
        )
        .eq("deck_id", deck.id);
      if (questions && questions.length > 0) {
        await supabase.from("deck_questions").insert(
          questions.map((q) => ({
            course_id: newId,
            deck_id: newDeckId,
            prompt: q.prompt,
            options: q.options,
            correct_indices: q.correct_indices,
            rationale: q.rationale,
            position_after_page: q.position_after_page,
            approved: q.approved,
            source: q.source,
          }))
        );
      }
    }
  }

  revalidatePath("/dashboard");
  return {
    ok: true,
    data: { id: newId, joinCode, seats: seatCount, decks: deckCount },
  };
}

/** Toggle which icebreaker fields students answer (FR-004). */
export async function updateIcebreakerFields(
  courseId: string,
  fieldKeys: string[]
): Promise<ActionResult> {
  const parsed = icebreakerFieldsSchema.safeParse(fieldKeys);
  if (!parsed.success) return { ok: false, error: "Invalid field selection." };

  const validKeys = new Set(ICEBREAKER_CATALOG.map((f) => f.key));
  const keys = parsed.data.filter((k) => validKeys.has(k));

  const supabase = await createClient();
  // RLS restricts the update to the owning professor.
  const { error } = await supabase
    .from("courses")
    .update({ icebreaker_fields: keys })
    .eq("id", courseId);

  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath(`/course/${courseId}/setup`);
  return { ok: true };
}

/**
 * Set the meeting schedule. With auto-open on, check-in opens itself 15
 * minutes before start on meeting days — no professor click required.
 * An empty days list clears the schedule (manual open only).
 */
export async function updateSchedule(
  courseId: string,
  input: {
    days: number[];
    start: string | null;
    end: string | null;
    timezone: string | null;
    autoOpen: boolean;
    termStart?: string | null;
    termEnd?: string | null;
  }
): Promise<ActionResult> {
  const clearing = input.days.length === 0;
  const termStart = input.termStart?.trim() || null;
  const termEnd = input.termEnd?.trim() || null;
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if ((termStart && !isDate(termStart)) || (termEnd && !isDate(termEnd))) {
    return { ok: false, error: "Term dates need to be real calendar dates." };
  }
  if (termStart && termEnd && termEnd < termStart) {
    return { ok: false, error: "The term can't end before it starts." };
  }
  if (!clearing && !isScheduleComplete(input)) {
    return {
      ok: false,
      error: "Pick at least one day and a start time before the end time.",
    };
  }
  if (!clearing) {
    try {
      // Throws on unknown IANA names — reject rather than store garbage.
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone! });
    } catch {
      return { ok: false, error: "Unrecognized timezone — try saving again." };
    }
  }

  const supabase = await createClient();
  // RLS restricts the update to the owning professor.
  const { error } = await supabase
    .from("courses")
    .update(
      clearing
        ? {
            meeting_days: [],
            meeting_start: null,
            meeting_end: null,
            auto_open: input.autoOpen,
            // Term dates outlive the weekly pattern — keep them.
            term_start: termStart,
            term_end: termEnd,
          }
        : {
            meeting_days: [...new Set(input.days)].sort((a, b) => a - b),
            meeting_start: input.start,
            meeting_end: input.end,
            timezone: input.timezone,
            auto_open: input.autoOpen,
            term_start: termStart,
            term_end: termEnd,
          }
    )
    .eq("id", courseId);

  if (error) return { ok: false, error: "Couldn't save the schedule. Try again." };
  revalidatePath(`/course/${courseId}/setup`);
  revalidatePath(`/course/${courseId}/checkin`);
  return { ok: true };
}
