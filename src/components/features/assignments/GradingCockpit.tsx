"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LocalTime } from "@/components/ui/localtime";
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
  reorderSubmission,
  setBands as saveBands,
  submitVerdict,
} from "@/server/actions/grading";
import { setGradingOptions } from "@/server/actions/assignments";
import { updateAssignment } from "@/server/actions/assignments";
import { ComparePair, type PairDocKind } from "./ComparePair";
import { RankedList } from "./RankedList";
import { SpeedView } from "./SpeedView";
import {
  bandsProblem,
  cutScoresFromDividers,
  type Band,
  type ScoreMode,
} from "@/lib/bands";
import type { ScoreVisibility } from "@/lib/tastegrading";

/**
 * The professor's grading cockpit. The ranked list is the grading surface:
 * drag a submission to where it belongs, drag the grade lines to band the
 * class, type what each band is worth, open any row to read the work — then
 * publish, the one click no grade ships without.
 *
 * The histogram stays as a read-only companion: it shows the shape of the
 * distribution and where the lines fall on it, left → high like every axis
 * in the product, but the list is what you edit.
 */

export interface CockpitStudent {
  submissionId: string;
  name: string;
  photoUrl: string | null;
  score: number;
  rank: number;
  letter: string | null;
  comparisons: number;
  /** True when the work was turned in after the deadline. */
  late?: boolean;
}

interface Props {
  assignmentId: string;
  state: string;
  peerCloseAt: string;
  /** Already sorted best-first by the page (final_rank ?? rank). */
  students: CockpitStudent[];
  initialBands: Band[];
  initialDividers: number[];
  scoreMode: ScoreMode;
  scoreVisibility: ScoreVisibility;
  points: number | null;
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
  initialBands,
  initialDividers,
  scoreMode: initialScoreMode,
  scoreVisibility: initialVisibility,
  points: initialPoints,
  similarPairs,
  decidedPeerVotes,
  totalPeerPairs,
  published,
}: Props) {
  const router = useRouter();
  const [binCount, setBinCount] = useState(10);
  const [bands, setBands] = useState<Band[]>(initialBands);
  const [dividers, setDividers] = useState<number[]>(initialDividers);
  const [bandsDirty, setBandsDirty] = useState(false);
  const [scoreMode, setScoreMode] = useState<ScoreMode>(initialScoreMode);
  const [visibility, setVisibility] = useState<ScoreVisibility>(initialVisibility);
  const [points, setPoints] = useState<number | null>(initialPoints);
  const [pointsText, setPointsText] = useState(
    initialPoints === null ? "" : String(initialPoints)
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [pair, setPair] = useState<{
    comparisonId: string;
    left: string;
    right: string;
    leftKind: PairDocKind;
    rightKind: PairDocKind;
  } | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // The peer window may simply have lapsed without the professor closing it;
  // either way the order is theirs from that moment. Watched rather than
  // computed at render, so a professor sitting on this page as the window
  // closes sees the list unlock — and so the first client render agrees with
  // the server's.
  const closeMs = new Date(peerCloseAt).getTime();
  const [windowLapsed, setWindowLapsed] = useState(false);
  useEffect(() => {
    const check = () => setWindowLapsed(Date.now() > closeMs);
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [closeMs]);

  const finalizing =
    state === "finalizing" || (state === "peer_review" && windowLapsed);
  const canReorder = finalizing && !published;
  const canEditBands = !published;

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

  // Markers on the histogram are derived from where the lines sit in the
  // list — the list is the source of truth, the histogram just reports it.
  const markers = useMemo(
    () =>
      cutScoresFromDividers(
        students.map((s) => s.score),
        dividers
      ),
    [students, dividers]
  );

  const problem = bandsProblem({
    bands,
    dividers,
    scoreMode,
    points,
    rowCount: students.length,
  });

  function changeBands(nextBands: Band[], nextDividers: number[]) {
    setBands(nextBands);
    setDividers(nextDividers);
    setBandsDirty(true);
  }

  async function persistBands(): Promise<boolean> {
    const result = await saveBands(assignmentId, bands, dividers);
    if (result.ok) {
      setBandsDirty(false);
      return true;
    }
    toast.error(result.error);
    return false;
  }

  async function reorder(submissionId: string, toPosition: number) {
    const result = await reorderSubmission(assignmentId, submissionId, toPosition);
    if (result.ok) router.refresh();
    else toast.error(result.error);
  }

  async function savePoints() {
    const value = pointsText.trim() === "" ? null : Number(pointsText);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Points must be a number, zero or more.");
      return;
    }
    const result = await updateAssignment({ assignmentId, points: pointsText });
    if (result.ok) {
      setPoints(value);
      toast.success("Point value saved.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function changeMode(next: ScoreMode) {
    const previous = scoreMode;
    setScoreMode(next);
    const result = await setGradingOptions(assignmentId, { scoreMode: next });
    if (!result.ok) {
      setScoreMode(previous);
      toast.error(result.error);
    }
  }

  async function changeVisibility(next: ScoreVisibility) {
    const previous = visibility;
    setVisibility(next);
    const result = await setGradingOptions(assignmentId, { scoreVisibility: next });
    if (!result.ok) {
      setVisibility(previous);
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
      toast.error(urls.ok ? "Couldn't open the files." : urls.error);
    }
  }

  async function decide(verdict: number) {
    if (!pair) return;
    setVerdictBusy(true);
    const result = await submitVerdict(pair.comparisonId, verdict);
    setVerdictBusy(false);
    if (result.ok) {
      toast.success(
        finalizing ? "Recorded — the list moved to match." : "Recorded — ranking refined."
      );
      setPair(null);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function publish() {
    setPublishing(true);
    if (bandsDirty && !(await persistBands())) {
      setPublishing(false);
      return;
    }
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

  const openStudent = students.find((s) => s.submissionId === openId) ?? null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={published ? "default" : "secondary"}>
          {published
            ? "Published"
            : state === "peer_review" && !finalizing ? (
              <>
                Peer grading open until <LocalTime iso={peerCloseAt} />
              </>
            ) : (
              "Ready for your review"
            )}
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
            Best at the top. Drag the grade lines to band the class and type
            what each band is worth
            {canReorder
              ? ", drag a student to move them"
              : " — you can move students once peer grading closes"}
            . Click a name to read the work.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => openPair()} disabled={pairBusy}>
              {pairBusy ? "Picking…" : "Compare next pair"}
            </Button>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Worth
              <Input
                value={pointsText}
                onChange={(e) => setPointsText(e.target.value)}
                onBlur={savePoints}
                disabled={published}
                inputMode="decimal"
                placeholder="points"
                aria-label="What this assignment is worth"
                className="h-8 w-24"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Scale
              <select
                value={scoreMode}
                onChange={(e) => changeMode(e.target.value as ScoreMode)}
                disabled={published}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="stepped">Stepped — one value per band</option>
                <option value="linear">Linear — spread within a band</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Students see
              <select
                value={visibility}
                onChange={(e) => changeVisibility(e.target.value as ScoreVisibility)}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="both">Score and label</option>
                <option value="points">Score only</option>
                <option value="label">Label only</option>
              </select>
            </label>

            {bandsDirty && (
              <Button variant="outline" onClick={persistBands} disabled={!!problem}>
                Save bands
              </Button>
            )}
          </div>

          {problem && <p className="text-sm text-destructive">{problem}</p>}

          <RankedList
            students={students}
            bands={bands}
            dividers={dividers}
            scoreMode={scoreMode}
            points={points}
            canReorder={canReorder}
            canEditBands={canEditBands}
            lockedReason={
              published
                ? "Grades are published — this list is final."
                : "The order is still being refined by peer votes. Close peer grading to take it over."
            }
            onReorder={reorder}
            onBandsChange={changeBands}
            onOpen={(id) => setOpenId((prev) => (prev === id ? null : id))}
            openId={openId}
          />
        </CardContent>
      </Card>

      {openStudent && (
        <SpeedView
          assignmentId={assignmentId}
          submissionId={openStudent.submissionId}
          studentName={openStudent.name}
          onClose={() => setOpenId(null)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The shape of it</CardTitle>
          <CardDescription>
            Left is low, right is high. Click a column to spot-check two
            submissions from it — the &ldquo;next pair&rdquo; button favors
            comparisons straddling your grade lines.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
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

          <div className="select-none">
            <div className="flex items-end gap-1" style={{ height: 180 }}>
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
                        height: Math.min(24, 160 / tallest),
                        width: Math.min(24, 160 / tallest),
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

            {/* Where the list's grade lines land on the score axis. */}
            <div className="relative mt-1 h-6 rounded-md border bg-muted/30">
              {markers.map((score, i) => (
                <div
                  key={i}
                  className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                  style={{ left: `${Math.min(100, Math.max(0, score))}%` }}
                >
                  <span
                    className="block h-0 w-0 border-b-[8px] border-l-[6px] border-r-[6px] border-b-primary border-l-transparent border-r-transparent"
                    aria-hidden
                  />
                  <span className="text-[10px] font-semibold text-primary">
                    {bands[i + 1]?.label ?? ""}
                  </span>
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
          leftKind={pair.leftKind}
          rightKind={pair.rightKind}
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
                  toast.success("Peer grading closed — the list is yours now.");
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              }}
            >
              Close peer grading now
            </Button>
          )}
          <Button
            onClick={() => setConfirmPublish(true)}
            disabled={publishing || !!problem}
          >
            Publish the scores
          </Button>
        </div>
      )}

      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish grades?</DialogTitle>
            <DialogDescription>
              Students will see their standing and full report. Want to move
              anyone, adjust the bands, or read a few more first? No grade goes
              out without this click — that part is all you.
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
