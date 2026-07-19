"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The comparison surface professors and peers share: two anonymous PDFs
 * side by side, one five-position verdict scale running worse → better,
 * left → right (like every axis in the product). The verdict describes the
 * RIGHT document relative to the LEFT.
 */

export const VERDICT_LABELS = [
  "Right is clearly worse",
  "Right is slightly worse",
  "They're equal",
  "Right is slightly better",
  "Right is clearly better",
];

interface Props {
  leftUrl: string | null;
  rightUrl: string | null;
  verdict: number | null;
  busy: boolean;
  onVerdict: (verdict: number) => void;
}

export function ComparePair({ leftUrl, rightUrl, verdict, busy, onVerdict }: Props) {
  const [selected, setSelected] = useState<number | null>(verdict);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {[
          { label: "Left", url: leftUrl },
          { label: "Right", url: rightUrl },
        ].map((side) => (
          <Card key={side.label} className="overflow-hidden">
            <CardContent className="p-0">
              <p className="border-b px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {side.label}
              </p>
              {side.url ? (
                <iframe
                  src={side.url}
                  title={`${side.label} submission`}
                  className="h-[540px] w-full"
                />
              ) : (
                <div className="grid h-[540px] place-items-center text-sm text-muted-foreground">
                  Loading PDF…
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-3 py-4">
          <div
            role="radiogroup"
            aria-label="How does the right submission compare to the left?"
            className="flex items-center justify-between gap-2"
          >
            <span className="hidden text-xs text-muted-foreground sm:block">
              Right is clearly worse
            </span>
            <div className="flex flex-1 items-center justify-center gap-4">
              {[-2, -1, 0, 1, 2].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected === value}
                  aria-label={VERDICT_LABELS[value + 2]}
                  title={VERDICT_LABELS[value + 2]}
                  onClick={() => setSelected(value)}
                  className={[
                    "size-6 rounded-full border-2 transition-all",
                    selected === value
                      ? "scale-125 border-primary bg-primary"
                      : "border-muted-foreground/40 bg-card hover:border-primary",
                    value === 0 ? "size-5" : "",
                  ].join(" ")}
                />
              ))}
            </div>
            <span className="hidden text-xs text-muted-foreground sm:block">
              Right is clearly better
            </span>
          </div>
          <p className="text-center text-sm font-medium">
            {selected !== null
              ? VERDICT_LABELS[selected + 2]
              : "Slide your call — equal is a real answer"}
          </p>
          <div className="flex justify-center">
            <Button
              onClick={() => selected !== null && onVerdict(selected)}
              disabled={selected === null || busy}
            >
              {busy ? "Recording…" : verdict !== null ? "Update my call" : "Submit my call"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
