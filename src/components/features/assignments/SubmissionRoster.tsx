import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Professor's pre-deadline view of who has turned in what: every active
 * student with their face, when their submission landed, and where their
 * taste file stands. Server-rendered — no interactivity, just the facts.
 */

export interface SubmissionRosterRow {
  enrollmentId: string;
  name: string;
  photoUrl: string | null;
  /** Null = no submission yet. */
  submittedAt: string | null;
  /** Set when the submission was edited after first submitting. */
  editedAt: string | null;
  /** Null = taste file not started. */
  taste: {
    criteriaCount: number;
    /** Still the shipped default, never edited by the student. */
    untouchedDefault: boolean;
    editedAt: string | null;
  } | null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function tasteLabel(taste: SubmissionRosterRow["taste"]): string {
  if (!taste) return "Taste file not started";
  if (taste.untouchedDefault) return "Taste file: default, untouched";
  const count = `${taste.criteriaCount} ${
    taste.criteriaCount === 1 ? "criterion" : "criteria"
  }`;
  return taste.editedAt
    ? `Taste file: ${count}, edited ${when(taste.editedAt)}`
    : `Taste file: ${count}`;
}

export function SubmissionRoster({ rows }: { rows: SubmissionRosterRow[] }) {
  if (rows.length === 0) return null;
  const missing = rows.filter((r) => !r.submittedAt).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Who&apos;s turned in what
          {missing > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {missing} still missing
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.map((r) => (
          <div
            key={r.enrollmentId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              {r.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img
                  src={r.photoUrl}
                  alt={r.name}
                  className="size-9 rounded-full border object-cover"
                />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">
                  {initialsOf(r.name)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.submittedAt
                    ? `Submitted ${when(r.submittedAt)}${
                        r.editedAt ? ` · edited ${when(r.editedAt)}` : ""
                      }`
                    : "No submission yet"}
                  {" · "}
                  {tasteLabel(r.taste)}
                </p>
              </div>
            </div>
            <Badge
              variant={
                r.submittedAt
                  ? "default"
                  : r.taste && !r.taste.untouchedDefault
                    ? "secondary"
                    : "outline"
              }
            >
              {r.submittedAt
                ? "Submitted"
                : r.taste && !r.taste.untouchedDefault
                  ? "Started"
                  : "Nothing yet"}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
