"use client";

import { PencilLine, Sparkles, Zap, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PresenterQuestion } from "@/components/features/follow/ProfessorPresenter";

/**
 * "Run activity" — the verb that was missing.
 *
 * Think-pair-share was fully built but could only be reached by walking onto
 * the right slide, so a professor who wanted one *now* had nowhere to click.
 * The whole choreography starts here instead: a queued question, one written
 * on the spot, or a small-group exercise.
 */

interface Props {
  /** Approved questions not yet run, in slide order. */
  queued: PresenterQuestion[];
  /** True while a poll is on screen — the command strip takes over then. */
  pollOpen: boolean;
  /** True while a group exercise is running. */
  exerciseOpen: boolean;
  busy: boolean;
  courseId: string;
  onLaunchQuestion: (question: PresenterQuestion) => void;
  /** Quick-start poll: opens on student screens with A–E before a word is typed. */
  onQuickPoll: () => void;
  /** Omitted where the group exercise isn't wired up yet. */
  onStartExercise?: () => void;
  /** Told when the menu opens or closes, so slide keys can stand down. */
  onOpenChange: (open: boolean) => void;
  /** Start with the menu open (Radix passthrough; used by tests). */
  defaultOpen?: boolean;
}

/** Questions listed inline before the menu starts pointing elsewhere. */
const SHOWN = 5;

export function RunActivityControl({
  queued,
  pollOpen,
  exerciseOpen,
  busy,
  courseId,
  onLaunchQuestion,
  onQuickPoll,
  onStartExercise,
  onOpenChange,
  defaultOpen,
}: Props) {
  // While a poll runs, its controls are the strip right below this bar.
  // Two launch surfaces disagreeing about state is its own kind of trap.
  if (pollOpen) return null;

  const shown = queued.slice(0, SHOWN);
  const hidden = queued.length - shown.length;

  return (
    <DropdownMenu defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" data-testid="run-activity">
          <Sparkles className="mr-2 size-4" /> Run activity
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Think-pair-share</DropdownMenuLabel>

        {shown.length === 0 ? (
          <DropdownMenuItem disabled>
            No approved questions for this deck yet
          </DropdownMenuItem>
        ) : (
          shown.map((q) => (
            <DropdownMenuItem
              key={q.id}
              disabled={busy}
              onSelect={() => onLaunchQuestion(q)}
              className="flex-col items-start gap-0.5"
            >
              <span className="line-clamp-2 w-full text-left">{q.prompt}</span>
              <span className="text-xs text-muted-foreground">
                After slide {q.positionAfterPage}
              </span>
            </DropdownMenuItem>
          ))
        )}
        {hidden > 0 && (
          <DropdownMenuItem disabled>
            +{hidden} more in the card below
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={busy}
          onSelect={onQuickPoll}
          className="flex-col items-start gap-0.5"
        >
          <span className="flex items-center gap-2">
            <Zap className="size-4" /> Quick poll — starts now
          </span>
          <span className="pl-6 text-xs text-muted-foreground">
            Students get A–E instantly; edit the question while they answer
          </span>
        </DropdownMenuItem>
        {onStartExercise && (
          <DropdownMenuItem
            disabled={busy || exerciseOpen}
            onSelect={onStartExercise}
            className="flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-2">
              <PencilLine className="size-4" /> One-minute paper…
            </span>
            {exerciseOpen && (
              <span className="pl-6 text-xs text-muted-foreground">
                One is already running
              </span>
            )}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/*
          A new tab on purpose: mid-lecture, navigating the presenter away
          would end the thing they're standing in front of.
        */}
        <DropdownMenuItem
          onSelect={() =>
            window.open(`/course/${courseId}/participate`, "_blank")
          }
        >
          <ExternalLink /> Manage question bank
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
