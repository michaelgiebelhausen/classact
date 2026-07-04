"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { SlideViewer } from "@/components/features/follow/SlideViewer";
import { setLecturePage } from "@/server/actions/lectures";
import { lectureChannelName, type LectureSyncMessage } from "@/lib/lecturesync";

interface Props {
  courseId: string;
  lectureId: string;
  initialPage: number;
  pageCount: number | null;
  deckTitle: string;
  deckKind: "pdf" | "google_slides";
  fileUrl: string | null;
  embedUrl: string | null;
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
}: Props) {
  const [page, setPage] = useState(initialPage);
  const [ended, setEnded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pageRef = useRef(initialPage);

  // Same-browser sync with the presenter window.
  useEffect(() => {
    const channel = new BroadcastChannel(lectureChannelName(lectureId));
    channelRef.current = channel;
    channel.onmessage = (e: MessageEvent<LectureSyncMessage>) => {
      if (e.data?.type === "page") {
        pageRef.current = e.data.page;
        setPage(e.data.page);
      } else if (e.data?.type === "ended") {
        setEnded(true);
      }
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [lectureId]);

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
