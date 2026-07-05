"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PencilLine, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { closeExercise, startExercise } from "@/server/actions/exercises";

export interface ExerciseGroupView {
  id: string;
  label: string;
  memberNames: string[];
  response: string;
}

export interface OpenExerciseView {
  roundId: string;
  prompt: string;
  groups: ExerciseGroupView[];
}

interface Props {
  courseId: string;
  round: OpenExerciseView | null;
}

/**
 * Professor's one-minute-paper console on the Participate page: pose a prompt
 * (groups form from who's checked in and where they're sitting), then watch
 * every group's shared response come in live.
 */
export function ExerciseProfessor({ courseId, round }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [groupSize, setGroupSize] = useState("4");
  const [busy, setBusy] = useState(false);

  // Live responses as groups scribe them.
  useEffect(() => {
    if (!round) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`exercise-prof-${round.roundId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "exercise_responses",
          filter: `round_id=eq.${round.roundId}`,
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [round, router]);

  async function handleStart() {
    const text = prompt.trim();
    if (text.length < 3) {
      toast.error("Give the exercise a prompt.");
      return;
    }
    setBusy(true);
    const result = await startExercise({
      courseId,
      prompt: text,
      targetSize: Number(groupSize) || 4,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPrompt("");
    toast.success(
      `Exercise started — ${result.data?.groupCount ?? 0} groups formed from the room.`
    );
    router.refresh();
  }

  async function handleClose() {
    if (!round) return;
    if (!window.confirm("Close this exercise? Responses will freeze.")) return;
    setBusy(true);
    const result = await closeExercise(courseId, round.roundId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Exercise closed.");
    router.refresh();
  }

  if (round) {
    const answered = round.groups.filter((g) => g.response.trim()).length;
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>One-minute paper — live</CardTitle>
              <CardDescription>
                {answered} of {round.groups.length} groups have written
                something. Updates arrive as they type.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => void handleClose()} disabled={busy}>
              Close exercise
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="rounded-lg bg-muted p-3 text-sm font-medium">
            <PencilLine className="mr-1 inline size-4" />
            {round.prompt}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {round.groups.map((g) => (
              <div key={g.id} className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Users className="size-4 text-muted-foreground" />
                  {g.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {g.memberNames.join(", ")}
                  </span>
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {g.response.trim() || (
                    <span className="italic">Nothing yet…</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Small-group exercise (one-minute paper)</CardTitle>
        <CardDescription>
          Pose a quick prompt — the system sorts checked-in students into small
          groups by where they&apos;re sitting, and each group writes one shared
          response. Great for a mid-lecture whiteboard prep.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. In one sentence, what's the single most important idea from the last ten minutes?"
          className="min-h-20 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="ex-size"
            >
              Group size
            </label>
            <Input
              id="ex-size"
              type="number"
              min={2}
              max={8}
              value={groupSize}
              onChange={(e) => setGroupSize(e.target.value)}
              className="max-w-24"
            />
          </div>
          <Button onClick={() => void handleStart()} disabled={busy}>
            {busy ? "Forming groups…" : "Start exercise"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Groups come from the latest class session&apos;s check-ins, so open
          today&apos;s session and let students check in first.
        </p>
      </CardContent>
    </Card>
  );
}
