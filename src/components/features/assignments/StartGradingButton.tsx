"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { advanceAnalysis } from "@/server/actions/grading";

/**
 * Starts grading now instead of waiting for the next tick (which starts it on
 * its own within a minute of the deadline). The first advanceAnalysis call
 * flips the assignment to "analyzing" and runs the first chunk; the refresh
 * then re-renders under "analyzing", where AnalysisRunner shows progress.
 * Late work stays open either way, until the professor publishes.
 */
export function StartGradingButton({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    let result: Awaited<ReturnType<typeof advanceAnalysis>>;
    try {
      result = await advanceAnalysis(assignmentId);
    } catch {
      setStarting(false);
      toast.error("Couldn't reach the server — try again.");
      return;
    }
    if (result.ok) {
      // Leave the button disabled: the refresh re-renders into AnalysisRunner.
      router.refresh();
    } else {
      setStarting(false);
      toast.error(result.error);
    }
  }

  return (
    <Button onClick={() => void start()} disabled={starting} size="lg">
      {starting ? "Starting…" : "Start now"}
    </Button>
  );
}
