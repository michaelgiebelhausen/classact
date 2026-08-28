"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  MonitorUp,
  Pause,
  Play,
  Sparkles,
  Square,
  Timer,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SlideViewer } from "@/components/features/follow/SlideViewer";
import { ClassroomAttention } from "@/components/features/follow/ClassroomAttention";
import type { RoomMapSeat } from "@/components/features/rooms/RoomMap";
import { PollResultsChart } from "@/components/features/follow/PollResultsChart";
import { QuickPollDialog } from "@/components/features/follow/QuickPollDialog";
import { PollCommandStrip } from "@/components/features/follow/PollCommandStrip";
import { PollOfferStrip } from "@/components/features/follow/PollOfferStrip";
import { PollStageStepper } from "@/components/features/follow/PollStageStepper";
import { RunActivityControl } from "@/components/features/follow/RunActivityControl";
import {
  ExerciseLaunchDialog,
  type StartedExercise,
} from "@/components/features/follow/ExerciseLaunchDialog";
import { ExerciseStatusCard } from "@/components/features/follow/ExerciseStatusCard";
import {
  endLecture,
  pauseLecture,
  resumeLecture,
  setLecturePage,
} from "@/server/actions/lectures";
import {
  closePollRound,
  launchPollRound,
  markPollCorrect,
  revealPollResults,
  setPollStage,
} from "@/server/actions/polls";
import {
  effectiveAwayMs,
  formatAwayDuration,
  isLecturePaused,
  type PauseInterval,
} from "@/lib/focus";
import { firstVoteGuidance, tallyVotes } from "@/lib/participate";
import { decideNavigation } from "@/lib/presenternav";
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
  /** Pause windows so far; open pause = lecture paused right now. */
  initialPauses: PauseInterval[];
  /** Room geometry for the classroom view (empty = no seat map yet). */
  seats: RoomMapSeat[];
  /** seatId → enrollmentId from today's check-ins. */
  occupants: Record<string, string>;
  /** Approved think-pair-share questions for this deck. */
  questions: PresenterQuestion[];
  /** Question ids already run (any round) in this lecture. */
  ranQuestionIds: string[];
  /** The open round, when the page loads mid-poll. */
  initialRound: ActiveRound | null;
  /** Votes already recorded on the open round. */
  initialVotes: PresenterVote[];
  /** A group exercise already running when the page loads. */
  initialExercise: PresenterExercise | null;
}

/** A live one-minute paper, as the presenter tracks it. */
export interface PresenterExercise {
  roundId: string;
  prompt: string;
  groupCount: number;
  /** Groups that have written something so far. */
  answered: number;
}

interface FocusState {
  awayCount: number;
  awayMs: number;
  awaySince: number | null;
}

/** A question boundary the professor has been asked about but not answered. */
interface PollOffer {
  /** Slide the question is pinned after. */
  position: number;
  questionIds: string[];
  /** The stage window already moved on; this is an after-the-fact offer. */
  alreadyAdvanced: boolean;
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
  initialPauses,
  seats,
  occupants,
  questions,
  ranQuestionIds,
  initialRound,
  initialVotes,
  initialExercise,
}: Props) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState<number | null>(pageCount);
  const [ending, setEnding] = useState(false);
  const [pauses, setPauses] = useState<PauseInterval[]>(initialPauses);
  const pausesRef = useRef<PauseInterval[]>(initialPauses);
  const [pauseBusy, setPauseBusy] = useState(false);
  const paused = isLecturePaused(pauses);
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
  const exerciseCardRef = useRef<HTMLDivElement | null>(null);

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
  // Mirrored so goTo can see it without being rebuilt on every toggle — a
  // keypress must never race a launch that's already in flight.
  const pollBusyRef = useRef(false);
  const setBusy = useCallback((value: boolean) => {
    pollBusyRef.current = value;
    setPollBusy(value);
  }, []);

  // A queued question waiting at a slide boundary, asking to be run. Nothing
  // reaches the projector until the professor answers this.
  const [offer, setOffer] = useState<PollOffer | null>(null);
  const offerRef = useRef<PollOffer | null>(null);
  const applyOffer = useCallback((next: PollOffer | null) => {
    offerRef.current = next;
    setOffer(next);
  }, []);
  // Boundaries the professor has chosen to walk past; we don't ask twice.
  const skippedRef = useRef<Set<number>>(new Set());

  // Overlays that own the keyboard while they're up, so arrow keys don't
  // flip slides behind an open menu or dialog.
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickPollOpen, setQuickPollOpen] = useState(false);
  const [exerciseDialogOpen, setExerciseDialogOpen] = useState(false);

  // A group exercise running alongside the lecture.
  const [exercise, setExercise] = useState<StartedExercise | null>(
    initialExercise
  );
  const [exerciseAnswered, setExerciseAnswered] = useState(
    initialExercise?.answered ?? 0
  );

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
      setBusy(true);
      const result = await launchPollRound(courseId, lectureId, question.id);
      setBusy(false);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Couldn't launch the poll." : result.error);
        return;
      }
      // The offer has been answered; don't let it linger behind the poll.
      applyOffer(null);
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
    [applyRound, applyOffer, courseId, lectureId, setBusy]
  );

  const goTo = useCallback(
    (next: number) => {
      // Every rule about what a keypress means lives in decideNavigation, so
      // it can be tested without a browser. This is just the side effects.
      const decision = decideNavigation({
        requested: next,
        current: pageRef.current,
        totalPages,
        pollOpen: Boolean(roundRef.current),
        busy: pollBusyRef.current,
        offerArmedAt: offerRef.current?.position ?? null,
        skipped: skippedRef.current,
        ran: ranRef.current,
        questions: allQuestions,
      });

      if (decision.kind === "none") return;

      if (decision.kind === "blocked") {
        // Silence here is what cost a lecture: the professor pressed the key
        // repeatedly and the room never told them why nothing moved.
        if (decision.reason === "poll") {
          toast.info(
            "A poll is on screen — slides are paused. End the poll to keep moving.",
            { id: "poll-nav" }
          );
        }
        return;
      }

      if (decision.kind === "offer") {
        applyOffer({
          position: decision.position,
          questionIds: decision.questionIds,
          alreadyAdvanced: false,
        });
        return;
      }

      if (decision.crossedPosition !== null) {
        skippedRef.current.add(decision.crossedPosition);
      }
      applyOffer(null);
      pageRef.current = decision.page;
      setPage(decision.page);
      channelRef.current?.postMessage({
        type: "page",
        page: decision.page,
      } satisfies LectureSyncMessage);
      void setLecturePage(courseId, lectureId, decision.page).then((result) => {
        if (!result.ok) toast.error(result.error);
      });
    },
    [courseId, lectureId, totalPages, allQuestions, applyOffer]
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
        // The stage window doesn't know about queued questions. If its
        // advance crossed one, mention it here rather than seizing the
        // projector the professor is presenting from.
        if (!roundRef.current && e.data.page === previous + 1) {
          const waiting = allQuestions.filter(
            (q) =>
              q.positionAfterPage === previous &&
              !ranRef.current.has(q.id) &&
              !skippedRef.current.has(previous)
          );
          if (waiting.length > 0) {
            applyOffer({
              position: previous,
              questionIds: waiting.map((q) => q.id),
              alreadyAdvanced: true,
            });
          }
        }
      }
      // The projector closed the poll (Esc over there). Catch up without
      // rebroadcasting — it already told everyone.
      if (
        e.data?.type === "poll-closed" &&
        roundRef.current?.id === e.data.roundId
      ) {
        roundRef.current = null;
        setRound(null);
        advanceOnResumeRef.current = false;
      }
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [lectureId, allQuestions, applyOffer]);

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
      // An open menu or dialog owns the arrows; moving the deck underneath it
      // is never what the keypress meant.
      if (menuOpen || quickPollOpen) return;
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
  }, [page, goTo, menuOpen, quickPollOpen]);

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
                // Stepping out during a pause is sanctioned — don't tally it.
                awayCount: isLecturePaused(pausesRef.current)
                  ? state.awayCount
                  : state.awayCount + 1,
                awaySince: Date.now(),
              });
            } else if (rec.event_type === "back" && state.awaySince !== null) {
              next.set(rec.enrollment_id, {
                awayCount: state.awayCount,
                awayMs:
                  state.awayMs +
                  effectiveAwayMs(
                    state.awaySince,
                    Date.now(),
                    pausesRef.current,
                    Date.now()
                  ),
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
    setBusy(true);
    const result = await setPollStage(courseId, roundRef.current.id, stage);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    applyRound({ ...roundRef.current, stage });
  }

  async function revealResults() {
    if (!roundRef.current) return;
    setBusy(true);
    const result = await revealPollResults(courseId, roundRef.current.id);
    setBusy(false);
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
    const closing = roundRef.current;
    if (!closing) return;
    setBusy(true);
    const result = await closePollRound(courseId, closing.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const wasAdvanceOnResume = advanceOnResumeRef.current;
    applyRound(null);

    if (advance && wasAdvanceOnResume) {
      // Step off the boundary the poll was holding. A second question pinned
      // to the same slide now *offers* itself rather than snapping open,
      // which used to read as "I closed it and it came back".
      goTo(pageRef.current + 1);
      return;
    }

    // Ended early. The question is marked as run, so it has just vanished
    // from the queue — leave a way back in case the exit was a mis-click.
    const question = allQuestions.find((q) => q.id === closing.questionId);
    if (question) {
      toast.success("Poll ended — back to slides.", {
        action: {
          label: "Relaunch",
          onClick: () => void launchQuestion(question, wasAdvanceOnResume),
        },
      });
    } else {
      toast.success("Poll ended — back to slides.");
    }
  }

  // Escape is the reflex people reach for when something has taken over the
  // screen. It had no meaning here at all, which is how a lecture ended up
  // being shut down to get out of a question.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (roundRef.current) {
        e.preventDefault();
        void closeRound(false);
      } else if (offerRef.current) {
        e.preventDefault();
        dismissOffer();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Run the question waiting at the current boundary. */
  function runOffer() {
    const current = offerRef.current;
    if (!current) return;
    const question = allQuestions.find((q) => q.id === current.questionIds[0]);
    if (!question) {
      applyOffer(null);
      return;
    }
    // Closing the poll should step off the boundary only if we're still
    // holding it — a stage-driven advance already moved past.
    void launchQuestion(question, !current.alreadyAdvanced);
  }

  /** Walk past the boundary without running anything. */
  function dismissOffer() {
    const current = offerRef.current;
    if (!current) return;
    skippedRef.current.add(current.position);
    applyOffer(null);
    if (!current.alreadyAdvanced) goTo(pageRef.current + 1);
  }

  async function togglePause() {
    setPauseBusy(true);
    const result = paused
      ? await resumeLecture(courseId, lectureId)
      : await pauseLecture(courseId, lectureId);
    setPauseBusy(false);
    if (!result.ok || !result.data) {
      toast.error(result.ok ? "Couldn't update the pause." : result.error);
      return;
    }
    pausesRef.current = result.data.pauses;
    setPauses(result.data.pauses);
    const nowPaused = isLecturePaused(result.data.pauses);
    channelRef.current?.postMessage({
      type: "pause",
      paused: nowPaused,
    } satisfies LectureSyncMessage);
    capture(nowPaused ? "lecture_paused" : "lecture_resumed", {});
    toast.success(
      nowPaused
        ? "Paused — student tab-aways aren't counted until you resume."
        : "Resumed — focus tracking is back on."
    );
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
        (state?.awaySince && now
          ? effectiveAwayMs(state.awaySince, now, pauses, now)
          : 0);
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
  }, [roster, focus, now, pauses]);
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

  const helpText = (
    <span className="grid gap-2">
      <span className="block">
        <span className="font-medium">Project slides</span> opens a clean
        slides-only window — drag it to the projector screen and click
        Fullscreen. This window stays your private dashboard.
      </span>
      <span className="block">
        <span className="font-medium">Pause lecture</span> when you send the
        class to look something up: paused time never counts against
        anyone&apos;s focus score.
      </span>
      <span className="block">
        <span className="font-medium">Think-Pair-Share</span> questions offer
        themselves as you reach their slide — nothing goes on the projector
        until you press Run question. Press → again to skip one.
      </span>
      <span className="block">
        <span className="font-medium">While a poll is up</span> the slides
        wait. Its controls stay in this bar, and{" "}
        <span className="font-medium">End poll &amp; show slides</span> (or
        Esc, here or on the projector) puts the slides back.
      </span>
    </span>
  );

  const offerQuestions = offer
    ? allQuestions.filter((q) => offer.questionIds.includes(q.id))
    : [];

  return (
    <div className="grid gap-4">
      {/*
        Controls run across the top so the room below gets the space — and
        they stay pinned there, because during a live poll the professor is
        looking at the room, not scrolling a dashboard.
      */}
      <div className="sticky top-16 z-20 grid gap-2 rounded-xl border bg-card p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0 pl-1">
          <p className="truncate text-sm font-semibold">{deckTitle}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Timer className="size-3" />
            Live for {formatAwayDuration(elapsedMs)}
            {deckKind === "google_slides" && " · slides unsynced (embed)"}
          </p>
        </div>
        <RunActivityControl
          queued={queued}
          pollOpen={Boolean(round)}
          exerciseOpen={Boolean(exercise)}
          busy={pollBusy}
          courseId={courseId}
          onLaunchQuestion={(q) => void launchQuestion(q, false)}
          onWriteQuestion={() => setQuickPollOpen(true)}
          onStartExercise={() => setExerciseDialogOpen(true)}
          onOpenChange={setMenuOpen}
        />
        {exercise && (
          <button
            type="button"
            onClick={() =>
              exerciseCardRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              })
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--flame,#e0552f)]/40 bg-[var(--flame,#e0552f)]/10 px-3 py-1 text-xs"
          >
            <span
              aria-hidden
              className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--flame,#e0552f)]"
            />
            One-minute paper · {exerciseAnswered}/{exercise.groupCount} writing
          </button>
        )}
        <Button size="sm" variant="outline" onClick={openStage}>
          <MonitorUp className="mr-2 size-4" /> Project slides
        </Button>
        <Button
          size="sm"
          variant={paused ? "default" : "outline"}
          onClick={() => void togglePause()}
          disabled={pauseBusy}
        >
          {paused ? (
            <>
              <Play className="mr-2 size-4" /> Resume
            </>
          ) : (
            <>
              <Pause className="mr-2 size-4" /> Pause lecture
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => void handleEnd()}
          disabled={ending}
        >
          <Square className="mr-2 size-4" /> End
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                aria-label="How the presenter controls work"
              >
                <HelpCircle className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              {helpText}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {round && pollStats && (
        <PollCommandStrip
          prompt={round.prompt}
          stage={round.stage}
          answered={
            round.stage === "revote" || round.stage === "reveal"
              ? pollStats.revoteCount
              : pollStats.thinkCount
          }
          total={rosterCount}
          busy={pollBusy}
          onAdvanceStage={(stage) => void advanceStage(stage)}
          onReveal={() => void revealResults()}
          onResume={() => void closeRound(true)}
          onEndPoll={() => void closeRound(false)}
        />
      )}
      </div>

      {paused && (
        <p className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">Paused.</span> Students can browse
          freely — tab-aways aren&apos;t counted until you resume.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
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
          <TooltipProvider>
            <div className="flex items-center justify-center gap-3">
              {/*
                Dimmed rather than truly disabled: a click still reaches goTo,
                which says out loud why the slides aren't moving. An inert
                button that looked clickable is what made the room feel broken.
              */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goTo(page - 1)}
                    disabled={page <= 1}
                    aria-disabled={Boolean(round) || undefined}
                    className={round ? "opacity-50" : undefined}
                    aria-label="Previous slide"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                </TooltipTrigger>
                {round && (
                  <TooltipContent side="top">
                    Slides wait while the poll is up — end it to keep moving.
                  </TooltipContent>
                )}
              </Tooltip>
              <span className="min-w-24 text-center text-sm tabular-nums text-muted-foreground">
                Slide {page}
                {totalPages ? ` of ${totalPages}` : ""}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goTo(page + 1)}
                    disabled={totalPages !== null && page >= totalPages}
                    aria-disabled={Boolean(round) || undefined}
                    className={round ? "opacity-50" : undefined}
                    aria-label="Next slide"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </TooltipTrigger>
                {round && (
                  <TooltipContent side="top">
                    Slides wait while the poll is up — end it to keep moving.
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </TooltipProvider>
        )}

        {/*
          Lives outside the pdf-only block on purpose: embedded decks get
          offered their questions too, even though their slides don't sync.
        */}
        {offer && offerQuestions.length > 0 && !round && (
          <PollOfferStrip
            prompt={offerQuestions[0].prompt}
            count={offerQuestions.length}
            alreadyAdvanced={offer.alreadyAdvanced}
            nextPage={offer.position + 1}
            busy={pollBusy}
            onRun={runOffer}
            onSkip={dismissOffer}
          />
        )}

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
                  ? `${queued.length} approved ${queued.length === 1 ? "question offers" : "questions offer"} to run as you reach ${queued.length === 1 ? "its" : "their"} slide — nothing starts until you say so.`
                  : "Approve or add questions on your deck to run them live."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {round && pollStats ? (
              <>
                <PollStageStepper stage={round.stage} />
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
                  {/*
                    A quieter twin of the strip's exit, for professors already
                    reading the tallies down here. At reveal nothing is being
                    cancelled — the question ran.
                  */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    onClick={() => void closeRound(false)}
                    disabled={pollBusy}
                  >
                    <X className="mr-1 size-4" />
                    {round.stage === "reveal" ? "Close poll" : "Cancel poll"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/*
                  Read-only now. Launching lives in Run activity up top, so
                  there's one place to start a question rather than two that
                  can tell different stories about what's running.
                */}
                {queued.length > 0 && (
                  <p className="text-xs font-medium text-muted-foreground">
                    Up next
                  </p>
                )}
                {queued.slice(0, 4).map((q) => (
                  <div key={q.id} className="min-w-0">
                    <p className="truncate text-sm" title={q.prompt}>
                      {q.prompt}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      After slide {q.positionAfterPage}
                    </p>
                  </div>
                ))}
                {queued.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nothing queued for this deck. Use{" "}
                    <span className="font-medium">Run activity</span> above to
                    write a question on the spot, or open the question bank in
                    a new tab to generate and approve some.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {exercise && (
          <div ref={exerciseCardRef}>
            <ExerciseStatusCard
              courseId={courseId}
              roundId={exercise.roundId}
              prompt={exercise.prompt}
              groupCount={exercise.groupCount}
              initialAnswered={exerciseAnswered}
              onClosed={() => {
                setExercise(null);
                setExerciseAnswered(0);
              }}
              onProgress={setExerciseAnswered}
            />
          </div>
        )}
      </div>

      {/* The room: who's here, where they're sitting, who's drifted. */}
      <div className="grid content-start gap-4">
        <ClassroomAttention
          seats={seats}
          occupants={occupants}
          attention={attention}
          paused={paused}
        />
      </div>

      {/*
        Mounted once, outside the card, so Run activity can reach it whatever
        the card happens to be showing.
      */}
      <QuickPollDialog
        courseId={courseId}
        lectureId={lectureId}
        disabled={pollBusy}
        onLaunched={handleQuickLaunched}
        open={quickPollOpen}
        onOpenChange={setQuickPollOpen}
        hideTrigger
      />
      <ExerciseLaunchDialog
        courseId={courseId}
        open={exerciseDialogOpen}
        onOpenChange={setExerciseDialogOpen}
        onStarted={(started) => {
          setExercise(started);
          setExerciseAnswered(0);
        }}
      />
      </div>
    </div>
  );
}
