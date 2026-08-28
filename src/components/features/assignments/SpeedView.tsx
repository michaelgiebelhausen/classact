"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSubmissionReview } from "@/server/actions/grading";
import { DocPane, type PairDocKind } from "./DocPane";

/**
 * One submission, open for reading — the "speed" in speed grading. The work
 * itself sits beside what the AI saw in it, so the professor can check a
 * placement without leaving the list.
 */

interface Props {
  assignmentId: string;
  submissionId: string;
  studentName: string;
  onClose: () => void;
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
}: Props) {
  // Keyed by submission rather than cleared on change: resetting state in the
  // effect body would cascade a second render on every open.
  const [loaded, setLoaded] = useState<{
    id: string;
    review: Review | null;
    error: string | null;
  } | null>(null);

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

  const current = loaded?.id === submissionId ? loaded : null;
  const review = current?.review ?? null;
  const error = current?.error ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{studentName}</CardTitle>
          <CardDescription>
            {review?.summary || (error ?? "Opening…")}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="overflow-hidden rounded-md border">
          <DocPane
            url={review?.url ?? null}
            label={studentName}
            kind={review?.kind}
            heightClass="h-[520px]"
          />
        </div>

        <div className="grid content-start gap-3 text-sm">
          {review && (
            <>
              <div className="flex flex-wrap gap-2">
                {review.ownBar !== null && (
                  <Badge variant="outline">
                    Own bar {Math.round(review.ownBar)}/10
                  </Badge>
                )}
                {review.distinctiveness !== null && (
                  <Badge variant="outline">
                    {review.distinctiveness >= 5 ? "Distinctive" : "Generic"}{" "}
                    {Math.round(review.distinctiveness)}/10
                  </Badge>
                )}
              </div>

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

              {review.note && (
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Their note
                  </p>
                  <p className="mt-1">{review.note}</p>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
