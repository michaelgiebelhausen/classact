"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  compareStudents,
  flagStudent,
  resolveStudentFlag,
  saveParticipationWeights,
  type CockpitParticipant,
  type ParticipationCockpitData,
} from "@/server/actions/participation";
import { participationScore, type WeightedAttribute } from "@/lib/participation";
import { seededRandom } from "@/lib/tastegrading";

/**
 * The professor's participation cockpit — the assignment-grading interface
 * where "the assignment is the person's scores": an avatar histogram of
 * weighted participation, weight sliders, side-by-side student comparisons
 * (the conjoint that infers which attributes actually drive your judgment),
 * click-through breakdowns, and a flag for suspected gaming.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ParticipationCockpit({
  courseId,
  data,
}: {
  courseId: string;
  data: ParticipationCockpitData;
}) {
  const router = useRouter();
  const [weights, setWeights] = useState<WeightedAttribute[]>(data.weights);
  const [weightsDirty, setWeightsDirty] = useState(false);
  const [selected, setSelected] = useState<CockpitParticipant | null>(null);
  const [pair, setPair] = useState<[CockpitParticipant, CockpitParticipant] | null>(
    null
  );
  const [pairsServed, setPairsServed] = useState(0);
  const [verdict, setVerdict] = useState<number | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Live re-score as sliders move — the histogram answers immediately.
  const scored = useMemo(
    () =>
      data.participants
        .map((p) => ({ ...p, participation: participationScore(p.scores, weights) }))
        .sort((a, b) => b.participation - a.participation),
    [data.participants, weights]
  );

  const BIN_COUNT = 10;
  const bins = useMemo(() => {
    const width = 100 / BIN_COUNT;
    const list = Array.from({ length: BIN_COUNT }, (_, i) => ({
      min: i * width,
      students: [] as typeof scored,
    }));
    for (const s of scored) {
      list[
        Math.min(BIN_COUNT - 1, Math.floor(s.participation / width))
      ].students.push(s);
    }
    return list;
  }, [scored]);
  const tallest = Math.max(1, ...bins.map((b) => b.students.length));

  function servePair() {
    if (scored.length < 2) return;
    // Adjacent-by-score pairs are the informative ones; randomize which.
    const rand = seededRandom(
      `${courseId}:${data.comparisonCount}:${pairsServed}`
    );
    const i = Math.floor(rand() * (scored.length - 1));
    const flip = rand() < 0.5;
    setPair(flip ? [scored[i + 1], scored[i]] : [scored[i], scored[i + 1]]);
    setPairsServed((n) => n + 1);
    setVerdict(null);
  }

  async function submitComparison() {
    if (!pair || verdict === null) return;
    setBusy(true);
    const result = await compareStudents(
      courseId,
      pair[0].enrollmentId,
      pair[1].enrollmentId,
      verdict
    );
    setBusy(false);
    if (result.ok) {
      toast.success("Recorded — a few of these and the fitted weights sharpen.");
      setPair(null);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function persistWeights(next: WeightedAttribute[]) {
    const result = await saveParticipationWeights(
      courseId,
      Object.fromEntries(next.map((w) => [w.key, w.weight]))
    );
    if (result.ok) {
      setWeightsDirty(false);
      toast.success("Weights saved — participation scores updated.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Participation, weighted your way</CardTitle>
          <CardDescription>
            Every student&apos;s behavior rolls into eight attributes; the
            sliders decide what counts. Or compare two students below and
            let the fit tell you what you actually value.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Histogram */}
          <div className="flex items-end gap-1" style={{ height: 200 }}>
            {bins.map((bin, i) => (
              <div
                key={i}
                className="flex flex-1 flex-col-reverse items-center gap-0.5 rounded-t-md pb-1"
                title={`${Math.round(bin.min)}–${Math.round(bin.min + 100 / BIN_COUNT)}: ${bin.students.length}`}
              >
                {bin.students.slice(0, 10).map((s) => (
                  <button
                    key={s.enrollmentId}
                    type="button"
                    onClick={() => setSelected(s)}
                    title={`${s.name} — ${s.participation}`}
                    className={
                      s.flagged ? "rounded-full ring-2 ring-destructive" : ""
                    }
                  >
                    <Avatar
                      className="border border-border"
                      style={{
                        height: Math.min(26, 180 / tallest),
                        width: Math.min(26, 180 / tallest),
                      }}
                    >
                      {s.photoUrl && <AvatarImage src={s.photoUrl} alt={s.name} />}
                      <AvatarFallback className="text-[8px]">
                        {initials(s.name)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                ))}
                {bin.students.length > 10 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{bin.students.length - 10}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0 · lowest participation</span>
            <span>100 · highest</span>
          </div>

          {/* Weight sliders */}
          <div className="grid gap-2 sm:grid-cols-2">
            {weights.map((w, i) => (
              <label key={w.key} className="flex items-center gap-2 text-sm">
                <span className="w-44 shrink-0">{w.label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(w.weight * 100)}
                  onChange={(e) => {
                    const next = weights.map((x, j) =>
                      j === i ? { ...x, weight: Number(e.target.value) / 100 } : x
                    );
                    setWeights(next);
                    setWeightsDirty(true);
                  }}
                  className="flex-1 accent-primary"
                />
                <span className="w-10 text-right text-xs text-muted-foreground">
                  {Math.round(
                    (w.weight /
                      Math.max(
                        0.0001,
                        weights.reduce((s, x) => s + x.weight, 0)
                      )) *
                      100
                  )}
                  %
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {weightsDirty && (
              <Button onClick={() => persistWeights(weights)}>Save weights</Button>
            )}
            {data.fittedWeights && (
              <Button
                variant="outline"
                onClick={() => {
                  setWeights(data.fittedWeights!);
                  void persistWeights(data.fittedWeights!);
                }}
              >
                Use fitted weights (from your {data.comparisonCount} comparisons)
              </Button>
            )}
            <Button
              variant="outline"
              onClick={servePair}
              disabled={scored.length < 2}
            >
              Compare two students
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Side-by-side conjoint */}
      {pair && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who participates better?</CardTitle>
            <CardDescription>
              Same slider as assignment pairs — left to right, worse to
              better, judging the RIGHT student against the left. Your calls
              teach the fit which attributes matter to you.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {pair.map((p, side) => (
                <div key={p.enrollmentId} className="rounded-lg border p-4">
                  <p className="mb-2 flex items-center gap-2 font-medium">
                    <Avatar className="size-8">
                      {p.photoUrl && <AvatarImage src={p.photoUrl} alt={p.name} />}
                      <AvatarFallback>{initials(p.name)}</AvatarFallback>
                    </Avatar>
                    {p.name}
                    <Badge variant="outline">{side === 0 ? "Left" : "Right"}</Badge>
                  </p>
                  <div className="grid gap-1">
                    {data.attributes.map((a) => (
                      <div key={a.key} className="flex items-center gap-2 text-xs">
                        <span className="w-40 shrink-0 text-muted-foreground">
                          {a.label}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${p.scores[a.key] ?? 0}%` }}
                          />
                        </div>
                        <span className="w-8 text-right">
                          {Math.round(p.scores[a.key] ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-4">
              {[-2, -1, 0, 1, 2].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-label={`verdict ${v}`}
                  onClick={() => setVerdict(v)}
                  className={[
                    "size-6 rounded-full border-2 transition-all",
                    verdict === v
                      ? "scale-125 border-primary bg-primary"
                      : "border-muted-foreground/40 bg-card hover:border-primary",
                  ].join(" ")}
                />
              ))}
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => setPair(null)}>
                Skip
              </Button>
              <Button onClick={submitComparison} disabled={verdict === null || busy}>
                {busy ? "Recording…" : "Record"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Breakdown + flagging */}
      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Avatar className="size-8">
                {selected.photoUrl && (
                  <AvatarImage src={selected.photoUrl} alt={selected.name} />
                )}
                <AvatarFallback>{initials(selected.name)}</AvatarFallback>
              </Avatar>
              {selected.name} — {participationScore(selected.scores, weights)}
              {selected.flagged && <Badge variant="destructive">Flagged</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1">
              {data.attributes.map((a) => (
                <div key={a.key} className="flex items-center gap-2 text-sm">
                  <span className="w-44 shrink-0 text-muted-foreground">
                    {a.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${selected.scores[a.key] ?? 0}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs">
                    {Math.round(selected.scores[a.key] ?? 0)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                placeholder="Flag reason (private): suspected gaming, sudden pattern change…"
                className="max-w-md"
              />
              <Button
                variant="outline"
                onClick={async () => {
                  const result = await flagStudent(
                    courseId,
                    selected.enrollmentId,
                    flagReason
                  );
                  if (result.ok) {
                    toast.success("Flagged — visible only to you.");
                    setFlagReason("");
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                }}
              >
                Flag
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data.flags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open flags</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.flags.map((f) => {
              const student = data.participants.find(
                (p) => p.enrollmentId === f.enrollmentId
              );
              return (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{student?.name ?? "Student"}</span>
                    {f.reason && (
                      <span className="text-muted-foreground"> — {f.reason}</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const result = await resolveStudentFlag(courseId, f.id);
                      if (result.ok) router.refresh();
                      else toast.error(result.error);
                    }}
                  >
                    Resolve
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
