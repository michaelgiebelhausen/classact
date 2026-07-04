"use client";

import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PollResults } from "@/types/db";

const LETTERS = "ABCDEFGH";

interface Props {
  options: string[];
  results: PollResults | null;
  correctIndices: number[] | null;
  /** Professor reveal: click an option to mark it correct. */
  onSelectOption?: (index: number) => void;
  /** dark = projector stage; light = app cards. */
  variant?: "light" | "dark";
  className?: string;
}

/**
 * Before/after distribution for a think-pair-share round: for each option,
 * the think-stage bar (muted) above the re-vote bar (strong), per Peer
 * Instruction practice of showing how discussion moved the class.
 */
export function PollResultsChart({
  options,
  results,
  correctIndices,
  onSelectOption,
  variant = "light",
  className,
}: Props) {
  const think = results?.think ?? options.map(() => 0);
  const revote = results?.revote ?? options.map(() => 0);
  const thinkTotal = think.reduce((a, b) => a + b, 0);
  const revoteTotal = revote.reduce((a, b) => a + b, 0);
  const hasRevote = revoteTotal > 0;
  const dark = variant === "dark";

  function pct(count: number, total: number): number {
    return total > 0 ? Math.round((count / total) * 100) : 0;
  }

  return (
    <div className={cn("grid gap-3", className)}>
      {options.map((option, i) => {
        const isCorrect = correctIndices?.includes(i) ?? false;
        const rowInner = (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  "text-sm font-medium",
                  dark && "text-lg",
                  isCorrect && (dark ? "text-green-400" : "text-green-700")
                )}
              >
                {LETTERS[i]}. {option}
                {isCorrect && (
                  <CheckCircle2 className="ml-1.5 inline size-4 align-[-2px]" />
                )}
              </span>
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums",
                  dark ? "text-white/60" : "text-muted-foreground"
                )}
              >
                {hasRevote
                  ? `${pct(think[i], thinkTotal)}% → ${pct(revote[i], revoteTotal)}%`
                  : `${pct(think[i], thinkTotal)}% (${think[i]})`}
              </span>
            </div>
            <div className="grid gap-1">
              <div
                className={cn(
                  "h-2 overflow-hidden rounded-full",
                  dark ? "bg-white/10" : "bg-muted"
                )}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    dark ? "bg-white/35" : "bg-foreground/25"
                  )}
                  style={{ width: `${pct(think[i], thinkTotal)}%` }}
                />
              </div>
              {hasRevote && (
                <div
                  className={cn(
                    "h-2 overflow-hidden rounded-full",
                    dark ? "bg-white/10" : "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isCorrect ? "bg-green-500" : "bg-[var(--flame,#e0552f)]"
                    )}
                    style={{ width: `${pct(revote[i], revoteTotal)}%` }}
                  />
                </div>
              )}
            </div>
          </>
        );

        return onSelectOption ? (
          <button
            key={i}
            type="button"
            onClick={() => onSelectOption(i)}
            className={cn(
              "grid gap-1 rounded-lg border p-2 text-left transition-colors",
              isCorrect
                ? "border-green-500/60 bg-green-500/5"
                : "hover:border-foreground/30"
            )}
            aria-label={`Mark option ${LETTERS[i]} ${isCorrect ? "incorrect" : "correct"}`}
          >
            {rowInner}
          </button>
        ) : (
          <div key={i} className="grid gap-1">
            {rowInner}
          </div>
        );
      })}
      <p
        className={cn(
          "text-xs",
          dark ? "text-white/50" : "text-muted-foreground"
        )}
      >
        {hasRevote
          ? `Top bar: first vote (${thinkTotal}) · bottom: after discussion (${revoteTotal})`
          : `${thinkTotal} first-vote ${thinkTotal === 1 ? "answer" : "answers"}`}
      </p>
    </div>
  );
}
