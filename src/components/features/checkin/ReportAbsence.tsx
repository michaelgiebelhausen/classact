"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarOff, CheckCircle2, Paperclip, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ABSENCE_CATEGORIES, MAX_DOC_BASE64_CHARS } from "@/lib/absences";
import { appealAbsence, submitAbsence, type MyAbsenceView } from "@/server/actions/absences";
import type { AbsenceCategory } from "@/types/db";

/**
 * Student side: report an absence instead of emailing the professor, and see
 * the verdict immediately. Documentation is uploaded, assessed, and dropped —
 * this component never gets it back and the server never stores it.
 */
export function ReportAbsence({
  courseId,
  upcomingDates,
  mine,
  policyNote,
}: {
  courseId: string;
  /** Next few class dates, "YYYY-MM-DD", course timezone. */
  upcomingDates: string[];
  mine: MyAbsenceView[];
  policyNote: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(upcomingDates[0] ?? "");
  // The dates refresh as classes pass; if the one we're holding is no longer
  // offered, fall back to the next class rather than submitting a stale day.
  const [knownDates, setKnownDates] = useState(upcomingDates);
  if (knownDates !== upcomingDates) {
    setKnownDates(upcomingDates);
    if (upcomingDates.length > 0 && !upcomingDates.includes(date)) {
      setDate(upcomingDates[0]);
    }
  }
  const [category, setCategory] = useState<AbsenceCategory>("illness");
  const [explanation, setExplanation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [appealNote, setAppealNote] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  const chosen = ABSENCE_CATEGORIES.find((c) => c.key === category);

  /**
   * Close and forget. Clearing the file matters: a document attached to a
   * cancelled report would otherwise still be in state and get sent with a
   * later, unrelated absence.
   */
  function closeForm() {
    setOpen(false);
    setExplanation("");
    setFile(null);
    setDate(upcomingDates[0] ?? "");
    // The <input type="file"> keeps its own value; reset the element too or
    // it still shows the old filename.
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit() {
    if (!date) {
      toast.error("Pick the class you'll miss.");
      return;
    }
    setBusy(true);
    try {
      let document: { mimeType: string; base64: string } | null = null;
      if (file) {
        const base64 = await fileToBase64(file);
        if (base64.length > MAX_DOC_BASE64_CHARS) {
          toast.error("That file is too large — keep it under about 6 MB.");
          return;
        }
        document = { mimeType: file.type, base64 };
      }
      const result = await submitAbsence({
        courseId,
        date,
        category,
        explanation,
        document,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const excused = result.data!.verdict === "excused";
      toast[excused ? "success" : "message"](
        excused ? "Recorded as excused." : "Recorded as unexcused.",
        { description: result.data!.reason, duration: 12000 }
      );
      closeForm();
      router.refresh();
    } catch {
      toast.error("Couldn't send that — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendAppeal(id: string) {
    setBusy(true);
    let result: Awaited<ReturnType<typeof appealAbsence>>;
    try {
      result = await appealAbsence(id, appealNote);
    } catch {
      toast.error("Couldn't reach the server — try again.");
      return;
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      toast.success("Appeal sent — your professor will take a look.");
      setAppealFor(null);
      setAppealNote("");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarOff className="size-4" /> Can&apos;t make a class?
            </CardTitle>
            <CardDescription>
              Report it here instead of emailing — you&apos;ll get an answer
              right away.
            </CardDescription>
          </div>
          {!open && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Report an absence
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {policyNote && !open && mine.length === 0 && (
          <p className="text-xs text-muted-foreground">{policyNote}</p>
        )}

        {open && (
          <div className="grid gap-4 rounded-lg border border-dashed p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="absence-date">Which class?</Label>
              {upcomingDates.length > 0 ? (
                <select
                  id="absence-date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {upcomingDates.map((d) => (
                    <option key={d} value={d}>
                      {formatDate(d)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="absence-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
                />
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="absence-category">Why?</Label>
              <select
                id="absence-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as AbsenceCategory)}
                className="max-w-md rounded-md border bg-background px-3 py-2 text-sm"
              >
                {ABSENCE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              {chosen && <p className="text-xs text-muted-foreground">{chosen.hint}</p>}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="absence-explanation">What&apos;s going on?</Label>
              <textarea
                id="absence-explanation"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="A sentence or two. Specific beats vague."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="absence-doc" className="flex items-center gap-2">
                <Paperclip className="size-3.5" /> Documentation (optional)
              </Label>
              <input
                id="absence-doc"
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="max-w-sm text-sm"
              />
              <p className="text-xs text-muted-foreground">
                A travel letter, interview confirmation, clinic note — whatever
                supports it.{" "}
                <span className="font-medium">
                  ClassAct checks it and throws it away.
                </span>{" "}
                It is never stored and your professor never sees the file, only
                what kind of document it was.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={submit} disabled={busy}>
                {busy ? "Checking…" : "Submit"}
              </Button>
              <Button variant="ghost" onClick={closeForm} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mine.length > 0 && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Your reported absences</p>
            <ul className="grid gap-2">
              {mine.map((a) => (
                <li key={a.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{formatDate(a.date)}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.categoryLabel}
                      </span>
                    </div>
                    <Badge variant={a.verdict === "excused" ? "secondary" : "outline"}>
                      {a.verdict === "excused" ? (
                        <CheckCircle2 className="mr-1 size-3" />
                      ) : (
                        <XCircle className="mr-1 size-3" />
                      )}
                      {a.verdict}
                      {a.overridden ? " (professor)" : ""}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{a.reason}</p>
                  {a.professorNote && (
                    <p className="mt-1 text-xs">
                      <span className="font-medium">Your professor:</span>{" "}
                      {a.professorNote}
                    </p>
                  )}
                  {a.verdict === "unexcused" && !a.overridden && !a.appealedAt && (
                    <div className="mt-2">
                      {appealFor === a.id ? (
                        <div className="grid gap-2">
                          <textarea
                            value={appealNote}
                            onChange={(e) => setAppealNote(e.target.value)}
                            rows={2}
                            maxLength={2000}
                            placeholder="Tell your professor what ClassAct missed."
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => sendAppeal(a.id)} disabled={busy}>
                              Send appeal
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAppealFor(null)}
                              disabled={busy}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAppealFor(a.id);
                            setAppealNote("");
                          }}
                        >
                          Appeal to your professor
                        </Button>
                      )}
                    </div>
                  )}
                  {a.appealedAt && !a.overridden && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Appeal sent — waiting on your professor.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Read a File as bare base64 (no data: prefix) without blocking the UI. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** "2026-08-24" → "Mon, Aug 24" without dragging the date through a timezone. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
