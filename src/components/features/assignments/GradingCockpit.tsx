"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  closePeerWindow,
  getPairPdfUrls,
  professorNextPair,
  publishAssignment,
  setCutPoints,
  submitVerdict,
} from "@/server/actions/grading";
import { ComparePair } from "./ComparePair";
import type { CutPoint } from "@/lib/tastegrading";

/**
 * The professor's grading cockpit: the avatar histogram IS the grading
 * surface. Drag the triangular cut markers to draw grade lines, click a
 * bar to spot-check a pair inside it, press "next pair" for the most
 * informative comparison (boundary-weighted), then publish — the one
 * click no grade ships without.
 */

export interface CockpitStudent {
  submissionId: string;
  name: string;
  photoUrl: string | null;
  score: number;
  rank: number;
  letter: string | null;
  comparisons: number;
}

interface Props {
  assignmentId: string;
  state: string;
  peerCloseAt: string;
  students: CockpitStudent[];
  initialCutPoints: CutPoint[];
  similarPairs: Array<{ aName: string; bName: string; similarity: number }>;
  decidedPeerVotes: number;
  totalPeerPairs: number;
  published: boolean;
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

export function GradingCockpit({
  assignmentId,
  state,
  peerCloseAt,
  students,
  initialCutPoints,
  similarPairs,
  decidedPeerVotes,
  totalPeerPairs,
  published,
}: Props) {
  const router = useRouter();
  const stripRef = useRef<HTMLDivElement>(null);
  const [binCount, setBinCount] = useState(10);
  const [cuts, setCuts] = useState<CutPoint[]>(initialCutPoints);
  const [dragging, setDragging] = useState<number | null>(null);
  const [cutsDirty, setCutsDirty] = useState(false);
  const [pair, setPair] = useState<{
    comparisonId: string;
    left: string;
    right: string;
  } | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const bins = useMemo(() => {
    const width = 100 / binCount;
    const list = Array.from({ length: binCount }, (_, i) => ({
      min: i * width,
      max: (i + 1) * width,
      students: [] as CockpitStudent[],
    }));
    for (const s of students) {
      const i = Math.min(binCount - 1, Math.floor(s.score / width));
      list[i].students.push(s);
    }
    return list;
  }, [students, binCount]);
  const tallest = Math.max(1, ...bins.map((b) => b.students.length));
  const untouched = students.filter((s) => s.comparisons === 0).length;

  function moveCut(index: number, clientX: number) {
    const strip = stripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    setCuts((prev) =>
      prev.map((c, i) => (i === index ? { ...c, min: Math.round(pct) } : c))
    );
    setCutsDirty(true);
  }

  async function saveCuts() {
    const result = await setCutPoints(assignmentId, cuts);
    if (result.ok) {
      setCutsDirty(false);
      toast.success("Cut points saved — letters updated.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function openPair(bin?: { minScore: number; maxScore: number }) {
    setPairBusy(true);
    const created = await professorNextPair(assignmentId, bin);
    if (!created.ok || !created.data) {
      setPairBusy(false);
      toast.error(created.ok ? "No pair available." : created.error);
      return;
    }
    const urls = await getPairPdfUrls(created.data.comparisonId);
    setPairBusy(false);
    if (urls.ok && urls.data) {
      setPair({ comparisonId: created.data.comparisonId, ...urls.data });
    } else {
      toast.error(urls.ok ? "Couldn't open the PDFs." : urls.error);
    }
  }

  async function decide(verdict: number) {
    if (!pair) return;
    setVerdictBusy(true);
    const result = await submitVerdict(pair.comparisonId, verdict);
    setVerdictBusy(false);
    if (result.ok) {
      toast.success("Recorded — ranking refined.");
      setPair(null);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function publish() {
    setPublishing(true);
    if (cutsDirty) await setCutPoints(assignmentId, cuts);
    const result = await publishAssignment(assignmentId);
    setPublishing(false);
    setConfirmPublish(false);
    if (result.ok) {
      toast.success("Published — students can see their reports now.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={published ? "default" : "secondary"}>
          {published
            ? "Published"
            : state === "peer_review"
              ? `Peer grading open until ${new Date(peerCloseAt).toLocaleString()}`
              : "Ready for your review"}
        </Badge>
        <Badge variant="outline">
          {decidedPeerVotes}/{totalPeerPairs} peer votes in
        </Badge>
        <Badge variant="outline">
          {untouched === 0
            ? "Every submission has human eyes on it"
            : `${untouched} submissions untouched by humans`}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>The class, ranked</CardTitle>
          <CardDescription>
            Left is low, right is high. Drag the triangles to set grade
            lines, click a bar to spot-check two submissions from it, or
            take the &ldquo;next pair&rdquo; — it serves the comparison the
            ranking is least sure about, favoring your grade boundaries.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => openPair()} disabled={pairBusy}>
              {pairBusy ? "Picking…" : "Compare next pair"}
            </Button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Columns
              <input
                type="range"
                min={5}
                max={20}
                value={binCount}
                onChange={(e) => setBinCount(Number(e.target.value))}
                className="w-28 accent-primary"
              />
            </label>
            {cutsDirty && (
              <Button variant="outline" onClick={saveCuts}>
                Save cut points
              </Button>
            )}
          </div>

          <div className="select-none">
            <div className="flex items-end gap-1" style={{ height: 220 }}>
              {bins.map((bin, i) => (
                <button
                  key={i}
                  type="button"
                  title={`${Math.round(bin.min)}–${Math.round(bin.max)}: ${bin.students.length} student(s) — click to compare two`}
                  onClick={() =>
                    bin.students.length >= 2 &&
                    openPair({ minScore: bin.min, maxScore: bin.max })
                  }
                  className="flex flex-1 flex-col-reverse items-center gap-0.5 rounded-t-md pb-1 transition-colors hover:bg-muted/50"
                >
                  {bin.students.slice(0, 12).map((s) => (
                    <Avatar
                      key={s.submissionId}
                      className="border border-border"
                      style={{
                        height: Math.min(28, 200 / tallest),
                        width: Math.min(28, 200 / tallest),
                      }}
                    >
                      {s.photoUrl && <AvatarImage src={s.photoUrl} alt={s.name} />}
                      <AvatarFallback className="text-[8px]">
                        {initials(s.name)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {bin.students.length > 12 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{bin.students.length - 12}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Cut-point strip: draggable triangles on the 0–100 axis. */}
            <div
              ref={stripRef}
              className="relative mt-1 h-10 rounded-md border bg-muted/30"
              onPointerMove={(e) => {
                if (dragging !== null) moveCut(dragging, e.clientX);
              }}
              onPointerUp={() => setDragging(null)}
              onPointerLeave={() => setDragging(null)}
            >
              {cuts.map((cut, i) => (
                <div
                  key={cut.letter}
                  role="slider"
                  aria-label={`${cut.letter} starts at`}
                  aria-valuenow={cut.min}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  tabIndex={0}
                  onPointerDown={(e) => {
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    setDragging(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      const delta = e.key === "ArrowLeft" ? -1 : 1;
                      setCuts((prev) =>
                        prev.map((c, j) =>
                          j === i
                            ? { ...c, min: Math.min(100, Math.max(0, c.min + delta)) }
                            : c
                        )
                      );
                      setCutsDirty(true);
                    }
                  }}
                  className="absolute top-0 flex -translate-x-1/2 cursor-ew-resize flex-col items-center"
                  style={{ left: `${cut.min}%` }}
                >
                  <span
                    className="block h-0 w-0 border-b-[10px] border-l-[7px] border-r-[7px] border-b-primary border-l-transparent border-r-transparent"
                    aria-hidden
                  />
                  <span className="text-[11px] font-semibold text-primary">
                    {cut.letter}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{cut.min}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>0 · lowest</span>
              <span>100 · highest</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {pair && (
        <ComparePair
          leftUrl={pair.left}
          rightUrl={pair.right}
          verdict={null}
          busy={verdictBusy}
          onVerdict={decide}
        />
      )}

      {similarPairs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worth a look</CardTitle>
            <CardDescription>
              Unusually similar submission pairs (visible only to you — a
              signal for your judgment, never an automatic penalty).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {similarPairs.slice(0, 8).map((p, i) => (
              <p key={i}>
                {p.aName} · {p.bName}{" "}
                <span className="text-muted-foreground">
                  ({Math.round(p.similarity * 100)}% overlapping language)
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {!published && (
        <div className="flex flex-wrap gap-2">
          {state === "peer_review" && (
            <Button
              variant="outline"
              onClick={async () => {
                const result = await closePeerWindow(assignmentId);
                if (result.ok) {
                  toast.success("Peer grading closed.");
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              }}
            >
              Close peer grading now
            </Button>
          )}
          <Button onClick={() => setConfirmPublish(true)} disabled={publishing}>
            Publish the scores
          </Button>
        </div>
      )}

      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish grades?</DialogTitle>
            <DialogDescription>
              Students will see their rank, letter, and full report. Want to
              adjust the cut points or review a few more pairs first? No
              grade goes out without this click — that part is all you.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPublish(false)}>
              Keep reviewing
            </Button>
            <Button onClick={publish} disabled={publishing}>
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
