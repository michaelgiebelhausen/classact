import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Professor's pre-deadline view of who has turned in what: every active
 * student with their face, when their submission landed, and where their
 * taste file stands — spreadsheet-shaped, one row per student.
 * Server-rendered; no interactivity, just the facts.
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

function tasteCell(taste: SubmissionRosterRow["taste"]): string {
  if (!taste) return "—";
  if (taste.untouchedDefault) return "Default, untouched";
  const count = `${taste.criteriaCount} ${
    taste.criteriaCount === 1 ? "criterion" : "criteria"
  }`;
  return taste.editedAt ? `${count} · ${when(taste.editedAt)}` : count;
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
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Last edit</TableHead>
              <TableHead>Taste file</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.enrollmentId}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {r.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img
                        src={r.photoUrl}
                        alt=""
                        className="size-8 rounded-full border object-cover"
                      />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed text-[10px] text-muted-foreground">
                        {initialsOf(r.name)}
                      </span>
                    )}
                    <span className="whitespace-nowrap font-medium">{r.name}</span>
                  </span>
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {r.submittedAt ? when(r.submittedAt) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {r.editedAt ? when(r.editedAt) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {tasteCell(r.taste)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
