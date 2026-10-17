"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ZoomIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSubmissionReview } from "@/server/actions/grading";
import { DocPane, type PairDocKind } from "./DocPane";

/**
 * One submission, open for reading — the "speed" in speed grading. On a wide
 * screen it stands beside the list and the work fills it; the per-theme
 * scores already sit on the row, so here they fold away behind "why", one
 * click from the evidence. Previous and next walk the list without leaving
 * the work.
 */

interface Props {
  assignmentId: string;
  submissionId: string;
  studentName: string;
  onClose: () => void;
  /** Open the student above / below in the list; absent at either end. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Tailwind height class for the work itself. */
  docHeightClass?: string;
}

interface Review {
  url: string;
  kind: PairDocKind;
  note: string;
  summary: string;
  ownBar: number | null;
  distinctiveness: number | null;
  themeScores: Array<{ name: string; score: number; evidence: string }>;
}

function Meter({ value, max = 10 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex h-1.5 w-20 overflow-hidden rounded-full bg-muted align-middle">
      <span
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }}
      />
    </span>
  );
}

export function SpeedView({
  assignmentId,
  submissionId,
  studentName,
  onClose,
  onPrev,
  onNext,
  docHeightClass = "h-[75vh]",
}: Props) {
  // Keyed by submission rather than cleared on change: resetting state in the
  // effect body would cascade a second render on every open.
  const [loaded, setLoaded] = useState<{
    id: string;
    review: Review | null;
    error: string | null;
  } | null>(null);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  // The lightbox: the work as big as the window, and for a screenshot, one
  // more click to its true pixels.
  const [zoomOpen, setZoomOpen] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getSubmissionReview(assignmentId, submissionId).then((result) => {
      if (!live) return;
      setLoaded({
        id: submissionId,
        review: result.ok && result.data ? (result.data as Review) : null,
        error: result.ok ? null : result.error,
      });
    });
    return () => {
      live = false;
    };
  }, [assignmentId, submissionId]);

  // Beside the list the view is already on screen. Stacked under it, it can
  // open far below the fold — bring it up rather than leave a long scroll.
  useEffect(() => {
    const card = cardRef.current;
    if (card && card.getBoundingClientRect().top > window.innerHeight - 120) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [submissionId]);

  const current = loaded?.id === submissionId ? loaded : null;
  const review = current?.review ?? null;
  const error = current?.error ?? null;
  const expanded = expandedFor === submissionId;
  const summary = review?.summary || (error ?? "Opening…");
  const isImage = review?.kind === "png" || review?.kind === "jpeg";

  function setZoom(open: boolean) {
    setZoomOpen(open);
    if (!open) setActualSize(false);
  }

  return (
    // scroll-mt clears the app's sticky header when this scrolls into view.
    <Card ref={cardRef} className="h-full scroll-mt-20 gap-3">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="grid min-w-0 gap-1.5">
          <CardTitle className="text-base">{studentName}</CardTitle>
          <CardDescription>
            <button
              type="button"
              onClick={() => setExpandedFor(expanded ? null : submissionId)}
              title={expanded ? "Show less" : "Show the whole summary"}
              className={[
                "text-left",
                expanded ? "" : "line-clamp-3",
              ].join(" ")}
            >
              {summary}
            </button>
          </CardDescription>
          {review && (review.ownBar !== null || review.distinctiveness !== null) && (
            <div className="flex flex-wrap gap-2">
              {review.ownBar !== null && (
                <Badge variant="outline">Own bar {Math.round(review.ownBar)}/10</Badge>
              )}
              {review.distinctiveness !== null && (
                <Badge variant="outline">
                  {review.distinctiveness >= 5 ? "Distinctive" : "Generic"}{" "}
                  {Math.round(review.distinctiveness)}/10
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onPrev}
            disabled={!onPrev}
            aria-label="Previous student"
            title="Previous student"
            className="px-2"
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onNext}
            disabled={!onNext}
            aria-label="Next student"
            title="Next student"
            className="px-2"
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
        {review?.note && (
          <div className="rounded-md border bg-muted/30 p-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Their note
            </p>
            <p className="mt-1">{review.note}</p>
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border">
          <DocPane
            url={review?.url ?? null}
            label={studentName}
            kind={review?.kind}
            heightClass={docHeightClass}
          />
          {review && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoom(true)}
              aria-label="Open full size"
              title="Open full size"
              className="absolute right-2 top-2 bg-background/90 px-2 shadow-sm backdrop-blur"
            >
              <ZoomIn className="size-4" />
            </Button>
          )}
        </div>

        {review && review.themeScores.length > 0 && (
          <details className="shrink-0 rounded-md border">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Why these scores
            </summary>
            <div className="grid max-h-56 gap-3 overflow-auto px-3 pb-3">
              {review.themeScores.map((theme, i) => (
                <div key={i} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{theme.name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Meter value={theme.score} />
                      <span className="tabular-nums">{theme.score}/10</span>
                    </span>
                  </div>
                  {theme.evidence && (
                    <p className="text-xs text-muted-foreground">{theme.evidence}</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>

      <Dialog open={zoomOpen} onOpenChange={setZoom}>
        <DialogContent className="flex h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-2 p-3 sm:max-w-[96vw]">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-base">{studentName}</DialogTitle>
            <DialogDescription>
              {isImage
                ? actualSize
                  ? "Actual size — scroll around, or click the image to fit it to the window."
                  : "Fitted to the window — click the image to see it at actual size."
                : "The submission at full window size."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20">
            {review && isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img
                src={review.url}
                alt={`${studentName} submission (image)`}
                onClick={() => setActualSize((v) => !v)}
                className={
                  actualSize
                    ? "max-w-none cursor-zoom-out"
                    : "h-full w-full cursor-zoom-in object-contain"
                }
              />
            ) : (
              review && (
                <DocPane
                  url={review.url}
                  label={studentName}
                  kind={review.kind}
                  heightClass="h-full"
                />
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
