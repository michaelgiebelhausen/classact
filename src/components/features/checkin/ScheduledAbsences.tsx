"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CalendarOff, FileCheck2, FileX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { decideAbsence, type CourseAbsenceView } from "@/server/actions/absences";

/**
 * Professor side: every self-reported absence, most recent first. The point
 * is that there's nothing to do here — ClassAct already ruled. Appeals float
 * to the top with two buttons.
 */

const FLAG_LABELS: Record<string, string> = {
  vague: "vague explanation",
  contradicts_policy: "against policy",
  late_notice: "late notice",
  doc_mismatch: "document doesn't match",
  doc_looks_edited: "document looks edited",
  repeat_pattern: "repeat pattern",
  no_doc_required_doc: "extra documentation",
};

export function ScheduledAbsences({ rows }: { rows: CourseAbsenceView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const appeals = rows.filter((r) => r.appealedAt && !r.professorVerdict);

  async function decide(id: string, verdict: "excused" | "unexcused") {
    setBusyId(id);
    let result: Awaited<ReturnType<typeof decideAbsence>>;
    try {
      result = await decideAbsence(id, verdict);
    } catch {
      toast.error("Couldn't reach the server — try again.");
      return;
    } finally {
      setBusyId(null);
    }
    if (result.ok) {
      toast.success(`Marked ${verdict}.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarOff className="size-4" /> Scheduled absences
          </CardTitle>
          <CardDescription>
            When a student reports an absence, it lands here already judged
            against your attendance policy — no email, nothing to answer.
            Set the policy under Setup → Attendance.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarOff className="size-4" /> Scheduled absences
        </CardTitle>
        <CardDescription>
          {rows.length} reported this term
          {appeals.length > 0 ? ` · ${appeals.length} awaiting your call` : " · nothing needs you"}
          . Documentation is assessed and discarded — never stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {appeals.length > 0 && (
          <div className="grid gap-2">
            {appeals.map((a) => (
              <div
                key={a.id}
                className="grid gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {a.studentName} is appealing {formatDate(a.date)} — ClassAct
                    said {a.aiVerdict}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => decide(a.id, "excused")}
                      disabled={busyId === a.id}
                    >
                      Excuse it
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decide(a.id, "unexcused")}
                      disabled={busyId === a.id}
                    >
                      Keep unexcused
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{a.summary}</p>
                {a.appealNote && (
                  <p className="text-sm">
                    <span className="font-medium">Their appeal:</span> {a.appealNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Notice</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead className="text-right">Legitimacy</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  <TableCell className="whitespace-nowrap font-medium">
                    {formatDate(r.date)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.studentName}</TableCell>
                  <TableCell className="min-w-[220px]">
                    <div className="text-sm">{r.categoryLabel}</div>
                    <div className="text-xs text-muted-foreground">{r.summary}</div>
                    {expanded === r.id && (
                      <div className="mt-2 grid gap-1 text-xs">
                        <p className="text-muted-foreground">
                          <span className="font-medium text-foreground">
                            In their words:
                          </span>{" "}
                          {r.explanation}
                        </p>
                        {r.professorNote && (
                          <p>
                            <span className="font-medium">Your note:</span>{" "}
                            {r.professorNote}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px]">
                          {FLAG_LABELS[f] ?? f}
                        </Badge>
                      ))}
                      {r.attendedElsewhere && (
                        <Badge variant="outline" className="text-[10px]">
                          <AlertTriangle className="mr-1 size-3" />
                          checked into another ClassAct class that day
                        </Badge>
                      )}
                      {r.attendedHere && (
                        <Badge variant="outline" className="text-[10px]">
                          <AlertTriangle className="mr-1 size-3" />
                          checked in here anyway
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.notice}</TableCell>
                  <TableCell className="text-sm">
                    {r.hasDocumentation ? (
                      <span className="inline-flex items-center gap-1">
                        <FileCheck2 className="size-3.5" />
                        <span className="text-xs">
                          {r.documentationKind ?? "attached"}
                          {r.docAuthenticity !== null && ` · ${r.docAuthenticity}`}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <FileX2 className="size-3.5" />
                        <span className="text-xs">none</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.legitimacy}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant={r.finalVerdict === "excused" ? "secondary" : "outline"}
                      >
                        {r.finalVerdict}
                      </Badge>
                      {r.professorVerdict && (
                        <span className="text-[10px] text-muted-foreground">
                          your call
                        </span>
                      )}
                      {!r.professorVerdict && (
                        <button
                          type="button"
                          className="text-[10px] text-muted-foreground underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            decide(
                              r.id,
                              r.finalVerdict === "excused" ? "unexcused" : "excused"
                            );
                          }}
                          disabled={busyId === r.id}
                        >
                          change to{" "}
                          {r.finalVerdict === "excused" ? "unexcused" : "excused"}
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Legitimacy is ClassAct&apos;s confidence in the report, 0–100; the
          documentation number is how genuine the attachment looked. Students
          never see either. Click a row for what they actually wrote.
        </p>
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
