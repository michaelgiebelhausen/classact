"use client";

import { Button } from "@/components/ui/button";

/**
 * "There's a question here — want to run it?"
 *
 * Questions used to insert themselves the instant a slide was crossed, which
 * meant the projector could change to something the professor hadn't chosen
 * and couldn't dismiss. Now the boundary just knocks, and the lecture only
 * changes when someone says yes.
 */

interface Props {
  /** The question that would run, for a look-before-you-leap preview. */
  prompt: string;
  /** How many questions are waiting at this boundary (usually one). */
  count: number;
  /**
   * True when the slide already moved — the stage window advanced on its own,
   * so this is an after-the-fact offer rather than a held boundary.
   */
  alreadyAdvanced: boolean;
  /** Slide the professor lands on by declining (unused when alreadyAdvanced). */
  nextPage: number;
  busy: boolean;
  onRun: () => void;
  onSkip: () => void;
}

export function PollOfferStrip({
  prompt,
  count,
  alreadyAdvanced,
  nextPage,
  busy,
  onRun,
  onSkip,
}: Props) {
  return (
    <div
      data-testid="poll-offer-strip"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--flame,#e0552f)]/40 bg-[var(--flame,#e0552f)]/5 px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">
            {alreadyAdvanced
              ? "Question queued for the previous slide."
              : "Question queued here."}
          </span>{" "}
          <span className="text-muted-foreground" title={prompt}>
            {prompt}
          </span>
          {count > 1 && (
            <span className="text-muted-foreground"> (+{count - 1} more)</span>
          )}
        </p>
        {!alreadyAdvanced && (
          <p className="text-xs text-muted-foreground">
            Pressing → again also continues.
          </p>
        )}
      </div>

      <Button size="sm" onClick={onRun} disabled={busy}>
        Run question
      </Button>
      <Button size="sm" variant="outline" onClick={onSkip} disabled={busy}>
        {alreadyAdvanced ? "Dismiss" : `Continue to slide ${nextPage}`}
      </Button>
    </div>
  );
}
