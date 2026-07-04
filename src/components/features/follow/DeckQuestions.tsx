"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createQuestion,
  deleteQuestion,
  generateDeckQuestions,
  setQuestionApproved,
  updateQuestion,
} from "@/server/actions/polls";
import { capture } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const LETTERS = "ABCDEFGH";

export interface QuestionItem {
  id: string;
  prompt: string;
  options: string[];
  correctIndices: number[];
  rationale: string | null;
  positionAfterPage: number;
  approved: boolean;
  source: "ai" | "professor";
}

interface Props {
  courseId: string;
  deckId: string;
  deckKind: "pdf" | "google_slides";
  pageCount: number | null;
  readingTitle: string | null;
  questions: QuestionItem[];
}

interface DraftQuestion {
  id: string | null; // null = adding new
  prompt: string;
  options: string[];
  correctIndices: number[];
  /** True = opinion question, no answer key. */
  noCorrect: boolean;
  positionAfterPage: number;
  rationale: string | null;
}

/**
 * The think-pair-share bank under a deck in "Your decks": collapsible list of
 * AI drafts + custom questions with approve / edit / delete / add, plus the
 * Reading/Reference PDF attachment that grounds AI generation.
 */
export function DeckQuestions({
  courseId,
  deckId,
  deckKind,
  pageCount,
  readingTitle,
  questions,
}: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(questions.length > 0);
  const [generating, setGenerating] = useState(false);
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftQuestion | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const approvedCount = questions.filter((q) => q.approved).length;
  const sorted = [...questions].sort(
    (a, b) => a.positionAfterPage - b.positionAfterPage
  );

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = await generateDeckQuestions(courseId, deckId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const count = result.data?.count ?? 0;
      capture("tps_questions_generated", { count });
      toast.success(
        `Drafted ${count} think-pair-share questions — all approved and ready to run; uncheck any you don't want in class.`
      );
      setExpanded(true);
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(question: QuestionItem, approved: boolean) {
    setBusyQuestion(question.id);
    const result = await setQuestionApproved(courseId, question.id, approved);
    setBusyQuestion(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(question: QuestionItem) {
    if (!window.confirm("Delete this question? This can't be undone.")) return;
    setBusyQuestion(question.id);
    const result = await deleteQuestion(courseId, question.id);
    setBusyQuestion(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Question deleted.");
    router.refresh();
  }

  async function handleSaveDraft() {
    if (!draft) return;
    if (!draft.noCorrect && draft.correctIndices.length === 0) {
      toast.error(
        'Mark a correct answer, or check "no correct answer" for an opinion question.'
      );
      return;
    }
    setSavingDraft(true);
    try {
      const payload = {
        courseId,
        prompt: draft.prompt,
        options: draft.options,
        correctIndices: draft.noCorrect ? [] : draft.correctIndices,
        positionAfterPage: draft.positionAfterPage,
      };
      const result = draft.id
        ? await updateQuestion({ ...payload, questionId: draft.id })
        : await createQuestion({ ...payload, deckId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(draft.id ? "Question updated." : "Question added.");
      setDraft(null);
      router.refresh();
    } finally {
      setSavingDraft(false);
    }
  }

  function updateDraftOption(index: number, value: string) {
    setDraft((d) =>
      d
        ? { ...d, options: d.options.map((o, i) => (i === index ? value : o)) }
        : d
    );
  }

  function toggleDraftCorrect(index: number) {
    setDraft((d) => {
      if (!d) return d;
      const has = d.correctIndices.includes(index);
      return {
        ...d,
        correctIndices: has
          ? d.correctIndices.filter((i) => i !== index)
          : [...d.correctIndices, index].sort((a, b) => a - b),
      };
    });
  }

  function removeDraftOption(index: number) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        options: d.options.filter((_, i) => i !== index),
        correctIndices: d.correctIndices
          .filter((i) => i !== index)
          .map((i) => (i > index ? i - 1 : i)),
      };
    });
  }

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          {questions.length === 0
            ? "Think-pair-share questions"
            : `${questions.length} question${questions.length === 1 ? "" : "s"} · ${approvedCount} approved`}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {deckKind === "pdf" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleGenerate()}
              disabled={generating}
            >
              <Sparkles className="mr-1 size-4" />
              {generating ? "Reading your slides…" : "Generate questions"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft({
                id: null,
                prompt: "",
                options: ["", "", ""],
                correctIndices: [],
                noCorrect: false,
                positionAfterPage: 1,
                rationale: null,
              })
            }
            aria-label="Add a custom question"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <ul className="mt-2 grid gap-1.5">
          {sorted.length === 0 && (
            <li className="text-xs text-muted-foreground">
              No questions yet — hit Generate to draft some from your slides
              {readingTitle ? " and the reading" : ""}, or add your own with +.
            </li>
          )}
          {sorted.length > 0 && approvedCount === 0 && (
            <li className="text-xs text-muted-foreground">
              Check the box to approve a question — only approved questions
              pop into the lecture.
            </li>
          )}
          {sorted.map((q) => (
            <li
              key={q.id}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2",
                !q.approved && "opacity-70"
              )}
            >
              <input
                type="checkbox"
                checked={q.approved}
                onChange={(e) => void handleApprove(q, e.target.checked)}
                disabled={busyQuestion === q.id}
                title={
                  q.approved
                    ? "Approved — will run in lecture"
                    : "Approve to run in lecture"
                }
                aria-label={`Approve question: ${q.prompt.slice(0, 60)}`}
                className="mt-1 size-4 accent-[var(--flame,#e0552f)]"
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm">{q.prompt}</p>
                <p className="text-xs text-muted-foreground">
                  After slide {q.positionAfterPage} · {q.options.length} options
                  {q.correctIndices.length === 0 && " · opinion"}
                  {q.source === "ai" && " · AI draft"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      id: q.id,
                      prompt: q.prompt,
                      options: [...q.options],
                      correctIndices: [...q.correctIndices],
                      noCorrect: q.correctIndices.length === 0,
                      positionAfterPage: q.positionAfterPage,
                      rationale: q.rationale,
                    })
                  }
                  disabled={busyQuestion === q.id}
                  aria-label="Edit question"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleDelete(q)}
                  disabled={busyQuestion === q.id}
                  aria-label="Delete question"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Edit question" : "Add a question"}
            </DialogTitle>
            <DialogDescription>
              Aim for a concept students argue about — best results when 35–70%
              get it right before discussing.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="tps-prompt">
                  Question
                </label>
                <textarea
                  id="tps-prompt"
                  value={draft.prompt}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, prompt: e.target.value } : d))
                  }
                  className="min-h-20 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">
                  Options — check the correct answer(s)
                </span>
                {draft.options.map((option, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.correctIndices.includes(i)}
                      onChange={() => toggleDraftCorrect(i)}
                      disabled={draft.noCorrect}
                      aria-label={`Option ${LETTERS[i]} is correct`}
                      className="size-4 accent-green-600"
                    />
                    <span className="w-4 text-xs text-muted-foreground">
                      {LETTERS[i]}
                    </span>
                    <Input
                      value={option}
                      onChange={(e) => updateDraftOption(i, e.target.value)}
                      placeholder={`Option ${LETTERS[i]}`}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeDraftOption(i)}
                      disabled={draft.options.length <= 2}
                      aria-label={`Remove option ${LETTERS[i]}`}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-self-start"
                  onClick={() =>
                    setDraft((d) =>
                      d && d.options.length < 6
                        ? { ...d, options: [...d.options, ""] }
                        : d
                    )
                  }
                  disabled={draft.options.length >= 6}
                >
                  <Plus className="mr-1 size-4" /> Add option
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.noCorrect}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              noCorrect: e.target.checked,
                              correctIndices: e.target.checked
                                ? []
                                : d.correctIndices,
                            }
                          : d
                      )
                    }
                    className="size-4 accent-[var(--flame,#e0552f)]"
                  />
                  No correct answer (opinion / discussion prompt)
                </label>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="tps-position">
                  Appears after slide
                </label>
                <Input
                  id="tps-position"
                  type="number"
                  min={1}
                  max={pageCount ?? 2000}
                  value={draft.positionAfterPage}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            positionAfterPage: Math.max(
                              1,
                              Math.round(Number(e.target.value) || 1)
                            ),
                          }
                        : d
                    )
                  }
                  className="max-w-28"
                />
                <p className="text-xs text-muted-foreground">
                  The question interrupts the lecture right after this slide
                  {pageCount ? ` (deck has ${pageCount})` : ""}. Keep activities
                  no more than ~15 minutes apart.
                </p>
              </div>
              {draft.rationale && (
                <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  <Sparkles className="mr-1 inline size-3" />
                  {draft.rationale}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveDraft()}
              disabled={savingDraft}
            >
              {savingDraft ? "Saving…" : "Save question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
