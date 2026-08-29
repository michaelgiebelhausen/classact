"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X, Zap } from "lucide-react";
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
import { updateLivePoll } from "@/server/actions/polls";
import type { ActiveRound } from "@/components/features/follow/ProfessorPresenter";

const LETTERS = "ABCDEFGH";

/** What a quick-start poll opens with: students vote A–E while the professor
 *  asks the question out loud (and optionally types it in here). */
export const QUICK_POLL_DEFAULT_PROMPT = "Quick poll — pick your answer.";
export const QUICK_POLL_DEFAULT_OPTIONS = ["A", "B", "C", "D", "E"];

interface Props {
  courseId: string;
  /** The round on screen right now — the thing being edited. */
  round: ActiveRound | null;
  /** The bank question's answer key, so reopening the editor keeps it. */
  initialCorrectIndices: number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saved on the server — the presenter re-broadcasts and updates its bank. */
  onSaved: (prompt: string, options: string[], correctIndices: number[]) => void;
}

/**
 * Edits the poll that is already live (quick-start polls launch with A–E
 * before anything is typed). The professor rewrites the question and options
 * while the room discusses; Update pushes the wording to every student
 * screen mid-round.
 */
export function LivePollEditDialog({
  courseId,
  round,
  initialCorrectIndices,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  return (
    <Dialog
      open={open && Boolean(round)}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {/* Mounts fresh on every open, so the form reseeds from the live
            round without effect-driven state resets. */}
        {round && (
          <EditorForm
            courseId={courseId}
            round={round}
            initialCorrectIndices={initialCorrectIndices}
            onSaved={onSaved}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  courseId,
  round,
  initialCorrectIndices,
  onSaved,
  onClose,
}: {
  courseId: string;
  round: ActiveRound;
  initialCorrectIndices: number[];
  onSaved: (prompt: string, options: string[], correctIndices: number[]) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(
    round.prompt === QUICK_POLL_DEFAULT_PROMPT ? "" : round.prompt
  );
  const [options, setOptions] = useState<string[]>(round.options);
  const [correct, setCorrect] = useState<number[]>(initialCorrectIndices);
  const [noCorrect, setNoCorrect] = useState(
    initialCorrectIndices.length === 0
  );
  const [busy, setBusy] = useState(false);

  function toggleCorrect(index: number) {
    setCorrect((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b)
    );
  }

  function removeOption(index: number) {
    // Bare-letter placeholders re-letter to their new slot, so dropping C
    // from A–E leaves A–D on student screens, not A, B, D, E.
    setOptions((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((o, j) =>
          o.trim().length === 1 && LETTERS.includes(o.trim()) ? LETTERS[j] : o
        )
    );
    setCorrect((prev) =>
      prev.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
    );
  }

  async function handleSave() {
    const trimmedPrompt = prompt.trim() || QUICK_POLL_DEFAULT_PROMPT;
    const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
    const correctIndices = noCorrect
      ? []
      : correct.filter((i) => i < trimmedOptions.length);
    setBusy(true);
    const result = await updateLivePoll({
      courseId,
      roundId: round.id,
      prompt: trimmedPrompt,
      options: trimmedOptions,
      correctIndices,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSaved(trimmedPrompt, trimmedOptions, correctIndices);
    toast.success("Poll updated — it's on every screen.");
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit the live poll</DialogTitle>
        <DialogDescription>
          The poll is already running — students are answering right now. Your
          changes reach their screens when you press Update.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="live-poll-prompt">
            Question
          </label>
          <textarea
            id="live-poll-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Asking it out loud? Leave this blank."
            className="min-h-20 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Options</span>
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={correct.includes(i)}
                onChange={() => toggleCorrect(i)}
                disabled={noCorrect}
                aria-label={`Option ${LETTERS[i]} is correct`}
                className="size-4 accent-green-600"
              />
              <span className="w-4 text-xs text-muted-foreground">
                {LETTERS[i]}
              </span>
              <Input
                value={option}
                onChange={(e) =>
                  setOptions((prev) =>
                    prev.map((o, j) => (j === i ? e.target.value : o))
                  )
                }
                placeholder={`Option ${LETTERS[i]}`}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeOption(i)}
                disabled={options.length <= 2}
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
              setOptions((prev) =>
                prev.length < 6 ? [...prev, LETTERS[prev.length]] : prev
              )
            }
            disabled={options.length >= 6}
          >
            <Plus className="mr-1 size-4" /> Add option
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={noCorrect}
              onChange={(e) => {
                setNoCorrect(e.target.checked);
                if (e.target.checked) setCorrect([]);
              }}
              className="size-4 accent-[var(--flame,#e0552f)]"
            />
            No correct answer (opinion / discussion prompt)
          </label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => void handleSave()} disabled={busy}>
          <Zap className="mr-2 size-4" />
          {busy ? "Updating…" : "Update poll"}
        </Button>
      </DialogFooter>
    </>
  );
}
