"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { seedGradingDryRun, teardownGradingDryRun } from "@/server/actions/gradingdev";
import { RankedList, type RankedStudent } from "./RankedList";
import { bandsProblem, type Band, type ScoreMode } from "@/lib/bands";

/**
 * The bench: a mock ranked list to exercise the interactions for free, and
 * the controls for a real dry run.
 */

const MOCK_NAMES = [
  "Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson",
  "Claude Shannon", "Barbara Liskov", "Edsger Dijkstra", "Radia Perlman",
  "Donald Knuth", "Frances Allen", "Ken Thompson", "Margaret Hamilton",
  "Tim Berners-Lee", "Shafi Goldwasser", "Vint Cerf", "Jean Bartik",
  "Dennis Ritchie", "Adele Goldberg", "Linus Torvalds", "Anita Borg",
  "Guido van Rossum", "Karen Spärck Jones", "Bjarne Stroustrup",
  "Sophie Wilson", "John McCarthy",
];

function mockStudents(): RankedStudent[] {
  return MOCK_NAMES.map((name, i) => ({
    submissionId: `mock-${i}`,
    name,
    photoUrl: null,
    // A plausible spread: bunched in the middle, thin at the tails.
    score: Math.round(100 - i * 3.2 - (i % 3) * 1.5),
    comparisons: (i * 7) % 5,
  }));
}

interface Props {
  courses: Array<{ id: string; title: string }>;
  runs: Array<{ id: string; courseId: string; title: string; state: string }>;
}

export function GradingBench({ courses, runs }: Props) {
  const router = useRouter();
  const [students, setStudents] = useState<RankedStudent[]>(mockStudents);
  const [bands, setBands] = useState<Band[]>([
    { label: "A", value: 90 },
    { label: "B", value: 80 },
    { label: "C", value: 70 },
  ]);
  const [dividers, setDividers] = useState<number[]>([6, 15]);
  const [scoreMode, setScoreMode] = useState<ScoreMode>("stepped");
  const [points, setPoints] = useState<number | null>(100);
  const [pointsText, setPointsText] = useState("100");
  const [openId, setOpenId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [seeding, setSeeding] = useState(false);

  const problem = bandsProblem({
    bands,
    dividers,
    scoreMode,
    points,
    rowCount: students.length,
  });

  /** The mock has no server: reorder in place, same shape as the real one. */
  function reorder(submissionId: string, toPosition: number) {
    setStudents((prev) => {
      const from = prev.findIndex((s) => s.submissionId === submissionId);
      if (from < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(Math.min(next.length, Math.max(0, toPosition)), 0, moved);
      return next;
    });
  }

  async function seed(mode: "tasty" | "ai_only") {
    if (!courseId) return;
    setSeeding(true);
    const result = await seedGradingDryRun(courseId, mode);
    setSeeding(false);
    if (result.ok && result.data) {
      toast.success(`Seeded ${result.data.students} submissions — open it and let the runner crank.`);
      router.refresh();
    } else {
      toast.error(result.ok ? "Couldn't seed." : result.error);
    }
  }

  async function teardown(assignmentId: string) {
    const result = await teardownGradingDryRun(assignmentId);
    if (result.ok) {
      toast.success("Dry run removed.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dry run (spends API credit)</CardTitle>
          <CardDescription>
            Seeds a throwaway assignment with ten synthetic memos spanning real
            quality tiers, deadline already passed. Open it and the analysis
            runner cranks the live pipeline. Tear it down when you&apos;re done.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <Button onClick={() => seed("tasty")} disabled={seeding || !courseId}>
              {seeding ? "Seeding…" : "Seed tasty run"}
            </Button>
            <Button
              variant="outline"
              onClick={() => seed("ai_only")}
              disabled={seeding || !courseId}
            >
              Seed AI-only run
            </Button>
          </div>

          {runs.length > 0 && (
            <div className="grid gap-2">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    {run.title}{" "}
                    <span className="text-muted-foreground">· {run.state}</span>
                  </span>
                  <span className="flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/course/${run.courseId}/assignments/${run.id}`}>
                        Open
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => teardown(run.id)}
                    >
                      Tear down
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mock list (free)</CardTitle>
          <CardDescription>
            Twenty-five fake rows. Drag students, drag the grade lines, add and
            remove bands, switch the scale — the previewed points come from the
            same pure function the real cockpit and the publish path use.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Worth
              <Input
                value={pointsText}
                onChange={(e) => {
                  setPointsText(e.target.value);
                  setPoints(e.target.value === "" ? null : Number(e.target.value));
                }}
                inputMode="decimal"
                className="h-8 w-24"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Scale
              <select
                value={scoreMode}
                onChange={(e) => setScoreMode(e.target.value as ScoreMode)}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="stepped">Stepped</option>
                <option value="linear">Linear</option>
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStudents(mockStudents())}
            >
              Reset order
            </Button>
          </div>

          {problem && <p className="text-sm text-destructive">{problem}</p>}

          <RankedList
            students={students}
            bands={bands}
            dividers={dividers}
            scoreMode={scoreMode}
            points={points}
            canReorder
            canEditBands
            onReorder={reorder}
            onBandsChange={(b, d) => {
              setBands(b);
              setDividers(d);
            }}
            onOpen={(id) => setOpenId((prev) => (prev === id ? null : id))}
            openId={openId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
