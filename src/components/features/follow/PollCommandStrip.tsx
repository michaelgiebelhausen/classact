"use client";

import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { nextStageAction, STAGE_CHIP } from "@/lib/presenternav";
import type { PollStage } from "@/types/db";

/**
 * The poll's controls, pinned where the professor is already looking.
 *
 * The detail card lower down has everything, but during a live class nobody
 * scrolls — the room is watching. So the current question, where it is in the
 * choreography, the next move, and above all the way *out* live up here in
 * the control bar and never leave the screen.
 */

interface Props {
  prompt: string;
  stage: PollStage;
  /** Students who have answered the phase currently being collected. */
  answered: number;
  /** Students on the roster, for the "12 of 30" reading. */
  total: number;
  busy: boolean;
  onAdvanceStage: (stage: "pair" | "revote") => void;
  onReveal: () => void;
  onResume: () => void;
  /** Close the round and go back to slides, from any stage. */
  onEndPoll: () => void;
  /** Reopen the live editor — absent once results are on screen. */
  onEdit?: () => void;
}

export function PollCommandStrip({
  prompt,
  stage,
  answered,
  total,
  busy,
  onAdvanceStage,
  onReveal,
  onResume,
  onEndPoll,
  onEdit,
}: Props) {
  const action = nextStageAction(stage);
  if (!action) return null;

  function runPrimary() {
    if (!action) return;
    if (action.kind === "stage" && action.stage) onAdvanceStage(action.stage);
    else if (action.kind === "reveal") onReveal();
    else if (action.kind === "resume") onResume();
  }

  return (
    <div
      data-testid="poll-command-strip"
      className="flex w-full flex-wrap items-center gap-2 border-t border-[var(--flame,#e0552f)]/40 pt-2"
    >
      <Badge
        variant="outline"
        className="border-[var(--flame,#e0552f)]/50 text-[var(--flame,#e0552f)]"
      >
        <span
          aria-hidden
          className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-[var(--flame,#e0552f)]"
        />
        Live poll
      </Badge>

      <p className="min-w-0 flex-1 truncate text-sm" title={prompt}>
        {prompt}
      </p>

      {onEdit && (
        <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}>
          <PencilLine className="mr-1.5 size-4" /> Edit question
        </Button>
      )}

      <span className="text-xs tabular-nums text-muted-foreground">
        {STAGE_CHIP[stage]} · {answered} of {total} answered
      </span>

      <Button size="sm" onClick={runPrimary} disabled={busy}>
        {action.label}
      </Button>

      {/*
        The escape hatch. It was a grey ghost link below the fold the day a
        lecture had to be abandoned, so here it is a real button that is
        present at every stage and never needs scrolling to find.
      */}
      <Button size="sm" variant="outline" onClick={onEndPoll} disabled={busy}>
        End poll &amp; show slides
      </Button>
    </div>
  );
}
