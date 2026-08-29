"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import { DECK_BUCKET, MATERIALS_BUCKET } from "@/lib/storage";
import {
  assembleCorpus,
  taSystemPrompt,
  type CorpusSource,
} from "@/lib/tacorpus";
import { answerTa, extractPdfText, type TaTurn } from "@/server/ta";
import { resolveCourseAi } from "@/server/aicreds";
import type { ActionResult } from "@/server/actions/auth";

/** Anthropic-class models cap PDF requests around 32MB — leave headroom. */
const MAX_EXTRACT_PDF_BYTES = 28 * 1024 * 1024;
const MAX_QUESTION_CHARS = 2000;
/** Thread context sent to the model — follow-ups work, costs stay bounded. */
const HISTORY_TURNS = 8;
/** Daily spend caps, counted from ta_messages in the DB — the in-memory
 *  limiter resets on every deploy/cold start, which is fine for bursts but
 *  not for a cap that guards the professor's OpenRouter bill. */
const DAILY_PER_PERSON = 30;
const DAILY_PER_COURSE = 400;

/**
 * Membership in is_course_member's sense: the professor, or an active
 * enrollment. The professor is deliberately included — they should be able
 * to try their own TA (their thread is as private as anyone's).
 */
async function requireMember(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: "Sign in first." as string };
  }
  // RLS membership gate — non-members get null on the course row itself.
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, professor_id, syllabus_text, syllabus_title")
    .eq("id", courseId)
    .single();
  if (!course) {
    return { supabase, user: null, error: "Course not found." as string };
  }
  if (course.professor_id !== user.id) {
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
        user: null,
        error: "You're not on this course's roster." as string,
      };
    }
  }
  return { supabase, user, course, error: null };
}

interface DeckCorpusRow {
  id: string;
  title: string;
  deck_text: string | null;
  transcript_text: string | null;
  transcript_title: string | null;
  reading_text: string | null;
  reading_title: string | null;
}

/**
 * The TA's entire world, as labeled sources. Built from an explicit
 * allowlist — deck_questions (answer keys) and grading internals must never
 * appear here. Ordered so the budget squeezes out old lectures last-first:
 * syllabus and assignment briefs always fit, then decks newest-first.
 */
function buildSources(
  course: { syllabus_text: string | null; syllabus_title: string | null },
  decks: DeckCorpusRow[],
  assignments: Array<{ title: string; instructions: string }>
): CorpusSource[] {
  const sources: CorpusSource[] = [];
  if (course.syllabus_text) {
    sources.push({ label: "[Syllabus]", text: course.syllabus_text });
  }
  for (const a of assignments) {
    if (!a.instructions.trim()) continue;
    sources.push({
      label: `[Assignment "${a.title}"]`,
      text: a.instructions,
    });
  }
  // decks arrive position-ordered (lecture order); walk newest-first so
  // truncation eats the start of the semester, not last week.
  for (let i = decks.length - 1; i >= 0; i--) {
    const deck = decks[i];
    const n = i + 1;
    if (deck.deck_text) {
      sources.push({
        label: `[Lecture ${n} slides "${deck.title}"]`,
        text: deck.deck_text,
      });
    }
    if (deck.transcript_text) {
      sources.push({
        label: `[Lecture ${n} transcript "${deck.transcript_title ?? deck.title}"]`,
        text: deck.transcript_text,
      });
    }
    if (deck.reading_text) {
      sources.push({
        label: `[Lecture ${n} reading "${deck.reading_title ?? "Reading"}"]`,
        text: deck.reading_text,
      });
    }
  }
  return sources;
}

/**
 * Student or professor: ask the course TA one question. Grounded in the
 * indexed materials; runs on the course owner's OpenRouter key only.
 */
export async function askTa(
  courseId: string,
  question: string
): Promise<ActionResult<{ answer: string }>> {
  const q = question.trim();
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: "That question is too long — trim it down." };
  }

  const { supabase, user, course, error } = await requireMember(courseId);
  if (error || !user || !course) {
    return { ok: false, error: error ?? "Not allowed." };
  }

  // Burst guard (in-memory is fine at this window size).
  const burst = rateLimit(`ta:${user.id}`, { limit: 3, windowMs: 60_000 });
  if (!burst.allowed) {
    return { ok: false, error: "One at a time — give the TA a few seconds." };
  }

  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "The TA isn't configured on this server." };
  }
  const admin = createAdminClient();

  // Daily caps, counted in the DB so they survive deploys.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: mine }, { count: courseWide }] = await Promise.all([
    admin
      .from("ta_messages")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("profile_id", user.id)
      .eq("role", "user")
      .gte("created_at", since),
    admin
      .from("ta_messages")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("role", "user")
      .gte("created_at", since),
  ]);
  if ((mine ?? 0) >= DAILY_PER_PERSON) {
    return {
      ok: false,
      error: "You've hit today's question limit — the TA will be back tomorrow.",
    };
  }
  if ((courseWide ?? 0) >= DAILY_PER_COURSE) {
    return {
      ok: false,
      error: "The TA has hit this course's daily limit — try again tomorrow.",
    };
  }

  const creds = await resolveCourseAi(courseId, "ta");
  if (!creds) {
    return {
      ok: false,
      error:
        course.professor_id === user.id
          ? "The TA needs an OpenRouter key — connect yours in AI Settings."
          : "The TA isn't enabled for this course yet — ask your professor.",
    };
  }

  // Corpus: allowlisted materials only (never deck_questions — answer keys).
  const [{ data: decks }, { data: assignments }] = await Promise.all([
    admin
      .from("lecture_decks")
      .select(
        "id, title, deck_text, transcript_text, transcript_title, reading_text, reading_title"
      )
      .eq("course_id", courseId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("assignments")
      .select("title, instructions")
      .eq("course_id", courseId)
      .order("created_at", { ascending: true }),
  ]);
  const sources = buildSources(course, decks ?? [], assignments ?? []);
  if (sources.length === 0) {
    return {
      ok: false,
      error:
        course.professor_id === user.id
          ? "The TA has nothing to read yet — upload a syllabus or index your slides first."
          : "The TA has no course materials to read yet — ask your professor.",
    };
  }
  const corpus = assembleCorpus(sources);

  // Recent turns from THIS person's private thread, oldest first.
  const { data: recent } = await supabase
    .from("ta_messages")
    .select("role, content")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);
  const history: TaTurn[] = (recent ?? [])
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));

  const result = await answerTa(
    taSystemPrompt(course.name, corpus.dropped),
    corpus.text,
    history,
    q,
    creds
  );
  if (!result.ok) return { ok: false, error: result.error };

  // The user turn goes through the user's client (RLS proves membership and
  // pins role='user'); the assistant turn is service-role only, so a student
  // can't forge context the model would later trust.
  const { error: insertError } = await supabase.from("ta_messages").insert({
    course_id: courseId,
    profile_id: user.id,
    role: "user",
    content: q,
  });
  if (!insertError) {
    await admin.from("ta_messages").insert({
      course_id: courseId,
      profile_id: user.id,
      role: "assistant",
      content: result.data,
    });
  }

  return { ok: true, data: { answer: result.data } };
}

export interface IndexProgress {
  /** Items still waiting after this call (0 = fully indexed). */
  remaining: number;
  /** What this call indexed, when it indexed something. */
  indexed: string | null;
}

interface IndexCandidate {
  kind: "slides" | "reading" | "syllabus";
  label: string;
  bucket: string;
  path: string;
  deckId: string | null;
}

async function listUnindexed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
): Promise<IndexCandidate[]> {
  const [{ data: course }, { data: decks }] = await Promise.all([
    supabase
      .from("courses")
      .select("syllabus_path, syllabus_text")
      .eq("id", courseId)
      .single(),
    supabase
      .from("lecture_decks")
      .select(
        "id, title, kind, storage_path, deck_text, reading_path, reading_title, reading_text"
      )
      .eq("course_id", courseId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);
  const items: IndexCandidate[] = [];
  if (
    course?.syllabus_path &&
    /\.pdf$/i.test(course.syllabus_path) &&
    !course.syllabus_text
  ) {
    items.push({
      kind: "syllabus",
      label: "Syllabus",
      bucket: MATERIALS_BUCKET,
      path: course.syllabus_path,
      deckId: null,
    });
  }
  for (const deck of decks ?? []) {
    if (deck.kind === "pdf" && deck.storage_path && !deck.deck_text) {
      items.push({
        kind: "slides",
        label: `Slides: ${deck.title}`,
        bucket: DECK_BUCKET,
        path: deck.storage_path,
        deckId: deck.id,
      });
    }
    if (deck.reading_path && !deck.reading_text) {
      items.push({
        kind: "reading",
        label: `Reading: ${deck.reading_title ?? deck.title}`,
        bucket: DECK_BUCKET,
        path: deck.reading_path,
        deckId: deck.id,
      });
    }
  }
  return items;
}

/**
 * Professor: index ONE unindexed item (slides, reading, or PDF syllabus)
 * into corpus text, and report how many remain. The client cranks this in a
 * loop — same idiom as the grading analysis runner; no background jobs.
 */
export async function indexNextMaterial(
  courseId: string
): Promise<ActionResult<IndexProgress>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can index materials." };
  }

  const items = await listUnindexed(supabase, courseId);
  if (items.length === 0) {
    return { ok: true, data: { remaining: 0, indexed: null } };
  }
  const item = items[0];

  const creds = await resolveCourseAi(courseId, "extract");
  if (!creds) {
    return {
      ok: false,
      error: "Indexing needs an OpenRouter key — connect yours in AI Settings.",
    };
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(item.bucket)
    .download(item.path);
  if (downloadError || !file) {
    return { ok: false, error: `Couldn't read "${item.label}" from storage.` };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_EXTRACT_PDF_BYTES) {
    return {
      ok: false,
      error: `"${item.label}" is too large to index (28MB max) — compress it.`,
    };
  }

  const extracted = await extractPdfText(
    buffer.toString("base64"),
    item.path.split("/").pop() ?? "document.pdf",
    item.kind,
    creds
  );
  if (!extracted.ok) return { ok: false, error: extracted.error };
  const text = extracted.data.trim().slice(0, 400_000);

  if (item.kind === "syllabus") {
    const { error: saveError } = await supabase
      .from("courses")
      .update({ syllabus_text: text })
      .eq("id", courseId);
    if (saveError) return { ok: false, error: "Couldn't save the syllabus text." };
  } else {
    const { error: saveError } = await supabase
      .from("lecture_decks")
      .update(item.kind === "slides" ? { deck_text: text } : { reading_text: text })
      .eq("id", item.deckId!);
    if (saveError) return { ok: false, error: "Couldn't save the extracted text." };
  }

  revalidatePath(`/course/${courseId}/ta`);
  return {
    ok: true,
    data: { remaining: items.length - 1, indexed: item.label },
  };
}
