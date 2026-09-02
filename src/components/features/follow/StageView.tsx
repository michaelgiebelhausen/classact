"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { SlideViewer } from "@/components/features/follow/SlideViewer";
import { PollResultsChart } from "@/components/features/follow/PollResultsChart";
import { setLecturePage } from "@/server/actions/lectures";
import { closePollRound } from "@/server/actions/polls";
import { pollOptionText } from "@/lib/participate";
import { subscribeWithRecovery } from "@/lib/live-sync";
import {
  LECTURE_LIVE_EVENT,
  lectureChannelName,
  lectureLiveTopic,
  type LectureLiveState,
  type LectureSyncMessage,
  type PollBroadcast,
} from "@/lib/lecturesync";
import type { PollResults, PollStage } from "@/types/db";

const LETTERS = "ABCDEFGH";

interface Props {
  courseId: string;
  lectureId: string;
  initialPage: number;
  pageCount: number | null;
  deckTitle: string;
  deckKind: "pdf" | "google_slides";
  fileUrl: string | null;
  embedUrl: string | null;
  /** Open round when the window is opened mid-poll. */
  initialPoll: PollBroadcast | null;
  /** Whether the lecture is paused when the window opens. */
  initialPaused: boolean;
}

/**
 * The projector surface: nothing but the slide, full-bleed on black. Opened
 * as a popup from the presenter and dragged to the second screen. Syncs
 * instantly with the presenter window via BroadcastChannel, with Supabase
 * Realtime as the cross-device fallback.
 */
export function StageView({
  courseId,
  lectureId,
  initialPage,
  pageCount,
  deckTitle,
  deckKind,
  fileUrl,
  embedUrl,
  initialPoll,
  initialPaused,
}: Props) {
  const [page, setPage] = useState(initialPage);
  const [ended, setEnded] = useState(false);
  const [paused, setPaused] = useState(initialPaused);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [poll, setPoll] = useState<PollBroadcast | null>(initialPoll);
  // Brief on-screen answer to "why isn't the slide moving?".
  const [nudge, setNudge] = useState(false);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards a double-Esc while the close request is still in flight.
  const closingRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pageRef = useRef(initialPage);
  const pollRef = useRef<PollBroadcast | null>(initialPoll);

  const applyPoll = useCallback((next: PollBroadcast | null) => {
    pollRef.current = next;
    setPoll(next);
  }, []);

  // Same-browser sync with the presenter window.
  useEffect(() => {
    const channel = new BroadcastChannel(lectureChannelName(lectureId));
    channelRef.current = channel;
    channel.onmessage = (e: MessageEvent<LectureSyncMessage>) => {
      if (e.data?.type === "page") {
        pageRef.current = e.data.page;
        setPage(e.data.page);
      } else if (e.data?.type === "poll") {
        applyPoll(e.data.poll);
      } else if (e.data?.type === "pause") {
        setPaused(e.data.paused);
      } else if (e.data?.type === "ended") {
        setEnded(true);
      }
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [lectureId, applyPoll]);

  // Cross-device fallback for polls: follow the round rows directly, with a
  // 5s polling fallback when realtime drops (same pattern as slide sync).
  useEffect(() => {
    const supabase = createClient();
    // Fresher-realtime guard: a slow catch-up defers to any realtime poll event
    // that landed while it was in flight.
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
        if (pollRef.current) applyPoll(null);
        return;
      }
      const next = {
        roundId: data.id,
        prompt: data.prompt,
        options: data.options,
        stage: data.stage,
        results: data.results,
        correctIndices: data.correct_indices,
      };
      if (JSON.stringify(next) !== JSON.stringify(pollRef.current)) {
        applyPoll(next);
      }
    }

    return subscribeWithRecovery({
      client: supabase,
      topic: (g) => `stage-polls:${lectureId}:${g}`,
      bind: (channel) =>
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "poll_rounds",
            filter: `lecture_id=eq.${lectureId}`,
          },
          (payload) => {
            realtimeSeq++;
            const rec = payload.new as {
              id?: string;
              prompt?: string;
              options?: string[];
              stage?: PollStage;
              results?: PollResults | null;
              correct_indices?: number[] | null;
            };
            if (!rec?.id || !rec.stage) return;
            if (rec.stage === "closed") {
              if (pollRef.current?.roundId === rec.id) applyPoll(null);
              return;
            }
            applyPoll({
              roundId: rec.id,
              prompt: rec.prompt ?? pollRef.current?.prompt ?? "",
              options: rec.options ?? pollRef.current?.options ?? [],
              stage: rec.stage,
              results: rec.results ?? null,
              correctIndices: rec.correct_indices ?? null,
            });
          }
        ),
      catchUp: pollRound,
    });
  }, [lectureId, applyPoll]);

  // Cross-device fallback: follow the lecture broadcast like a student would
  // — with a 5s poll when realtime is down and an authoritative catch-up on
  // wake. A projector that slept or lost Wi-Fi missed every advance made in
  // the gap (broadcast never replays), so it must re-read the current slide
  // on return rather than trust a possibly-zombie socket.
  useEffect(() => {
    const supabase = createClient();
    // Bumped on every realtime apply, so a slow catch-up SELECT bows out if a
    // fresher realtime update landed while it was in flight (no backward jump).
    let realtimeSeq = 0;

    function applyRow(rec: {
      current_page: number;
      ended_at: string | null;
      pauses?: Array<{ start: string; end: string | null }> | null;
    }) {
      if (rec.ended_at) {
        setEnded(true);
        return;
      }
      pageRef.current = rec.current_page;
      setPage(rec.current_page);
      if (rec.pauses) {
        const last = rec.pauses[rec.pauses.length - 1];
        setPaused(Boolean(last && last.end === null));
      }
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

    // Same safety re-read as the student view, for a broadcast that never
    // arrived. One projector, so the cadence hardly matters; keep it in step.
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
    });
    return () => {
      if (safety) clearTimeout(safety);
      stop();
    };
  }, [lectureId]);

  // The professor may click through with this window focused too.
  const goTo = useCallback(
    (next: number) => {
      // While a poll is on, the poll owns the projector — slides stay put.
      // Say so, briefly, instead of swallowing the keypress in silence.
      if (pollRef.current) {
        setNudge(true);
        if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
        nudgeTimer.current = setTimeout(() => setNudge(false), 4000);
        return;
      }
      const clamped = Math.max(1, pageCount ? Math.min(next, pageCount) : next);
      if (clamped === pageRef.current) return;
      pageRef.current = clamped;
      setPage(clamped);
      channelRef.current?.postMessage({
        type: "page",
        page: clamped,
      } satisfies LectureSyncMessage);
      // Persist; non-professors' attempts fail silently and realtime corrects.
      void setLecturePage(courseId, lectureId, clamped);
    },
    [courseId, lectureId, pageCount]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goTo(pageRef.current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goTo(pageRef.current - 1);
      } else if (e.key === "Escape" && pollRef.current && !closingRef.current) {
        // The professor is standing at the projector, not the laptop. Give
        // them a way out from here rather than making them go find it.
        // Not preventDefault'd: Esc also leaves fullscreen, which we can't
        // suppress anyway, and double-click restores it.
        const roundId = pollRef.current.roundId;
        closingRef.current = true;
        void closePollRound(courseId, roundId).then((result) => {
          closingRef.current = false;
          // Anyone but the professor is rejected here; realtime keeps their
          // screen honest, so a failure just means nothing happens.
          if (!result.ok) return;
          channelRef.current?.postMessage({
            type: "poll-closed",
            roundId,
          } satisfies LectureSyncMessage);
          applyPoll(null);
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, applyPoll, courseId]);

  useEffect(
    () => () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    },
    []
  );

  // Track fullscreen so the hint button hides while projecting.
  useEffect(() => {
    function onChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Some browsers refuse; F11 still works.
    }
  }

  if (ended) {
    return (
      <div className="grid h-screen place-items-center bg-black text-white/70">
        <div className="text-center">
          <p className="text-2xl font-semibold">Lecture ended</p>
          <p className="mt-2 text-sm">You can close this window.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black"
      onDoubleClick={() => void toggleFullscreen()}
    >
      {deckKind === "pdf" && fileUrl ? (
        <SlideViewer
          fileUrl={fileUrl}
          page={page}
          fit="contain"
          className="flex h-full w-full items-center justify-center"
        />
      ) : embedUrl ? (
        <iframe
          src={embedUrl}
          title={deckTitle}
          className="h-full w-full"
          allowFullScreen
        />
      ) : null}

      {poll && (
        <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-black p-[6vmin] text-white">
          <div className="w-full max-w-4xl">
            <p className="text-sm font-medium uppercase tracking-widest text-white/50">
              {poll.stage === "think" && "Think — answer on your own device"}
              {poll.stage === "pair" && "Pair — discuss with your partner"}
              {poll.stage === "revote" && "Re-vote — answer again"}
              {poll.stage === "reveal" && "Results"}
            </p>
            <h1 className="mt-4 text-balance text-[clamp(1.5rem,4vmin,3rem)] font-semibold leading-tight">
              {poll.prompt}
            </h1>
            <div className="mt-8">
              {poll.stage === "reveal" ? (
                <PollResultsChart
                  options={poll.options}
                  results={poll.results}
                  correctIndices={poll.correctIndices}
                  variant="dark"
                />
              ) : poll.stage === "pair" ? (
                <div className="flex items-center gap-4 rounded-xl bg-white/5 p-6 text-white/80">
                  <Users className="size-10 shrink-0" />
                  <p className="text-[clamp(1rem,2.5vmin,1.5rem)]">
                    Your partner is on your screen — explain your reasoning and
                    try to convince each other.
                  </p>
                </div>
              ) : (
                <ul className="grid gap-3">
                  {poll.options.map((option, i) => (
                    <li
                      key={i}
                      className="rounded-xl bg-white/5 px-5 py-4 text-[clamp(1rem,2.8vmin,1.75rem)]"
                    >
                      <span className="mr-3 font-semibold text-white/60">
                        {LETTERS[i]}.
                      </span>
                      {pollOptionText(option, i)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {(poll.stage === "think" || poll.stage === "revote") && (
              <p className="mt-8 text-[clamp(0.875rem,2vmin,1.25rem)] text-white/50">
                Answer on your own computer — Follow Along → Participate.
              </p>
            )}
          </div>

          {/*
            Faint enough that the room won't read it, present enough that the
            professor standing here has an answer when the arrow key does
            nothing. It brightens when they press one.
          */}
          <p
            className={
              nudge
                ? "absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80 transition-all"
                : "absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/25 transition-all"
            }
          >
            {nudge
              ? "A poll is on screen — press Esc to return to the slides"
              : "Esc returns to slides"}
          </p>
        </div>
      )}

      {paused && !poll && (
        <div className="absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-full bg-white/10 px-6 py-2.5 text-center text-[clamp(0.875rem,2vmin,1.25rem)] font-medium text-white/90 backdrop-blur">
          Lecture paused — browse away, it doesn&apos;t count. Come back when
          your professor resumes.
        </div>
      )}

      {!isFullscreen && (
        <button
          onClick={() => void toggleFullscreen()}
          className="absolute right-4 top-4 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80 backdrop-blur transition-colors hover:bg-white/20"
        >
          <Maximize2 className="size-4" /> Fullscreen (or press F11)
        </button>
      )}
    </div>
  );
}
