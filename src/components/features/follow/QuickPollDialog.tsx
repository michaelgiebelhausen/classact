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
import { launchQuickPoll } from "@/server/actions/polls";
import type {
  ActiveRound,
  PresenterQuestion,
} from "@/components/features/follow/ProfessorPresenter";

const LETTERS = "ABCDEFGH";

interface Props {
  courseId: string;
  lectureId: string;
  disabled?: boolean;
  /** The poll is live — hand the round + question back to the presenter. */
  onLaunched: (round: ActiveRound, question: PresenterQuestion) => void;
}

/**
 * Impromptu mid-lecture question (ClassroomDJ's "Random DJ" idea): type it,
 * launch it, done. Saved into the deck's question bank at the current slide
 * so it shows up in the record afterward.
 */
export function QuickPollDialog({
  courseId,
  lectureId,
  disabled,
  onLaunched,
}: Props) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [correct, setCorrect] = useState<number[]>([]);
  const [noCorrect, setNoCorrect] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setPrompt("");
    setOptions(["", ""]);
    setCorrect([]);
    setNoCorrect(false);
  }

  function toggleCorrect(index: number) {
    setCorrect((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b)
    );
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index));
    setCorrect((prev) =>
      prev.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
    );
  }

  async function handleLaunch() {
    const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!noCorrect && correct.length === 0) {
      toast.error(
        'Mark a correct answer, or check "no correct answer" for an opinion poll.'
      );
      return;
    }
    const correctIndices = noCorrect ? [] : correct;
    setBusy(true);
    const result = await launchQuickPoll({
      courseId,
      lectureId,
      prompt,
      options: trimmedOptions,
      correctIndices,
    });
    setBusy(false);
    if (!result.ok || !result.data) {
      toast.error(result.ok ? "Couldn't launch the poll." : result.error);
      return;
    }
    onLaunched(
      {
        id: result.data.roundId,
        questionId: result.data.questionId,
        prompt: prompt.trim(),
        options: trimmedOptions,
        stage: "think",
        results: null,
        correctIndices: null,
      },
      {
        id: result.data.questionId,
        prompt: prompt.trim(),
        options: trimmedOptions,
        correctIndices,
        positionAfterPage: 0,
      }
    );
    toast.success("Quick poll is live.");
    reset();
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Zap className="mr-2 size-4" /> Quick poll
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quick poll</DialogTitle>
            <DialogDescription>
              Ask the room something right now — it launches immediately and
              is saved to this deck&apos;s question bank.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="quick-prompt">
                Question
              </label>
              <textarea
                id="quick-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
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
                  setOptions((prev) => (prev.length < 6 ? [...prev, ""] : prev))
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
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleLaunch()}
              disabled={busy || !prompt.trim()}
            >
              <Zap className="mr-2 size-4" />
              {busy ? "Launching…" : "Launch now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
