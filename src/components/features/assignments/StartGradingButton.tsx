"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { advanceAnalysis } from "@/server/actions/grading";

/**
 * Kicks off grading on the professor's command. Nothing runs after the
 * deadline until this is clicked. The first advanceAnalysis call flips the
 * assignment out of "open" — which is what closes the late-submission window —
 * and runs the first chunk; the refresh then re-renders under "analyzing",
 * where AnalysisRunner takes over and cranks the rest to peer grading.
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
      {starting ? "Starting…" : "Start grading"}
    </Button>
  );
}
