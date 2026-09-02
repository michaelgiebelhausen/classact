"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MonitorPlay, PencilLine, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { saveExerciseResponse } from "@/server/actions/exercises";

export interface MyExerciseGroup {
  groupId: string;
  label: string;
  prompt: string;
  memberNames: string[];
  response: string;
}

interface Props {
  courseId: string;
  /** The open round, watched so the card can tell when the professor ends it. */
  roundId: string;
  /** The caller's group for the open round, or null if they weren't grouped. */
  group: MyExerciseGroup | null;
  /** True when an exercise is open but the student has no group (didn't check in). */
  openButUngrouped: boolean;
  /** True while a lecture is running, so "back to the lecture" leads somewhere. */
  lectureLive: boolean;
}

const SAVE_DEBOUNCE_MS = 700;

/**
 * Student's one-minute-paper card: shows the group they've been placed in and
 * a shared response box. Any group member can scribe; the box autosaves and
 * syncs to teammates via realtime (their edits land only while you're not
 * actively typing, so nobody clobbers your sentence mid-word).
 */
export function ExerciseStudent({
  courseId,
  roundId,
  group,
  openButUngrouped,
  lectureLive,
}: Props) {
  const [content, setContent] = useState(group?.response ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [closed, setClosed] = useState(false);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupId = group?.groupId ?? null;

  const save = useCallback(
    async (text: string) => {
      if (!groupId) return;
      setStatus("saving");
      const result = await saveExerciseResponse(courseId, groupId, text);
      setStatus(result.ok ? "saved" : "idle");
    },
    [courseId, groupId]
  );

  // A teammate's edits — apply only when you're not mid-sentence yourself.
  useEffect(() => {
    if (!groupId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`exercise-student-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "exercise_responses",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const next = (payload.new as { content?: string })?.content ?? "";
          if (!focusedRef.current) setContent(next);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);

  /*
    The professor ending the round is the student's cue to go back. Without
    this the card sat there looking live, and every keystroke after it saved
    into a rejection nobody surfaced.
  */
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`exercise-round-${roundId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "exercise_rounds",
          filter: `id=eq.${roundId}`,
        },
        (payload) => {
          if ((payload.new as { stage?: string })?.stage !== "open") {
            if (timerRef.current) clearTimeout(timerRef.current);
            setStatus("idle");
            setClosed(true);
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roundId]);

  function onChange(text: string) {
    if (closed) return;
    setContent(text);
    setStatus("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(text), SAVE_DEBOUNCE_MS);
  }

  const backToLecture = lectureLive ? (
    <Button asChild size="sm">
      <Link href={`/course/${courseId}/follow`}>
        <MonitorPlay className="size-4" />
        Back to the lecture
      </Link>
    </Button>
  ) : null;

  // Once it's over there is nothing here for someone who was never grouped.
  if (openButUngrouped) {
    if (closed) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>A group exercise is running</CardTitle>
          <CardDescription>
            You&apos;re not in a group for it — groups are formed from students
            who checked in. Check in on the Check In page and ask your professor
            to re-run it, or join a nearby group in the room.
          </CardDescription>
        </CardHeader>
        {backToLecture && <CardContent>{backToLecture}</CardContent>}
      </Card>
    );
  }

  if (!group) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Your group — {group.label}</CardTitle>
            <CardDescription className="flex items-center gap-1">
              <Users className="size-3.5" />
              {group.memberNames.join(", ")}
            </CardDescription>
          </div>
          <span className="text-xs text-muted-foreground">
            {closed
              ? "Closed"
              : status === "saving"
                ? "Saving…"
                : status === "saved"
                  ? "Saved"
                  : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="rounded-lg bg-muted p-3 text-sm font-medium">
          <PencilLine className="mr-1 inline size-4" />
          {group.prompt}
        </p>
        <textarea
          value={content}
          readOnly={closed}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onBlur={() => {
            focusedRef.current = false;
          }}
          placeholder="Your group's answer — anyone can type. Talk it out, then put it here."
          className="min-h-32 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:bg-muted read-only:text-muted-foreground"
        />
        {closed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              This exercise is closed — your group&apos;s answer is in.
            </p>
            {backToLecture}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            One shared answer for the whole group — your professor sees it live.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
