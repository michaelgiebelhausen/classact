"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Eye, NotebookPen, Radio, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SlideViewer } from "@/components/features/follow/SlideViewer";
import { recordFocusEvent, saveLectureNotes } from "@/server/actions/lectures";
import { formatAwayDuration } from "@/lib/focus";
import { capture } from "@/lib/analytics";

interface Props {
  courseId: string;
  lectureId: string;
  initialPage: number;
  deckTitle: string;
  deckKind: "pdf" | "google_slides";
  fileUrl: string | null;
  embedUrl: string | null;
  initialNotes: string;
  /** Prior focus tally for this lecture (survives refreshes). */
  initialAwayCount: number;
  initialAwayMs: number;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function StudentFollow({
  courseId,
  lectureId,
  initialPage,
  deckTitle,
  deckKind,
  fileUrl,
  embedUrl,
  initialNotes,
  initialAwayCount,
  initialAwayMs,
}: Props) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [live, setLive] = useState(true);
  const [notes, setNotes] = useState(initialNotes);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [awayCount, setAwayCount] = useState(initialAwayCount);
  const [awayMs, setAwayMs] = useState(initialAwayMs);
  const [warning, setWarning] = useState<{ durationMs: number } | null>(null);

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

        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
              <Sparkles className="size-4" /> Participate
            </CardTitle>
            <CardDescription>
              Think-pair-share questions will pop in here when your professor
              launches one.
            </CardDescription>
          </CardHeader>
        </Card>
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
