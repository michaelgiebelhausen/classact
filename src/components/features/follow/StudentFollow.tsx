"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Eye, NotebookPen, Radio, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SlideViewer } from "@/components/features/follow/SlideViewer";
import { PollResultsChart } from "@/components/features/follow/PollResultsChart";
import { recordFocusEvent, saveLectureNotes } from "@/server/actions/lectures";
import { submitPollAnswer } from "@/server/actions/polls";
import { formatAwayDuration } from "@/lib/focus";
import { capture } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { PollPhase, PollResults, PollStage } from "@/types/db";

const LETTERS = "ABCDEFGH";

/** The open round, as students see it (no answer key until reveal). */
export interface StudentRound {
  id: string;
  prompt: string;
  options: string[];
  stage: PollStage;
  results: PollResults | null;
  correctIndices: number[] | null;
}

interface Props {
  courseId: string;
  lectureId: string;
  enrollmentId: string;
  initialPage: number;
  deckTitle: string;
  deckKind: "pdf" | "google_slides";
  fileUrl: string | null;
  embedUrl: string | null;
  initialNotes: string;
  /** Prior focus tally for this lecture (survives refreshes). */
  initialAwayCount: number;
  initialAwayMs: number;
  /** Class roster (names/photos) so partners can be shown by face. */
  roster: Record<string, { name: string; photoUrl: string | null }>;
  initialRound: StudentRound | null;
  initialMyAnswers: Array<{ phase: PollPhase; choice: number }>;
  initialPartnerIds: string[];
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function StudentFollow({
  courseId,
  lectureId,
  enrollmentId,
  initialPage,
  deckTitle,
  deckKind,
  fileUrl,
  embedUrl,
  initialNotes,
  initialAwayCount,
  initialAwayMs,
  roster,
  initialRound,
  initialMyAnswers,
  initialPartnerIds,
}: Props) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [live, setLive] = useState(true);
  const [notes, setNotes] = useState(initialNotes);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [awayCount, setAwayCount] = useState(initialAwayCount);
  const [awayMs, setAwayMs] = useState(initialAwayMs);
  const [warning, setWarning] = useState<{ durationMs: number } | null>(null);

  // ---- Think-pair-share round ----
  const [round, setRound] = useState<StudentRound | null>(initialRound);
  const [myThink, setMyThink] = useState<number | null>(
    initialMyAnswers.find((a) => a.phase === "think")?.choice ?? null
  );
  const [myRevote, setMyRevote] = useState<number | null>(
    initialMyAnswers.find((a) => a.phase === "revote")?.choice ?? null
  );
  const [partnerIds, setPartnerIds] = useState<string[]>(initialPartnerIds);
  const [voting, setVoting] = useState(false);
  const roundIdRef = useRef<string | null>(initialRound?.id ?? null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAwayRef = useRef(false);
  const awayStartRef = useRef<number | null>(null);
  const notesRef = useRef(initialNotes);

  // ---- Slide sync: realtime on the lecture row, 5s polling fallback ----
  useEffect(() => {
    const supabase = createClient();
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      const { data } = await supabase
        .from("lectures")
        .select("current_page, ended_at")
        .eq("id", lectureId)
        .maybeSingle();
      if (!data) return;
      if (data.ended_at) {
        router.refresh();
        return;
      }
      setPage(data.current_page);
    }

    const channel = supabase
      .channel(`lecture:${lectureId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "lectures",
          filter: `id=eq.${lectureId}`,
        },
        (payload) => {
          const rec = payload.new as {
            current_page: number;
            ended_at: string | null;
          };
          if (rec.ended_at) {
            router.refresh();
            return;
          }
          setPage(rec.current_page);
        }
      )
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        setLive(ok);
        if (!ok && !pollTimer) pollTimer = setInterval(() => void poll(), 5000);
        if (ok && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      });

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [lectureId, router]);

  // ---- Poll sync: rounds pop in / advance stages, pairs arrive ----
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`polls:${lectureId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "poll_rounds",
          filter: `lecture_id=eq.${lectureId}`,
        },
        (payload) => {
          const rec = payload.new as {
            id: string;
            prompt: string;
            options: string[];
            stage: PollStage;
            results: PollResults | null;
            correct_indices: number[] | null;
          };
          if (!rec?.id || rec.stage === "closed") return;
          roundIdRef.current = rec.id;
          setRound({
            id: rec.id,
            prompt: rec.prompt,
            options: rec.options,
            stage: rec.stage,
            results: rec.results,
            correctIndices: rec.correct_indices,
          });
          setMyThink(null);
          setMyRevote(null);
          setPartnerIds([]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "poll_rounds",
          filter: `lecture_id=eq.${lectureId}`,
        },
        (payload) => {
          const rec = payload.new as {
            id: string;
            stage: PollStage;
            results: PollResults | null;
            correct_indices: number[] | null;
          };
          if (!rec?.id || rec.id !== roundIdRef.current) return;
          if (rec.stage === "closed") {
            roundIdRef.current = null;
            setRound(null);
            setPartnerIds([]);
            return;
          }
          setRound((prev) =>
            prev && prev.id === rec.id
              ? {
                  ...prev,
                  stage: rec.stage,
                  results: rec.results,
                  correctIndices: rec.correct_indices,
                }
              : prev
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "poll_pairs",
          filter: `course_id=eq.${courseId}`,
        },
        (payload) => {
          const rec = payload.new as {
            round_id: string;
            member_ids: string[];
          };
          if (
            rec?.round_id !== roundIdRef.current ||
            !Array.isArray(rec.member_ids) ||
            !rec.member_ids.includes(enrollmentId)
          ) {
            return;
          }
          setPartnerIds(rec.member_ids.filter((id) => id !== enrollmentId));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [lectureId, courseId, enrollmentId]);

  async function vote(choice: number) {
    if (!round || voting) return;
    const phase: PollPhase | null =
      round.stage === "think"
        ? "think"
        : round.stage === "revote"
          ? "revote"
          : null;
    if (!phase) return;
    const previous = phase === "think" ? myThink : myRevote;
    if (phase === "think") setMyThink(choice);
    else setMyRevote(choice);
    setVoting(true);
    const result = await submitPollAnswer(courseId, round.id, choice);
    setVoting(false);
    if (!result.ok) {
      if (phase === "think") setMyThink(previous);
      else setMyRevote(previous);
      toast.error(result.error);
      return;
    }
    capture("poll_answered", { phase });
  }

  // ---- Focus guard: log tab-away / return, warn on return ----
  useEffect(() => {
    function evaluate() {
      const away = document.hidden || !document.hasFocus();
      if (away && !isAwayRef.current) {
        isAwayRef.current = true;
        awayStartRef.current = Date.now();
        setAwayCount((c) => c + 1);
        capture("lecture_focus_lost", {});
        void recordFocusEvent(courseId, lectureId, "away");
      } else if (!away && isAwayRef.current) {
        isAwayRef.current = false;
        const durationMs = awayStartRef.current
          ? Date.now() - awayStartRef.current
          : 0;
        awayStartRef.current = null;
        setAwayMs((ms) => ms + durationMs);
        setWarning({ durationMs });
        void recordFocusEvent(courseId, lectureId, "back");
      }
    }
    // blur needs a beat — focus may just be moving inside the page.
    function onBlur() {
      setTimeout(evaluate, 150);
    }
    document.addEventListener("visibilitychange", evaluate);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", evaluate);
    return () => {
      document.removeEventListener("visibilitychange", evaluate);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", evaluate);
    };
  }, [courseId, lectureId]);

  // ---- Notes autosave (1.5s after typing stops) ----
  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      const result = await saveLectureNotes(
        courseId,
        lectureId,
        notesRef.current
      );
      setSaveState(result.ok ? "saved" : "error");
      if (!result.ok) toast.error(result.error);
    }, 1500);
  }, [courseId, lectureId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "dirty"
          ? "Unsaved changes"
          : saveState === "error"
            ? "Save failed — keep a copy!"
            : "Notes are private to you";

  // ---- Poll card (pops into the rail while a round is live) ----
  const canVote = round?.stage === "think" || round?.stage === "revote";
  const selection =
    round?.stage === "revote" || round?.stage === "reveal"
      ? (myRevote ?? null)
      : myThink;
  let revealOutcome: string | null = null;
  if (round?.stage === "reveal" && round.correctIndices?.length) {
    const key = round.correctIndices;
    const finalChoice = myRevote ?? myThink;
    const firstRight = myThink !== null && key.includes(myThink);
    const finalRight = finalChoice !== null && key.includes(finalChoice);
    if (finalChoice === null) revealOutcome = null;
    else if (finalRight && !firstRight)
      revealOutcome =
        "You switched to the right answer after discussing — that's exactly how this works.";
    else if (finalRight) revealOutcome = "You had it right — nice.";
    else revealOutcome = "Not this time — arguing it out still counts.";
  }

  const pollCard = round ? (
    <Card className="border-[var(--flame,#e0552f)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-[var(--flame,#e0552f)]" />
          {round.stage === "think" && "Think"}
          {round.stage === "pair" && "Pair up"}
          {round.stage === "revote" && "Re-vote"}
          {round.stage === "reveal" && "Results"}
        </CardTitle>
        <CardDescription>
          {round.stage === "think" &&
            "Answer on your own first — no talking yet."}
          {round.stage === "pair" &&
            "Explain your reasoning and try to convince each other."}
          {round.stage === "revote" &&
            "Did your partner change your mind? Answer again."}
          {round.stage === "reveal" && "How the class voted, before and after."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm font-medium">{round.prompt}</p>

        {round.stage === "pair" && (
          <div className="rounded-lg bg-muted p-2.5">
            {partnerIds.length > 0 ? (
              <div className="grid gap-1.5">
                <p className="text-xs font-medium">Discuss with:</p>
                {partnerIds.map((id) => {
                  const partner = roster[id];
                  if (!partner) return null;
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <Avatar className="size-7">
                        {partner.photoUrl && (
                          <AvatarImage
                            src={partner.photoUrl}
                            alt={partner.name}
                          />
                        )}
                        <AvatarFallback className="text-[10px]">
                          {initials(partner.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{partner.name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Turn to a neighbor and compare answers.
              </p>
            )}
          </div>
        )}

        {round.stage === "reveal" ? (
          <>
            <PollResultsChart
              options={round.options}
              results={round.results}
              correctIndices={round.correctIndices}
            />
            {revealOutcome && (
              <p className="rounded-lg bg-muted p-2 text-xs">{revealOutcome}</p>
            )}
          </>
        ) : (
          <div className="grid gap-1.5">
            {round.options.map((option, i) => (
              <Button
                key={i}
                variant={selection === i ? "default" : "outline"}
                className={cn(
                  "h-auto w-full justify-start whitespace-normal py-2 text-left",
                  !canVote && "opacity-80"
                )}
                onClick={() => void vote(i)}
                disabled={!canVote || voting}
              >
                <span className="mr-2 font-semibold">{LETTERS[i]}.</span>
                {option}
              </Button>
            ))}
            {round.stage === "revote" && myThink !== null && (
              <p className="text-xs text-muted-foreground">
                Your first answer: {LETTERS[myThink]}. Stick or switch — your
                call.
              </p>
            )}
            {canVote && selection !== null && (
              <p className="text-xs text-muted-foreground">
                Answer recorded — you can change it until the next stage.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="grid content-start gap-4">
        {deckKind === "pdf" && fileUrl ? (
          <SlideViewer fileUrl={fileUrl} page={page} className="w-full" />
        ) : embedUrl ? (
          <iframe
            src={embedUrl}
            title={deckTitle}
            className="aspect-video w-full rounded-lg border"
            allowFullScreen
          />
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <NotebookPen className="size-4" /> My notes
            </CardTitle>
            <CardDescription>{saveLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                notesRef.current = e.target.value;
                scheduleSave();
              }}
              placeholder="Type your lecture notes here — they save automatically."
              className="min-h-40 w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-4">
        {pollCard}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="size-4 text-[var(--flame,#e0552f)]" /> {deckTitle}
            </CardTitle>
            <CardDescription>
              {deckKind === "pdf"
                ? live
                  ? `Following live — slide ${page}.`
                  : `Reconnecting… syncing every 5s (slide ${page}).`
                : "Embedded slides — follow along with the room."}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="size-4" /> Focus
            </CardTitle>
            <CardDescription>
              Leaving this tab during lecture is recorded and affects your
              ClassAct Metrics.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {awayCount === 0 ? (
              <Badge variant="secondary">Locked in — no tab-aways</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">
                Away {awayCount} {awayCount === 1 ? "time" : "times"} ·{" "}
                {formatAwayDuration(awayMs)} total this lecture.
              </p>
            )}
          </CardContent>
        </Card>

        {!round && (
          <Card className="border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
                <Sparkles className="size-4" /> Participate
              </CardTitle>
              <CardDescription>
                Think-pair-share questions pop in here when your professor
                launches one — stay ready.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      {warning && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <Card className="max-w-md border-[var(--flame,#e0552f)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-[var(--flame,#e0552f)]" />
                Welcome back
              </CardTitle>
              <CardDescription>
                You were away from the lecture for{" "}
                {formatAwayDuration(warning.durationMs)}. Time away is recorded
                and impacts your ClassAct Metrics — stay with the class to keep
                your focus score up.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => setWarning(null)}>
                Back to the lecture
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
