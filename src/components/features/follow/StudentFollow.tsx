"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  Eye,
  Pause,
  PencilLine,
  Radio,
  Sparkles,
} from "lucide-react";
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
import { NoteFeed } from "@/components/features/follow/NoteFeed";
import type { NoteEntryData } from "@/components/features/notes/NoteEntryItem";
import {
  recordFocusEvent,
  recordPresenceHeartbeat,
} from "@/server/actions/lectures";
import { submitPollAnswer } from "@/server/actions/polls";
import { pollOptionText } from "@/lib/participate";
import { subscribeWithRecovery } from "@/lib/live-sync";
import {
  LECTURE_LIVE_EVENT,
  lectureLiveTopic,
  type LectureLiveState,
} from "@/lib/lecturesync";
import {
  effectiveAwayMs,
  formatAwayDuration,
  isLecturePaused,
  PRESENCE_DISCONNECT_MS,
  PRESENCE_HEARTBEAT_MS,
  type PauseInterval,
} from "@/lib/focus";
import { capture } from "@/lib/analytics";
import { initialsOf } from "@/lib/names";
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
  /** Attachment-disposition variant of fileUrl, so a click saves the PDF. */
  slidesDownloadUrl?: string | null;
  /** Minted only while the professor allows transcript downloads. */
  transcriptDownloadUrl?: string | null;
  embedUrl: string | null;
  /** Notes this student already took in this lecture, oldest first. */
  initialEntries: NoteEntryData[];
  /** Prior focus tally for this lecture (survives refreshes). */
  initialAwayCount: number;
  initialAwayMs: number;
  /** The server still has an open away spell (e.g. sleep ate the 'back'). */
  initialIsAway: boolean;
  /** Professor pause windows so far; open pause = lecture paused right now. */
  initialPauses: PauseInterval[];
  /** Class roster (names/photos) so partners can be shown by face. */
  roster: Record<
    string,
    { name: string; firstName: string; photoUrl: string | null }
  >;
  initialRound: StudentRound | null;
  initialMyAnswers: Array<{ phase: PollPhase; choice: number }>;
  initialPartnerIds: string[];
  /** Prompt of a group exercise running right now, if any. */
  initialExercisePrompt?: string | null;
}

export function StudentFollow({
  courseId,
  lectureId,
  enrollmentId,
  initialPage,
  deckTitle,
  deckKind,
  fileUrl,
  slidesDownloadUrl = null,
  transcriptDownloadUrl = null,
  embedUrl,
  initialEntries,
  initialAwayCount,
  initialAwayMs,
  initialIsAway,
  initialPauses,
  roster,
  initialRound,
  initialMyAnswers,
  initialPartnerIds,
  initialExercisePrompt = null,
}: Props) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [live, setLive] = useState(true);
  const [awayCount, setAwayCount] = useState(initialAwayCount);
  const [awayMs, setAwayMs] = useState(initialAwayMs);
  const [warning, setWarning] = useState<{ durationMs: number } | null>(null);
  const [pauses, setPauses] = useState<PauseInterval[]>(initialPauses);
  const pausesRef = useRef<PauseInterval[]>(initialPauses);
  const applyPauses = useCallback((next: PauseInterval[]) => {
    pausesRef.current = next;
    setPauses(next);
  }, []);
  const paused = isLecturePaused(pauses);

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

  // ---- Group exercise ----
  // The professor can start one from the presenter now, so students sitting
  // on this page need to hear about it without being told out loud.
  const [exercisePrompt, setExercisePrompt] = useState<string | null>(
    initialExercisePrompt
  );

  // Seeded from the server: a reload wipes local state, but an away spell the
  // sleep/close ate the 'back' for is still open in the DB — the heartbeat
  // effect's mount reconcile closes it (the server backdates the timestamp).
  const isAwayRef = useRef(initialIsAway);
  const awayStartRef = useRef<number | null>(null);
  // Last local proof of life, mirroring the server heartbeat: a big gap means
  // the machine slept, so the time between beats isn't browsing. Stamped by
  // the heartbeat effect's first beat on mount (refs can't call Date.now()
  // during render).
  const lastBeatRef = useRef(0);

  // ---- Slide sync: realtime broadcast, resilient to sleep/wake ----
  // The professor's server actions broadcast the lecture state (see
  // lectureLiveTopic for why that replaced postgres_changes on the row).
  // subscribeWithRecovery owns the hard part: catch up on every (re)subscribe,
  // fall back to polling while down, and rebounce onto the channel when the
  // tab returns to the foreground or the network — so a laptop that slept, shut,
  // or dropped Wi-Fi resumes tracking instead of freezing on the last slide.
  useEffect(() => {
    const supabase = createClient();
    // Bumped on every realtime apply, so a slow catch-up SELECT can bow out if a
    // fresher realtime update landed while it was in flight (no backward jump).
    let realtimeSeq = 0;

    function applyRow(rec: {
      current_page: number;
      ended_at: string | null;
      pauses?: PauseInterval[] | null;
    }) {
      if (rec.ended_at) {
        router.refresh();
        return;
      }
      setPage(rec.current_page);
      applyPauses(rec.pauses ?? []);
    }

    async function catchUp() {
      const issued = realtimeSeq;
      const { data } = await supabase
        .from("lectures")
        .select("current_page, ended_at, pauses")
        .eq("id", lectureId)
        .maybeSingle();
      if (!data || realtimeSeq !== issued) return;
      applyRow(data);
    }

    // Safety net for a broadcast that never arrived (the send is one HTTP
    // call with no redelivery): a slow, jittered authoritative re-read. At
    // 300 students that's a few primary-key reads a second, spread out.
    let safety: ReturnType<typeof setTimeout> | null = null;
    const armSafety = () => {
      if (safety) clearTimeout(safety);
      safety = setTimeout(
        () => {
          void catchUp();
          armSafety();
        },
        60_000 + Math.floor(Math.random() * 30_000)
      );
    };
    armSafety();

    const stop = subscribeWithRecovery({
      client: supabase,
      topic: () => lectureLiveTopic(lectureId),
      bind: (channel) =>
        channel.on(
          "broadcast",
          { event: LECTURE_LIVE_EVENT },
          ({ payload }: { payload: LectureLiveState }) => {
            if (typeof payload?.current_page !== "number") return;
            realtimeSeq++;
            applyRow(payload);
            armSafety();
          }
        ),
      catchUp,
      onStatus: setLive,
    });
    return () => {
      if (safety) clearTimeout(safety);
      stop();
    };
  }, [lectureId, router, applyPauses]);

  // ---- Poll sync: rounds pop in / advance stages, pairs arrive ----
  // Realtime first, with a 5s polling fallback (same pattern as slide sync)
  // so a dropped connection can't strand anyone mid-vote.
  useEffect(() => {
    const supabase = createClient();
    // Fresher-realtime guard (same as the slide sync): a slow catch-up defers
    // to any realtime poll event that landed while it was in flight.
    let realtimeSeq = 0;

    async function pollRound() {
      const issued = realtimeSeq;
      const { data } = await supabase
        .from("poll_rounds")
        .select("id, prompt, options, stage, results, correct_indices")
        .eq("lecture_id", lectureId)
        .neq("stage", "closed")
        .maybeSingle();
      if (realtimeSeq !== issued) return;
      if (!data) {
        if (roundIdRef.current) {
          roundIdRef.current = null;
          setRound(null);
          setPartnerIds([]);
        }
        return;
      }
      if (data.id !== roundIdRef.current) {
        roundIdRef.current = data.id;
        setRound({
          id: data.id,
          prompt: data.prompt,
          options: data.options,
          stage: data.stage,
          results: data.results,
          correctIndices: data.correct_indices,
        });
        setMyThink(null);
        setMyRevote(null);
        setPartnerIds([]);
      } else {
        setRound((prev) => {
          if (!prev || prev.id !== data.id) return prev;
          const next = {
            ...prev,
            prompt: data.prompt,
            options: data.options,
            stage: data.stage,
            results: data.results,
            correctIndices: data.correct_indices,
          };
          return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
        });
      }
      if (data.stage === "pair" || data.stage === "revote") {
        const { data: pair } = await supabase
          .from("poll_pairs")
          .select("member_ids")
          .eq("round_id", data.id)
          .contains("member_ids", JSON.stringify([enrollmentId]))
          .maybeSingle();
        // This catch-up runs on every re-subscribe, when realtime may be live
        // and redelivering; a poll event landing during this second fetch is
        // fresher than our partner read, so bow out rather than clobber it.
        if (realtimeSeq !== issued) return;
        if (pair) {
          const partners = pair.member_ids.filter((id) => id !== enrollmentId);
          setPartnerIds((prev) =>
            JSON.stringify(prev) === JSON.stringify(partners) ? prev : partners
          );
        }
      }
    }

    return subscribeWithRecovery({
      client: supabase,
      topic: (g) => `polls:${lectureId}:${g}`,
      bind: (channel) =>
        channel
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "poll_rounds",
              filter: `lecture_id=eq.${lectureId}`,
            },
            (payload) => {
              realtimeSeq++;
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
              realtimeSeq++;
              const rec = payload.new as {
                id: string;
                prompt?: string;
                options?: string[];
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
              // Prompt/options ride along too: the professor can rewrite a
              // quick-start poll's wording while this student is on it.
              setRound((prev) =>
                prev && prev.id === rec.id
                  ? {
                      ...prev,
                      prompt: rec.prompt ?? prev.prompt,
                      options: rec.options ?? prev.options,
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
              realtimeSeq++;
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
          ),
      catchUp: pollRound,
    });
  }, [lectureId, courseId, enrollmentId]);

  // ---- Group exercise: appear/disappear as the professor starts and ends one ----
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`exercises:${courseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "exercise_rounds",
          filter: `course_id=eq.${courseId}`,
        },
        (payload) => {
          const rec = payload.new as {
            prompt?: string;
            stage?: string;
          } | null;
          if (!rec) return;
          setExercisePrompt(rec.stage === "open" ? (rec.prompt ?? null) : null);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [courseId]);

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

  // ---- Presence heartbeat: proves the machine is still on and connected ----
  // Runs for the component's whole life (it only renders while the lecture is
  // live). Hidden tabs still fire throttled timers, so a student on another
  // site keeps beating; a sleeping machine goes silent and scoring stops
  // charging them at the last beat.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const beat = () => {
      const now = Date.now();
      const prev = lastBeatRef.current;
      lastBeatRef.current = now;
      if (prev > 0 && now - prev > PRESENCE_DISCONNECT_MS && isAwayRef.current) {
        // The machine slept mid-away-spell and just woke with this tab still
        // loaded. Close the stale spell BEFORE beating — the server backdates
        // the 'back' against the pre-sleep heartbeat this beat would
        // otherwise overwrite — then reopen it only if we're still hidden.
        // Locally, bill the demonstrably-awake stretch and restart the clock
        // at the wake, so the eventual return dialog covers only real
        // browsing.
        const start = awayStartRef.current;
        if (start !== null) {
          const preSleep = effectiveAwayMs(
            start,
            Math.max(start, prev),
            pausesRef.current,
            now
          );
          if (preSleep > 0) setAwayCount((c) => c + 1);
          setAwayMs((ms) => ms + preSleep);
        }
        awayStartRef.current = now;
        void recordFocusEvent(courseId, lectureId, "back")
          .then(() => {
            if (document.hidden || !document.hasFocus()) {
              return recordFocusEvent(courseId, lectureId, "away");
            }
            isAwayRef.current = false;
            awayStartRef.current = null;
          })
          .catch(() => {})
          .finally(() => void recordPresenceHeartbeat(courseId, lectureId));
        return;
      }
      void recordPresenceHeartbeat(courseId, lectureId);
    };
    const begin = () => {
      if (cancelled) return;
      beat();
      timer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    };
    if (isAwayRef.current) {
      // Reconcile a spell left open by a pre-reload sleep/close BEFORE the
      // first beat: the server backdates this 'back' to the last heartbeat,
      // so beating first would overwrite the very timestamp it needs.
      const closeStale = recordFocusEvent(courseId, lectureId, "back");
      if (!document.hidden && document.hasFocus()) {
        isAwayRef.current = false;
        void closeStale.catch(() => {}).finally(begin);
      } else {
        // Awake again but reading another tab: the stale spell ends where
        // the heartbeat died; the browsing happening now starts a new one.
        // Re-check at send time — a focus during the round-trip means the
        // focus guard already closed everything, and reopening would wrongly
        // flag a student who's looking right at the lecture.
        void closeStale
          .then(() => {
            if (document.hidden || !document.hasFocus()) {
              return recordFocusEvent(courseId, lectureId, "away");
            }
          })
          .catch(() => {})
          .finally(begin);
      }
    } else {
      begin();
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [courseId, lectureId]);

  // ---- Focus guard: log tab-away / return, warn on return ----
  useEffect(() => {
    function evaluate() {
      const away = document.hidden || !document.hasFocus();
      if (away && !isAwayRef.current) {
        isAwayRef.current = true;
        awayStartRef.current = Date.now();
        lastBeatRef.current = Date.now();
        capture("lecture_focus_lost", {});
        // Events are always recorded — pause windows are subtracted at
        // scoring time, so the stream stays truthful either way.
        void recordFocusEvent(courseId, lectureId, "away");
      } else if (!away && isAwayRef.current) {
        isAwayRef.current = false;
        const start = awayStartRef.current;
        awayStartRef.current = null;
        const nowMs = Date.now();
        // A silent gap since the last beat means the machine slept — only
        // the stretch while it was demonstrably awake counts (the server
        // applies the same rule by backdating the 'back' event).
        const lastBeat = lastBeatRef.current;
        const slept = nowMs - lastBeat > PRESENCE_DISCONNECT_MS;
        lastBeatRef.current = nowMs;
        void recordFocusEvent(courseId, lectureId, "back");
        // A null start means the spell predates this page load (reload after
        // sleep) — the server closes it; there's nothing to tally locally.
        if (start === null) return;
        const end = slept ? Math.max(start, lastBeat) : nowMs;
        const raw = end - start;
        const counted = effectiveAwayMs(start, end, pausesRef.current, nowMs);
        // Only real away time tallies (mirrors summarizeFocus): a spell the
        // pause fully covers was sanctioned, and a spell the sleep collapsed
        // to nothing scores like absence.
        if (counted > 0) setAwayCount((c) => c + 1);
        setAwayMs((ms) => ms + counted);
        if (counted > 0) {
          setWarning({ durationMs: counted });
        } else if (slept) {
          toast.success(
            "Welcome back — looks like your computer was asleep, so that didn't count."
          );
        } else if (raw > 0) {
          toast.success(
            "Welcome back — focus tracking was paused, so that didn't count."
          );
        }
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
                            alt={partner.firstName}
                          />
                        )}
                        <AvatarFallback className="text-[10px]">
                          {initialsOf(partner.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{partner.firstName}</span>
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
                {pollOptionText(option, i)}
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
        {paused && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <Pause className="size-4 shrink-0" />
            <span>
              <span className="font-medium">Focus tracking paused.</span> Your
              professor opened a browsing window — leaving this tab won&apos;t
              count against you until they resume.
            </span>
          </div>
        )}
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

        <NoteFeed
          courseId={courseId}
          lectureId={lectureId}
          page={page}
          initialEntries={initialEntries}
        />
      </div>

      <div className="grid content-start gap-4">
        {/*
          A group exercise is started from the professor's presenter but is
          answered over on Participate — without this, it would begin with
          nobody on this page knowing it had.
        */}
        {exercisePrompt && (
          <Card className="border-[var(--flame,#e0552f)]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PencilLine className="size-4" /> Group exercise started
              </CardTitle>
              <CardDescription>{exercisePrompt}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild size="sm" className="w-full">
                <Link href={`/course/${courseId}/participate`}>
                  Join your group
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
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
          {((deckKind === "pdf" && slidesDownloadUrl) ||
            transcriptDownloadUrl) && (
            <CardContent className="grid gap-2">
              {deckKind === "pdf" && slidesDownloadUrl && (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <a href={slidesDownloadUrl}>
                    <Download className="size-4" /> Download slides
                  </a>
                </Button>
              )}
              {transcriptDownloadUrl && (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <a href={transcriptDownloadUrl}>
                    <Download className="size-4" /> Download transcript
                  </a>
                </Button>
              )}
            </CardContent>
          )}
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
          <CardContent className="grid gap-2">
            {paused && (
              <Badge className="w-fit" variant="outline">
                <Pause className="mr-1 size-3" /> Focus tracking paused — aways
                don&apos;t count right now
              </Badge>
            )}
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
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Looking something up because your professor asked? If this is
                an official activity, remind them to hit{" "}
                <span className="font-medium">Pause focus tracking</span> —
                paused time never counts against anyone.
              </p>
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
