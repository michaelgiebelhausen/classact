"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { advanceAnalysis } from "@/server/actions/grading";

/**
 * Turns the analysis crank after the deadline: polls advanceAnalysis (each
 * call is one bounded chunk) until peer grading opens, then refreshes.
 * Whoever has the page open drives it — no cron, no professor required.
 */

const PHASE_LABELS: Record<string, string> = {
  rubric: "Reading the class's taste files — the rubric is emerging",
  baselines: "Preparing generic one-shot baselines",
  scoring: "Grading each submission against the class rubric",
  shingle: "Checking submissions for unusual similarity",
  pairs: "Building the draft ranking and assigning peer pairs",
  done: "Done",
};

export function AnalysisRunner({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState("rubric");
  const [progress, setProgress] = useState<{ scored: number; total: number }>({
    scored: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function crank() {
      if (running.current) return;
      running.current = true;
      while (!cancelled) {
        const result = await advanceAnalysis(assignmentId);
        if (cancelled) break;
        if (!result.ok) {
          setError(result.error);
          // Back off, then retry.
          await new Promise((r) => setTimeout(r, 8000));
          setError(null);
          continue;
        }
        const data = result.data!;
        setPhase(data.phase);
        if (data.total >= 0) setProgress({ scored: data.scored, total: data.total });
        if (data.state !== "analyzing") {
          router.refresh();
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      running.current = false;
    }
    void crank();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, router]);

  return (
    <Card>
      <CardContent className="grid gap-2 py-10 text-center">
        <p className="font-medium">
          {PHASE_LABELS[phase] ?? "Analyzing the class's work…"}
        </p>
        {phase === "scoring" && progress.total > 0 && (
          <p className="text-sm text-muted-foreground">
            {progress.scored} of {progress.total} submissions scored
          </p>
        )}
        {error && <p className="text-sm text-muted-foreground">{error}</p>}
        <p className="text-xs text-muted-foreground">
          This runs on its own — keeping the page open speeds it up.
        </p>
      </CardContent>
    </Card>
  );
}
