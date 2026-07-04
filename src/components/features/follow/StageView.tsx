"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { SlideViewer } from "@/components/features/follow/SlideViewer";
import { PollResultsChart } from "@/components/features/follow/PollResultsChart";
import { setLecturePage } from "@/server/actions/lectures";
import {
  lectureChannelName,
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
}: Props) {
  const [page, setPage] = useState(initialPage);
  const [ended, setEnded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [poll, setPoll] = useState<PollBroadcast | null>(initialPoll);
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
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function pollRound() {
      const { data } = await supabase
        .from("poll_rounds")
        .select("id, prompt, options, stage, results, correct_indices")
        .eq("lecture_id", lectureId)
        .neq("stage", "closed")
        .maybeSingle();
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

    const channel = supabase
      .channel(`stage-polls:${lectureId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "poll_rounds",
          filter: `lecture_id=eq.${lectureId}`,
        },
        (payload) => {
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
      )
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        if (!ok && !pollTimer) {
          pollTimer = setInterval(() => void pollRound(), 5000);
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
  }, [lectureId, applyPoll]);

  // Cross-device fallback: follow the lecture row like a student would.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`stage:${lectureId}`)
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
            setEnded(true);
            return;
          }
          pageRef.current = rec.current_page;
          setPage(rec.current_page);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [lectureId]);

  // The professor may click through with this window focused too.
  const goTo = useCallback(
    (next: number) => {
      // While a poll is on, the poll owns the projector — slides stay put.
      if (pollRef.current) return;
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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

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
                      {option}
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
