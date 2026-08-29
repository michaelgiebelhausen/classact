/**
 * Ask-the-TA corpus assembly. Pure functions (tested) — the server wraps
 * these with data fetching and the model call. The corpus is the ONLY thing
 * the TA is allowed to know, so what goes in is an explicit allowlist:
 * syllabus, assignment instructions, slide text, transcripts, readings.
 * Never deck_questions (it holds answer keys) and never grading internals.
 */

export interface CorpusSource {
  /** Bracketed citation label, e.g. `[Lecture 3 slides "Pricing"]`. */
  label: string
  text: string
}

/** Keep any single source from crowding out the rest of the course. */
export const SOURCE_CHAR_CAP = 60_000
/** ~50k tokens of context — cheap once the prefix is cache-hit. */
export const CORPUS_CHAR_BUDGET = 200_000

export interface AssembledCorpus {
  text: string
  /** Labels that didn't fit the budget (newest-last ordering decides). */
  dropped: string[]
}

/**
 * Concatenate labeled sources under the budget. Order matters: callers put
 * must-keep material (syllabus, assignments) first and older lectures last,
 * so when a semester outgrows the budget it's the oldest lectures that fall
 * off. Dropped labels are reported so the TA can say what it can't see.
 */
export function assembleCorpus(
  sources: CorpusSource[],
  budget: number = CORPUS_CHAR_BUDGET
): AssembledCorpus {
  const parts: string[] = []
  const dropped: string[] = []
  let used = 0
  for (const source of sources) {
    const body = source.text.trim()
    if (!body) continue
    const capped =
      body.length > SOURCE_CHAR_CAP
        ? `${body.slice(0, SOURCE_CHAR_CAP)}\n[…truncated]`
        : body
    const block = `===== ${source.label} =====\n${capped}\n`
    if (used + block.length > budget) {
      dropped.push(source.label)
      continue
    }
    parts.push(block)
    used += block.length
  }
  return { text: parts.join("\n"), dropped }
}

/** The TA's standing orders. Grounding is the whole product: an answer that
 *  isn't in the materials must say so instead of guessing. */
export function taSystemPrompt(courseName: string, dropped: string[]): string {
  const droppedNote =
    dropped.length > 0
      ? `\nNot loaded (course too large for one context): ${dropped.join(", ")}. If a question likely depends on these, say you can't see them.`
      : ""
  return [
    `You are the course TA for "${courseName}". Below are the course materials, each section headed by its citation label in ===== markers.`,
    ``,
    `Rules:`,
    `- Answer ONLY from these materials. They are the entire extent of what you know about this course.`,
    `- Cite the label(s) you drew from inline, e.g. "Late work loses 10% per day [Syllabus]."`,
    `- If the materials don't cover the question, say: "I don't see this in the course materials — ask your professor." Do not guess, extrapolate policy, or fill gaps with general knowledge.`,
    `- General study help (explaining a concept that IS in the slides, quizzing the student on covered material) is fine — stay anchored to what the materials say.`,
    `- Never speculate about grades, other students, or anything not in the materials.`,
    `- Be concise and warm. Plain text, no markdown headings.`,
    droppedNote,
  ].join("\n")
}
