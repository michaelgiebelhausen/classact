"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { saveTasteFile, submitWork } from "@/server/actions/assignments";
import type { TasteCriterion } from "@/types/db";

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
  initialCriteria: TasteCriterion[];
  initialBar: string;
  tasteIsDefault: boolean;
  submittedAt: string | null;
  submissionNote: string;
}

export function SubmissionEditor({
  courseId,
  assignmentId,
  enrollmentId,
  deadline,
  initialCriteria,
  initialBar,
  tasteIsDefault,
  submittedAt,
  submissionNote,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [criteria, setCriteria] = useState<TasteCriterion[]>(
    initialCriteria.length > 0
      ? initialCriteria
      : [{ name: "", standard: "" }]
  );
  const [bar, setBar] = useState(initialBar);
  const [savingTaste, setSavingTaste] = useState(false);
  const [note, setNote] = useState(submissionNote);
  const [uploading, setUploading] = useState(false);

  function setCriterion(i: number, patch: Partial<TasteCriterion>) {
    setCriteria((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  async function saveTaste() {
    setSavingTaste(true);
    const result = await saveTasteFile(assignmentId, criteria, bar);
    setSavingTaste(false);
    if (result.ok) {
      toast.success("Taste file saved — that's the standard you'll be judged by.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleFile(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Keep your PDF under 20 MB.");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const storagePath = `${courseId}/sub/${enrollmentId}/${crypto.randomUUID()}.pdf`;
    const { error } = await supabase.storage
      .from(ASSIGNMENT_BUCKET)
      .upload(storagePath, file, { contentType: "application/pdf" });
    if (error) {
      setUploading(false);
      toast.error("Upload failed — try again.");
      return;
    }
    const result = await submitWork(assignmentId, storagePath, note);
    setUploading(false);
    if (result.ok) {
      toast.success(
        submittedAt ? "Submission replaced." : "Submitted. You can replace it until the deadline."
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Your taste file
            {tasteIsDefault && (
              <Badge variant="secondary">AI draft — make it yours</Badge>
            )}
          </CardTitle>
          <CardDescription>
            The standard you hold this work to — your class&apos;s taste files
            together become the rubric everyone is graded by. Sharpening it
            (and meeting it) feeds your &ldquo;holds a high standard&rdquo;
            statistic. Locks at the deadline.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="bar">My bar</Label>
            <Input
              id="bar"
              value={bar}
              onChange={(e) => setBar(e.target.value)}
              placeholder="I won't turn in anything I wouldn't show an employer."
            />
          </div>
          <div className="grid gap-3">
            {criteria.map((c, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={c.name}
                    onChange={(e) => setCriterion(i, { name: e.target.value })}
                    placeholder="Criterion (e.g. Evidence)"
                    className="max-w-xs font-medium"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCriteria((prev) => prev.filter((_, j) => j !== i))
                    }
                    aria-label="Remove criterion"
                  >
                    Remove
                  </Button>
                </div>
                <textarea
                  value={c.standard}
                  onChange={(e) => setCriterion(i, { standard: e.target.value })}
                  placeholder="What does excellent look like, concretely?"
                  rows={2}
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setCriteria((prev) => [...prev, { name: "", standard: "" }])
              }
            >
              Add criterion
            </Button>
            <Button onClick={saveTaste} disabled={savingTaste}>
              {savingTaste ? "Saving…" : "Save taste file"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {submittedAt ? "Your submission" : "Submit your work"}
          </CardTitle>
          <CardDescription>
            One PDF, up to 20 MB. Don&apos;t put your name in the file —
            your work is judged anonymously. Resubmitting before the deadline
            replaces the file (your last edit is what counts for timeliness).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {submittedAt && (
            <p className="text-sm text-muted-foreground">
              Submitted {new Date(submittedAt).toLocaleString()} · deadline{" "}
              {new Date(deadline).toLocaleString()}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="note">Note to the graders (optional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the reader should know"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
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
                ? "Replace PDF"
                : "Upload PDF"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
