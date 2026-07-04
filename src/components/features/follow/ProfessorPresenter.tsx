"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Sparkles,
  Square,
  Timer,
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
import { endLecture, setLecturePage } from "@/server/actions/lectures";
import { formatAwayDuration } from "@/lib/focus";
import { capture } from "@/lib/analytics";
import type { FocusEventType } from "@/types/db";

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

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(1, totalPages ? Math.min(next, totalPages) : next);
      setPage((current) => {
        if (clamped === current) return current;
        void setLecturePage(courseId, lectureId, clamped).then((result) => {
          if (!result.ok) toast.error(result.error);
        });
        return clamped;
      });
    },
    [courseId, lectureId, totalPages]
  );

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

  async function handleEnd() {
    setEnding(true);
    const result = await endLecture(courseId, lectureId);
    setEnding(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    capture("lecture_ended", {});
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
          <CardContent>
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

        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
              <Sparkles className="size-4" /> Think-Pair-Share
            </CardTitle>
            <CardDescription>
              Coming soon — AI-suggested discussion questions will pop in here
              based on your slides.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
