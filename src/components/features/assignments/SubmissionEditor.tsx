"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/localtime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  saveSubmissionNote,
  saveTasteFile,
  submitWork,
} from "@/server/actions/assignments";
import {
  classifySubmissionFile,
  deliverableAccept,
  type DeliverableType,
} from "@/lib/submissionfile";
import type { TasteRequirement } from "@/lib/tastegrading";

/**
 * Student, before the deadline: sharpen the taste file (the standard you
 * commit to) and submit the PDF. One deadline locks both; the taste file
 * you ship is the one you're judged for holding yourself to.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";

interface Props {
  courseId: string;
  assignmentId: string;
  enrollmentId: string;
  deadline: string;
  /** The taste file as prose — free-flowing text, or a legacy grid already
   *  rendered as prose by the page. */
  initialTaste: string;
  tasteIsDefault: boolean;
  /** Whether a taste file is part of what gets handed in. */
  tasteRequirement?: TasteRequirement;
  submittedAt: string | null;
  submissionNote: string;
  /** Short-lived signed URL for the student's own submitted file, so they
   *  can confirm the right one landed. Null when nothing is submitted. */
  submittedFileUrl?: string | null;
  /** Extension of the submitted file (pdf/md/png/jpg), for the label. */
  submittedFileExt?: string | null;
  /** ai_only: no student taste file — the instructor's criteria rule. */
  mode?: "tasty" | "ai_only";
  instructorCriteria?: string;
  /** What the professor asked students to hand in; restricts the picker. */
  deliverableType?: DeliverableType;
}

export function SubmissionEditor({
  courseId,
  assignmentId,
  enrollmentId,
  deadline,
  initialTaste,
  tasteIsDefault,
  tasteRequirement = "optional",
  submittedAt,
  submissionNote,
  submittedFileUrl = null,
  submittedFileExt = null,
  mode = "tasty",
  instructorCriteria = "",
  deliverableType = "any",
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [taste, setTaste] = useState(initialTaste);
  const [savingTaste, setSavingTaste] = useState(false);
  const [note, setNote] = useState(submissionNote);
  const [uploading, setUploading] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  // Watched rather than computed at render: a student sitting on this page
  // as the deadline arrives should see it close, not find out by having an
  // upload refused. Starts false so the server and the first client render
  // agree, then corrects on mount.
  const deadlineMs = new Date(deadline).getTime();
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  useEffect(() => {
    const check = () => setDeadlinePassed(Date.now() > deadlineMs);
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const noteChanged = note !== submissionNote;

  // What the professor asked for, in plain words — drives the picker's accept
  // filter and the card copy so the student sees the same thing everywhere.
  const acceptLabel =
    deliverableType === "image"
      ? "a screenshot (PNG or JPG)"
      : deliverableType === "pdf"
        ? "a PDF"
        : deliverableType === "md"
          ? "a Markdown (.md) file"
          : "a PDF, Markdown, or image (PNG/JPG)";

  // Nothing of their own on the page yet — either blank or still the draft.
  const tasteUnwritten = !taste.trim() || (tasteIsDefault && taste === initialTaste);

  async function saveTaste() {
    setSavingTaste(true);
    const result = await saveTasteFile(assignmentId, taste);
    setSavingTaste(false);
    if (result.ok) {
      toast.success("Taste file saved — that's the standard you'll be judged by.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleFile(file: File) {
    // Past the deadline is allowed — it's a late submission, not a closed one;
    // the server still refuses once the professor has started grading.

    // The server refuses this too, but only after the file has already gone up.
    if (mode === "tasty" && tasteRequirement === "required" && tasteUnwritten) {
      toast.error(
        "Write your taste file first — it's part of what you're handing in."
      );
      return;
    }

    // Refuse unknown types rather than guessing. A .docx used to be stored
    // as a .pdf, which "succeeded" and handed the professor a file that
    // wouldn't open.
    const verdict = classifySubmissionFile(
      { name: file.name, size: file.size, type: file.type },
      deliverableType
    );
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const storagePath = `${courseId}/sub/${enrollmentId}/${crypto.randomUUID()}.${verdict.file.ext}`;
    const { error } = await supabase.storage
      .from(ASSIGNMENT_BUCKET)
      .upload(storagePath, file, { contentType: verdict.file.contentType });
    if (error) {
      setUploading(false);
      toast.error("Upload failed — try again.");
      return;
    }
    const result = await submitWork(assignmentId, storagePath, note);
    setUploading(false);
    if (result.ok) {
      toast.success(
        submittedAt
          ? "Submission replaced."
          : deadlinePassed
            ? "Submitted late — you can still replace it until grading starts."
            : "Submitted. You can replace it until grading starts."
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function saveNote() {
    setSavingNote(true);
    const result = await saveSubmissionNote(assignmentId, note);
    setSavingNote(false);
    if (result.ok) {
      toast.success("Note saved.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      {mode === "ai_only" && (
        <Card>
          <CardHeader>
            <CardTitle>How this is graded</CardTitle>
            <CardDescription>
              This assignment is AI-graded against your instructor&apos;s
              criteria — no peer review, no taste file. Your professor
              reviews everything before grades publish.
            </CardDescription>
          </CardHeader>
          {instructorCriteria && (
            <CardContent>
              <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm">
                {instructorCriteria}
              </p>
            </CardContent>
          )}
        </Card>
      )}
      {mode === "tasty" && tasteRequirement !== "off" && (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            What makes this assignment good?
            {tasteIsDefault && (
              <Badge variant="secondary">AI draft — make it yours</Badge>
            )}
            {tasteRequirement === "required" && (
              <Badge variant="outline">Part of the deliverable</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Think out loud — no grid, no criteria to fill in. What would make
            this work genuinely good, and what&apos;s the bar you&apos;d be
            proud to clear? Your class&apos;s answers together become the
            rubric everyone is graded by, so write it your way. Dictate it,
            paste it, ramble a little. After the deadline it counts as late.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <textarea
            value={taste}
            onChange={(e) => setTaste(e.target.value)}
            placeholder="Good work here would…"
            rows={10}
            aria-label="What makes this assignment good?"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveTaste} disabled={savingTaste}>
              {savingTaste ? "Saving…" : "Save taste file"}
            </Button>
            {tasteRequirement === "required" && tasteUnwritten && (
              <span className="text-sm text-muted-foreground">
                Needed before you can hand in the work.
              </span>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {submittedAt ? "Your submission" : "Submit your work"}
          </CardTitle>
          <CardDescription>
            One file — {acceptLabel}, up to 20 MB — your entire submission
            for this assignment, so combine any parts into a single file.
            Don&apos;t put your name in it — your work is judged anonymously.
            Resubmitting replaces the file (your last edit is what counts for
            timeliness).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {/* The deadline shows whether or not anything is submitted — it
              matters most to the student who hasn't submitted yet. */}
          <p
            className={
              deadlinePassed
                ? "text-sm font-medium text-amber-600 dark:text-amber-400"
                : "text-sm text-muted-foreground"
            }
          >
            {deadlinePassed ? "Past due — submissions marked late" : "Due"}{" "}
            <LocalTime iso={deadline} />
          </p>

          {submittedAt && (
            <div className="grid gap-1 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                Submitted <LocalTime iso={submittedAt} />
              </p>
              {submittedFileUrl ? (
                <a
                  href={submittedFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit text-sm underline underline-offset-4"
                >
                  Open the file you submitted
                  {submittedFileExt ? ` (${submittedFileExt.toUpperCase()})` : ""}
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your file is stored. Reload if the link doesn&apos;t appear.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="note">Note to the graders (optional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the reader should know"
            />
            {submittedAt ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => void saveNote()}
                  disabled={savingNote || !noteChanged}
                >
                  {savingNote ? "Saving…" : "Save note"}
                </Button>
                {noteChanged && (
                  <span className="text-xs text-muted-foreground">
                    Unsaved
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Saved together with your file when you upload.
              </p>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={deliverableAccept(deliverableType)}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-fit"
          >
            {uploading
              ? "Uploading…"
              : submittedAt
                ? "Replace file"
                : "Choose your file"}
          </Button>
          {deadlinePassed && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              The deadline has passed, but you can still turn in your work — it
              will be marked late. Submissions close for good once your
              professor starts grading.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
