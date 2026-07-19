import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The published report — private to the student (FERPA: your standing
 * only). Rank + letter up top, then the evidence: per-theme scores with
 * quotes pulled from their own work, whether they met their own bar,
 * distinctiveness, and their judging statistics.
 */

interface Props {
  rank: number;
  total: number;
  letter: string | null;
  summary: string;
  themeScores: Array<{ name: string; score: number; evidence: string }>;
  ownBar: number | null;
  distinctiveness: number | null;
  stats: {
    tasteAgreement: number | null;
    selfHonesty: number | null;
    participation: number;
    rubricSeconds: number;
  };
}

function Meter({ value, max = 10 }: { value: number; max?: number }) {
  return (
    <div className="h-2 w-full max-w-40 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
      />
    </div>
  );
}

export function StudentReport({
  rank,
  total,
  letter,
  summary,
  themeScores,
  ownBar,
  distinctiveness,
  stats,
}: Props) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {letter && <span className="text-3xl">{letter}</span>}
            <span>
              Ranked {rank} of {total}
            </span>
          </CardTitle>
          {summary && <CardDescription>{summary}</CardDescription>}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Against the class&apos;s standard</CardTitle>
          <CardDescription>
            Scored on the rubric your class wrote together, with evidence
            from your own work.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {themeScores.map((t) => (
            <div key={t.name} className="grid gap-1 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{t.name}</p>
                <div className="flex items-center gap-2">
                  <Meter value={t.score} />
                  <span className="w-10 text-right text-sm font-semibold">
                    {t.score}/10
                  </span>
                </div>
              </div>
              {t.evidence && (
                <p className="text-sm italic text-muted-foreground">
                  &ldquo;{t.evidence}&rdquo;
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your own bar</CardTitle>
            <CardDescription>
              Did the work meet the standard you set for yourself?
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            {ownBar !== null ? (
              <>
                <Meter value={ownBar} />
                <span className="text-lg font-semibold">{ownBar}/10</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                No taste file was submitted.
              </span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distinctive ↔ Generic</CardTitle>
            <CardDescription>
              How much of this could only have come from you? Low scores
              read like unedited AI output — everyone can tell.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            {distinctiveness !== null ? (
              <>
                <Meter value={distinctiveness} />
                <span className="text-lg font-semibold">{distinctiveness}/10</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Not measured.</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">You as a judge</CardTitle>
          <CardDescription>
            Grading is a skill too — these feed your work-readiness metrics.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">
            Recognizes good work:{" "}
            {stats.tasteAgreement !== null ? `${stats.tasteAgreement}%` : "—"}
          </Badge>
          <Badge variant="outline">
            Self-honesty: {stats.selfHonesty !== null ? `${stats.selfHonesty}%` : "—"}
          </Badge>
          <Badge variant="outline">Pairs completed: {stats.participation}%</Badge>
          <Badge variant="outline">
            Rubric study time: {Math.round(stats.rubricSeconds / 60)} min
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
