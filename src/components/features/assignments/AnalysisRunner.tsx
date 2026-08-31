"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { advanceAnalysis } from "@/server/actions/grading";

/**
 * Turns the analysis crank once the professor has kicked grading off: polls
 * advanceAnalysis (each call is one bounded chunk) until peer grading opens,
 * then refreshes. The professor's open page drives it — advanceAnalysis is
 * professor-only, and this renders only for them.
 */

const PHASE_LABELS: Record<string, string> = {
  rubric: "Reading the class's taste files — the rubric is emerging",
  baselines: "Preparing generic one-shot baselines",
  scoring: "Grading each submission against the class rubric",
  shingle: "Checking submissions for unusual similarity",
  pairs: "Building the draft ranking and assigning peer pairs",
  done: "Done",
};

export function AnalysisRunner({
  assignmentId,
  currentState = "analyzing",
}: {
  assignmentId: string;
  /** The state the page rendered under — refresh only on transitions. */
  currentState?: string;
}) {
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
        if (data.state !== "analyzing" && data.state !== currentState) {
          // Transitioned (e.g. → peer_review, or → awaiting_key): re-render.
          router.refresh();
          break;
        }
        // Paused on a missing key: retry slowly; otherwise keep cranking.
        await new Promise((r) =>
          setTimeout(r, data.state === "awaiting_key" ? 30_000 : 1500)
        );
      }
      running.current = false;
    }
    void crank();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, currentState, router]);

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
          Keep this page open until it finishes — it grades in the background.
        </p>
      </CardContent>
    </Card>
  );
}
