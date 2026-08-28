"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { startExercise } from "@/server/actions/exercises";
import { capture } from "@/lib/analytics";

/**
 * Start a one-minute paper without leaving the lecture.
 *
 * The exercise itself was already built, but the only way in was the
 * Participate page — which meant walking away from the deck you're
 * presenting to start a two-minute activity.
 */

export interface StartedExercise {
  roundId: string;
  prompt: string;
  groupCount: number;
}

interface Props {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (exercise: StartedExercise) => void;
}

export function ExerciseLaunchDialog({
  courseId,
  open,
  onOpenChange,
  onStarted,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("4");
  const [busy, setBusy] = useState(false);

  async function handleStart() {
    setBusy(true);
    const result = await startExercise({
      courseId,
      prompt,
      targetSize: Number(size) || 4,
    });
    setBusy(false);
    if (!result.ok || !result.data) {
      // Keep the dialog up: the server's reasons are all fixable in the room
      // (open a session, get people checked in), and retyping the prompt
      // while a class waits is its own small punishment.
      toast.error(result.ok ? "Couldn't start the exercise." : result.error);
      return;
    }
    toast.success(
      `Exercise started — ${result.data.groupCount} ${
        result.data.groupCount === 1 ? "group" : "groups"
      } formed.`
    );
    capture("exercise_started", { from: "presenter" });
    onStarted({
      roundId: result.data.roundId,
      prompt: prompt.trim(),
      groupCount: result.data.groupCount,
    });
    setPrompt("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>One-minute paper</DialogTitle>
          <DialogDescription>
            Groups come from the latest class session&apos;s check-ins — who is
            actually sitting near whom.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="exercise-prompt">Prompt</Label>
            <Textarea
              id="exercise-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="In one minute, together: what's the strongest objection to this argument?"
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="exercise-size">Students per group</Label>
            <Input
              id="exercise-size"
              type="number"
              min={2}
              max={8}
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-24"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleStart()}
            disabled={busy || prompt.trim().length < 3}
          >
            Start exercise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
