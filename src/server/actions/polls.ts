"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DECK_BUCKET } from "@/lib/storage";
import { assignPairs, pairKey, tallyVotes } from "@/lib/participate";
import { generateTpsQuestions } from "@/server/questiongen";
import type { ActionResult } from "@/server/actions/auth";
import type { PollStage } from "@/types/db";

const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;
/** Anthropic-class models cap PDF requests around 32MB — leave headroom. */
const MAX_AI_PDF_BYTES = 28 * 1024 * 1024;
/** How many recent groups count as "recent" for pairing variety. */
const PAIR_HISTORY_GROUPS = 200;

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

function validateQuestionFields(input: {
  prompt: string;
  options: string[];
  correctIndices: number[];
  positionAfterPage: number;
}): string | null {
  const prompt = input.prompt.trim();
  if (!prompt) return "Write the question first.";
  if (prompt.length > 2000) return "That question is too long.";
  const options = input.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return `Give the question ${MIN_OPTIONS}–${MAX_OPTIONS} answer options.`;
  }
  if (options.some((o) => o.length > 500)) return "An option is too long.";
  // Empty correctIndices is allowed — that's an opinion question (no key).
  if (
    input.correctIndices.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= options.length
    )
  ) {
    return "The correct-answer markers don't match the options.";
  }
  if (
    !Number.isInteger(input.positionAfterPage) ||
    input.positionAfterPage < 1 ||
    input.positionAfterPage > 2000
  ) {
    return "Pick a valid slide position.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading / Reference PDF
// ---------------------------------------------------------------------------

/**
 * Professor: attach the (single) Reading/Reference PDF to a deck. The browser
 * has already uploaded the file under `{courseId}/` in the lecture-decks
 * bucket; this records it and cleans up any previous reading object.
 */
export async function attachDeckReading(
  courseId: string,
  deckId: string,
  storagePath: string,
  title: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  if (!storagePath.startsWith(`${courseId}/`)) {
    return { ok: false, error: "Upload didn't complete — try again." };
  }
  const { data: deck } = await supabase
    .from("lecture_decks")
    .select("id, reading_path")
    .eq("id", deckId)
    .eq("course_id", courseId)
    .single();
  if (!deck) return { ok: false, error: "Deck not found." };

  if (deck.reading_path && deck.reading_path !== storagePath) {
    await supabase.storage.from(DECK_BUCKET).remove([deck.reading_path]);
  }
  const { error: updateError } = await supabase
    .from("lecture_decks")
    .update({
      reading_path: storagePath,
      reading_title: title.trim().slice(0, 200) || "Reading",
    })
    .eq("id", deckId);
  if (updateError) return { ok: false, error: "Couldn't attach the reading." };
  revalidatePath(`/course/${courseId}/follow`);
  revalidatePath(`/course/${courseId}/participate`);
  return { ok: true };
}

/** Professor: remove a deck's reading PDF (row + stored object). */
export async function removeDeckReading(
  courseId: string,
  deckId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { data: deck } = await supabase
    .from("lecture_decks")
    .select("id, reading_path")
    .eq("id", deckId)
    .eq("course_id", courseId)
    .single();
  if (!deck) return { ok: false, error: "Deck not found." };
  if (deck.reading_path) {
    await supabase.storage.from(DECK_BUCKET).remove([deck.reading_path]);
  }
  const { error: updateError } = await supabase
    .from("lecture_decks")
    .update({ reading_path: null, reading_title: null })
    .eq("id", deckId);
  if (updateError) return { ok: false, error: "Couldn't remove the reading." };
  revalidatePath(`/course/${courseId}/follow`);
  revalidatePath(`/course/${courseId}/participate`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

/**
 * Professor: have AI draft think-pair-share questions from the deck PDF
 * (plus the attached reading, when present). Drafts arrive approved — ready
 * to run in lecture — and the professor unchecks any they don't want.
 */
export async function generateDeckQuestions(
  courseId: string,
  deckId: string
): Promise<ActionResult<{ count: number }>> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: deck } = await supabase
    .from("lecture_decks")
    .select(
      "id, title, kind, storage_path, page_count, reading_path, reading_title"
    )
    .eq("id", deckId)
    .eq("course_id", courseId)
    .single();
  if (!deck) return { ok: false, error: "Deck not found." };
  if (deck.kind !== "pdf" || !deck.storage_path) {
    return {
      ok: false,
      error:
        "AI generation reads the slides — it needs a PDF deck (Google Slides links aren't supported).",
    };
  }

  async function downloadBase64(path: string): Promise<string | null> {
    const { data, error: downloadError } = await supabase.storage
      .from(DECK_BUCKET)
      .download(path);
    if (downloadError || !data) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.byteLength > MAX_AI_PDF_BYTES) return "too-large";
    return buffer.toString("base64");
  }

  const deckPdf = await downloadBase64(deck.storage_path);
  if (!deckPdf) return { ok: false, error: "Couldn't read the deck PDF." };
  if (deckPdf === "too-large") {
    return {
      ok: false,
      error:
        "The deck PDF is too large for AI generation (28MB max) — compress it.",
    };
  }

  let readingPdf: string | null = null;
  if (deck.reading_path) {
    readingPdf = await downloadBase64(deck.reading_path);
    if (readingPdf === "too-large") {
      return {
        ok: false,
        error:
          "The reading PDF is too large for AI generation (28MB max) — compress it.",
      };
    }
  }

  const result = await generateTpsQuestions({
    deckTitle: deck.title,
    pageCount: deck.page_count,
    deckPdfBase64: deckPdf,
    readingPdfBase64: readingPdf,
    readingTitle: deck.reading_title,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const rows = result.questions.map((q) => ({
    deck_id: deckId,
    course_id: courseId,
    prompt: q.prompt,
    options: q.options,
    correct_indices: q.correctIndices,
    rationale: q.rationale || null,
    position_after_page: q.positionAfterPage,
    approved: true,
    source: "ai" as const,
  }));
  const { error: insertError } = await supabase
    .from("deck_questions")
    .insert(rows);
  if (insertError) {
    return { ok: false, error: "Couldn't save the generated questions." };
  }
  revalidatePath(`/course/${courseId}/follow`);
  revalidatePath(`/course/${courseId}/participate`);
  return { ok: true, data: { count: rows.length } };
}

/** Professor: add a custom question (approved immediately — it's theirs). */
export async function createQuestion(input: {
  courseId: string;
  deckId: string;
  prompt: string;
  options: string[];
  correctIndices: number[];
  positionAfterPage: number;
}): Promise<ActionResult<{ questionId: string }>> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };
  const invalid = validateQuestionFields(input);
  if (invalid) return { ok: false, error: invalid };

  const { data: created, error: insertError } = await supabase
    .from("deck_questions")
    .insert({
      deck_id: input.deckId,
      course_id: input.courseId,
      prompt: input.prompt.trim(),
      options: input.options.map((o) => o.trim()).filter(Boolean),
      correct_indices: input.correctIndices,
      position_after_page: input.positionAfterPage,
      approved: true,
      source: "professor",
    })
    .select("id")
    .single();
  if (insertError || !created) {
    return { ok: false, error: "Couldn't save the question." };
  }
  revalidatePath(`/course/${input.courseId}/follow`);
  revalidatePath(`/course/${input.courseId}/participate`);
  return { ok: true, data: { questionId: created.id } };
}

/** Professor: edit a question's text, options, answer key, or slide position. */
export async function updateQuestion(input: {
  courseId: string;
  questionId: string;
  prompt: string;
  options: string[];
  correctIndices: number[];
  positionAfterPage: number;
}): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };
  const invalid = validateQuestionFields(input);
  if (invalid) return { ok: false, error: invalid };

  const { error: updateError } = await supabase
    .from("deck_questions")
    .update({
      prompt: input.prompt.trim(),
      options: input.options.map((o) => o.trim()).filter(Boolean),
      correct_indices: input.correctIndices,
      position_after_page: input.positionAfterPage,
    })
    .eq("id", input.questionId)
    .eq("course_id", input.courseId);
  if (updateError) return { ok: false, error: "Couldn't save the changes." };
  revalidatePath(`/course/${input.courseId}/follow`);
  revalidatePath(`/course/${input.courseId}/participate`);
  return { ok: true };
}

/** Professor: approve (activate for lecture) or unapprove a question. */
export async function setQuestionApproved(
  courseId: string,
  questionId: string,
  approved: boolean
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { error: updateError } = await supabase
    .from("deck_questions")
    .update({ approved })
    .eq("id", questionId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't update the question." };
  revalidatePath(`/course/${courseId}/follow`);
  revalidatePath(`/course/${courseId}/participate`);
  return { ok: true };
}

/** Professor: delete a question from the bank. */
export async function deleteQuestion(
  courseId: string,
  questionId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { error: deleteError } = await supabase
    .from("deck_questions")
    .delete()
    .eq("id", questionId)
    .eq("course_id", courseId);
  if (deleteError) return { ok: false, error: "Couldn't delete the question." };
  revalidatePath(`/course/${courseId}/follow`);
  revalidatePath(`/course/${courseId}/participate`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Live poll rounds (Peer Instruction flow)
// ---------------------------------------------------------------------------

/**
 * Professor: launch a question as a live round. Snapshots the prompt/options
 * onto the round so students never read deck_questions (which holds the key).
 */
export async function launchPollRound(
  courseId: string,
  lectureId: string,
  questionId: string
): Promise<ActionResult<{ roundId: string }>> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: lecture } = await supabase
    .from("lectures")
    .select("id")
    .eq("id", lectureId)
    .eq("course_id", courseId)
    .is("ended_at", null)
    .maybeSingle();
  if (!lecture) return { ok: false, error: "The lecture isn't live." };

  const { data: question } = await supabase
    .from("deck_questions")
    .select("id, prompt, options, approved")
    .eq("id", questionId)
    .eq("course_id", courseId)
    .single();
  if (!question) return { ok: false, error: "Question not found." };
  if (!question.approved) {
    return { ok: false, error: "Approve the question before launching it." };
  }

  const { data: created, error: insertError } = await supabase
    .from("poll_rounds")
    .insert({
      lecture_id: lectureId,
      course_id: courseId,
      question_id: question.id,
      prompt: question.prompt,
      options: question.options,
      stage: "think",
    })
    .select("id")
    .single();
  if (insertError || !created) {
    // The partial unique index rejects a second open round.
    return { ok: false, error: "A poll is already running — close it first." };
  }
  return { ok: true, data: { roundId: created.id } };
}

/**
 * Professor: ask an impromptu question mid-lecture — saved into the deck's
 * question bank (for the record, positioned at the current slide) and
 * launched as a live round in one step. Empty correctIndices = opinion poll.
 */
export async function launchQuickPoll(input: {
  courseId: string;
  lectureId: string;
  prompt: string;
  options: string[];
  correctIndices: number[];
}): Promise<ActionResult<{ roundId: string; questionId: string }>> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };
  const invalid = validateQuestionFields({ ...input, positionAfterPage: 1 });
  if (invalid) return { ok: false, error: invalid };

  const { data: lecture } = await supabase
    .from("lectures")
    .select("id, deck_id, current_page")
    .eq("id", input.lectureId)
    .eq("course_id", input.courseId)
    .is("ended_at", null)
    .maybeSingle();
  if (!lecture) return { ok: false, error: "The lecture isn't live." };

  const options = input.options.map((o) => o.trim()).filter(Boolean);
  const prompt = input.prompt.trim();
  const { data: question, error: questionError } = await supabase
    .from("deck_questions")
    .insert({
      deck_id: lecture.deck_id,
      course_id: input.courseId,
      prompt,
      options,
      correct_indices: input.correctIndices,
      rationale: "Asked live as a quick poll.",
      position_after_page: lecture.current_page,
      approved: true,
      source: "professor",
    })
    .select("id")
    .single();
  if (questionError || !question) {
    return { ok: false, error: "Couldn't save the question." };
  }

  const { data: round, error: roundError } = await supabase
    .from("poll_rounds")
    .insert({
      lecture_id: input.lectureId,
      course_id: input.courseId,
      question_id: question.id,
      prompt,
      options,
      stage: "think",
    })
    .select("id")
    .single();
  if (roundError || !round) {
    return { ok: false, error: "A poll is already running — close it first." };
  }
  revalidatePath(`/course/${input.courseId}/participate`);
  return { ok: true, data: { roundId: round.id, questionId: question.id } };
}

/**
 * Professor: move a live round forward. Moving to `pair` assigns discussion
 * partners from today's seat map — preferring neighbors who answered
 * differently and rotating partners for variety.
 */
export async function setPollStage(
  courseId: string,
  roundId: string,
  stage: Extract<PollStage, "pair" | "revote">
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: round } = await supabase
    .from("poll_rounds")
    .select("id, lecture_id, stage")
    .eq("id", roundId)
    .eq("course_id", courseId)
    .single();
  if (!round) return { ok: false, error: "Poll not found." };
  const order: PollStage[] = ["think", "pair", "revote", "reveal", "closed"];
  if (order.indexOf(stage) <= order.indexOf(round.stage)) {
    return { ok: false, error: "The poll has already moved past that stage." };
  }

  if (stage === "pair") {
    // Think-phase votes are the participant pool.
    const { data: answers } = await supabase
      .from("poll_answers")
      .select("enrollment_id, choice")
      .eq("round_id", roundId)
      .eq("phase", "think");

    if (answers && answers.length > 0) {
      // Seats from the latest class session's check-ins.
      const { data: session } = await supabase
        .from("class_sessions")
        .select("id")
        .eq("course_id", courseId)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const seatByEnrollment = new Map<string, { row: number; col: number }>();
      if (session) {
        const { data: checkIns } = await supabase
          .from("check_ins")
          .select("enrollment_id, seats(row_index, col_index)")
          .eq("session_id", session.id);
        for (const c of checkIns ?? []) {
          const seat = c.seats as unknown as {
            row_index: number;
            col_index: number;
          } | null;
          if (seat) {
            seatByEnrollment.set(c.enrollment_id, {
              row: seat.row_index,
              col: seat.col_index,
            });
          }
        }
      }

      // Recent groups in this course → variety.
      const { data: history } = await supabase
        .from("poll_pairs")
        .select("member_ids")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false })
        .limit(PAIR_HISTORY_GROUPS);
      const previous = new Set<string>();
      for (const group of history ?? []) {
        const ids = group.member_ids as string[];
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            previous.add(pairKey(ids[i], ids[j]));
          }
        }
      }

      const groups = assignPairs(
        answers.map((a) => ({
          enrollmentId: a.enrollment_id,
          choice: a.choice,
          seat: seatByEnrollment.get(a.enrollment_id),
        })),
        previous
      );
      if (groups.length > 0) {
        const { error: pairsError } = await supabase.from("poll_pairs").insert(
          groups.map((memberIds) => ({
            round_id: roundId,
            course_id: courseId,
            member_ids: memberIds,
          }))
        );
        if (pairsError) {
          return { ok: false, error: "Couldn't assign discussion partners." };
        }
      }
    }
  }

  const { error: updateError } = await supabase
    .from("poll_rounds")
    .update({ stage })
    .eq("id", roundId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't advance the poll." };
  return { ok: true };
}

/**
 * Professor: reveal results — computes the before/after distributions and
 * publishes them on the round (that's the moment students may see them).
 */
export async function revealPollResults(
  courseId: string,
  roundId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: round } = await supabase
    .from("poll_rounds")
    .select("id, options, stage")
    .eq("id", roundId)
    .eq("course_id", courseId)
    .single();
  if (!round) return { ok: false, error: "Poll not found." };
  if (round.stage === "closed") {
    return { ok: false, error: "That poll is already closed." };
  }

  const { data: answers } = await supabase
    .from("poll_answers")
    .select("phase, choice")
    .eq("round_id", roundId);
  const results = tallyVotes(answers ?? [], (round.options as string[]).length);

  const { error: updateError } = await supabase
    .from("poll_rounds")
    .update({
      stage: "reveal",
      results,
      revealed_at: new Date().toISOString(),
    })
    .eq("id", roundId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't reveal the results." };
  return { ok: true };
}

/** Professor: mark the correct answer(s) during the reveal. */
export async function markPollCorrect(
  courseId: string,
  roundId: string,
  correctIndices: number[]
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: round } = await supabase
    .from("poll_rounds")
    .select("id, options, stage")
    .eq("id", roundId)
    .eq("course_id", courseId)
    .single();
  if (!round) return { ok: false, error: "Poll not found." };
  const optionCount = (round.options as string[]).length;
  if (
    correctIndices.length === 0 ||
    correctIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= optionCount)
  ) {
    return { ok: false, error: "Pick at least one valid option." };
  }

  const { error: updateError } = await supabase
    .from("poll_rounds")
    .update({ correct_indices: correctIndices })
    .eq("id", roundId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't mark the answer." };
  return { ok: true };
}

/** Professor: close the round and go back to the slides. */
export async function closePollRound(
  courseId: string,
  roundId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { error: updateError } = await supabase
    .from("poll_rounds")
    .update({ stage: "closed", closed_at: new Date().toISOString() })
    .eq("id", roundId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't close the poll." };
  return { ok: true };
}

/**
 * Student: vote. The phase is derived from the round's current stage —
 * `think` before discussion, `revote` after. Re-submitting in the same
 * phase updates the vote (people change their minds mid-timer).
 */
export async function submitPollAnswer(
  courseId: string,
  roundId: string,
  choice: number
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const { data: round } = await supabase
    .from("poll_rounds")
    .select("id, options, stage")
    .eq("id", roundId)
    .eq("course_id", courseId)
    .single();
  if (!round) return { ok: false, error: "Poll not found." };
  const stage = round.stage as PollStage;
  if (stage !== "think" && stage !== "revote") {
    return { ok: false, error: "Voting is closed for this question." };
  }
  const optionCount = (round.options as string[]).length;
  if (!Number.isInteger(choice) || choice < 0 || choice >= optionCount) {
    return { ok: false, error: "Pick one of the options." };
  }

  const { error: upsertError } = await supabase.from("poll_answers").upsert(
    {
      round_id: roundId,
      enrollment_id: enrollmentId,
      phase: stage,
      choice,
      answered_at: new Date().toISOString(),
    },
    { onConflict: "round_id,enrollment_id,phase" }
  );
  if (upsertError) return { ok: false, error: "Couldn't record your answer." };
  return { ok: true };
}
