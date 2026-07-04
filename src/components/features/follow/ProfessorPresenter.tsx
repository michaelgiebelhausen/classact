"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  MonitorUp,
  Play,
  Sparkles,
  Square,
  Timer,
  Users,
  X,
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
import { QuickPollDialog } from "@/components/features/follow/QuickPollDialog";
import { endLecture, setLecturePage } from "@/server/actions/lectures";
import {
  closePollRound,
  launchPollRound,
  markPollCorrect,
  revealPollResults,
  setPollStage,
} from "@/server/actions/polls";
import { formatAwayDuration } from "@/lib/focus";
import { firstVoteGuidance, tallyVotes } from "@/lib/participate";
import {
  lectureChannelName,
  stagePath,
  type LectureSyncMessage,
} from "@/lib/lecturesync";
import { capture } from "@/lib/analytics";
import type {
  FocusEventType,
  PollPhase,
  PollResults,
  PollStage,
} from "@/types/db";

const LETTERS = "ABCDEFGH";

export interface RosterEntry {
  name: string;
  photoUrl: string | null;
}

export interface FocusStateInput {
  enrollmentId: string;
  awayCount: number;
  awayMs: number;
  isAway: boolean;
}

/** Approved bank question, ready to launch (includes the professor's key). */
export interface PresenterQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndices: number[];
  positionAfterPage: number;
}

/** The open round, as the presenter tracks it locally. */
export interface ActiveRound {
  id: string;
  questionId: string | null;
  prompt: string;
  options: string[];
  stage: PollStage;
  results: PollResults | null;
  correctIndices: number[] | null;
}

export interface PresenterVote {
  enrollmentId: string;
  phase: PollPhase;
  choice: number;
}

interface Props {
  courseId: string;
  lectureId: string;
  startedAt: string;
  initialPage: number;
  deckTitle: string;
  deckKind: "pdf" | "google_slides";
  fileUrl: string | null;
  embedUrl: string | null;
  pageCount: number | null;
  roster: Record<string, RosterEntry>;
  initialFocus: FocusStateInput[];
  /** Approved think-pair-share questions for this deck. */
  questions: PresenterQuestion[];
  /** Question ids already run (any round) in this lecture. */
  ranQuestionIds: string[];
  /** The open round, when the page loads mid-poll. */
  initialRound: ActiveRound | null;
  /** Votes already recorded on the open round. */
  initialVotes: PresenterVote[];
}

interface FocusState {
  awayCount: number;
  awayMs: number;
  awaySince: number | null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ProfessorPresenter({
  courseId,
  lectureId,
  startedAt,
  initialPage,
  deckTitle,
  deckKind,
  fileUrl,
  embedUrl,
  pageCount,
  roster,
  initialFocus,
  questions,
  ranQuestionIds,
  initialRound,
  initialVotes,
}: Props) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState<number | null>(pageCount);
  const [ending, setEnding] = useState(false);
  const [focus, setFocus] = useState<Map<string, FocusState>>(
    () =>
      new Map(
        initialFocus.map((f) => [
          f.enrollmentId,
          {
            awayCount: f.awayCount,
            awayMs: f.awayMs,
            awaySince: f.isAway ? Date.now() : null,
          },
        ])
      )
  );
  // Clock state so elapsed/away durations can be computed purely in render;
  // refreshed every few seconds by the interval below.
  const [now, setNow] = useState<number | null>(null);
  const pageRef = useRef(initialPage);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // ---- Think-pair-share round state ----
  const [round, setRound] = useState<ActiveRound | null>(initialRound);
  const roundRef = useRef<ActiveRound | null>(initialRound);
  const ranRef = useRef<Set<string>>(new Set(ranQuestionIds));
  const [ran, setRan] = useState<Set<string>>(() => new Set(ranQuestionIds));
  // Whether closing the current round should advance to the next slide —
  // true only when the poll inserted itself between two slides.
  const advanceOnResumeRef = useRef(false);
  const [votes, setVotes] = useState<Map<string, Partial<Record<PollPhase, number>>>>(
    () => {
      const map = new Map<string, Partial<Record<PollPhase, number>>>();
      for (const v of initialVotes) {
        const entry = map.get(v.enrollmentId) ?? {};
        entry[v.phase] = v.choice;
        map.set(v.enrollmentId, entry);
      }
      return map;
    }
  );
  const [pollBusy, setPollBusy] = useState(false);
  // Quick polls launched this session — not in the server-fetched bank yet.
  const [localQuestions, setLocalQuestions] = useState<PresenterQuestion[]>([]);
  const allQuestions = useMemo(
    () => [...questions, ...localQuestions],
    [questions, localQuestions]
  );

  const broadcastPoll = useCallback((p: ActiveRound | null) => {
    channelRef.current?.postMessage({
      type: "poll",
      poll: p
        ? {
            roundId: p.id,
            prompt: p.prompt,
            options: p.options,
            stage: p.stage,
            results: p.results,
            correctIndices: p.correctIndices,
          }
        : null,
    } satisfies LectureSyncMessage);
  }, []);

  const applyRound = useCallback(
    (p: ActiveRound | null) => {
      roundRef.current = p;
      setRound(p);
      broadcastPoll(p);
    },
    [broadcastPoll]
  );

  const launchQuestion = useCallback(
    async (question: PresenterQuestion, advanceOnResume = false) => {
      setPollBusy(true);
      const result = await launchPollRound(courseId, lectureId, question.id);
      setPollBusy(false);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Couldn't launch the poll." : result.error);
        return;
      }
      advanceOnResumeRef.current = advanceOnResume;
      ranRef.current.add(question.id);
      setRan(new Set(ranRef.current));
      setVotes(new Map());
      applyRound({
        id: result.data.roundId,
        questionId: question.id,
        prompt: question.prompt,
        options: question.options,
        stage: "think",
        results: null,
        correctIndices: null,
      });
      capture("poll_launched", {});
    },
    [applyRound, courseId, lectureId]
  );

  const goTo = useCallback(
    (next: number) => {
      // While a poll is open it owns the room — slides stay put.
      if (roundRef.current) return;
      const clamped = Math.max(1, totalPages ? Math.min(next, totalPages) : next);
      if (clamped === pageRef.current) return;
      // Advancing one slide forward runs any queued question first — the
      // poll inserts itself between the slides.
      if (clamped === pageRef.current + 1) {
        const queued = allQuestions.find(
          (q) =>
            q.positionAfterPage === pageRef.current && !ranRef.current.has(q.id)
        );
        if (queued) {
          void launchQuestion(queued, true);
          return;
        }
      }
      pageRef.current = clamped;
      setPage(clamped);
      channelRef.current?.postMessage({
        type: "page",
        page: clamped,
      } satisfies LectureSyncMessage);
      void setLecturePage(courseId, lectureId, clamped).then((result) => {
        if (!result.ok) toast.error(result.error);
      });
    },
    [courseId, lectureId, totalPages, allQuestions, launchQuestion]
  );

  // Instant sync with the projector stage window (same browser).
  useEffect(() => {
    const channel = new BroadcastChannel(lectureChannelName(lectureId));
    channelRef.current = channel;
    channel.onmessage = (e: MessageEvent<LectureSyncMessage>) => {
      // Stage window clicked through — it already persisted the page.
      if (e.data?.type === "page") {
        const previous = pageRef.current;
        pageRef.current = e.data.page;
        setPage(e.data.page);
        // The stage window doesn't know about queued questions — if its
        // advance crossed one, launch it now (the poll overlays the slide,
        // so no extra advance on resume).
        if (!roundRef.current && e.data.page === previous + 1) {
          const queued = allQuestions.find(
            (q) =>
              q.positionAfterPage === previous && !ranRef.current.has(q.id)
          );
          if (queued) void launchQuestion(queued);
        }
      }
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [lectureId, allQuestions, launchQuestion]);

  function openStage() {
    void (async () => {
      let features = "popup=yes,width=1280,height=720";
      try {
        // Window Management API (Chrome/Edge): place straight on the
        // projector screen when one is attached.
        const w = window as Window & {
          getScreenDetails?: () => Promise<{
            currentScreen: unknown;
            screens: Array<{
              availLeft: number;
              availTop: number;
              availWidth: number;
              availHeight: number;
            }>;
          }>;
        };
        if (w.getScreenDetails) {
          const details = await w.getScreenDetails();
          const other = details.screens.find((s) => s !== details.currentScreen);
          if (other) {
            features = `popup=yes,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
          }
        }
      } catch {
        // Permission declined or single screen — default popup is fine.
      }
      window.open(stagePath(courseId), "classact-stage", features);
    })();
  }

  // Keyboard presenting: ← → and space.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goTo(page + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(page - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, goTo]);

  // Live attention roster from focus_events inserts.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`lecture-focus:${lectureId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "focus_events",
          filter: `lecture_id=eq.${lectureId}`,
        },
        (payload) => {
          const rec = payload.new as {
            enrollment_id: string;
            event_type: FocusEventType;
          };
          if (!rec?.enrollment_id) return;
          setFocus((prev) => {
            const next = new Map(prev);
            const state = next.get(rec.enrollment_id) ?? {
              awayCount: 0,
              awayMs: 0,
              awaySince: null,
            };
            if (rec.event_type === "away" && state.awaySince === null) {
              next.set(rec.enrollment_id, {
                ...state,
                awayCount: state.awayCount + 1,
                awaySince: Date.now(),
              });
            } else if (rec.event_type === "back" && state.awaySince !== null) {
              next.set(rec.enrollment_id, {
                awayCount: state.awayCount,
                awayMs: state.awayMs + (Date.now() - state.awaySince),
                awaySince: null,
              });
            }
            return next;
          });
        }
      )
      .subscribe();
    const firstTick = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [lectureId]);

  // Live votes on the open round (professor-private tallies), with a 5s
  // polling fallback when realtime drops — same pattern as slide sync.
  const roundId = round?.id ?? null;
  useEffect(() => {
    if (!roundId) return;
    const supabase = createClient();
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function pollVotes() {
      const { data } = await supabase
        .from("poll_answers")
        .select("enrollment_id, phase, choice")
        .eq("round_id", roundId!);
      if (!data) return;
      setVotes(() => {
        const next = new Map<string, Partial<Record<PollPhase, number>>>();
        for (const v of data) {
          const entry = next.get(v.enrollment_id) ?? {};
          entry[v.phase] = v.choice;
          next.set(v.enrollment_id, entry);
        }
        return next;
      });
    }

    const channel = supabase
      .channel(`poll-votes:${roundId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "poll_answers",
          filter: `round_id=eq.${roundId}`,
        },
        (payload) => {
          const rec = payload.new as {
            enrollment_id?: string;
            phase?: PollPhase;
            choice?: number;
          };
          if (!rec?.enrollment_id || rec.phase === undefined) return;
          setVotes((prev) => {
            const next = new Map(prev);
            const entry = { ...(next.get(rec.enrollment_id!) ?? {}) };
            entry[rec.phase!] = rec.choice;
            next.set(rec.enrollment_id!, entry);
            return next;
          });
        }
      )
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        if (!ok && !pollTimer) {
          pollTimer = setInterval(() => void pollVotes(), 5000);
        }
        if (ok && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      });
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [roundId]);

  async function advanceStage(stage: "pair" | "revote") {
    if (!roundRef.current) return;
    setPollBusy(true);
    const result = await setPollStage(courseId, roundRef.current.id, stage);
    setPollBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    applyRound({ ...roundRef.current, stage });
  }

  async function revealResults() {
    if (!roundRef.current) return;
    setPollBusy(true);
    const result = await revealPollResults(courseId, roundRef.current.id);
    setPollBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    // Local tally so the reveal is instant; students get the DB copy.
    const answers: Array<{ phase: PollPhase; choice: number }> = [];
    votes.forEach((entry) => {
      if (entry.think !== undefined)
        answers.push({ phase: "think", choice: entry.think });
      if (entry.revote !== undefined)
        answers.push({ phase: "revote", choice: entry.revote });
    });
    applyRound({
      ...roundRef.current,
      stage: "reveal",
      results: tallyVotes(answers, roundRef.current.options.length),
    });
    capture("poll_revealed", {});
  }

  async function toggleCorrect(index: number) {
    if (!roundRef.current) return;
    const current = roundRef.current.correctIndices ?? [];
    const next = current.includes(index)
      ? current.filter((i) => i !== index)
      : [...current, index].sort((a, b) => a - b);
    if (next.length === 0) return; // keep at least one marked
    const result = await markPollCorrect(courseId, roundRef.current.id, next);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    applyRound({ ...roundRef.current, correctIndices: next });
  }

  function handleQuickLaunched(
    newRound: ActiveRound,
    question: PresenterQuestion
  ) {
    setLocalQuestions((prev) => [...prev, question]);
    ranRef.current.add(question.id);
    setRan(new Set(ranRef.current));
    advanceOnResumeRef.current = false;
    setVotes(new Map());
    applyRound(newRound);
    capture("poll_launched", { quick: true });
  }

  async function closeRound(advance: boolean) {
    if (!roundRef.current) return;
    setPollBusy(true);
    const result = await closePollRound(courseId, roundRef.current.id);
    setPollBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    applyRound(null);
    // Advance only when the poll inserted itself between slides (goTo
    // re-checks queued questions, so a second one at the same slide runs
    // next instead of being skipped).
    if (advance && advanceOnResumeRef.current) goTo(pageRef.current + 1);
  }

  async function handleEnd() {
    if (roundRef.current) {
      await closePollRound(courseId, roundRef.current.id);
      applyRound(null);
    }
    setEnding(true);
    const result = await endLecture(courseId, lectureId);
    setEnding(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    capture("lecture_ended", {});
    channelRef.current?.postMessage({
      type: "ended",
    } satisfies LectureSyncMessage);
    toast.success("Lecture ended.");
    router.refresh();
  }

  const elapsedMs = now ? Math.max(0, now - Date.parse(startedAt)) : 0;
  const attention = useMemo(() => {
    const rows = Object.entries(roster).map(([enrollmentId, entry]) => {
      const state = focus.get(enrollmentId);
      const awayMs =
        (state?.awayMs ?? 0) +
        (state?.awaySince && now ? Math.max(0, now - state.awaySince) : 0);
      return {
        enrollmentId,
        name: entry.name,
        photoUrl: entry.photoUrl,
        awayCount: state?.awayCount ?? 0,
        awayMs,
        isAway: Boolean(state?.awaySince),
      };
    });
    rows.sort(
      (a, b) =>
        Number(b.isAway) - Number(a.isAway) ||
        b.awayMs - a.awayMs ||
        a.name.localeCompare(b.name)
    );
    return rows;
  }, [roster, focus, now]);
  const awayNow = attention.filter((a) => a.isAway).length;
  const rosterCount = Object.keys(roster).length;

  const queued = useMemo(
    () =>
      allQuestions
        .filter((q) => !ran.has(q.id))
        .sort((a, b) => a.positionAfterPage - b.positionAfterPage),
    [allQuestions, ran]
  );

  // Professor-private live tallies for the open round.
  const pollStats = useMemo(() => {
    if (!round) return null;
    const showRevote = round.stage === "revote" || round.stage === "reveal";
    const counts = round.options.map(() => 0);
    const suggestedKey = round.questionId
      ? (allQuestions.find((q) => q.id === round.questionId)?.correctIndices ??
        [])
      : [];
    let thinkCount = 0;
    let revoteCount = 0;
    let thinkCorrect = 0;
    votes.forEach((entry) => {
      if (entry.think !== undefined) {
        thinkCount += 1;
        if (suggestedKey.includes(entry.think)) thinkCorrect += 1;
      }
      if (entry.revote !== undefined) revoteCount += 1;
      const shown = showRevote ? entry.revote : entry.think;
      if (shown !== undefined && shown >= 0 && shown < counts.length) {
        counts[shown] += 1;
      }
    });
    return {
      counts,
      thinkCount,
      revoteCount,
      suggestedKey,
      guidance:
        suggestedKey.length > 0
          ? firstVoteGuidance(thinkCorrect, thinkCount)
          : null,
    };
  }, [round, votes, allQuestions]);

  const stageLabel: Record<PollStage, string> = {
    think: "Think — students answer on their own.",
    pair: "Pair — partners are assigned and debating.",
    revote: "Re-vote — did anyone get convinced?",
    reveal: "Reveal — click an option to mark it correct.",
    closed: "",
  };
  // No key on the question and none marked = opinion question.
  const isOpinionRound =
    Boolean(round) &&
    (round?.correctIndices?.length ?? 0) === 0 &&
    (pollStats?.suggestedKey.length ?? 0) === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="grid content-start gap-4">
        {deckKind === "pdf" && fileUrl ? (
          <SlideViewer
            fileUrl={fileUrl}
            page={page}
            onPageCount={(n) => setTotalPages(n)}
            className="w-full"
          />
        ) : embedUrl ? (
          <iframe
            src={embedUrl}
            title={deckTitle}
            className="aspect-video w-full rounded-lg border"
            allowFullScreen
          />
        ) : null}

        {deckKind === "pdf" && (
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goTo(page - 1)}
              disabled={page <= 1}
              aria-label="Previous slide"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-24 text-center text-sm tabular-nums text-muted-foreground">
              Slide {page}
              {totalPages ? ` of ${totalPages}` : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goTo(page + 1)}
              disabled={totalPages !== null && page >= totalPages}
              aria-label="Next slide"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{deckTitle}</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <Timer className="size-3.5" />
              Live for {formatAwayDuration(elapsedMs)}
              {deckKind === "google_slides" && " · slides unsynced (embed)"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button className="w-full" onClick={openStage}>
              <MonitorUp className="mr-2 size-4" /> Project slides
            </Button>
            <p className="text-xs text-muted-foreground">
              Opens a clean slides-only window — drag it to the projector
              screen and click Fullscreen. This window stays your private
              dashboard.
            </p>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => void handleEnd()}
              disabled={ending}
            >
              <Square className="mr-2 size-4" /> End lecture
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <EyeOff className="size-4" /> Attention
            </CardTitle>
            <CardDescription>
              {awayNow === 0
                ? "Everyone's tab is on the lecture."
                : `${awayNow} ${awayNow === 1 ? "student is" : "students are"} away right now.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Students appear here as they join.
              </p>
            ) : (
              <ul className="grid max-h-80 gap-2 overflow-y-auto">
                {attention.map((a) => (
                  <li key={a.enrollmentId} className="flex items-center gap-2.5">
                    <Avatar className="size-7">
                      {a.photoUrl && (
                        <AvatarImage src={a.photoUrl} alt={a.name} />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {initials(a.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate text-sm">{a.name}</span>
                    {a.isAway ? (
                      <Badge variant="destructive">away</Badge>
                    ) : a.awayCount > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {a.awayCount}× · {formatAwayDuration(a.awayMs)}
                      </span>
                    ) : (
                      <Badge variant="secondary">focused</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card
          className={
            round ? "border-[var(--flame,#e0552f)]" : undefined
          }
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" /> Think-Pair-Share
            </CardTitle>
            <CardDescription>
              {round
                ? round.stage === "reveal" && isOpinionRound
                  ? "Reveal — opinion question; this is how the class voted."
                  : stageLabel[round.stage]
                : queued.length > 0
                  ? `${queued.length} approved ${queued.length === 1 ? "question pops" : "questions pop"} in automatically as you pass ${queued.length === 1 ? "its" : "their"} slide.`
                  : "Approve or add questions on your deck to run them live."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {round && pollStats ? (
              <>
                <p className="text-sm font-medium">{round.prompt}</p>
                <p className="text-xs text-muted-foreground">
                  {round.stage === "revote" || round.stage === "reveal"
                    ? `${pollStats.revoteCount} of ${rosterCount} re-voted`
                    : `${pollStats.thinkCount} of ${rosterCount} answered`}
                </p>
                {round.stage === "think" && pollStats.guidance && (
                  <p className="rounded-lg bg-muted p-2 text-xs">
                    <span className="font-medium">
                      {pollStats.guidance.pct}% correct so far.
                    </span>{" "}
                    {pollStats.guidance.message}
                  </p>
                )}
                {round.stage === "reveal" ? (
                  <PollResultsChart
                    options={round.options}
                    results={round.results}
                    correctIndices={round.correctIndices}
                    onSelectOption={(i) => void toggleCorrect(i)}
                  />
                ) : (
                  <ul className="grid gap-1">
                    {round.options.map((option, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {LETTERS[i]}. {option}
                          {pollStats.suggestedKey.includes(i) && (
                            <span
                              className="ml-1 text-xs text-green-700"
                              title="Your answer key"
                            >
                              ✓
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {pollStats.counts[i]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-2">
                  {round.stage === "think" && (
                    <Button
                      className="w-full"
                      onClick={() => void advanceStage("pair")}
                      disabled={pollBusy}
                    >
                      <Users className="mr-2 size-4" /> Pair & discuss
                    </Button>
                  )}
                  {round.stage === "pair" && (
                    <Button
                      className="w-full"
                      onClick={() => void advanceStage("revote")}
                      disabled={pollBusy}
                    >
                      Open re-vote
                    </Button>
                  )}
                  {(round.stage === "revote" ||
                    round.stage === "think" ||
                    round.stage === "pair") && (
                    <Button
                      variant={round.stage === "revote" ? "default" : "outline"}
                      className="w-full"
                      onClick={() => void revealResults()}
                      disabled={pollBusy}
                    >
                      Reveal results
                    </Button>
                  )}
                  {round.stage === "reveal" && (
                    <Button
                      className="w-full"
                      onClick={() => void closeRound(true)}
                      disabled={pollBusy}
                    >
                      <Play className="mr-2 size-4" /> Resume lecture
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    onClick={() => void closeRound(false)}
                    disabled={pollBusy}
                  >
                    <X className="mr-1 size-4" /> Cancel poll
                  </Button>
                </div>
              </>
            ) : (
              <>
                {queued.slice(0, 4).map((q) => (
                  <div key={q.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={q.prompt}>
                        {q.prompt}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        After slide {q.positionAfterPage}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void launchQuestion(q)}
                      disabled={pollBusy}
                      aria-label={`Launch: ${q.prompt.slice(0, 60)}`}
                    >
                      <Play className="size-4" />
                    </Button>
                  </div>
                ))}
                {queued.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nothing queued. Questions are managed on your deck in
                    Follow Along (or the Participate page) — approve some
                    before class.
                  </p>
                )}
                <QuickPollDialog
                  courseId={courseId}
                  lectureId={lectureId}
                  disabled={pollBusy}
                  onLaunched={handleQuickLaunched}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
