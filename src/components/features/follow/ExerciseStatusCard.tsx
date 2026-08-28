"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, PencilLine } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { closeExercise } from "@/server/actions/exercises";

/**
 * A running one-minute paper, watched from inside the lecture.
 *
 * Deliberately thin: how many groups have written something, and a way to
 * stop. Reading the responses properly is a Participate-page job, and
 * rebuilding that grid here would just be a second thing to keep in sync.
 */

interface Props {
  courseId: string;
  roundId: string;
  prompt: string;
  groupCount: number;
  initialAnswered: number;
  onClosed: () => void;
  /** Keeps the top-bar pill's count honest. */
  onProgress?: (answered: number) => void;
}

export function ExerciseStatusCard({
  courseId,
  roundId,
  prompt,
  groupCount,
  initialAnswered,
  onClosed,
  onProgress,
}: Props) {
  const [answered, setAnswered] = useState(initialAnswered);
  const [busy, setBusy] = useState(false);

  // Track which groups have written something. Counting ids rather than
  // incrementing keeps repeated edits from inflating the tally.
  useEffect(() => {
    const supabase = createClient();
    const written = new Set<string>();
    const channel = supabase
      .channel(`exercise-presenter-${roundId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "exercise_responses",
          filter: `round_id=eq.${roundId}`,
        },
        (payload) => {
          const row = payload.new as {
            group_id?: string;
            content?: string | null;
          } | null;
          if (!row?.group_id) return;
          if (row.content && row.content.trim().length > 0) {
            written.add(row.group_id);
          } else {
            written.delete(row.group_id);
          }
          setAnswered(written.size);
          onProgress?.(written.size);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roundId, onProgress]);

  async function handleClose() {
    if (!window.confirm("Close the exercise? Responses stop here.")) return;
    setBusy(true);
    const result = await closeExercise(courseId, roundId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Exercise closed.");
    onClosed();
  }

  return (
    <Card className="border-[var(--flame,#e0552f)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PencilLine className="size-4" /> One-minute paper — live
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="rounded-lg bg-muted p-2 text-sm">{prompt}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {answered} of {groupCount}{" "}
          {groupCount === 1 ? "group has" : "groups have"} written something
        </p>
        <div className="grid gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleClose()}
            disabled={busy}
          >
            Close exercise
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              window.open(`/course/${courseId}/participate`, "_blank")
            }
          >
            <ExternalLink className="mr-1 size-4" /> View responses
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
