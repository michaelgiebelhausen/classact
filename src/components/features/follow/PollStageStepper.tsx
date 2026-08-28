"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PollStage } from "@/types/db";

/**
 * Where this question is in the think-pair-share arc, and what comes next.
 *
 * The stage buttons only appear one at a time, so a professor meeting the
 * feature mid-round had no way to know that "Pair & discuss" was coming —
 * they had to discover each step by arriving at it. This shows the whole
 * shape up front.
 */

const STEPS: Array<{ key: PollStage; label: string }> = [
  { key: "think", label: "Think" },
  { key: "pair", label: "Pair & discuss" },
  { key: "revote", label: "Re-vote" },
  { key: "reveal", label: "Reveal" },
];

export function PollStageStepper({
  stage,
  className,
}: {
  stage: PollStage;
  className?: string;
}) {
  const current = STEPS.findIndex((s) => s.key === stage);
  if (current === -1) return null;

  return (
    <ol
      data-testid="poll-stage-stepper"
      className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}
    >
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step.key}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border text-[10px] tabular-nums",
                active && "border-[var(--flame,#e0552f)] text-[var(--flame,#e0552f)]",
                done && "border-transparent bg-muted"
              )}
            >
              {done ? <Check className="size-2.5" /> : i + 1}
            </span>
            {step.label}
            {i < STEPS.length - 1 && (
              <span aria-hidden className="ml-1 text-muted-foreground/40">
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
