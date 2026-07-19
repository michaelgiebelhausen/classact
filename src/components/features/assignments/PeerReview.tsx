"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { rubricPing } from "@/server/actions/assignments";
import { getPairPdfUrls, submitVerdict } from "@/server/actions/grading";
import { ComparePair, VERDICT_LABELS } from "./ComparePair";
import type { PairType, RubricThemeRow } from "@/types/db";

/**
 * Student peer grading: the consensus rubric is the mandatory first stop
 * (time here is itself a statistic), then the assigned pairs — one may
 * contain your own work, and you're told so up front: you're scored on how
 * honestly you place it. Every vote is a bet against the settled ranking.
 */

export interface PeerPairView {
  comparisonId: string;
  pairType: PairType;
  position: number;
  verdict: number | null;
  containsMine: boolean;
  mineIsRight: boolean;
}

interface Props {
  assignmentId: string;
  themes: Array<
    Pick<RubricThemeRow, "id" | "name" | "description" | "provenance"> & {
      quotes: string[];
    }
  >;
  pairs: PeerPairView[];
  peerCloseAt: string;
}

export function PeerReview({ assignmentId, themes, pairs, peerCloseAt }: Props) {
  const router = useRouter();
  const [entered, setEntered] = useState(false);
  const [activePair, setActivePair] = useState(0);
  const [urls, setUrls] = useState<Record<string, { left: string; right: string }>>({});
  const [verdicts, setVerdicts] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(pairs.map((p) => [p.comparisonId, p.verdict]))
  );
  const [submitting, setSubmitting] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...pairs].sort((a, b) => a.position - b.position),
    [pairs]
  );
  const hasSelfPair = ordered.some((p) => p.containsMine);
  const decidedCount = ordered.filter(
    (p) => verdicts[p.comparisonId] !== null && verdicts[p.comparisonId] !== undefined
  ).length;

  // Time on the rubric is a statistic — ping while it's the active view.
  useEffect(() => {
    if (entered) return;
    const timer = setInterval(() => {
      void rubricPing(assignmentId, 15);
    }, 15_000);
    return () => clearInterval(timer);
  }, [entered, assignmentId]);

  async function openPair(index: number) {
    setActivePair(index);
    setEntered(true);
    const pair = ordered[index];
    if (pair && !urls[pair.comparisonId]) {
      const result = await getPairPdfUrls(pair.comparisonId);
      if (result.ok && result.data) {
        const data = result.data;
        setUrls((prev) => ({ ...prev, [pair.comparisonId]: data }));
      } else {
        toast.error(result.ok ? "Couldn't open the PDFs." : result.error);
      }
    }
  }

  async function decide(comparisonId: string, verdict: number) {
    setSubmitting(comparisonId);
    const result = await submitVerdict(comparisonId, verdict);
    setSubmitting(null);
    if (result.ok) {
      setVerdicts((prev) => ({ ...prev, [comparisonId]: verdict }));
      toast.success(`Recorded: ${VERDICT_LABELS[verdict + 2]}.`);
      if (decidedCount + 1 === ordered.length) {
        toast.message("All pairs judged — your taste score settles when grading closes.");
        router.refresh();
      }
    } else {
      toast.error(result.error);
    }
  }

  if (!entered) {
    return (
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Your class&apos;s standard</CardTitle>
            <CardDescription>
              This rubric emerged from the whole class&apos;s taste files —
              these are your classmates&apos; own words. Read it carefully:
              it&apos;s what you&apos;re about to judge against, and time
              spent here counts toward your metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {themes.map((t) => (
              <div key={t.id} className="rounded-lg border p-4">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  <Badge variant="outline">
                    {t.provenance === "class"
                      ? "class-defined"
                      : t.provenance === "both"
                        ? "class + professor"
                        : "professor"}
                  </Badge>
                </p>
                {t.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                )}
                <ul className="mt-2 grid gap-1">
                  {t.quotes.slice(0, 4).map((q, i) => (
                    <li key={i} className="text-sm italic text-muted-foreground">
                      &ldquo;{q}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>How this works</CardTitle>
            <CardDescription>
              You&apos;ll judge {ordered.length} pairs of anonymous
              submissions side by side.
              {hasSelfPair &&
                " One pair contains your own work — you'll be scored on how honestly you place it."}{" "}
              Your calls move the real rankings, and each one is also a bet:
              agreeing with where the class and professor finally land raises
              your &ldquo;recognizes good work&rdquo; score. Window closes{" "}
              {new Date(peerCloseAt).toLocaleString()}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => openPair(0)}>Start judging</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pair = ordered[activePair];
  if (!pair) return null;
  const pairUrls = urls[pair.comparisonId];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {ordered.map((p, i) => (
          <Button
            key={p.comparisonId}
            size="sm"
            variant={i === activePair ? "default" : "outline"}
            onClick={() => openPair(i)}
          >
            Pair {i + 1}
            {verdicts[p.comparisonId] !== null && verdicts[p.comparisonId] !== undefined
              ? " ✓"
              : ""}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setEntered(false)}>
          Review the rubric
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          {decidedCount}/{ordered.length} decided — you can revise until the window closes
        </span>
      </div>

      {pair.containsMine && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <span className="font-medium">Heads up:</span> one of these is your
          own submission ({pair.mineIsRight ? "right" : "left"} side). Judge it
          like a stranger&apos;s — your self-honesty score comes from this call.
        </div>
      )}

      <ComparePair
        leftUrl={pairUrls?.left ?? null}
        rightUrl={pairUrls?.right ?? null}
        verdict={verdicts[pair.comparisonId] ?? null}
        busy={submitting === pair.comparisonId}
        onVerdict={(v) => decide(pair.comparisonId, v)}
      />
    </div>
  );
}
